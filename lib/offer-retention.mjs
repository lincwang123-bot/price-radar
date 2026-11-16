// 主库 offers 瘦身：热窗口保留完整明细；更早的重复报价收成投影点；
// 超过保留期的明细先滚成上海时区 K 线（默认 4 小时），再分批删除。
// 最新快照始终写完整行，价格页、盯盘和赞助位仍按 snapshot_id 读取。
import {createGzip, createGunzip} from 'node:zlib';
import {createReadStream, createWriteStream} from 'node:fs';
import {copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, statfsSync} from 'node:fs';
import {once} from 'node:events';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {metaSet} from './db.mjs';
import {productQuoteGroups, projectProduct} from './quote-policy.mjs';

export const CHART_SNAPSHOTS = 120;
export const MIN_PROTECT_SNAPSHOTS = 160;
export const CANDLE_HOUR_CHOICES = Object.freeze([1, 2, 3, 4, 6, 8, 12, 24]);
const DAY_MS = 86400000;
const SHANGHAI_OFFSET = 8 * 3600000;

export function candleHours(value) {
  const hours = Math.floor(Number(value) || 4);
  if (!CANDLE_HOUR_CHOICES.includes(hours)) {
    throw new Error(`K 线粒度只能是 ${CANDLE_HOUR_CHOICES.join('/')} 小时，默认 4`);
  }
  return hours;
}

/** 桶起点对齐上海时区 0 点，再按 hours 切。4 小时就是 0/4/8/12/16/20 点。 */
export function candleBucketStart(value, hours = 4) {
  const span = candleHours(hours);
  const ms = +new Date(value);
  if (!Number.isFinite(ms)) throw new Error('无效时间');
  const shanghai = ms + SHANGHAI_OFFSET;
  const day = Math.floor(shanghai / DAY_MS) * DAY_MS;
  const hour = Math.floor((shanghai - day) / 3600000);
  const bucketHour = Math.floor(hour / span) * span;
  return new Date(day + bucketHour * 3600000 - SHANGHAI_OFFSET).toISOString();
}

export function shanghaiDay(value) {
  return new Date(+new Date(value) + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

export function shanghaiHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23',
  }).format(now));
}

export function sameObservedQuote(a, b) {
  const num = value => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return num(a?.price) === num(b?.price)
    && num(a?.stock_count ?? a?.stockCount) === num(b?.stock_count ?? b?.stockCount)
    && (a?.currency ?? null) === (b?.currency ?? null)
    && (a?.status ?? null) === (b?.status ?? null)
    && (a?.title ?? null) === (b?.title ?? null)
    && (a?.url ?? null) === (b?.url ?? null);
}

export function stockStatusOf(point) {
  const stock = Number(point?.in_stock_count);
  const offers = Number(point?.offer_count);
  if (Number.isFinite(stock) && stock > 0) return 'in_stock';
  if (Number.isFinite(offers) && offers > 0) return 'out_of_stock';
  return 'unknown';
}

export function protectSnapshotCount(config = {}) {
  const windows = (config.watch?.rules || []).map(rule => Math.max(0, Math.floor(Number(rule.window) || 0)));
  const watchNeed = Math.max(24, ...windows, 0) + 2;
  const requested = Math.floor(Number(config.offerRetention?.protectSnapshots) || 0);
  // 下限盖住前台 120 个点的走势和默认盯盘窗口。配置只能加大，不能把热窗口削到走势下面。
  return Math.max(MIN_PROTECT_SNAPSHOTS, watchNeed, requested);
}

function finitePrice(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 事务没打开时忽略 */ }
    throw error;
  }
}

function upsertCandle(db, row) {
  db.prepare(
    `INSERT INTO offer_candle (
       source, product_id, comparison_key, bucket_start, hours, currency,
       price_open, price_low, price_high, price_close,
       in_stock_open, in_stock_close, offer_count_close, stock_status,
       comparable, series_key, observations, first_at, last_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source, product_id, comparison_key, bucket_start, hours) DO UPDATE SET
       currency=COALESCE(excluded.currency, offer_candle.currency),
       price_open=COALESCE(offer_candle.price_open, excluded.price_open),
       price_low=CASE
         WHEN offer_candle.price_low IS NULL THEN excluded.price_low
         WHEN excluded.price_low IS NULL THEN offer_candle.price_low
         ELSE MIN(offer_candle.price_low, excluded.price_low) END,
       price_high=CASE
         WHEN offer_candle.price_high IS NULL THEN excluded.price_high
         WHEN excluded.price_high IS NULL THEN offer_candle.price_high
         ELSE MAX(offer_candle.price_high, excluded.price_high) END,
       price_close=COALESCE(excluded.price_close, offer_candle.price_close),
       in_stock_open=COALESCE(offer_candle.in_stock_open, excluded.in_stock_open),
       in_stock_close=excluded.in_stock_close,
       offer_count_close=excluded.offer_count_close,
       stock_status=excluded.stock_status,
       comparable=excluded.comparable,
       series_key=excluded.series_key,
       observations=offer_candle.observations+excluded.observations,
       first_at=MIN(offer_candle.first_at, excluded.first_at),
       last_at=CASE WHEN excluded.last_at>=offer_candle.last_at THEN excluded.last_at ELSE offer_candle.last_at END`
  ).run(
    row.source, row.productId, row.comparisonKey, row.bucketStart, row.hours, row.currency,
    row.priceOpen, row.priceLow, row.priceHigh, row.priceClose,
    row.inStockOpen, row.inStockClose, row.offerCountClose, row.stockStatus,
    row.comparable ? 1 : 0, row.seriesKey, 1, row.at, row.at,
  );
}

function candleRowFromPoint(source, productId, comparisonKey, point, at, hours, stockStatus = null) {
  const price = finitePrice(point.lowest_price);
  return {
    source, productId, comparisonKey, bucketStart: candleBucketStart(at, hours), hours, currency: point.currency ?? null,
    priceOpen: price, priceLow: price, priceHigh: price, priceClose: price,
    inStockOpen: point.in_stock_count ?? 0, inStockClose: point.in_stock_count ?? 0,
    offerCountClose: point.offer_count ?? 0, stockStatus: stockStatus || stockStatusOf(point),
    comparable: !!point.comparable, seriesKey: point.comparison_key || point.series_key || comparisonKey || '',
    at,
  };
}
function stockFromRaw(projected, raw) {
  const status = stockStatusOf(projected);
  if (status !== 'unknown') return status;
  const sold = (raw || []).some(offer => Number(offer.stock_count) === 0 || ['out_of_stock', 'sold_out', 'soldout', 'unavailable'].includes(String(offer.status || '').toLowerCase()));
  return sold ? 'out_of_stock' : 'unknown';
}

function foldProjected(db, source, productId, projected, groups, at, hours, rawOffers) {
  upsertCandle(db, candleRowFromPoint(source, productId, '', projected, at, hours, stockFromRaw(projected, rawOffers)));
  for (const group of groups) {
    if (!group.comparison_key) continue;
    upsertCandle(db, candleRowFromPoint(source, productId, group.comparison_key, group, at, hours));
  }
}

function foldSnapshotOfferRows(db, snap, hours, offers) {
  const byProduct = new Map();
  for (const offer of offers) {
    if (!byProduct.has(offer.product_id)) byProduct.set(offer.product_id, []);
    byProduct.get(offer.product_id).push(offer);
  }
  const products = db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(snap.source, snap.snapshot_id);
  for (const product of products) {
    const rows = byProduct.get(product.product_id) || [];
    if (!rows.length) continue;
    const projected = projectProduct(db, snap.source, snap, product, {historical: true, offers: rows});
    foldProjected(db, snap.source, product.product_id, projected, productQuoteGroups(projected), snap.fetched_at, hours, rows);
  }
}

function foldSnapshotOffers(db, snap, hours) {
  foldSnapshotOfferRows(db, snap, hours, db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=?').all(snap.source, snap.snapshot_id));
}

function foldSnapshotPoints(db, snap, hours) {
  const rows = db.prepare('SELECT * FROM offer_snapshot_point WHERE source=? AND snapshot_id=?').all(snap.source, snap.snapshot_id);
  for (const row of rows) {
    upsertCandle(db, candleRowFromPoint(row.source, row.product_id, row.comparison_key, {
      lowest_price: row.lowest_price,
      currency: row.currency,
      comparable: !!row.comparable,
      comparison_key: row.series_key || row.comparison_key,
      in_stock_count: row.in_stock_count,
      offer_count: row.offer_count,
    }, snap.fetched_at, hours));
  }
}

export function loadSnapshots(db) {
  return db.prepare(
    'SELECT source, snapshot_id, fetched_at, generated_at, published_at, stale, rowid FROM snapshots ORDER BY source, fetched_at ASC, rowid ASC'
  ).all();
}

/** 只读快照清单，在内存里决定哪些快照的 offers 可以删。不扫 offers。 */
export function classifySnapshots(rows, horizon, protectSnapshots) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.source)) groups.set(row.source, []);
    groups.get(row.source).push(row);
  }
  const drop = [];
  const keep = [];
  for (const list of groups.values()) {
    const hotStart = Math.max(0, list.length - protectSnapshots);
    for (let index = 0; index < list.length; index++) {
      const snap = list[index];
      if (index < hotStart && snap.fetched_at < horizon) drop.push(snap);
      else keep.push(snap);
    }
  }
  drop.sort((a, b) => a.fetched_at < b.fetched_at ? -1 : a.fetched_at > b.fetched_at ? 1 : a.rowid - b.rowid);
  return {drop, keep};
}

function countOffersIn(db, snaps) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM offers WHERE source=? AND snapshot_id=?');
  let total = 0;
  for (const snap of snaps) total += Number(count.get(snap.source, snap.snapshot_id).n) || 0;
  return total;
}

export function installSlimSnapshotTable(db, classified) {
  db.exec('DROP TABLE IF EXISTS temp.slim_snapshot');
  db.exec(
    `CREATE TEMP TABLE slim_snapshot (
       source TEXT NOT NULL,
       snapshot_id TEXT NOT NULL,
       fetched_at TEXT NOT NULL,
       drop_offers INTEGER NOT NULL,
       PRIMARY KEY (source, snapshot_id)
     )`
  );
  const insert = db.prepare('INSERT INTO slim_snapshot(source, snapshot_id, fetched_at, drop_offers) VALUES(?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const snap of classified.drop) insert.run(snap.source, snap.snapshot_id, snap.fetched_at, 1);
    for (const snap of classified.keep) insert.run(snap.source, snap.snapshot_id, snap.fetched_at, 0);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 临时表建失败时主库还没改明细。 */ }
    throw error;
  }
  db.exec('CREATE INDEX IF NOT EXISTS temp.slim_snapshot_drop ON slim_snapshot(drop_offers, fetched_at)');
}

export function retentionHorizon(now, days) {
  const span = Math.max(1, Math.floor(Number(days) || 30));
  return new Date(+now - span * DAY_MS).toISOString();
}

export function rollupOffersBefore(db, horizon, protectSnapshots, {maxSnapshots = Infinity, shouldStop = () => false, candleHours: requestedHours = 4} = {}) {
  const hours = candleHours(requestedHours);
  const pending = db.prepare(
    `SELECT s.source, s.snapshot_id, s.fetched_at, s.generated_at, s.published_at, s.stale
     FROM slim_snapshot d
     JOIN snapshots s ON s.source=d.source AND s.snapshot_id=d.snapshot_id
     WHERE d.drop_offers=1
       AND NOT EXISTS (SELECT 1 FROM offer_rolled r WHERE r.source=d.source AND r.snapshot_id=d.snapshot_id)
     ORDER BY d.fetched_at ASC
     LIMIT ?`
  ).all(Number.isFinite(maxSnapshots) ? maxSnapshots : 1e15);
  let rolled = 0;
  for (const snap of pending) {
    if (shouldStop()) break;
    withTransaction(db, () => {
      const partial = db.prepare('SELECT partial FROM offer_compacted WHERE source=? AND snapshot_id=?').get(snap.source, snap.snapshot_id);
      if (partial?.partial) foldSnapshotPoints(db, snap, hours);
      else foldSnapshotOffers(db, snap, hours);
      db.prepare('INSERT OR IGNORE INTO offer_rolled(source, snapshot_id, rolled_at) VALUES(?,?,?)')
        .run(snap.source, snap.snapshot_id, new Date().toISOString());
    });
    rolled += 1;
  }
  if (rolled) metaSet(db, 'offer_candle_hours', String(hours));
  return {rolled, hours};
}

function loadHeads(db, source) {
  const heads = new Map();
  for (const row of db.prepare('SELECT * FROM offer_head WHERE source=?').all(source)) {
    heads.set(row.product_id + '\0' + row.offer_id, row);
  }
  return heads;
}

function writeHead(db, source, offer, seenAt) {
  db.prepare(
    `INSERT INTO offer_head(source, product_id, offer_id, price, currency, status, stock_count, title, url, last_seen_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source, product_id, offer_id) DO UPDATE SET
       price=excluded.price, currency=excluded.currency, status=excluded.status,
       stock_count=excluded.stock_count, title=excluded.title, url=excluded.url,
       last_seen_at=excluded.last_seen_at`
  ).run(source, offer.product_id, offer.offer_id, finitePrice(offer.price), offer.currency ?? null, offer.status ?? null, finitePrice(offer.stock_count), offer.title ?? null, offer.url ?? null, seenAt);
}

function rememberPoints(db, source, snap, products, offersByProduct) {
  const insert = db.prepare(
    `INSERT INTO offer_snapshot_point(
       source, snapshot_id, product_id, comparison_key, fetched_at, lowest_price, currency,
       comparable, series_key, in_stock_count, offer_count
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source, snapshot_id, product_id, comparison_key) DO UPDATE SET
       fetched_at=excluded.fetched_at, lowest_price=excluded.lowest_price, currency=excluded.currency,
       comparable=excluded.comparable, series_key=excluded.series_key,
       in_stock_count=excluded.in_stock_count, offer_count=excluded.offer_count`
  );
  const put = (productId, key, point) => insert.run(
    source, snap.snapshot_id, productId, key, snap.fetched_at, finitePrice(point.lowest_price), point.currency ?? null,
    point.comparable ? 1 : 0, point.comparison_key || key, point.in_stock_count ?? 0, point.offer_count ?? 0,
  );
  for (const product of products) {
    const offers = offersByProduct.get(product.product_id) || [];
    const projected = projectProduct(db, source, snap, product, {historical: true, offers});
    put(product.product_id, '', projected);
    for (const group of productQuoteGroups(projected)) {
      if (group.comparison_key) put(product.product_id, group.comparison_key, group);
    }
  }
}

function touchLastSeen(db, source, offer, before, seenAt) {
  const row = db.prepare(
    `SELECT o.rowid AS id FROM offers o
     JOIN snapshots s ON s.source=o.source AND s.snapshot_id=o.snapshot_id
     WHERE o.source=? AND o.product_id=? AND o.offer_id=? AND s.fetched_at<?
     ORDER BY s.fetched_at DESC, o.rowid DESC LIMIT 1`
  ).get(source, offer.product_id, offer.offer_id, before);
  if (!row) return;
  try {
    db.prepare('UPDATE offers SET last_seen_at=? WHERE rowid=? AND (last_seen_at IS NULL OR last_seen_at<?)').run(seenAt, row.id, seenAt);
  } catch { /* 只读旧库没有 last_seen_at 时，去重本身不在这条路径上。 */ }
}

function compactSnapshot(db, source, snap) {
  const products = db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(source, snap.snapshot_id);
  const offers = db.prepare('SELECT rowid AS offer_rowid, * FROM offers WHERE source=? AND snapshot_id=?').all(source, snap.snapshot_id);
  const offersByProduct = new Map();
  for (const offer of offers) {
    if (!offersByProduct.has(offer.product_id)) offersByProduct.set(offer.product_id, []);
    offersByProduct.get(offer.product_id).push(offer);
  }
  const heads = loadHeads(db, source);
  const seen = new Set();
  const removals = [];
  for (const offer of offers) {
    const key = offer.product_id + '\0' + offer.offer_id;
    seen.add(key);
    const head = heads.get(key);
    if (head && sameObservedQuote(head, offer)) removals.push(offer);
  }
  const retired = [];
  for (const [key, head] of heads) {
    if (!seen.has(key)) retired.push(head);
  }
  const partial = removals.length > 0 ? 1 : 0;
  withTransaction(db, () => {
    if (partial) rememberPoints(db, source, snap, products, offersByProduct);
    for (const offer of removals) {
      touchLastSeen(db, source, offer, snap.fetched_at, snap.fetched_at);
      writeHead(db, source, offer, snap.fetched_at);
      db.prepare('DELETE FROM offers WHERE rowid=?').run(offer.offer_rowid);
    }
    for (const offer of offers) {
      const key = offer.product_id + '\0' + offer.offer_id;
      if (heads.get(key) && sameObservedQuote(heads.get(key), offer)) continue;
      writeHead(db, source, offer, snap.fetched_at);
    }
    for (const head of retired) {
      db.prepare('DELETE FROM offer_head WHERE source=? AND product_id=? AND offer_id=?').run(source, head.product_id, head.offer_id);
    }
    db.prepare(
      `INSERT INTO offer_compacted(source, snapshot_id, compacted_at, partial) VALUES(?,?,?,?)
       ON CONFLICT(source, snapshot_id) DO UPDATE SET compacted_at=excluded.compacted_at, partial=excluded.partial`
    ).run(source, snap.snapshot_id, new Date().toISOString(), partial);
  });
  return {removed: removals.length, retired: retired.length, partial};
}

export function dedupeStableOffers(db, {protectSnapshots = MIN_PROTECT_SNAPSHOTS, maxSnapshots = 8, shouldStop = () => false, globalLimit = false} = {}) {
  const sources = db.prepare('SELECT DISTINCT source FROM snapshots').all();
  let compacted = 0, removed = 0, retired = 0, partial = 0;
  for (const {source} of sources) {
    if ((globalLimit && compacted >= maxSnapshots) || shouldStop()) break;
    const snaps = db.prepare('SELECT snapshot_id, fetched_at, rowid FROM snapshots WHERE source=? ORDER BY fetched_at ASC, rowid ASC').all(source);
    if (snaps.length <= protectSnapshots) continue;
    const protectedIds = new Set(snaps.slice(-protectSnapshots).map(row => row.snapshot_id));
    const done = new Set(db.prepare('SELECT snapshot_id FROM offer_compacted WHERE source=?').all(source).map(row => row.snapshot_id));
    let budget = maxSnapshots;
    for (const snap of snaps) {
      if (budget <= 0 || (globalLimit && compacted >= maxSnapshots) || shouldStop()) break;
      if (protectedIds.has(snap.snapshot_id)) break;
      if (done.has(snap.snapshot_id)) continue;
      const result = compactSnapshot(db, source, snap);
      compacted += 1;
      removed += result.removed;
      retired += result.retired;
      partial += result.partial;
      budget -= 1;
    }
  }
  if (partial > 0 || db.prepare('SELECT 1 FROM offer_compacted WHERE partial=1 LIMIT 1').get()) {
    metaSet(db, 'offer_dedupe_active', '1');
  }
  return {compacted, removed, retired, partial};
}

export function deleteRolledOffers(db, _horizon, _protectSnapshots, {batchSnapshots = 20, checkpoint = true, maxBatches = Infinity, shouldStop = () => false} = {}) {
  let removedOffers = 0, batches = 0;
  for (; batches < maxBatches;) {
    if (shouldStop()) break;
    const snaps = db.prepare(
      `SELECT d.source, d.snapshot_id FROM slim_snapshot d
       WHERE d.drop_offers=1
         AND EXISTS (SELECT 1 FROM offer_rolled r WHERE r.source=d.source AND r.snapshot_id=d.snapshot_id)
         AND (
           EXISTS (SELECT 1 FROM offers o WHERE o.source=d.source AND o.snapshot_id=d.snapshot_id)
           OR EXISTS (SELECT 1 FROM offer_snapshot_point p WHERE p.source=d.source AND p.snapshot_id=d.snapshot_id)
         )
       ORDER BY d.fetched_at ASC
       LIMIT ?`
    ).all(batchSnapshots);
    if (!snaps.length) break;
    const removed = withTransaction(db, () => {
      let count = 0;
      for (const snap of snaps) {
        count += db.prepare('DELETE FROM offers WHERE source=? AND snapshot_id=?').run(snap.source, snap.snapshot_id).changes;
        db.prepare('DELETE FROM offer_snapshot_point WHERE source=? AND snapshot_id=?').run(snap.source, snap.snapshot_id);
      }
      return count;
    });
    removedOffers += removed;
    batches += 1;
    if (checkpoint) {
      try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { /* 内存库没有 WAL 文件 */ }
    }
  }
  return {removedOffers, batches};
}

function columnBytes(row) {
  let bytes = 24;
  for (const value of Object.values(row)) {
    if (value == null) bytes += 1;
    else if (typeof value === 'number') bytes += 8;
    else bytes += Buffer.byteLength(String(value)) + 1;
  }
  return bytes;
}

export function estimateOfferFootprint(db, horizon, protectSnapshots) {
  const classified = classifySnapshots(loadSnapshots(db), horizon, protectSnapshots);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size) || 4096;
  const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count) || 0;
  const freelist = Number(db.prepare('PRAGMA freelist_count').get().freelist_count) || 0;
  const autoVacuum = Number(db.prepare('PRAGMA auto_vacuum').get().auto_vacuum) || 0;
  const eligible = countOffersIn(db, classified.drop);
  const keepOffers = countOffersIn(db, classified.keep);
  const offers = eligible + keepOffers;
  const sample = [];
  const sampleStmt = db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? LIMIT ?');
  for (const snap of classified.drop) {
    if (sample.length >= 80) break;
    sample.push(...sampleStmt.all(snap.source, snap.snapshot_id, 80 - sample.length));
  }
  const avg = sample.length ? sample.reduce((sum, row) => sum + columnBytes(row), 0) / sample.length : 500;
  const payloadBytes = Math.round(avg * eligible);
  // 主键加四条索引。宽文本行的索引通常小于正文，这里按正文的 0.8 倍估，并在报告里标明是估算。
  const indexBytes = Math.round(payloadBytes * 0.8);
  const logicalReclaimBytes = payloadBytes + indexBytes;
  const fileBytes = pageCount * pageSize;
  const usedBytes = Math.max(0, pageCount - freelist) * pageSize;
  return {
    offers,
    eligible,
    keep: Math.max(0, offers - eligible),
    sampleRows: sample.length,
    avgRowBytes: Math.round(avg),
    payloadBytes,
    indexBytes,
    estimatedLogicalReclaimBytes: Math.min(logicalReclaimBytes, usedBytes || logicalReclaimBytes),
    estimatedArchiveBytes: Math.ceil(payloadBytes * 0.45),
    fileBytes,
    usedBytes,
    freelistPages: freelist,
    pageSize,
    autoVacuum,
    incrementalVacuumAvailable: autoVacuum === 2,
    estimatedVacuumIntoBytes: Math.max(pageSize, usedBytes - Math.min(logicalReclaimBytes, usedBytes)),
    eligibleSnapshots: classified.drop.length,
    estimatedSlimBytes: estimateSlimOutputBytes({keptRows: keepOffers, totalRows: offers, fileBytes}),
  };
}

export function reclaimGuidance(estimate) {
  const lines = [];
  if (estimate.incrementalVacuumAvailable && estimate.freelistPages > 0) {
    lines.push('当前库已是 incremental auto_vacuum，删除后可以用 PRAGMA incremental_vacuum 按页把空闲页还给系统，不需要第二份全库空间。');
  } else if (estimate.incrementalVacuumAvailable) {
    lines.push('当前库已是 incremental auto_vacuum。删除完成并出现 freelist 后，再执行 PRAGMA incremental_vacuum，即可按页回收，不要先做全量 VACUUM。');
  } else {
    lines.push('当前库 auto_vacuum=0（普通模式）。PRAGMA incremental_vacuum 不会缩小文件。删除只会把页面放进 freelist，文件大小不变，但后续写入会复用这些页，库会停止继续涨。');
    lines.push('不要在这块只剩 4–6G 的盘上执行 VACUUM 或 VACUUM INTO。原地 VACUUM 需要大约一份结果库的临时空间，结果库仍有几十 GB，会把盘写满。');
    lines.push('要真正缩小文件：把新卷挂上，确认目标卷空闲大于 estimatedVacuumIntoBytes 加 2GB 余量，再执行本脚本的 --vacuum-into。校验行数和 quick_check 之后，在维护窗口用新文件替换旧文件。VACUUM INTO 会顺便把新文件设为 incremental，以后的每日清理就能按页回收。');
  }
  lines.push('替换完成前不要删除旧库。WAL 里的删除会在每批 PASSIVE checkpoint 后复用，不需要为了回收而停采集。');
  return lines;
}

export function assessVacuumInto({sourcePath, destPath, resultBytes, reserveBytes = 2 * 1024 ** 3, statImpl = statSync, statfsImpl = statfsSync}) {
  const destDir = path.dirname(destPath);
  const free = Number(statfsImpl(destDir).bavail) * Number(statfsImpl(destDir).bsize);
  const sameDevice = statImpl(sourcePath).dev === statImpl(destDir).dev;
  const need = Math.ceil(resultBytes + reserveBytes);
  if (!(free >= need)) {
    return {ok: false, sameDevice, free, need, reason: '目标位置剩余空间不够写下压缩后的库和余量。不要改在数据盘上原地 VACUUM。'};
  }
  return {
    ok: true, sameDevice, free, need,
    reason: sameDevice
      ? '目标和现库在同一块盘。VACUUM INTO 期间新旧两份文件同时存在，剩余空间必须盖住新文件，不能再跑原地 VACUUM。'
      : '目标在另一块卷上。写入完成并校验后，再在维护窗口替换旧文件。',
  };
}

function sqlPath(file) {
  return "'" + String(file).replaceAll("'", "''") + "'";
}

export function vacuumInto(db, sourcePath, destPath, estimate, {reserveBytes, statImpl, statfsImpl} = {}) {
  if (path.resolve(destPath) === path.resolve(sourcePath)) {
    throw new Error('VACUUM INTO 的新文件不能和正在瘦身的库是同一个路径');
  }
  if (existsSync(destPath)) throw new Error('VACUUM INTO 目标已存在，请换一个新文件路径，避免覆盖');
  mkdirSync(path.dirname(destPath), {recursive: true});
  const plan = assessVacuumInto({
    sourcePath, destPath, resultBytes: estimate.estimatedVacuumIntoBytes, reserveBytes, statImpl, statfsImpl,
  });
  if (!plan.ok) {
    const error = new Error(plan.reason);
    error.code = 'ENOSPC_GUARD';
    error.plan = plan;
    throw error;
  }
  db.exec('PRAGMA auto_vacuum=INCREMENTAL');
  db.exec('VACUUM INTO ' + sqlPath(destPath));
  const check = new DatabaseSync(destPath, {readOnly: true});
  try {
    plan.quickCheck = check.prepare('PRAGMA quick_check').get().quick_check;
    plan.autoVacuum = check.prepare('PRAGMA auto_vacuum').get().auto_vacuum;
    plan.destination = destPath;
  } finally { check.close(); }
  return plan;
}

function compareArchiveSnaps(a, b) {
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  const monthA = shanghaiDay(a.fetched_at).slice(0, 7);
  const monthB = shanghaiDay(b.fetched_at).slice(0, 7);
  if (monthA !== monthB) return monthA < monthB ? -1 : 1;
  if (a.fetched_at !== b.fetched_at) return a.fetched_at < b.fetched_at ? -1 : 1;
  return String(a.snapshot_id).localeCompare(String(b.snapshot_id));
}

async function writeLine(stream, line) {
  if (!stream.write(line)) await once(stream, 'drain');
}

async function hashFile(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), async function (source) {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest('hex');
}

/** 解压一遍，核对行数、压缩文件校验和和原文校验和。 */
export async function verifyGzipNdjson(file, expected) {
  const fileHash = createHash('sha256');
  const rawHash = createHash('sha256');
  let rows = 0;
  let pending = '';
  await pipeline(
    createReadStream(file.file || file),
    async function* (source) {
      for await (const chunk of source) {
        fileHash.update(chunk);
        yield chunk;
      }
    },
    createGunzip(),
    async function (source) {
      for await (const chunk of source) {
        rawHash.update(chunk);
        pending += chunk.toString('utf8');
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          if (pending.slice(0, newline).length) rows += 1;
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
      }
      if (pending.length) rows += 1;
    },
  );
  const sha256 = fileHash.digest('hex');
  const rawSha256 = rawHash.digest('hex');
  const pathName = file.file || file;
  if (rows !== expected.rows || sha256 !== expected.sha256 || rawSha256 !== expected.rawSha256) {
    const error = new Error(`归档校验失败 ${pathName}：解压行数 ${rows}，期望 ${expected.rows}`);
    error.code = 'ARCHIVE_MISMATCH';
    throw error;
  }
  return {rows, sha256, rawSha256};
}

export async function archiveEligibleOffers(db, horizon, protectSnapshots, archiveDir, {reserveBytes = 2 * 1024 ** 3, freeBytes = null, now = new Date(), snaps = null, shouldStop = () => false} = {}) {
  mkdirSync(archiveDir, {recursive: true});
  const estimate = estimateOfferFootprint(db, horizon, protectSnapshots);
  const free = freeBytes ?? Number(statfsSync(archiveDir).bavail) * Number(statfsSync(archiveDir).bsize);
  const need = estimate.estimatedArchiveBytes + reserveBytes;
  if (!(free >= need)) {
    const error = new Error(`归档目录剩余 ${free} 字节，按抽样估算至少需要 ${need} 字节（含余量）。请把 --archive 指到另一块卷，不要往这块快满的盘上继续写。`);
    error.code = 'ENOSPC_GUARD';
    throw error;
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const targets = snaps || db.prepare(
    `SELECT d.source, d.snapshot_id, d.fetched_at FROM slim_snapshot d
     WHERE d.drop_offers=1
       AND EXISTS (SELECT 1 FROM offer_rolled r WHERE r.source=d.source AND r.snapshot_id=d.snapshot_id)
     ORDER BY d.fetched_at ASC, d.source ASC`
  ).all();
  const offers = db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? ORDER BY rowid ASC');
  targets.sort(compareArchiveSnaps);
  const files = [];
  let current = null;
  let total = 0;
  const closeCurrent = async () => {
    if (!current) return;
    current.gzip.end();
    await once(current.out, 'finish');
    const sha256 = await hashFile(current.tempPath);
    const rawSha256 = current.rawHash.digest('hex');
    const bytes = statSync(current.tempPath).size;
    renameSync(current.tempPath, current.finalPath);
    files.push({file: current.finalPath, rows: current.rows, bytes, sha256, rawSha256});
    current = null;
  };
  let stopped = false;
  for (const snap of targets) {
    if (shouldStop()) { stopped = true; break; }
    for (const row of offers.iterate(snap.source, snap.snapshot_id)) {
      const fetchedAt = row.fetched_at || snap.fetched_at;
      const month = shanghaiDay(snap.fetched_at).slice(0, 7);
      const key = snap.source + '/' + month;
      if (!current || current.key !== key) {
        await closeCurrent();
        const dir = path.join(archiveDir, snap.source);
        mkdirSync(dir, {recursive: true});
        const name = `${month}-${stamp}.ndjson.gz`;
        const finalPath = path.join(dir, name);
        const tempPath = finalPath + '.partial';
        const gzip = createGzip();
        const out = createWriteStream(tempPath);
        gzip.pipe(out);
        current = {key, gzip, out, tempPath, finalPath, rows: 0, rawHash: createHash('sha256')};
      }
      const line = JSON.stringify({...row, fetched_at: fetchedAt}) + '\n';
      current.rawHash.update(line);
      await writeLine(current.gzip, line);
      current.rows += 1;
      total += 1;
    }
  }
  await closeCurrent();
  const manifest = {
    createdAt: now.toISOString(), horizon, rows: total, files,
    note: 'gzip NDJSON。每行是一条将被删除的 offer，并带上快照 fetched_at。删除前会解压核对行数和校验和。',
  };
  const manifestPath = path.join(archiveDir, `manifest-${stamp}.json`);
  const {writeFileSync} = await import('node:fs');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return {rows: total, files, manifestPath, estimate, verified: false, stopped};
}

export function planOfferSlim(db, {now = new Date(), days = 30, protectSnapshots = MIN_PROTECT_SNAPSHOTS} = {}) {
  const horizon = retentionHorizon(now, days);
  const estimate = estimateOfferFootprint(db, horizon, protectSnapshots);
  return {
    dryRun: true,
    horizon,
    days: Math.max(1, Math.floor(Number(days) || 30)),
    protectSnapshots,
    eligibleSnapshots: estimate.eligibleSnapshots,
    ...estimate,
    reclaim: reclaimGuidance(estimate),
    deletes: false,
  };
}

export async function slimOffers(db, options = {}) {
  // 单调时钟独立于用于保留期的 now；测试可注入，事务内部不检查期限。
  const elapsedNow = options.elapsedNow ?? (() => performance.now());
  const started = elapsedNow();
  const maxRuntimeMs = options.maxRuntimeMs ?? 2400000;
  let timedOut = false;
  const shouldStop = () => (timedOut ||= elapsedNow() - started >= maxRuntimeMs);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const days = options.days ?? 30;
  const protectSnapshots = options.protectSnapshots ?? MIN_PROTECT_SNAPSHOTS;
  const hours = candleHours(options.candleHours ?? 4);
  const horizon = retentionHorizon(now, days);
  try { db.exec('PRAGMA busy_timeout=' + Math.max(0, Math.floor(Number(options.busyTimeout ?? 10000)))); } catch { /* 只读连接会拒绝，调用方不应在只读库上瘦身。 */ }
  const plan = planOfferSlim(db, {now, days, protectSnapshots});
  if (options.dryRun) return plan;
  installSlimSnapshotTable(db, classifySnapshots(loadSnapshots(db), horizon, protectSnapshots));
  const reserveBytes = options.reserveBytes ?? 2 * 1024 ** 3;
  const rolled = rollupOffersBefore(db, horizon, protectSnapshots, {maxSnapshots: options.maxRollSnapshots ?? Infinity, shouldStop, candleHours: hours});
  let archive = null;
  if (options.archiveDir && !shouldStop()) {
    archive = await archiveEligibleOffers(db, horizon, protectSnapshots, options.archiveDir, {
      reserveBytes, freeBytes: options.freeBytes, now, shouldStop,
    });
    for (const file of archive.files) await verifyGzipNdjson(file, file);
    archive.verified = true;
  } else if (!options.archiveDir && !options.allowUnarchivedDelete && !shouldStop()) {
    const error = new Error('没有 --archive 目录，也没有 --allow-unarchived-delete。K 线已写入的快照会在下次重跑时跳过，明细还在。');
    error.code = 'ARCHIVE_REQUIRED';
    error.rolled = rolled;
    error.plan = plan;
    throw error;
  }
  const leftoverSql = `SELECT 1 FROM slim_snapshot d WHERE d.drop_offers=1 AND (
      NOT EXISTS (SELECT 1 FROM offer_rolled r WHERE r.source=d.source AND r.snapshot_id=d.snapshot_id)
      OR EXISTS (SELECT 1 FROM offers o WHERE o.source=d.source AND o.snapshot_id=d.snapshot_id)
    ) LIMIT 1`;
  const rolledSql = `SELECT 1 FROM slim_snapshot d WHERE d.drop_offers=1 AND EXISTS (
      SELECT 1 FROM offer_rolled r WHERE r.source=d.source AND r.snapshot_id=d.snapshot_id
    ) LIMIT 1`;
  // 先切换口径再删。还没删掉的快照仍走明细；已经删掉的前缀改读 K 线。
  if (plan.eligibleSnapshots === 0 || db.prepare(rolledSql).get()) {
    metaSet(db, 'offer_detail_before', horizon);
  }
  const purged = (archive?.stopped || shouldStop()) ? {removedOffers: 0, batches: 0} : deleteRolledOffers(db, horizon, protectSnapshots, {batchSnapshots: options.batchSnapshots ?? 20, checkpoint: options.checkpoint !== false, maxBatches: options.maxDeleteBatches ?? Infinity, shouldStop});

  let deduped = null;
  if (options.dedupe && !shouldStop()) deduped = dedupeStableOffers(db, {protectSnapshots, maxSnapshots: options.dedupeSnapshots ?? 4, shouldStop, globalLimit: true});
  let vacuum = null;
  if (options.vacuumInto && !shouldStop()) {
    const after = estimateOfferFootprint(db, horizon, protectSnapshots);
    vacuum = vacuumInto(db, options.dbPath, options.vacuumInto, {
      estimatedVacuumIntoBytes: Math.max(after.usedBytes, after.pageSize),
    }, {reserveBytes, statImpl: options.statImpl, statfsImpl: options.statfsImpl});
    vacuum.destination = options.vacuumInto;
  }
  const complete = !shouldStop() && !db.prepare(leftoverSql).get();
  if (complete) metaSet(db, 'offer_retention_last_day', shanghaiDay(now));
  return {
    stoppedReason: timedOut ? 'runtime' : complete ? null : 'batch-limit',
    dryRun: false, complete, horizon, days: plan.days, candleHours: hours, protectSnapshots, plan, rolled, archive, purged, deduped, vacuum,
    reclaim: reclaimGuidance(timedOut ? plan : estimateOfferFootprint(db, horizon, protectSnapshots)),
  };
}

export function retentionDue(now, {start = 2, end = 5, lastDay = null} = {}) {
  const hour = shanghaiHour(now);
  const quiet = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  return quiet && lastDay !== shanghaiDay(now);
}

function qi(name) {
  return '"' + String(name).replaceAll('"', '""') + '"';
}

// immutable=1 只读主库文件，不读、也不创建 -wal/-shm。
// 0 字节的残留不含页面，可以忽略。非空 -wal 里还有没 checkpoint 的提交，
// 非空 -shm 是未关闭连接的索引；只读会漏掉这些数据，所以直接拒绝。
export function openImmutableDb(dbPath) {
  const resolved = path.resolve(dbPath);
  const wal = resolved + '-wal';
  const shm = resolved + '-shm';
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error('源库旁边有非空 -wal。immutable 只读不会合并它，也不会创建 -shm。请先 checkpoint 或做成单文件备份。');
  }
  if (existsSync(shm) && statSync(shm).size > 0) {
    throw new Error('源库旁边有非空 -shm。这是未关闭连接留下的索引，immutable 只读会漏掉未写入主文件的页。请先关掉写入进程并 checkpoint。');
  }
  const url = pathToFileURL(resolved);
  url.searchParams.set('mode', 'ro');
  url.searchParams.set('immutable', '1');
  const db = new DatabaseSync(url.href, {readOnly: true});
  db.exec('PRAGMA query_only=ON');
  try { db.exec('PRAGMA cache_size=-65536'); } catch { /* 只读连接拒绝时保持默认缓存。 */ }
  return db;
}

/** 新库大小 ≈ 保留行占比 × 源文件大小 × 1.05，再加 256MB 余量。 */
export function estimateSlimOutputBytes({keptRows, totalRows, fileBytes}) {
  const kept = Math.max(0, Number(keptRows) || 0);
  const total = Math.max(0, Number(totalRows) || 0);
  const file = Math.max(0, Number(fileBytes) || 0);
  const share = total > 0 ? kept / total : 1;
  return Math.ceil(share * file * 1.05 + 256 * 1024 * 1024);
}

export function buildingFilePath(outPath, tmpDir) {
  if (!tmpDir) return outPath + '.building';
  return path.join(tmpDir, path.basename(outPath) + '.building');
}

function commitBuilding(building, outPath) {
  mkdirSync(path.dirname(outPath), {recursive: true});
  const buildDev = statSync(building).dev;
  const outDev = statSync(path.dirname(outPath)).dev;
  let from = building;
  if (buildDev !== outDev) {
    const staged = outPath + '.building';
    copyFileSync(building, staged);
    rmSync(building, {force: true});
    from = staged;
  }
  renameSync(from, outPath);
  for (const suffix of ['-wal', '-shm']) {
    rmSync(building + suffix, {force: true});
    if (from !== building) rmSync(from + suffix, {force: true});
  }
}

function existingDir(target) {
  let dir = target;
  while (!existsSync(dir)) dir = path.dirname(dir);
  return dir;
}

export function assertBuildSpace({outPath, archiveDir, outBytes, archiveBytes, reserveBytes = 0, finalPath = null, statImpl = statSync, statfsImpl = statfsSync}) {
  const groups = new Map();
  const add = (dir, bytes) => {
    const resolved = existingDir(dir);
    const dev = String(statImpl(resolved).dev);
    const group = groups.get(dev) || {dir: resolved, bytes: 0};
    group.bytes += bytes;
    groups.set(dev, group);
  };
  add(path.dirname(outPath), outBytes);
  if (finalPath && String(statImpl(existingDir(path.dirname(finalPath))).dev) !== String(statImpl(existingDir(path.dirname(outPath))).dev)) {
    add(path.dirname(finalPath), outBytes);
  }
  add(archiveDir, archiveBytes);
  let outFree = 0;
  let archFree = 0;
  for (const group of groups.values()) {
    const free = Number(statfsImpl(group.dir).bavail) * Number(statfsImpl(group.dir).bsize);
    if (group.dir === existingDir(path.dirname(outPath))) outFree = free;
    if (group.dir === existingDir(archiveDir)) archFree = free;
    if (!(free >= group.bytes + reserveBytes)) {
      const error = new Error(`目标目录剩余 ${free} 字节，新库约 ${outBytes} 字节、归档约 ${archiveBytes} 字节，再加上余量 ${reserveBytes} 字节后不够。已拒绝运行。`);
      error.code = 'ENOSPC_GUARD';
      throw error;
    }
  }
  return {ok: true, outFree, archFree, outBytes, archiveBytes};
}

function sourceSchema(db) {
  return db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY rowid`
  ).all();
}

const COPY_BATCH = 2000;

function streamInsert(dest, insert, columns, iterator) {
  let copied = 0;
  let pending = 0;
  dest.exec('BEGIN');
  try {
    for (const row of iterator) {
      insert.run(...columns.map(name => row[name] ?? null));
      copied += 1;
      pending += 1;
      if (pending >= COPY_BATCH) {
        dest.exec('COMMIT');
        dest.exec('BEGIN');
        pending = 0;
      }
    }
    dest.exec('COMMIT');
  } catch (error) {
    try { dest.exec('ROLLBACK'); } catch { /* 已提交的批次留在 .building，失败时不改成最终文件名。 */ }
    throw error;
  }
  return copied;
}

function copyRowsBetween(source, dest, table, whereSql, params) {
  const columns = source.prepare(`PRAGMA table_info(${qi(table)})`).all().map(column => column.name);
  if (!columns.length) return 0;
  const insert = dest.prepare(`INSERT INTO ${qi(table)} (${columns.map(qi).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  return streamInsert(dest, insert, columns, source.prepare(`SELECT * FROM ${qi(table)} WHERE ${whereSql}`).iterate(...params));
}

function alignAddedColumns(source, dest, table) {
  const have = new Set(dest.prepare(`PRAGMA table_info(${qi(table)})`).all().map(column => column.name));
  for (const column of source.prepare(`PRAGMA table_info(${qi(table)})`).all()) {
    if (have.has(column.name)) continue;
    const fallback = column.dflt_value == null ? '' : ` DEFAULT ${column.dflt_value}`;
    dest.exec(`ALTER TABLE ${qi(table)} ADD COLUMN ${qi(column.name)} ${column.type || 'TEXT'}${fallback}`);
  }
}

function countTable(db, table) {
  try { return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${qi(table)}`).get().n) || 0; }
  catch { return null; }
}

/**
 * 从只读源库直接写出精简库。源库以 immutable 打开，不写 -shm。
 * 窗口内 offers 和其他表整表复制；窗口外 offers 只进归档和 4h K 线。
 */
export async function buildSlimFromReadonly(options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const days = options.days ?? 30;
  const protectSnapshots = options.protectSnapshots ?? MIN_PROTECT_SNAPSHOTS;
  const hours = candleHours(options.candleHours ?? 4);
  const horizon = retentionHorizon(now, days);
  const reserveBytes = options.reserveBytes ?? 2 * 1024 ** 3;
  const source = openImmutableDb(options.sourcePath);
  const building = buildingFilePath(options.outPath, options.tmpDir);
  try {
    if (path.resolve(options.sourcePath) === path.resolve(options.outPath)) throw new Error('新库不能和源库是同一个文件');
    if (path.resolve(building) === path.resolve(options.outPath)) throw new Error('临时文件不能和最终新库是同一个路径');
    if (existsSync(options.outPath) || existsSync(building)) throw new Error('输出文件已存在，请换一个新路径');
    const classified = classifySnapshots(loadSnapshots(source), horizon, protectSnapshots);
    const keptOffers = countOffersIn(source, classified.keep);
    const droppedOffers = countOffersIn(source, classified.drop);
    const sample = [];
    const sampleStmt = source.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? LIMIT ?');
    for (const snap of classified.drop) {
      if (sample.length >= 40) break;
      sample.push(...sampleStmt.all(snap.source, snap.snapshot_id, 40 - sample.length));
    }
    const avg = sample.length ? sample.reduce((sum, row) => sum + columnBytes(row), 0) / sample.length : 500;
    const pageSize = Number(source.prepare('PRAGMA page_size').get().page_size) || 4096;
    const fileBytes = (Number(source.prepare('PRAGMA page_count').get().page_count) || 0) * pageSize;
    const totalOffers = keptOffers + droppedOffers;
    const outBytes = estimateSlimOutputBytes({keptRows: keptOffers, totalRows: totalOffers, fileBytes});
    const archiveBytes = Math.ceil(droppedOffers * avg * 0.5);
    const space = assertBuildSpace({
      outPath: building, archiveDir: options.archiveDir, outBytes, archiveBytes, reserveBytes,
      finalPath: options.outPath, statImpl: options.statImpl, statfsImpl: options.statfsImpl,
    });
    if (options.tmpDir) mkdirSync(options.tmpDir, {recursive: true});
    mkdirSync(path.dirname(building), {recursive: true});
    mkdirSync(path.dirname(options.outPath), {recursive: true});
    mkdirSync(options.archiveDir, {recursive: true});
    const dest = new DatabaseSync(building);
    const counts = [];
    let closed = false;
    try {
      dest.exec('PRAGMA journal_mode=WAL');
      try { dest.exec('PRAGMA cache_size=-65536'); } catch { /* 缓存上限失败时仍按默认页缓存写入。 */ }
      const objects = sourceSchema(source);
      for (const object of objects) {
        if (object.type === 'table') dest.exec(object.sql);
      }
      for (const object of objects) {
        if (object.type === 'table') alignAddedColumns(source, dest, object.name);
      }
      if (!objects.some(object => object.type === 'table' && object.name === 'offer_candle')) {
        dest.exec(`CREATE TABLE offer_candle (
          source TEXT NOT NULL, product_id TEXT NOT NULL, comparison_key TEXT NOT NULL,
          bucket_start TEXT NOT NULL, hours INTEGER NOT NULL, currency TEXT,
          price_open REAL, price_low REAL, price_high REAL, price_close REAL,
          in_stock_open INTEGER, in_stock_close INTEGER, offer_count_close INTEGER,
          stock_status TEXT, comparable INTEGER NOT NULL DEFAULT 0, series_key TEXT,
          observations INTEGER NOT NULL DEFAULT 0, first_at TEXT, last_at TEXT,
          PRIMARY KEY (source, product_id, comparison_key, bucket_start, hours)
        )`);
      }
      try {
        for (const row of source.prepare('SELECT name, seq FROM sqlite_sequence').all()) {
          dest.prepare('INSERT INTO sqlite_sequence(name, seq) VALUES(?,?)').run(row.name, row.seq);
        }
      } catch { /* 没有 AUTOINCREMENT 表时 sqlite_sequence 不存在。 */ }
      const offerColumns = source.prepare('PRAGMA table_info(offers)').all().map(column => column.name);
      const insertOffer = dest.prepare(`INSERT INTO offers (${offerColumns.map(qi).join(',')}) VALUES (${offerColumns.map(() => '?').join(',')})`);
      const offerSelect = source.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? ORDER BY rowid');
      const snapshotRow = source.prepare('SELECT * FROM snapshots WHERE source=? AND snapshot_id=?');
      for (const object of objects) {
        if (object.type !== 'table' || object.name === 'offers' || object.name === 'offer_candle') continue;
        const copied = copyRowsBetween(source, dest, object.name, '1=1', []);
        counts.push({table: object.name, source: countTable(source, object.name), out: copied});
      }
      let keptCopied = 0;
      for (const snap of classified.keep) {
        keptCopied += streamInsert(dest, insertOffer, offerColumns, offerSelect.iterate(snap.source, snap.snapshot_id));
      }
      const archive = await writeDroppedOffers(options.archiveDir, classified.drop, {now, horizon, readOffers: snap => offerSelect.iterate(snap.source, snap.snapshot_id), onSnapshot: (snap, offers) => {
        if (!offers.length) return;
        foldSnapshotOfferRows(dest, snapshotRow.get(snap.source, snap.snapshot_id), hours, offers);
      }});
      for (const file of archive.files) await verifyGzipNdjson(file, file);
      archive.verified = true;
      for (const object of objects) {
        if (object.type === 'index' && object.sql) dest.exec(object.sql);
      }
      dest.exec('CREATE INDEX IF NOT EXISTS idx_offer_candle_hist ON offer_candle(source, product_id, comparison_key, hours, bucket_start)');
      metaSet(dest, 'offer_detail_before', horizon);
      metaSet(dest, 'offer_candle_hours', String(hours));
      const quickCheck = dest.prepare('PRAGMA quick_check').get().quick_check;
      counts.push({table: 'offers', source: totalOffers, out: keptCopied});
      counts.push({table: 'offer_candle', source: countTable(source, 'offer_candle'), out: countTable(dest, 'offer_candle')});
      const report = {
        mode: 'from-readonly', source: path.resolve(options.sourcePath), out: path.resolve(options.outPath),
        horizon, days, candleHours: hours, protectSnapshots, space, counts,
        outputEstimate: {keptRows: keptOffers, totalRows: totalOffers, fileBytes, outBytes, archiveBytes},
        keptOffers: keptCopied, droppedOffers, archivedRows: archive.rows, archive, quickCheck,
      };
      if (quickCheck !== 'ok') throw new Error('quick_check 未通过：' + quickCheck);
      try { dest.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* 关库前再试一次。 */ }
      dest.close();
      closed = true;
      commitBuilding(building, options.outPath);
      return report;
    } catch (error) {
      if (!closed) try { dest.close(); } catch { /* 失败时尽力关掉未完成的新库。 */ }
      throw error;
    }
  } finally {
    source.close();
  }
}

async function writeDroppedOffers(archiveDir, snaps, {now, horizon, readOffers, onSnapshot}) {
  mkdirSync(archiveDir, {recursive: true});
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const files = [];
  let current = null;
  let total = 0;
  const closeCurrent = async () => {
    if (!current) return;
    current.gzip.end();
    await once(current.out, 'finish');
    const sha256 = await hashFile(current.tempPath);
    const rawSha256 = current.rawHash.digest('hex');
    const bytes = statSync(current.tempPath).size;
    renameSync(current.tempPath, current.finalPath);
    files.push({file: current.finalPath, rows: current.rows, bytes, sha256, rawSha256});
    current = null;
  };
  for (const snap of [...snaps].sort(compareArchiveSnaps)) {
    // 一次只留下一个快照的报价，用来投影这根 K 线，然后丢掉。
    const offers = [];
    for (const row of readOffers(snap)) offers.push(row);
    onSnapshot(snap, offers);
    for (const row of offers) {
      const month = shanghaiDay(snap.fetched_at).slice(0, 7);
      const key = snap.source + '/' + month;
      if (!current || current.key !== key) {
        await closeCurrent();
        const dir = path.join(archiveDir, snap.source);
        mkdirSync(dir, {recursive: true});
        const finalPath = path.join(dir, `${month}-${stamp}.ndjson.gz`);
        const tempPath = finalPath + '.partial';
        const gzip = createGzip();
        const out = createWriteStream(tempPath);
        gzip.pipe(out);
        current = {key, gzip, out, tempPath, finalPath, rows: 0, rawHash: createHash('sha256')};
      }
      const line = JSON.stringify({...row, fetched_at: snap.fetched_at}) + '\n';
      current.rawHash.update(line);
      await writeLine(current.gzip, line);
      current.rows += 1;
      total += 1;
    }
  }
  await closeCurrent();
  return {rows: total, files, verified: false, horizon};
}

export async function maybeMaintainOffers(db, config = {}, now = new Date()) {
  const options = config.offerRetention || {};
  const protectSnapshots = protectSnapshotCount(config);
  const report = {deduped: null, slim: null};
  if (options.dedupe) {
    report.deduped = dedupeStableOffers(db, {protectSnapshots, maxSnapshots: options.dedupePerCycle ?? 4});
  }
  if (options.enabled && retentionDue(now, {
    start: options.quietHourStart ?? 2,
    end: options.quietHourEnd ?? 5,
    lastDay: db.prepare("SELECT value FROM meta WHERE key='offer_retention_last_day'").get()?.value || null,
  })) {
    report.slim = await slimOffers(db, {
      now,
      days: options.days ?? 30,
      candleHours: options.candleHours ?? 4,
      protectSnapshots,
      archiveDir: options.archiveDir || null,
      reserveBytes: options.reserveBytes,
      allowUnarchivedDelete: !!options.allowUnarchivedDelete,
      dedupe: false,
      batchSnapshots: options.batchSnapshots ?? 20,
      maxRollSnapshots: options.maxRollSnapshots ?? 400,
      maxDeleteBatches: options.maxDeleteBatches ?? 40,
      dbPath: config.dbPath,
    });
  }
  return report;
}
