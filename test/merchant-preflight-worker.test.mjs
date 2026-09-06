import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processMerchantPreflights, readPreflightRequests } from '../lib/merchant-preflight-worker.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { runPull } from '../lib/pull.mjs';
import { openDb } from '../lib/db.mjs';

function fixture(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'merchant-preflight-worker-'));
  const merchantBridgeDir = path.join(dataDir, 'bridge'); mkdirSync(merchantBridgeDir);
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const now = Date.now();
  const request = { id: 'MT-' + 'A'.repeat(24), applicationId: 'MA-20260907-' + 'A'.repeat(12), applicationVersion: 1,
    identity: 'domain:preflight-shop.com', shopName: '测试店铺', shopUrl: 'https://preflight-shop.com/', platform: 'independent',
    requestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3599000).toISOString() };
  const save = (requests = [request]) => writeFileSync(path.join(merchantBridgeDir, 'preflight-requests.json'), JSON.stringify({ schemaVersion: 1, requests }));
  save();
  return { dataDir, merchantBridgeDir, request, save, result: () => JSON.parse(readFileSync(path.join(dataDir, 'merchant-preflights', request.id + '.json'))) };
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const payload = (title = 'ChatGPT Plus 月卡代充', stock = 3) => ({ status_code: 200, data: [{ id: 1, title, skus: [{ id: 1, price_amount: 100, auto_stock_available: stock }] }], pagination: { total: 1, total_page: 1, page: 1 } });

test('试采只产出有界结果，不写市场快照或已批准缓存；已完成请求不重复采集', async t => {
  const f = fixture(t); let calls = 0;
  const ctx = { ...f, merchantFetchFactory: () => async () => { calls++; return json(payload()); } };
  assert.equal((await processMerchantPreflights(ctx)).processed, 1);
  const result = f.result(); assert.equal(result.status, 'ready'); assert.equal(result.validCount, 1); assert.equal(result.rawCount, 1);
  assert.equal(result.samples[0].price, 100); assert.equal(result.applicationVersion, 1);
  assert.equal(existsSync(path.join(f.dataDir, 'radar.sqlite')), false);
  assert.equal(existsSync(path.join(f.dataDir, 'direct-shops-cache')), false);
  assert.equal((await processMerchantPreflights(ctx)).processed, 0); assert.equal(calls, 1);
});

test('零库存、无质保、不能分类的商品不能算有效接入', async t => {
  for (const [title, stock] of [['ChatGPT Plus 月卡代充', 0], ['ChatGPT Plus 月卡 无质保', 3], ['完全不相关的商品', 3]]) {
    const f = fixture(t);
    await processMerchantPreflights({ ...f, merchantFetchFactory: () => async () => json(payload(title, stock)) });
    assert.equal(f.result().status, 'no_valid_offers'); assert.equal(f.result().validCount, 0); assert.deepEqual(f.result().samples, []);
  }
});

test('队列身份、有效期、路径和容量验证失败时不联网', async t => {
  const f = fixture(t); let calls = 0;
  for (const change of [{ id: '../escape' }, { identity: 'domain:other.com' }, { shopUrl: 'https://127.0.0.1/' }, { applicationVersion: 0 }, { expiresAt: new Date(Date.now() + 86400000).toISOString() }, { shopUrl: 'https://preflight-shop.com/?key=secret' }]) {
    f.save([{ ...f.request, ...change }]); assert.equal(readPreflightRequests(f.merchantBridgeDir).valid, false);
    await processMerchantPreflights({ ...f, merchantFetchFactory: () => async () => { calls++; return json(payload()); } });
  }
  f.save([{ ...f.request, requestedAt: new Date(Date.now() - 7200000).toISOString(), expiresAt: new Date(Date.now() - 3600000).toISOString() }]);
  assert.equal(readPreflightRequests(f.merchantBridgeDir).requests.length, 0);
  assert.equal(calls, 0);
});

test('拒绝访问立即停止且不泄露原响应；未知系统明确待适配', async t => {
  const f = fixture(t); let calls = 0;
  await processMerchantPreflights({ ...f, merchantFetchFactory: () => async () => { calls++; return new Response('secret backend trace', { status: 403 }); } });
  assert.equal(calls, 1); assert.equal(f.result().status, 'unavailable'); assert.ok(!JSON.stringify(f.result()).includes('secret'));
  const g = fixture(t);
  await processMerchantPreflights({ ...g, merchantFetchFactory: () => async () => json({ unrelated: true }) });
  assert.equal(g.result().status, 'waiting_adapter');
});

test('撤销队列或更换版本后，进行中的试采不留下可批准结果', async t => {
  const f = fixture(t);
  await processMerchantPreflights({ ...f, merchantFetchFactory: () => async () => { f.save([]); return json(payload()); } });
  assert.equal(existsSync(path.join(f.dataDir, 'merchant-preflights', f.request.id + '.json')), false);
});

test('试采中被撤销的请求也占每轮最多两项预算', async t => {
  const f = fixture(t); let calls = 0;
  let requests = [1, 2, 3, 4].map(n => ({ ...f.request, id: 'MT-' + String(n).repeat(24), applicationId: 'MA-20260907-' + String(n).repeat(12),
    identity: `domain:preflight-shop${n}.com`, shopUrl: `https://preflight-shop${n}.com/` }));
  f.save(requests);
  await processMerchantPreflights({ ...f, merchantFetchFactory: origin => async () => {
    calls++; requests = requests.filter(r => new URL(r.shopUrl).origin !== origin); f.save(requests); return json(payload());
  } });
  assert.equal(calls, 2);
});

test('预览沿用网站公开过滤及去重，只输出允许字段', () => {
  const raw = { sourceId: 'probe', offerId: 'probe-1', storeName: '店铺', title: 'ChatGPT Plus 月卡代充',
    price: 100, currency: 'CNY', status: 'in_stock', stockCount: 3, url: 'https://preflight-shop.com/item/1', capturedAt: new Date().toISOString(), extra: { contact: 'private' } };
  const result = summarizeMerchantOffers([raw, { ...raw, offerId: 'probe-2' }, { ...raw, offerId: 'bad', title: 'ChatGPT Plus 月卡 无任何质保', price: 1 }]);
  assert.equal(result.rawCount, 3); assert.equal(result.validCount, 1); assert.equal(result.samples.length, 1);
  assert.deepEqual(Object.keys(result.samples[0]).sort(), ['currency', 'price', 'title', 'url']);
});

test('恢复旧锁后与第二个worker互斥，完成后清理自己持有的锁', async t => {
  const f = fixture(t), dir = path.join(f.dataDir, 'merchant-preflights'); mkdirSync(dir);
  const lock = path.join(dir, '.worker.lock'); writeFileSync(lock, 'old');
  const old = new Date(Date.now() - 600000); utimesSync(lock, old, old);
  let release, entered; const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); let calls = 0;
  const ctx = { ...f, merchantFetchFactory: () => async () => { calls++; entered(); await waiting; return json(payload()); } };
  const first = processMerchantPreflights(ctx); await started;
  assert.equal((await processMerchantPreflights(ctx)).processed, 0);
  release(); assert.equal((await first).processed, 1); assert.equal(calls, 1);
  assert.equal(existsSync(lock), false); assert.equal(existsSync(path.join(dir, '.worker-recovery')), false);
});

test('常规采集入口即使没有启用报价源也执行接入检测，不产生市场快照', async t => {
  const f = fixture(t), db = openDb(':memory:'); t.after(() => db.close());
  const results = await runPull({ ...f, db, config: { sources: {} }, log: () => {}, merchantFetchFactory: () => async () => json(payload()) });
  assert.deepEqual(results, []); assert.equal(f.result().status, 'ready');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM snapshots').get().n, 0);
});
