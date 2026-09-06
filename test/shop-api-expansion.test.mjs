import test from 'node:test';
import assert from 'node:assert/strict';
import { queryKeyword, pull, recommendedKeywords } from '../sources/ldxp.mjs';
import { openDb, metaGet } from '../lib/db.mjs';

const item = (id) => ({ id: `ldxp:${id}`, item_url: `https://wzyp.cn/item/${id}`, goods_name: 'Claude Pro 月卡', price: 100, stock: 2, status: 'online', captured_at: '2026-09-06T08:00:00Z' });
test('LDXP summary拒绝访问后不继续查询商品', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    await assert.rejects(pull({ config: { sources: { 'ldxp-goods': { keywords: ['claude pro'] } } }, sleep: async () => {}, fetchImpl: async () => { calls++; return new Response('denied', { status }); } }));
    assert.equal(calls, 1);
  }
});
function fixture(pages, calls = []) {
  return async url => {
    const u = new URL(url); calls.push(u);
    return new Response(JSON.stringify({ items: pages.shift(), total: 3, page: Number(u.searchParams.get('page')), page_size: Number(u.searchParams.get('page_size')) }), { headers: { 'Content-Type': 'application/json' } });
  };
}
test('LDXP 有限分页按公开在售契约查询并保留去重计数', async () => {
  const calls = [], sleeps = [];
  const result = await queryKeyword('claude pro', { page_size: 2, sleep: async ms => sleeps.push(ms), fetchImpl: fixture([[item(1), item(2)], [item(3)]], calls) });
  assert.equal(result.items.length, 3);
  assert.equal(result.coverage.truncated, false);
  assert.equal(calls[1].searchParams.get('page'), '2');
  assert.equal(calls[0].searchParams.get('stock'), 'in');
  assert.equal(calls[0].searchParams.get('sort'), 'price_asc');
  assert.deepEqual(sleeps, [1000]);
});
test('LDXP 达到分页预算明确标记截断', async () => {
  const result = await queryKeyword('claude pro', { page_size: 1, max_pages_per_keyword: 1, fetchImpl: fixture([[item(1)]]) });
  assert.deepEqual(result.coverage, { keyword: 'claude pro', total: 3, fetched: 1, pagesFetched: 1, truncated: true, reason: 'page_limit' });
});
test('LDXP 跨关键词共享请求预算，耗尽后不请求', async () => {
  const budget = { remaining: 1, requests: 0 }, calls = [];
  const options = { page_size: 1, fetchImpl: fixture([[item(1)]], calls) };
  await queryKeyword('claude pro', options, budget);
  const next = await queryKeyword('gemini pro', options, budget);
  assert.equal(calls.length, 1);
  assert.equal(next.coverage.reason, 'request_budget');
});
test('LDXP 重复页停止，不把重复计数当成完整', async () => {
  const result = await queryKeyword('claude pro', { page_size: 1, sleep: async () => {}, fetchImpl: fixture([[item(1)], [item(1)]]) });
  assert.equal(result.items.length, 1);
  assert.equal(result.coverage.reason, 'repeated_or_empty_page');
});
test('LDXP 拒绝无效分页/无限预算，HTTP阻挡不重试', async () => {
  await assert.rejects(queryKeyword('claude', { fetchImpl: async () => new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json' } }) }), /契约/);
  await assert.rejects(queryKeyword('claude', { max_pages_per_keyword: 4 }), /max_pages/);
  await assert.rejects(pull({ config: { sources: { 'ldxp-goods': { keywords: ['claude'], max_requests: 25 } } } }), /max_requests/);
  let calls = 0;
  await assert.rejects(queryKeyword('claude', { fetchImpl: async () => { calls++; return new Response('denied', { status: 403 }); } }), /403/);
  assert.equal(calls, 1);
  assert.equal(recommendedKeywords.length, 12);
});
test('LDXP 持久化有限样本统计，修改scope会产生新快照', async () => {
  const db = openDb(':memory:');
  try {
    const cfg = { keywords: ['claude pro'], page_size: 1, max_pages_per_keyword: 1, min_interval_minutes: 0 };
    const ctx = { db, config: { sources: { 'ldxp-goods': cfg } }, sleep: async () => {}, fetchImpl: async url => {
      const u = new URL(url);
      const body = u.pathname === '/api/summary' ? { generated_at: '2026-09-06T08:00:00Z' } : { items: [item(1)], page: 1, page_size: 1, total: 1 };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    } };
    const first = await pull(ctx);
    const saved = JSON.parse(metaGet(db, 'coverage:ldxp-goods'));
    assert.equal(saved.fetchedUnique, 1);
    assert.equal(saved.requests, 1);
    assert.equal(saved.truncated, false);
    assert.equal(saved.matchedTotalBasis, 'sum_of_overlapping_query_totals');
    cfg.max_pages_per_keyword = 2;
    assert.notEqual((await pull(ctx)).snapshotId, first.snapshotId);
  } finally { db.close(); }
});
