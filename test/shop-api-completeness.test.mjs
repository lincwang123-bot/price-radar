import test from 'node:test';
import assert from 'node:assert/strict';
import { collectShopApi, parseShopApiGoods } from '../collectors/direct/shop-api.mjs';

const target = { id: 'wzyp-ai-choice', name: 'AI优选站', token: 'QOZ92954', origin: 'https://wzyp.cn' };
const goods = id => ({ goods_key: id, name: 'Claude Pro 月卡', price: 150, extend: { stock_count: 1 } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
test('说明字段明确无保障过滤，但原站真实有限封号免责保留', () => {
  const descriptions = [
    '<p>本商品无<strong>质保</strong></p>',
    '<p>没有售后</p>',
    '<p>不提供&nbsp;质保</p>',
    '<p>30天质保掉订阅，封号不质保不售后</p>',
    '<p>自身账号封禁不保</p>',
    '<p>封号不质保不售后。本商品无质保</p>',
  ];
  const rows = parseShopApiGoods({ code: 1, data: { list: descriptions.map((description, i) => ({ ...goods(String(i)), description })) } }, target);
  assert.deepEqual(rows.map(row => row.offerId), ['wzyp-ai-choice:3', 'wzyp-ai-choice:4']);
});
test('真实自定义“全部商品”空分类不能遮掉其他分类目录', async () => {
  const calls = [];
  const result = await collectShopApi(target, { fetchImpl: async (url, init) => {
    const request = JSON.parse(init.body); calls.push(request);
    if (url.endsWith('categoryList')) return json({ code: 1, data: [
      { id: 127750, name: 'G', goods_count: 1 },
      { id: 177473, name: '全部商品', goods_count: 0 },
      { id: 139690, name: 'Claude', goods_count: 1 },
    ] });
    return json({ code: 1, data: { total: request.category_id === 177473 ? 0 : 1, list: request.category_id === 177473 ? [] : [goods(String(request.category_id))] } });
  } });
  assert.equal(result.length, 2);
  assert.deepEqual(calls.slice(1).map(x => x.category_id), [127750, 139690]);
});
test('缺失分类计数及null total表示未知，不能截断成零条', async () => {
  let requestCount = 0;
  const result = await collectShopApi(target, { pageSize: 1, fetchImpl: async (url, init) => {
    requestCount++;
    if (url.endsWith('categoryList')) return json({ code: 1, data: [{ id: 1, name: 'Claude', goods_count: null }] });
    const page = JSON.parse(init.body).current;
    return json({ code: 1, data: { total: null, list: page <= 2 ? [goods(String(page))] : [] } });
  } });
  assert.equal(result.length, 2);
  assert.equal(requestCount, 4);
});
test('分页total缩小或返回超量不能假称完整', async () => {
  let requestCount = 0;
  await assert.rejects(collectShopApi(target, { pageSize: 1, fetchImpl: async url => {
    if (url.endsWith('categoryList')) return json({ code: 1, data: [{ id: 1, name: 'Claude' }] });
    requestCount++;
    return json({ code: 1, data: { total: requestCount === 1 ? 3 : 1, list: [goods(String(requestCount))] } });
  } }), /完整|total/);
});
test('已知大店41个非空分类须明确提高上限，不能静默截断', async () => {
  const fetchImpl = async (url, init) => url.endsWith('categoryList')
    ? json({ code: 1, data: Array.from({ length: 41 }, (_, i) => ({ id: i + 1, name: `类${i + 1}`, goods_count: 1 })) })
    : json({ code: 1, data: { total: 1, list: [goods(String(JSON.parse(init.body).category_id))] } });
  await assert.rejects(collectShopApi(target, { maxCategories: 40, fetchImpl }), /maxCategories/);
  assert.equal((await collectShopApi(target, { maxCategories: 50, fetchImpl })).length, 41);
});
test('真实id0全店分类只读聚合目录，保留完整总数验证', async () => {
  const requests = [];
  const rows = await collectShopApi(target, { fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    return url.endsWith('categoryList')
      ? json({ code: 1, data: [{ id: 0, name: '全部', goods_count: 2 }, { id: 121065, name: '中转站', goods_count: 2 }] })
      : json({ code: 1, data: { total: 2, list: [goods('a'), goods('b')] } });
  } });
  assert.equal(rows.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].category_id, 0);
});
