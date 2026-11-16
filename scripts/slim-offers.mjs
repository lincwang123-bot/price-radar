#!/usr/bin/env node
// 瘦身必须显式给出库路径。不回落到 config.dbPath，避免在生产机上误改采集库。
// 只读源用 --source-readonly，并以 immutable=1 打开，不在备份旁边生成 -shm。
//
//   node scripts/slim-offers.mjs --dry-run --source-readonly --db /backup/radar.sqlite
//   node scripts/slim-offers.mjs --from-readonly /backup/radar.sqlite --source-readonly --out /mnt/radar-slim.sqlite --archive /mnt/offer-archive
//   node scripts/slim-offers.mjs --db /backup/radar-copy.sqlite --archive /mnt/offer-archive --vacuum-into /mnt/radar-slim.sqlite
import path from 'node:path';
import {openDb} from '../lib/db.mjs';
import {loadConfig} from '../lib/config.mjs';
import {
  buildSlimFromReadonly, candleHours, openImmutableDb, planOfferSlim, protectSnapshotCount, slimOffers,
} from '../lib/offer-retention.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}
function has(name) {
  return process.argv.includes(name);
}
function fail(message) {
  console.error(message);
  process.exit(1);
}

if (has('--help')) {
  console.log(`用法:
  node scripts/slim-offers.mjs --dry-run --source-readonly --db /backup/radar.sqlite
  node scripts/slim-offers.mjs --from-readonly /backup/radar.sqlite --source-readonly \\
    --out /mnt/radar-slim.sqlite --archive /mnt/offer-archive
  node scripts/slim-offers.mjs --db /backup/可写副本.sqlite --archive /mnt/offer-archive --vacuum-into /mnt/radar-slim.sqlite

--db PATH                 要就地瘦身的库。必填，不会改用 config.dbPath
--source-readonly         显式声明源库只能只读打开。dry-run 和 --from-readonly 都必须带上
--from-readonly PATH      只读源库。按原 schema 建新库，不写源文件，也不生成 -shm
--out PATH                --from-readonly 的最终新库路径。增长写在 .building，完成后再改名
--tmp-dir DIR             可选。把 .building 写到这个目录，结束时再原子改名到 --out。增长文件因此不必落在会被主机做写时复制快照的输出目录里；和 --out 同一文件系统时改名是原子的
--dry-run                 完全只读：不建表、不写归档、不删除
--days N                  保留最近 N 天明细，默认 30
--now ISO                 保留窗口的截止时刻，默认当前时间。演练和补录对齐冻结点时传 2026-11-06T02:16:00.000Z
--candle-hours N          K 线粒度，默认 4。上海时区 0/4/8/12/16/20
--archive DIR             gzip NDJSON 目录。写完会解压核对行数和校验和，然后才删除
--allow-unarchived-delete 不归档也删除。默认不允许
--dedupe                  热窗口外价格/库存未变化的明细收成投影点
--batch N                 就地删除时每批快照数，默认 20
--vacuum-into FILE        就地瘦身的最后一步，写到新文件，不替换 --db
`);
  process.exit(0);
}

const config = loadConfig();
const days = Number(arg('--days', config.offerRetention?.days ?? 30)) || 30;
const nowArg = arg('--now', '');
const now = nowArg ? new Date(nowArg) : new Date();
if (nowArg && !Number.isFinite(+now)) fail(`无法解析 --now ${nowArg}。请用 ISO，例如 2026-11-06T02:16:00.000Z`);
const hours = candleHours(arg('--candle-hours', config.offerRetention?.candleHours ?? 4));
const protectSnapshots = protectSnapshotCount(config);
const sourceReadonly = has('--source-readonly');
const fromReadonly = arg('--from-readonly', '');
const dryRun = has('--dry-run');
const archive = arg('--archive', '');
const options = {
  days, protectSnapshots, candleHours: hours, now,
  batchSnapshots: Number(arg('--batch', 20)) || 20,
  archiveDir: archive,
  allowUnarchivedDelete: has('--allow-unarchived-delete'),
  dedupe: has('--dedupe'),
  reserveBytes: config.offerRetention?.reserveBytes,
};

if (fromReadonly) {
  if (!sourceReadonly) fail('使用 --from-readonly 时必须同时显式传入 --source-readonly，避免误以可写方式打开源库。');
  const out = arg('--out', '');
  if (!out || !archive) fail('--from-readonly 需要 --out 和 --archive。');
  const sourcePath = path.resolve(fromReadonly);
  if (dryRun) {
    const db = openImmutableDb(sourcePath);
    try { console.log(JSON.stringify(planOfferSlim(db, options), null, 2)); }
    finally { db.close(); }
  } else {
    const tmpDir = arg('--tmp-dir', '');
    console.log(JSON.stringify(await buildSlimFromReadonly({
      ...options, sourcePath, outPath: path.resolve(out), archiveDir: path.resolve(archive),
      tmpDir: tmpDir ? path.resolve(tmpDir) : '',
    }), null, 2));
  }
  process.exit(0);
}

const dbArg = arg('--db', '');
if (!dbArg) fail('必须显式传入 --db。不会使用 config.dbPath，避免在生产机上误改采集库。');
const dbPath = path.resolve(dbArg);
if (dryRun) {
  if (!sourceReadonly) fail('--dry-run 必须同时传入 --source-readonly，并且只读打开，不建表。');
  const db = openImmutableDb(dbPath);
  try { console.log(JSON.stringify(planOfferSlim(db, options), null, 2)); }
  finally { db.close(); }
  process.exit(0);
}
if (sourceReadonly) fail('--source-readonly 禁止写入 --db。要从只读源生成新库，请用 --from-readonly --out。');
const vacuumInto = arg('--vacuum-into', '');
const db = openDb(dbPath);
try {
  console.log(JSON.stringify(await slimOffers(db, {
    ...options, dbPath, vacuumInto: vacuumInto ? path.resolve(vacuumInto) : '',
  }), null, 2));
} finally {
  db.close();
}
