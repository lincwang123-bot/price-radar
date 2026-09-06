import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM16688_SHOPS, collect16688, parse16688Goods } from '../collectors/direct/platform16688.mjs';
import { groupDirectOffers } from '../collectors/direct/catalog.mjs';

test('verified AI充值 shop retains negative inventory as unknown and original retail title', () => {
  const target = PLATFORM16688_SHOPS.find(row => row.shopNo === 'S361816');
  assert.equal(target.seedUrl, 'https://16688.com.cn/goods/G70554833');
  const title = '【美区IOS】GP.T Pro 5X 官方正规充值 质保30天 可以开发票（付款后秒发CDK直充自己号）';
  const rows = parse16688Goods({ code: 1, data: { list: [
    { goods_no: 'G70554833', name: title, price: 585, stock_available_quantity: 1, stock_available_status: 'low' },
    { goods_no: 'G50912785', name: 'GP.T Pro 20X 官方充值', price: 1150, stock_available_quantity: -1, stock_available_status: '' },
  ] } }, target);
  assert.equal(rows[0].title, title);
  assert.equal(rows[0].status, 'low_stock');
  assert.equal(rows[1].status, 'unknown');
  assert.equal(rows[1].stockCount, null);
  assert.equal(groupDirectOffers(rows).reduce((n, row) => n + row.inStockCount, 0), 1);
});

test('public source-square discovery adds verified retail shops without ingesting wholesale prices', async () => {
  const target = PLATFORM16688_SHOPS.find(row => row.shopNo === 'S888822');
  assert.ok(target, '带鱼ai verified retail shop is registered');
  assert.equal(target.seedUrl, 'https://16688.com.cn/goods/G69292311');
  assert.equal(target.discoveryUrl, 'https://www.16688.com.cn/source');
  const calls = [];
  const rows = await collect16688(target, { fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(JSON.parse(init.body).shop_no, 'S888822');
    return Response.json({ code: 1, data: { list: [
      { goods_no: 'G69292311', name: '【官方充值】Codex Plus 1 个月 菲区正价代充 质保', price: 114.8, cost_price: 1, agent_price: 2, stock_available_quantity: 3, stock_available_status: 'normal' },
      { goods_no: 'G2', name: 'Codex Plus 月卡代充', price: 10, stock_available_quantity: 0, stock_available_status: 'normal' },
      { goods_no: 'G3', name: 'Codex Plus 月卡代充', description: '<p>无质保无售后</p>', price: 9, stock_available_quantity: 2 },
    ] } });
  } });
  assert.deepEqual(calls, ['https://www.16688.com.cn/shopApi/goods/list']);
  const visible = groupDirectOffers(rows).flatMap(row => row.offers);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].price, 114.8);
  assert.equal(visible[0].storeName, '带鱼ai');
  assert.equal(visible[0].url, 'https://www.16688.com.cn/goods/G69292311');
  await assert.rejects(collect16688({ ...target, shopNo: 'S999999' }), /未登记/);
});
