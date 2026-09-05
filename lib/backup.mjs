import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

const NAME = /^(submissions|analytics)-\d{8}T\d{9}Z-[a-f0-9]+\.sqlite$/;
const TABLES = {submissions:["feedback_submissions", "cooperation_submissions", "submission_actions"],analytics:["analytics_days","analytics_visitors","analytics_meta"]};
function counts(db,kind) {
  return Object.fromEntries(TABLES[kind].filter(t => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))
    .map(t => [t, Number(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n)]));
}

/** Restore to an isolated directory, never over the live database. No private rows are returned. */
export function verifyBackup(file, {kind="submissions"}={}) {
  if(!TABLES[kind])throw new Error("未知备份类型");
  const temp = mkdtempSync(path.join(os.tmpdir(), "price-radar-restore-"));
  let db;
  try {
    const restored = path.join(temp, "restored.sqlite");
    copyFileSync(file, restored); chmodSync(restored, 0o600);
    db = new DatabaseSync(restored, { readOnly: true });
    const checks = db.prepare("PRAGMA quick_check").all();
    if (checks.length !== 1 || checks[0].quick_check !== "ok") throw new Error("备份完整性检查失败");
    for (const t of TABLES[kind].slice(0, 2)) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)) throw new Error("备份缺少必要数据表");
    return { quickCheck: "ok", counts: counts(db,kind) };
  } finally { db?.close(); rmSync(temp, { recursive: true, force: true }); }
}

export function backupStatus(directory) {
  try { const saved=JSON.parse(readFileSync(path.join(directory, "status.json"), "utf8"));const ageHours=(Date.now()-Date.parse(saved.createdAt))/3600000;const stale=!Number.isFinite(ageHours)||ageHours>36||ageHours<0;return {...saved,ok:saved.ok===true&&!stale,stale,ageHours:Number.isFinite(ageHours)?Math.round(ageHours):null}; }
  catch { return { ok: false, message: "尚无已验证备份", offsite: false }; }
}

export async function backupSubmissions(dbPath, directory, { keep = 14, now = new Date(),kind="submissions" } = {}) {
  if(!TABLES[kind])throw new Error("未知备份类型");
  if (!Number.isInteger(keep) || keep < 2 || keep > 365) throw new Error("备份保留数量必须为 2–365");
  if (!path.isAbsolute(directory) || !path.isAbsolute(dbPath) || path.resolve(directory) === path.dirname(path.resolve(dbPath))) throw new Error("备份必须使用独立绝对路径目录");
  if (!existsSync(dbPath)) throw new Error("投稿数据库不存在");
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  const name = `${kind}-${stamp}-${randomBytes(6).toString("hex")}.sqlite`;
  const file = path.join(directory, name), pending = file + ".pending";
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // SQLite online backup includes the committed WAL and produces a standalone database.
    await backup(source, pending);
    chmodSync(pending, 0o600);
    const verified = verifyBackup(pending,{kind});
    renameSync(pending, file);
    const status = { ok: true, createdAt: now.toISOString(), file: name, bytes: statSync(file).size, ...verified, offsite: false, keep };
    const statusTemp = path.join(directory, `${name}.status.pending`);
    writeFileSync(statusTemp, JSON.stringify(status), { mode: 0o600 }); renameSync(statusTemp, path.join(directory, "status.json"));
    // Only this tool's exact filenames are eligible; unrelated files are never removed.
    const old = readdirSync(directory).filter(n => NAME.test(n)&&n.startsWith(kind+"-")).sort().reverse().slice(keep);
    for (const n of old) rmSync(path.join(directory, n));
    return status;
  } finally { source.close(); if (existsSync(pending)) rmSync(pending); }
}
