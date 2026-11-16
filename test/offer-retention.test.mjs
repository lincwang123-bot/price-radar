import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {openDb, storeSnapshot} from '../lib/db.mjs';
import {quoteSeries} from '../lib/quote-policy.mjs';
import {
  assessVacuumInto, dedupeStableOffers, planOfferSlim, protectSnapshotCount,
  buildSlimFromReadonly, candleBucketStart, candleHours, estimateSlimOutputBytes, openImmutableDb, reclaimGuidance, retentionDue, sameObservedQuote, slimOffers, stockStatusOf,
} from '../lib/offer-retention.mjs';
import {exportOfferChanges, mergeOfferChanges, parseSince} from '../lib/offer-catchup.mjs';
import {openDbReadOnly} from '../lib/db.mjs';

const title = 'Claude Pro 代充月卡 新开续费均可';
function offer(price, extra = {}) {
  return {
    offerId: 'o', title, price, currency: 'CNY', status: 'in_stock', stockCount: 4,
    url: 'https://shop.example/item/1', ...extra,
  };
}
function snap(db, id, at, offers, productId = 'claude-pro-month') {
  storeSnapshot(db, {
    source: 'direct-shops', snapshotId: id, fetchedAt: at,
    products: [{productId, name: 'Claude Pro', currency: 'CNY', offers}],
  });
}
function prices(db, comparisonKey) {
  return quoteSeries(db, {source: 'direct-shops', productId: 'claude-pro-month', comparisonKey}).map(row => row.lowest_price);
}

test('4 小时线取桶内开高低收和收盘库存，同一规格不串线', async () => {
  const db = openDb(':memory:');
  try {
    snap(db, 'a', '2020-01-01T00:30:00.000Z', [offer(10, {stockCount: 5})]);
    snap(db, 'b', '2020-01-01T02:00:00.000Z', [offer(8, {stockCount: 1})]);
    snap(db, 'c', '2020-01-01T03:30:00.000Z', [offer(12, {stockCount: 9})]);
    snap(db, 'd', '2020-01-01T04:30:00.000Z', [offer(7, {stockCount: 2})]);
    snap(db, 'e', '2020-01-01T06:00:00.000Z', [offer(7, {status: 'out_of_stock', stockCount: 0})]);
    snap(db, 'keep', '2020-03-15T02:00:00.000Z', [offer(9)]);
    const key = quoteSeries(db, {source: 'direct-shops', productId: 'claude-pro-month'})[0].comparison_key;
    const dir = mkdtempSync(path.join(tmpdir(), 'offer-slim-'));
    try {
      const report = await slimOffers(db, {
        now: new Date('2020-03-22T00:00:00.000Z'), days: 30, protectSnapshots: 1,
        archiveDir: dir, reserveBytes: 0, dedupe: false,
      });
      assert.equal(report.dryRun, false);
      assert.ok(report.purged.removedOffers >= 5);
      const candles = db.prepare("SELECT * FROM offer_candle WHERE comparison_key='' ORDER BY bucket_start").all();
      assert.equal(candles.length, 2);
      assert.equal(candles[0].hours, 4);
      assert.equal(candles[0].bucket_start, '2020-01-01T00:00:00.000Z');
      assert.equal(candles[0].price_open, 10);
      assert.equal(candles[0].price_low, 8);
      assert.equal(candles[0].price_high, 12);
      assert.equal(candles[0].price_close, 12);
      assert.equal(candles[0].stock_status, 'in_stock');
      assert.equal(candles[0].observations, 3);
      assert.equal(candles[1].bucket_start, '2020-01-01T04:00:00.000Z');
      assert.equal(candles[1].price_close, 7);
      assert.equal(candles[1].stock_status, 'out_of_stock');
      const spec = db.prepare('SELECT * FROM offer_candle WHERE comparison_key=? ORDER BY bucket_start').all(key);
      assert.equal(spec[0].price_low, 8);
      assert.equal(spec[0].price_close, 12);
      assert.deepEqual(prices(db), [12, 7, 9]);
      assert.deepEqual(prices(db, key), [12, 7, 9]);
      const archived = gunzipSync(readFileSync(report.archive.files[0].file));
      assert.match(archived.toString('utf8'), /"price":10/);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id='keep'").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id='e'").get().n, 0);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  } finally { db.close(); }
});

test('走势在明细窗口和 4 小时线之间按时间拼接，limit 仍只取最近明细', async () => {
  const db = openDb(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-splice-'));
  try {
    snap(db, 'old', '2020-01-01T02:00:00.000Z', [offer(10)]);
    snap(db, 'mid', '2020-01-03T02:00:00.000Z', [offer(6)]);
    snap(db, 'new1', '2020-03-20T02:00:00.000Z', [offer(9)]);
    snap(db, 'new2', '2020-03-21T02:00:00.000Z', [offer(11)]);
    await slimOffers(db, {
      now: new Date('2020-03-22T00:00:00.000Z'), days: 30, protectSnapshots: 2,
      archiveDir: dir, reserveBytes: 0,
    });
    const series = quoteSeries(db, {source: 'direct-shops', productId: 'claude-pro-month'});
    assert.deepEqual(series.map(row => row.lowest_price), [10, 6, 9, 11]);
    assert.deepEqual(series.map(row => row.granularity), ['4h', '4h', undefined, undefined]);
    assert.deepEqual(quoteSeries(db, {source: 'direct-shops', productId: 'claude-pro-month', limit: 2}).map(row => row.lowest_price), [9, 11]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id IN ('new1','new2')").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id IN ('old','mid')").get().n, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); db.close(); }
});

test('价格和库存都没变才去掉热窗口外的重复行，变化和重新出现都保留', () => {
  const db = openDb(':memory:');
  try {
    const at = '2026-04-01T00:00:00.000Z';
    snap(db, '1', at, [offer(10)]);
    snap(db, '2', '2026-04-01T00:05:00.000Z', [offer(10)]);
    snap(db, '3', '2026-04-01T00:10:00.000Z', [offer(11)]);
    const unchanged = prices(db);
    dedupeStableOffers(db, {protectSnapshots: 1, maxSnapshots: 10});
    assert.deepEqual(prices(db), unchanged);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 2);
    assert.equal(db.prepare("SELECT last_seen_at FROM offers WHERE snapshot_id='1'").get().last_seen_at, '2026-04-01T00:05:00.000Z');
    assert.equal(db.prepare("SELECT partial FROM offer_compacted WHERE snapshot_id='2'").get().partial, 1);
    assert.equal(db.prepare("SELECT partial FROM offer_compacted WHERE snapshot_id='1'").get().partial, 0);
    const key = quoteSeries(db, {source: 'direct-shops', productId: 'claude-pro-month'})[0].comparison_key;
    assert.deepEqual(prices(db, key), unchanged);
  } finally { db.close(); }

  const stock = openDb(':memory:');
  try {
    snap(stock, '1', '2026-04-01T00:00:00.000Z', [offer(10, {stockCount: 5})]);
    snap(stock, '2', '2026-04-01T00:05:00.000Z', [offer(10, {stockCount: 0})]);
    snap(stock, '3', '2026-04-01T00:10:00.000Z', [offer(10, {stockCount: 0})]);
    dedupeStableOffers(stock, {protectSnapshots: 1, maxSnapshots: 10});
    assert.equal(stock.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id='2'").get().n, 1);
  } finally { stock.close(); }

  const gone = openDb(':memory:');
  try {
    snap(gone, '1', '2026-04-01T00:00:00.000Z', [offer(10)]);
    snap(gone, '2', '2026-04-01T00:05:00.000Z', []);
    snap(gone, '3', '2026-04-01T00:10:00.000Z', [offer(10)]);
    dedupeStableOffers(gone, {protectSnapshots: 1, maxSnapshots: 10});
    assert.deepEqual(prices(gone), [10, null, 10]);
    assert.equal(gone.prepare('SELECT COUNT(*) n FROM offer_head').get().n, 0);
  } finally { gone.close(); }
  assert.equal(sameObservedQuote({price: 10, stock_count: 1, currency: 'CNY', status: 'in_stock', title, url: 'https://shop.example/item/1'}, offer(10, {stockCount: 1})), true);
  assert.equal(sameObservedQuote(offer(10), offer(11)), false);
  assert.equal(stockStatusOf({in_stock_count: 0, offer_count: 2}), 'out_of_stock');
});

test('迁移 dry-run 报告将删行数且不删数据，空间不足时拒绝 VACUUM INTO', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-dry-'));
  const file = path.join(dir, 'radar.sqlite');
  const db = openDb(file);
  try {
    snap(db, 'old', '2020-01-01T00:00:00.000Z', [offer(4), offer(5, {offerId: 'other', title: 'Claude Pro 代充年卡 新开续费均可', price: 80})]);
    for (let i = 0; i < 160; i++) snap(db, 'k' + i, new Date(Date.parse('2026-04-02T00:00:00.000Z') + i * 1000).toISOString(), [offer(9)]);
    const before = db.prepare('SELECT COUNT(*) n FROM offers').get().n;
    const plan = planOfferSlim(db, {now: new Date('2026-04-03T00:00:00.000Z'), days: 30, protectSnapshots: 160});
    assert.equal(plan.dryRun, true);
    assert.equal(plan.deletes, false);
    assert.equal(plan.eligible, 2);
    assert.ok(plan.estimatedLogicalReclaimBytes > 0);
    assert.match(reclaimGuidance(plan).join('\n'), /不要在这块只剩 4–6G 的盘上执行 VACUUM/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, before);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    db.exec('DROP TABLE offer_candle');
    db.close();
    const run = spawnSync(process.execPath, ['scripts/slim-offers.mjs', '--dry-run', '--source-readonly', '--db', file, '--days', '30'], {cwd: root, encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.dryRun, true);
    assert.equal(report.eligible, 2);
    const after = openImmutableDb(file);
    try {
      assert.equal(after.prepare('SELECT COUNT(*) n FROM offers').get().n, before);
      assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE name='offer_candle'").get(), undefined);
    } finally { after.close(); }
    assert.equal(readdirSync(dir).some(name => name.endsWith('-shm')), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
  const blocked = assessVacuumInto({
    sourcePath: '/var/lib/radar.sqlite', destPath: '/var/lib/new/radar.sqlite',
    resultBytes: 20 * 1024 ** 3, reserveBytes: 2 * 1024 ** 3,
    statImpl: () => ({dev: 1}), statfsImpl: () => ({bavail: 5, bsize: 1024 ** 3}),
  });
  assert.equal(blocked.ok, false);
  const allowed = assessVacuumInto({
    sourcePath: '/data/radar.sqlite', destPath: '/mnt/new/radar.sqlite',
    resultBytes: 10 * 1024 ** 3, reserveBytes: 2 * 1024 ** 3,
    statImpl: file => ({dev: file.startsWith('/mnt') ? 2 : 1}),
    statfsImpl: () => ({bavail: 40, bsize: 1024 ** 3}),
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.sameDevice, false);
  assert.equal(protectSnapshotCount({watch: {rules: [{window: 24}]}, offerRetention: {protectSnapshots: 10}}), 160);
  assert.equal(retentionDue(new Date('2026-03-01T18:30:00.000Z'), {lastDay: null}), true);
  assert.equal(retentionDue(new Date('2026-03-01T18:30:00.000Z'), {lastDay: '2026-03-02'}), false);
  assert.equal(retentionDue(new Date('2026-03-01T04:00:00.000Z'), {lastDay: null}), false);
});

test('4 小时桶按上海 0/4/8/12/16/20 切，粒度可改成 8 小时', async () => {
  assert.equal(candleHours(), 4);
  assert.throws(() => candleHours(5), /粒度/);
  const slots = [
    ['2020-01-02T00:30:00+08:00', '2020-01-01T16:00:00.000Z'],
    ['2020-01-02T03:59:00+08:00', '2020-01-01T16:00:00.000Z'],
    ['2020-01-02T04:00:00+08:00', '2020-01-01T20:00:00.000Z'],
    ['2020-01-02T08:30:00+08:00', '2020-01-02T00:00:00.000Z'],
    ['2020-01-02T12:30:00+08:00', '2020-01-02T04:00:00.000Z'],
    ['2020-01-02T16:30:00+08:00', '2020-01-02T08:00:00.000Z'],
    ['2020-01-02T20:30:00+08:00', '2020-01-02T12:00:00.000Z'],
  ];
  for (const [at, bucket] of slots) assert.equal(candleBucketStart(at), bucket, at);
  const db = openDb(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-8h-'));
  try {
    snap(db, 'early', '2020-01-02T00:30:00.000Z', [offer(10)]);
    snap(db, 'late', '2020-01-02T06:00:00.000Z', [offer(6)]);
    snap(db, 'keep', '2020-03-15T02:00:00.000Z', [offer(9)]);
    await slimOffers(db, {
      now: new Date('2020-03-22T00:00:00.000Z'), days: 30, protectSnapshots: 1, candleHours: 8,
      archiveDir: dir, reserveBytes: 0,
    });
    const rows = db.prepare("SELECT * FROM offer_candle WHERE comparison_key='' ORDER BY bucket_start").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hours, 8);
    assert.equal(rows[0].bucket_start, '2020-01-02T00:00:00.000Z');
    assert.equal(rows[0].price_open, 10);
    assert.equal(rows[0].price_low, 6);
    assert.equal(rows[0].price_high, 10);
    assert.equal(rows[0].price_close, 6);
    assert.deepEqual(prices(db), [6, 9]);
  } finally { rmSync(dir, {recursive: true, force: true}); db.close(); }
});

test('离线副本可以指定库和归档目录，最后 VACUUM INTO 新文件', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-vacuum-'));
  const file = path.join(dir, 'copy.sqlite');
  const archive = path.join(dir, 'archive');
  const slim = path.join(dir, 'slim.sqlite');
  const db = openDb(file);
  try {
    snap(db, 'old', '2020-01-01T00:30:00.000Z', [offer(4)]);
    snap(db, 'keep', '2020-03-15T02:00:00.000Z', [offer(9)]);
    const report = await slimOffers(db, {
      dbPath: file, now: new Date('2020-03-22T00:00:00.000Z'), days: 30, protectSnapshots: 1,
      archiveDir: archive, reserveBytes: 0, vacuumInto: slim,
    });
    assert.equal(report.vacuum.quickCheck, 'ok');
    assert.equal(report.vacuum.autoVacuum, 2);
    assert.equal(report.vacuum.destination, slim);
  } finally { db.close(); }
  const out = openDbReadOnly(slim);
  try {
    assert.equal(out.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(out.prepare('SELECT COUNT(*) n FROM offer_candle').get().n > 0, true);
    assert.equal(out.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id='old'").get().n, 0);
    assert.equal(out.prepare("SELECT COUNT(*) n FROM offers WHERE snapshot_id='keep'").get().n, 1);
  } finally { out.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('冻结点之后的快照可从源库只读导出，再合并进精简库', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-catchup-'));
  const sourcePath = path.join(dir, 'prod.sqlite');
  const catchup = path.join(dir, 'catchup.sqlite');
  const slimPath = path.join(dir, 'slim.sqlite');
  try {
    const since = parseSince('2026-11-06 10:16');
    assert.equal(since, '2026-11-06T02:16:00.000Z');
    const source = openDb(sourcePath);
    snap(source, 'before', '2026-11-06T02:00:00.000Z', [offer(1)]);
    snap(source, 'after', '2026-11-06T03:00:00.000Z', [offer(2)]);
    source.exec('ALTER TABLE alerts ADD COLUMN group_id TEXT');
    source.prepare("INSERT INTO alerts(ts, source, product_id, product_name, rule_id, kind, message, group_id) VALUES('2026-11-06T03:30:00.000Z','direct-shops','claude-pro-month','Claude','r','min_below','降了','spec')").run();
    source.prepare("INSERT INTO rule_state(rule_key, state, updated_at) VALUES('k','{}','2026-11-06T03:30:00.000Z')").run();
    source.prepare("INSERT INTO meta(key, value) VALUES('health:direct-shops','ok')").run();
    source.close();
    const slim = openDb(slimPath);
    snap(slim, 'before', '2026-11-06T02:00:00.000Z', [offer(1)]);
    slim.prepare("INSERT INTO meta(key, value) VALUES('offer_detail_before','2020-01-01T00:00:00.000Z')").run();
    slim.prepare("INSERT INTO offer_candle(source, product_id, comparison_key, bucket_start, hours, price_close, comparable, observations, first_at, last_at, stock_status) VALUES('direct-shops','claude-pro-month','','2020-01-01T00:00:00.000Z',4,3,1,1,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','in_stock')").run();
    slim.close();
    const exported = exportOfferChanges(sourcePath, catchup, since);
    assert.equal(exported.snapshots.written, 1);
    assert.equal(exported.offers.written, 1);
    const merged = mergeOfferChanges(slimPath, catchup);
    assert.equal(merged.snapshots.written, 1);
    const check = openDb(slimPath);
    try {
      assert.equal(check.prepare('SELECT COUNT(*) n FROM snapshots').get().n, 2);
      assert.equal(check.prepare("SELECT price FROM offers WHERE snapshot_id='after'").get().price, 2);
      assert.equal(check.prepare("SELECT value FROM meta WHERE key='offer_detail_before'").get().value, '2020-01-01T00:00:00.000Z');
      assert.equal(check.prepare('SELECT COUNT(*) n FROM offer_candle').get().n, 1);
      assert.equal(check.prepare("SELECT value FROM meta WHERE key='health:direct-shops'").get().value, 'ok');
      assert.equal(check.prepare('SELECT group_id FROM alerts').get().group_id, 'spec');
      assert.equal(check.prepare("SELECT state FROM rule_state WHERE rule_key='k'").get().state, '{}');
    } finally { check.close(); }
    assert.equal(mergeOfferChanges(slimPath, catchup).snapshots.written, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('没传 --db 直接拒绝，dry-run 不回落到采集库', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const run = spawnSync(process.execPath, ['scripts/slim-offers.mjs', '--dry-run', '--source-readonly'], {cwd: root, encoding: 'utf8'});
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /必须显式传入 --db/);
});

test('从只读源直接生成精简库，归档校验后才算完成，空间不够就拒绝', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-build-'));
  const sourcePath = path.join(dir, 'source.sqlite');
  const outPath = path.join(dir, 'slim.sqlite');
  const archive = path.join(dir, 'archive');
  try {
    const source = openDb(sourcePath);
    snap(source, 'old', '2020-01-01T00:30:00.000Z', [offer(4)]);
    snap(source, 'keep', '2020-03-15T02:00:00.000Z', [offer(9)]);
    source.exec('ALTER TABLE alerts ADD COLUMN group_id TEXT');
    source.prepare("INSERT INTO alerts(ts, source, product_id, product_name, rule_id, kind, message, group_id) VALUES('2020-03-15T02:00:00.000Z','direct-shops','claude-pro-month','Claude','r','min_below','降了','1m')").run();
    source.exec('CREATE INDEX idx_offer_price_test ON offers(price)');
    source.close();
    await assert.rejects(() => buildSlimFromReadonly({
      sourcePath, outPath, archiveDir: archive, now: new Date('2020-03-22T00:00:00.000Z'),
      days: 30, protectSnapshots: 1, reserveBytes: 0,
      statImpl: () => ({dev: 1}), statfsImpl: () => ({bavail: 0, bsize: 1}),
    }), /不够|拒绝/);
    assert.equal(existsSync(outPath), false);
    assert.equal(existsSync(outPath + '.building'), false);
    const tmpDir = path.join(dir, 'tmp');
    const report = await buildSlimFromReadonly({
      sourcePath, outPath, archiveDir: archive, tmpDir, now: new Date('2020-03-22T00:00:00.000Z'),
      days: 30, protectSnapshots: 1, reserveBytes: 0,
    });
    assert.equal(existsSync(path.join(tmpDir, 'slim.sqlite.building')), false);
    assert.equal(report.outputEstimate.outBytes, estimateSlimOutputBytes(report.outputEstimate));
    assert.equal(report.quickCheck, 'ok');
    assert.equal(report.archive.verified, true);
    assert.equal(report.droppedOffers, 1);
    assert.equal(report.keptOffers, 1);
    assert.equal(readdirSync(dir).some(name => name.endsWith('-shm')), false);
    const out = openDb(outPath);
    try {
      assert.equal(out.prepare('SELECT COUNT(*) n FROM offers').get().n, 1);
      assert.equal(out.prepare('SELECT COUNT(*) n FROM snapshots').get().n, 2);
      assert.equal(out.prepare("SELECT price_close FROM offer_candle WHERE comparison_key=''").get().price_close, 4);
      assert.equal(out.prepare('SELECT group_id FROM alerts').get().group_id, '1m');
      assert.equal(out.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_offer_price_test'").get().name, 'idx_offer_price_test');
      assert.deepEqual(prices(out), [4, 9]);
    } finally { out.close(); }
    const archived = gunzipSync(readFileSync(report.archive.files[0].file));
    assert.match(archived.toString('utf8'), /"price":4/);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const missing = spawnSync(process.execPath, ['scripts/slim-offers.mjs', '--from-readonly', sourcePath, '--out', outPath + '.2', '--archive', archive], {cwd: root, encoding: 'utf8'});
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--source-readonly/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('多个来源和月份的归档行数等于被丢掉的报价数', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-archive-groups-'));
  const sourcePath = path.join(dir, 'source.sqlite');
  const outPath = path.join(dir, 'slim.sqlite');
  const archive = path.join(dir, 'archive');
  const groups = [
    ['direct-shops', 'a', '2020-01-10T02:00:00.000Z', 4],
    ['direct-shops', 'b', '2020-01-20T06:00:00.000Z', 5],
    ['direct-shops', 'c', '2020-02-10T02:00:00.000Z', 3],
    ['ldxp-goods', 'd', '2020-01-12T03:00:00.000Z', 6],
    ['ldxp-goods', 'e', '2020-01-18T08:00:00.000Z', 2],
  ];
  try {
    const source = openDb(sourcePath);
    for (const [sourceName, id, at, count] of groups) {
      storeSnapshot(source, {
        source: sourceName, snapshotId: id, fetchedAt: at,
        products: [{productId: 'claude-pro-month', name: 'Claude Pro', currency: 'CNY', offers: Array.from({length: count}, (_, index) => offer(10 + index, {offerId: id + '-' + index}))}],
      });
    }
    for (const sourceName of ['direct-shops', 'ldxp-goods']) {
      storeSnapshot(source, {
        source: sourceName, snapshotId: 'keep-' + sourceName, fetchedAt: '2020-03-15T02:00:00.000Z',
        products: [{productId: 'claude-pro-month', name: 'Claude Pro', currency: 'CNY', offers: [offer(9, {offerId: 'keep-' + sourceName})]}],
      });
    }
    source.close();
    const dropped = groups.reduce((sum, group) => sum + group[3], 0);
    const report = await buildSlimFromReadonly({
      sourcePath, outPath, archiveDir: archive, now: new Date('2020-03-22T00:00:00.000Z'),
      days: 30, protectSnapshots: 1, reserveBytes: 0,
    });
    assert.equal(report.archive.verified, true);
    assert.equal(report.droppedOffers, dropped);
    assert.equal(report.archivedRows, dropped);
    assert.ok(report.archive.files.length >= 3);
    assert.equal(report.archive.files.reduce((sum, file) => sum + file.rows, 0), dropped);
    const lines = report.archive.files.reduce((sum, file) => sum + gunzipSync(readFileSync(file.file)).toString('utf8').trim().split('\n').length, 0);
    assert.equal(lines, dropped);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('--now 把保留窗口对齐到冻结点', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-now-'));
  const file = path.join(dir, 'radar.sqlite');
  try {
    const db = openDb(file);
    snap(db, 's', '2026-11-01T00:00:00.000Z', [offer(9)]);
    db.close();
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const run = spawnSync(process.execPath, ['scripts/slim-offers.mjs', '--dry-run', '--source-readonly', '--db', file, '--now', '2026-11-06T02:16:00.000Z', '--days', '30'], {cwd: root, encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.horizon, '2026-10-07T02:16:00.000Z');
    const bad = spawnSync(process.execPath, ['scripts/slim-offers.mjs', '--dry-run', '--source-readonly', '--db', file, '--now', 'not-a-date'], {cwd: root, encoding: 'utf8'});
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--now/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('精简库空间按保留行占比估算，演练数字不会按整库拒绝', () => {
  const fileBytes = Math.round(41.9 * 1024 ** 3);
  const keptRows = 10701043;
  const totalRows = 18190803;
  const bytes = estimateSlimOutputBytes({keptRows, totalRows, fileBytes});
  assert.equal(bytes, Math.ceil(keptRows / totalRows * fileBytes * 1.05 + 256 * 1024 * 1024));
  assert.ok(bytes < 28 * 1024 ** 3);
  assert.ok(bytes > 23 * 1024 ** 3);
  assert.equal(10701043 + 7489760, 18190803);
});

test('非空 wal 或 shm 拒绝 immutable 打开，空残留可以忽略', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-wal-'));
  const file = path.join(dir, 'source.sqlite');
  try {
    const db = openDb(file);
    snap(db, 's', '2020-03-15T02:00:00.000Z', [offer(9)]);
    db.close();
    writeFileSync(file + '-wal', 'pending');
    assert.throws(() => openImmutableDb(file), /-wal/);
    rmSync(file + '-wal');
    writeFileSync(file + '-shm', 'index');
    assert.throws(() => openImmutableDb(file), /-shm/);
    writeFileSync(file + '-wal', '');
    writeFileSync(file + '-shm', '');
    const ro = openImmutableDb(file);
    try { assert.equal(ro.prepare('SELECT COUNT(*) n FROM offers').get().n, 1); }
    finally { ro.close(); }
    assert.equal(statSync(file + '-wal').size, 0);
    assert.equal(statSync(file + '-shm').size, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

const retentionNow = new Date('2020-03-22T00:00:00Z');
function retentionFixture() {
  const db = openDb(':memory:');
  for (let i = 0; i < 8; i++) snap(db, `cap-${i}`, `2020-01-0${i + 1}T00:00:00Z`, [offer(10)]);
  return db;
}
const capOptions = {now: retentionNow, protectSnapshots: 1, allowUnarchivedDelete: true, checkpoint: false};

test('滚动和删除达到各自上限后可续跑，锁等待使用传入值', async () => {
  const db = retentionFixture();
  try {
    const first = await slimOffers(db, {...capOptions, maxRollSnapshots: 3, batchSnapshots: 1, maxDeleteBatches: 2, busyTimeout: 1234});
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 1234);
    assert.equal(first.rolled.rolled, 3);
    assert.equal(first.purged.batches, 2);
    assert.equal(first.complete, false);
    assert.equal(first.stoppedReason, 'batch-limit');
    const second = await slimOffers(db, {...capOptions, maxRollSnapshots: 2, maxDeleteBatches: 1, batchSnapshots: 2});
    assert.equal(second.rolled.rolled, 2);
    assert.equal(second.purged.removedOffers, 2);
    assert.equal(second.complete, false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 4);
  } finally { db.close(); }
});

test('运行期限在滚动及删除批次边界停止，已提交结果保留且不再去重', async () => {
  for (const stage of ['roll', 'delete']) {
    const db = retentionFixture();
    try {
      const elapsedNow = () => {
        const n = db.prepare(stage === 'roll' ? 'SELECT COUNT(*) n FROM offer_rolled' : 'SELECT 8-COUNT(*) n FROM offers').get().n;
        return n >= 2 ? 100 : 0;
      };
      const report = await slimOffers(db, {...capOptions, maxRuntimeMs: 100, elapsedNow, batchSnapshots: 1, dedupe: true});
      assert.equal(report.complete, false);
      assert.equal(report.stoppedReason, 'runtime');
      assert.equal(report.deduped, null);
      assert.equal(report.rolled.rolled, stage === 'roll' ? 2 : 7);
      assert.equal(report.purged.removedOffers, stage === 'roll' ? 0 : 2);
      assert.ok(db.prepare('SELECT COUNT(*) n FROM offer_candle').get().n > 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, stage === 'roll' ? 8 : 6);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='offer_retention_last_day'").get(), undefined);
      db.exec('BEGIN IMMEDIATE; ROLLBACK');
    } finally { db.close(); }
  }
});

test('归档在快照边界超时则保留全部明细和已写 K 线', async () => {
  const db = retentionFixture();
  const dir = mkdtempSync(path.join(tmpdir(), 'offer-caps-'));
  try {
    let archiveChecks = 0;
    const report = await slimOffers(db, {...capOptions, archiveDir: dir, reserveBytes: 0, maxRuntimeMs: 100,
      elapsedNow: () => db.prepare('SELECT COUNT(*) n FROM offer_rolled').get().n === 7 && ++archiveChecks >= 3 ? 100 : 0});
    assert.equal(report.stoppedReason, 'runtime');
    assert.equal(report.archive.stopped, true);
    assert.equal(report.archive.rows, 1);
    assert.equal(report.archive.verified, true);
    assert.equal(report.purged.batches, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 8);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('timer 去重默认最多四个快照，配置可降低总上限', async () => {
  for (const limit of [undefined, 2]) {
    const db = retentionFixture();
    try {
      for (let i = 0; i < 8; i++) storeSnapshot(db, {
        source: 'second', snapshotId: `second-${i}`, fetchedAt: `2020-01-0${i + 1}T00:00:00Z`,
        products: [{productId: 'claude-pro-month', name: 'Claude Pro', currency: 'CNY', offers: [offer(10)]}],
      });
      const report = await slimOffers(db, {...capOptions, days: 99999, dedupe: true, dedupeSnapshots: limit});
      assert.equal(report.deduped.compacted, limit ?? 4);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM offer_compacted').get().n, limit ?? 4);
      assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 10000);
    } finally { db.close(); }
  }
});

test('静默起止相等时采集维护不会滚动', async () => {
  const {maybeMaintainOffers} = await import('../lib/offer-retention.mjs');
  const db = retentionFixture();
  try {
    const now = new Date('2020-03-22T18:20:00Z');
    assert.equal(retentionDue(now, {start: 2, end: 2}), false);
    const report = await maybeMaintainOffers(db, {offerRetention: {enabled: true, quietHourStart: 2, quietHourEnd: 2}}, now);
    assert.equal(report.slim, null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offer_rolled').get().n, 0);
  } finally { db.close(); }
});

test('retain-offers 将配置上限和 CLI 覆盖值传入 slimOffers', async () => {
  // 隔离执行真实命令函数，截获 slimOffers 参数，不读写本地配置或业务数据库。
  const source = readFileSync(new URL('../radar.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function cmdRetain('), source.indexOf('\nasync function cmdSources('))
    .replace('await import("./lib/offer-retention.mjs")', 'deps');
  for (const cli of [false, true]) {
    let received;
    const values = {batchSnapshots: 3, maxDeleteBatches: 2, maxRollSnapshots: 5, busyTimeout: 123, maxRuntimeMs: 456, dedupeSnapshots: 2};
    const flags = {'--batch': 6, '--max-delete-batches': 7, '--max-roll-snapshots': 8, '--busy-timeout': 234, '--max-runtime-ms': 567, '--dedupe-snapshots': 3};
    const run = new Function('deps', 'arg', 'has', 'console', body + '; return cmdRetain;')(
      {protectSnapshotCount: () => 160, slimOffers: async (_db, options) => { received = options; return {}; }},
      (flag, fallback) => cli && flag in flags ? flags[flag] : fallback,
      flag => cli && flag === '--dedupe', {log() {}},
    );
    await run({offerRetention: {enabled: true, ...values}}, {});
    assert.deepEqual(Object.keys(values).map(key => received[key]), cli ? Object.values(flags) : Object.values(values));
    assert.equal(received.dedupe, cli);
    await run({offerRetention: {enabled: true}}, {});
    if (!cli) assert.deepEqual(Object.keys(values).map(key => received[key]), [20, 40, 400, 10000, 2400000, 4]);
  }
});
