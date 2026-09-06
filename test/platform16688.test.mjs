import test from 'node:test';
import assert from 'node:assert/strict';
import { collect16688, parse16688Goods, PLATFORM16688_SHOPS } from '../collectors/direct/platform16688.mjs';
import { groupDirectOffers } from '../collectors/direct/catalog.mjs';

const target = PLATFORM16688_SHOPS.find(t => t.shopNo === 'S311799');
const capturedAt = '2026-09-06T08:47:00.000Z';
const item = { goods_no: 'G44611111', name: 'ChatGPT Plus 代充 月卡 质保30天', price: 113.89, stock_available_quantity: 17, stock_available_status: 'normal' };
const payload = list => ({ code: 1, data: { list } });

test('16688 原价、原始 URL、库存及店铺证据保真，去重但不推定未知库存', () => {
  const rows = parse16688Goods(payload([
    item, item,
    { ...item, goods_no: 'G2', stock_available_quantity: null, stock_available_status: '' },
    { ...item, goods_no: 'G3', stock_available_quantity: 15, stock_available_status: 'out' },
    { ...item, goods_no: 'G4', stock_available_quantity: 4, stock_available_status: 'low' },
  ]), target, capturedAt);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].price, 113.89);
  assert.equal(rows[0].currency, 'CNY');
  assert.equal(rows[0].feeAmount, null);
  assert.equal(rows[0].url, 'https://www.16688.com.cn/goods/G44611111');
  assert.equal(rows[0].extra.shopNo, 'S311799');
  assert.equal(rows[0].capturedAt, capturedAt);
  assert.equal(rows[1].status, 'unknown');
  assert.equal(rows[1].stockCount, null);
  assert.equal(rows[2].status, 'out_of_stock');
  assert.equal(rows[2].stockCount, 0);
  assert.equal(rows[3].status, 'low_stock');
});

test('16688 接入既有售罄和无质保过滤', () => {
  const rows = parse16688Goods(payload([
    item,
    { ...item, goods_no: 'G2', stock_available_quantity: 0 },
    { ...item, goods_no: 'G3', name: 'ChatGPT Plus 月卡 代充 无质保无售后' },
    { ...item, goods_no: 'G4', description: '<p>无<strong>质保</strong>，无售后</p>' },
  ]), target, capturedAt);
  const visible = groupDirectOffers(rows).flatMap(p => p.offers);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].offerId, `${target.id}:G44611111`);
  const limited = parse16688Goods(payload([{ ...item, description: '<p>质保30天，封号不质保</p>' }]), target);
  assert.equal(limited.length, 1);
});

test('16688 只请求已登记公开列表，不使用凭据、分页猜测或重试', async () => {
  let count = 0;
  const rows = await collect16688(target, { capturedAt, fetchImpl: async (url, init) => {
    count++;
    assert.equal(url, 'https://www.16688.com.cn/shopApi/goods/list');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Cookie, undefined);
    assert.deepEqual(JSON.parse(init.body), { shop_no: 'S311799', goods_category_no: '', keywords: '', sort: 'default' });
    return Response.json(payload([item]));
  } });
  assert.equal(count, 1);
  assert.equal(rows.length, 1);
  await assert.rejects(collect16688({ ...target, shopNo: 'S999999' }), /未登记/);
  await assert.rejects(collect16688({ ...target, origin: 'https://evil.test' }), /未登记/);
  await assert.rejects(collect16688(target, { fetchImpl: async () => new Response('blocked', { status: 403 }) }), /403/);
  assert.throws(() => parse16688Goods({ code: 0, msg: '请登录' }, target), /目录失败/);
  assert.throws(() => parse16688Goods({ code: 1, data: { list: [item], total: 2 } }, target), /不完整/);
});
