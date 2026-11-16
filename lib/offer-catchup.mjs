// 把冻结点之后的行情变更从一份库导出，再合并进已经瘦身的库。
// 导出只用只读连接，避免误写生产库。不碰赞助、投稿、analytics 那些独立库。
import path from 'node:path';
import {openDb, openDbReadOnly} from './db.mjs';

export const FREEZE_BEIJING = '2026-11-06 10:16';
const RETENTION_META = new Set(['offer_detail_before', 'offer_dedupe_active', 'offer_retention_last_day', 'offer_candle_hours', 'catchup_since']);

export function parseSince(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('缺少 --since。冻结点示例：2026-11-06 10:16');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
    const normalized = text.replace(' ', 'T');
    const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized;
    const parsed = new Date(`${withSeconds}+08:00`);
    if (!Number.isFinite(+parsed)) throw new Error(`无法把「${text}」当成北京时间`);
    return parsed.toISOString();
  }
  const parsed = new Date(text);
  if (!Number.isFinite(+parsed)) throw new Error(`无法解析时间「${text}」。用 2026-11-06 10:16 或 ISO。`);
  return parsed.toISOString();
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnInfo(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function sharedColumns(source, dest, table) {
  const src = columnInfo(source, table);
  const destNames = new Set(columnInfo(dest, table).map(column => column.name));
  for (const column of src) {
    if (destNames.has(column.name)) continue;
    dest.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type || 'TEXT'}`);
    destNames.add(column.name);
  }
  return src.map(column => column.name).filter(name => destNames.has(name));
}

function copyRows(source, dest, table, whereSql, params, {ignore = true} = {}) {
  if (!tableExists(source, table)) return {seen: 0, written: 0};
  const columns = sharedColumns(source, dest, table);
  const verb = ignore ? 'INSERT OR IGNORE' : 'INSERT';
  const insert = dest.prepare(`${verb} INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  let seen = 0, written = 0;
  dest.exec('BEGIN IMMEDIATE');
  try {
    for (const row of source.prepare(`SELECT * FROM ${table} WHERE ${whereSql}`).iterate(...params)) {
      seen += 1;
      written += insert.run(...columns.map(name => row[name] ?? null)).changes;
      if (seen % 500 === 0) {
        dest.exec('COMMIT');
        dest.exec('BEGIN IMMEDIATE');
      }
    }
    dest.exec('COMMIT');
  } catch (error) {
    try { dest.exec('ROLLBACK'); } catch { /* 已提交的批次保留，调用方可以重跑。 */ }
    throw error;
  }
  return {seen, written};
}

function snapshotFilter(table) {
  return `EXISTS (SELECT 1 FROM snapshots s WHERE s.source=${table}.source AND s.snapshot_id=${table}.snapshot_id AND s.fetched_at >= ?)`;
}

export function exportOfferChanges(sourcePath, outPath, since) {
  if (path.resolve(sourcePath) === path.resolve(outPath)) throw new Error('导出文件不能和源库是同一个路径');
  const source = openDbReadOnly(sourcePath);
  const dest = openDb(outPath);
  try {
    const report = {since, source: path.resolve(sourcePath), out: path.resolve(outPath)};
    report.snapshots = copyRows(source, dest, 'snapshots', 'fetched_at >= ?', [since]);
    report.products = copyRows(source, dest, 'products', snapshotFilter('products'), [since]);
    report.offers = copyRows(source, dest, 'offers', snapshotFilter('offers'), [since]);
    if (tableExists(source, 'alerts')) report.alerts = copyRows(source, dest, 'alerts', 'ts >= ?', [since]);
    if (tableExists(source, 'rule_state')) report.ruleState = copyRows(source, dest, 'rule_state', 'updated_at >= ? OR updated_at IS NULL', [since]);
    if (tableExists(source, 'meta')) report.meta = copyRows(source, dest, 'meta', "key LIKE 'health:%'", []);
    dest.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('catchup_since', since);
    return report;
  } finally {
    source.close();
    dest.close();
  }
}

function mergeRuleState(source, dest) {
  if (!tableExists(source, 'rule_state')) return {seen: 0, written: 0};
  sharedColumns(source, dest, 'rule_state');
  const insert = dest.prepare(
    `INSERT INTO rule_state(rule_key, state, updated_at) VALUES(?,?,?)
     ON CONFLICT(rule_key) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
     WHERE excluded.updated_at >= rule_state.updated_at OR rule_state.updated_at IS NULL`
  );
  let seen = 0, written = 0;
  dest.exec('BEGIN IMMEDIATE');
  try {
    for (const row of source.prepare('SELECT * FROM rule_state').iterate()) {
      seen += 1;
      written += insert.run(row.rule_key, row.state ?? null, row.updated_at ?? null).changes;
    }
    dest.exec('COMMIT');
  } catch (error) {
    try { dest.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return {seen, written};
}

function mergeHealth(source, dest) {
  if (!tableExists(source, 'meta')) return {seen: 0, written: 0};
  const insert = dest.prepare(
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value
     WHERE meta.key LIKE 'health:%'`
  );
  let seen = 0, written = 0;
  for (const row of source.prepare("SELECT key, value FROM meta WHERE key LIKE 'health:%'").iterate()) {
    if (RETENTION_META.has(row.key)) continue;
    seen += 1;
    written += insert.run(row.key, row.value).changes;
  }
  return {seen, written};
}

export function mergeOfferChanges(intoPath, fromPath) {
  if (path.resolve(intoPath) === path.resolve(fromPath)) throw new Error('精简库和补录文件不能是同一个路径');
  const source = openDbReadOnly(fromPath);
  const dest = openDb(intoPath);
  try {
    const kept = dest.prepare("SELECT value FROM meta WHERE key='offer_detail_before'").get()?.value ?? null;
    const report = {into: path.resolve(intoPath), from: path.resolve(fromPath)};
    report.snapshots = copyRows(source, dest, 'snapshots', '1=1', []);
    report.products = copyRows(source, dest, 'products', '1=1', []);
    report.offers = copyRows(source, dest, 'offers', '1=1', []);
    if (tableExists(source, 'alerts')) report.alerts = copyRows(source, dest, 'alerts', '1=1', []);
    report.ruleState = mergeRuleState(source, dest);
    report.meta = mergeHealth(source, dest);
    const after = dest.prepare("SELECT value FROM meta WHERE key='offer_detail_before'").get()?.value ?? null;
    if (after !== kept) throw new Error('补录改写了瘦身水位，已中止');
    return report;
  } finally {
    source.close();
    dest.close();
  }
}
