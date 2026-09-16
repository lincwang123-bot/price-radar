import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, storeSnapshot, recentSnapshots, productsOfSnapshot } from '../lib/db.mjs';
import { projectProduct, productQuoteGroups, quoteSeries } from '../lib/quote-policy.mjs';
import { runWatch } from '../lib/watch.mjs';

function fixture(t, offers, productId = 'claude-pro-month') {
  const db = openDb(':memory:'); t.after(() => db.close());
  const fetchedAt = new Date().toISOString();
  storeSnapshot(db, { source:'direct-shops', snapshotId:'delivery-fixture', fetchedAt, products:[{
    productId, name:productId.startsWith('chatgpt-plus') ? 'ChatGPT Plus 成品号/共享' : 'Claude Pro',
    productType:'订阅/会员', currency:'CNY', offers:offers.map((offer, index) => ({
      offerId:String(index), status:'in_stock', price:100, currency:'CNY', url:`https://delivery-shop.com/buy/${index}`,
      capturedAt:fetchedAt, ...offer,
    })),
  }] });
  const snapshot = recentSnapshots(db, 'direct-shops', 1)[0];
  const product = productsOfSnapshot(db, 'direct-shops', snapshot.snapshot_id)[0];
  return { db, snapshot, product, projected:projectProduct(db, 'direct-shops', snapshot, product) };
}

test('历史Plus存储ID不能覆盖交付证据或令更正后的报价消失', t => {
  const {db,projected} = fixture(t, [
    {title:'ChatGPT Plus 自有账号充值1个月',price:120},
    {title:'ChatGPT Plus 成品账号1个月',price:30},
  ], 'chatgpt-plus');
  assert.equal(projected.offers.length,2);
  assert.equal(projected.name,'ChatGPT Plus');
  assert.equal(projected.offers.find(offer=>offer.price===120).delivery_kind,'recharge');
  assert.equal(projected.offers.find(offer=>offer.price===30).delivery_kind,'account');
  assert.equal(projected.lowest_price,null);
  assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,2);
  assert.equal(db.prepare('SELECT name FROM products').get().name,'ChatGPT Plus 成品号/共享');
});

test('同名不同原店交付说明投影为分开的比较组，读取历史不串价', t => {
  const {db,projected}=fixture(t,[
    {title:'Claude Pro 月卡',price:30,extra:{deliveryEvidence:{category:'成品账号'}}},
    {title:'Claude Pro 月卡',price:130,extra:{deliveryEvidence:{category:'订阅代充'}}},
  ]);
  assert.equal(projected.offers.length,2);
  const groups=productQuoteGroups(projected);
  assert.equal(groups.length,2);
  assert.equal(projected.lowest_price,null);
  for(const group of groups) {
    assert.equal(group.comparable,true);
    assert.equal(quoteSeries(db,{source:'direct-shops',productId:'claude-pro-month',comparisonKey:group.comparison_key})[0].lowest_price,group.lowest_price);
  }
});

test('交付未注明、裸卡密、多种交付共价的记录保留，但不能产生可比最低价和价格提醒', t => {
  const {db,projected}=fixture(t,[
    {title:'Claude Pro 月卡',price:1},
    {title:'Claude Pro 月卡卡密',price:2},
    {title:'Claude Pro 月卡 代充/成品+50',price:3},
  ]);
  assert.equal(projected.offers.length,3);
  assert.ok(projected.offers.every(offer=>offer.delivery_known===false&&offer.comparison_known===false));
  assert.equal(projected.lowest_price,null);
  assert.equal(quoteSeries(db,{source:'direct-shops',productId:'claude-pro-month'})[0].lowest_price,null);
  assert.deepEqual(runWatch(db,{rules:[{id:'delivery-no-guess',source:'direct-shops',kind:'min_below',threshold:50}]}),[]);
});

test('成品低价不会触发代充比较组的阈值提醒', t => {
  const {db,projected}=fixture(t,[
    {title:'Claude Pro 月卡成品账号',price:30},
    {title:'Claude Pro 月卡代充',price:130},
  ]);
  const recharge=projected.offers.find(offer=>offer.price===130);
  assert.equal(recharge.delivery_kind,'recharge');
  assert.deepEqual(runWatch(db,{rules:[{id:'recharge-only',source:'direct-shops',kind:'min_below',threshold:50,groupId:recharge.comparison_key}]}),[]);
});
