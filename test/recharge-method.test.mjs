import test from 'node:test';
import assert from 'node:assert/strict';
import { rechargeMethod } from '../lib/recharge-method.mjs';
import { buildProductDirectory, directoryQuotes } from '../lib/product-directory.mjs';

test('recharge channel follows explicit product evidence, not price or device compatibility', () => {
  for (const title of ['ChatGPT Plus iOS 官方直充月卡', 'ChatGPT Plus 代充 App Store 内购', 'Claude Pro 苹果内购代充', 'ChatGPT Plus IOS礼品卡充值', 'GPT Go 充值月卡卡密（IOS印区质保）']) assert.equal(rechargeMethod({title}).kind, 'ios', title);
  for (const title of ['ChatGPT Plus 网页充值', 'ChatGPT Plus Web 代充', 'ChatGPT Plus Google Play 代充', 'Claude Pro 代充 谷歌正充', 'ChatGPT Plus 安卓代充', 'ChatGPT Plus 非iOS渠道充值']) assert.equal(rechargeMethod({title}).kind, 'other', title);
  for (const title of ['ChatGPT Plus 代充', 'ChatGPT Plus 官方直充', 'ChatGPT Plus 代充【可覆盖iOS/谷歌】', 'ChatGPT Plus 代充【安卓IOS通用】', 'ChatGPT Plus 代充【支持iOS设备使用】', 'Grok Super 官方充值【IOS通用】', 'ChatGPT Plus 代充 iOS/安卓任选', 'ChatGPT Plus 不支持iOS充值', 'ChatGPT Plus 代充，iOS用户可用', 'ChatGPT Plus 代充，支持iOS', 'ChatGPT Plus 代充，用苹果邮箱接收通知']) assert.equal(rechargeMethod({title, price:199, store_name:'iOS官方充值', source:'ios'}).kind, 'unknown', title);
  assert.equal(rechargeMethod({title:'ChatGPT Plus 安卓代充，支持iOS设备使用'}).kind, 'other');
  assert.equal(rechargeMethod({title:'ChatGPT Plus iOS代充，不支持安卓充值'}).kind, 'ios');
  assert.equal(rechargeMethod({title:'ChatGPT Plus 成品号 iOS'}).kind, 'unknown');
  for(const usage of ['仅限iOS使用','在iOS登录','iOS设备','iOS手机可用','supports iOS','iOS compatible','available on iOS']) assert.equal(rechargeMethod({title:'ChatGPT Plus 代充 '+usage}).kind,'unknown',usage);
});

test('selected SKU resolves alternatives; same-SKU conflicts and unscoped descriptions stay unknown', () => {
  const make = evidence => ({title:'ChatGPT Plus iOS/网页代充',extra:{deliveryEvidence:evidence}});
  assert.equal(rechargeMethod(make({skuTitle:'iOS代充 月卡',descriptionScope:'product_multi',description:'网页充值'})).kind, 'ios');
  assert.equal(rechargeMethod(make({skuTitle:'网页代充 月卡'})).kind, 'other');
  assert.equal(rechargeMethod(make({skuTitle:'iOS代充 月卡',descriptionScope:'sku',description:'本商品通过Google Play充值'})).kind, 'unknown');
  assert.equal(rechargeMethod({title:'ChatGPT Plus 代充',extra:{deliveryEvidence:{descriptionScope:'product_multi',description:'iOS充值'}}}).kind, 'unknown');
  assert.equal(rechargeMethod({title:'ChatGPT Plus 代充',extra:{deliveryEvidence:{descriptionScope:'sku',description:'通过 App Store 内购充值'}}}).kind, 'ios');
  assert.equal(rechargeMethod({title:'ChatGPT Plus iOS代充',extra:{deliveryEvidence:{skuTitle:'非iOS渠道充值'}}}).kind, 'other');
  assert.equal(rechargeMethod({title:'ChatGPT Plus iOS代充',extra:{deliveryEvidence:{skuTitle:'不支持iOS充值'}}}).kind, 'unknown');
  assert.equal(rechargeMethod({title:'ChatGPT Plus 代充',extra:{deliveryEvidence:{description:'全店提供 iOS代充'}}}).kind, 'unknown');
  assert.equal(rechargeMethod({title:'ChatGPT Plus 代充',extra:'broken json'}).kind, 'unknown');
});

test('directory filters recharge method before sorting/counting and preserves same-URL variants', () => {
  const offers = [
    ['ios','ChatGPT Plus iOS代充 1个月',150], ['web','ChatGPT Plus 网页代充 1个月',110],
    ['unknown','ChatGPT Plus 代充 1个月',90], ['account','ChatGPT Plus 成品号 1个月',20],
  ].map(([offer_id,title,price])=>({offer_id,title,price,currency:'CNY',status:'in_stock',stock_count:1,url:'https://merchant.example/product',comparison_known:true,comparison_key:offer_id==='account'?'account':'same-recharge-spec'}));
  const product = buildProductDirectory([{source:'direct-shops',products:[{product_id:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers}]}]).find(c=>c.key==='chatgpt').products.find(p=>p.key==='chatgpt-plus');
  const all=directoryQuotes(product,{delivery:'recharge'});
  assert.equal(all.total,3); assert.equal(all.shopCount,1);
  assert.deepEqual(all.rechargeMethods.map(g=>[g.kind,g.count]),[['ios',1],['other',1],['unknown',1]]);
  for(const [recharge,price] of [['ios',150],['other',110],['unknown',90]]) {
    const filtered=directoryQuotes(product,{delivery:'recharge',recharge,sort:'price_desc'});
    assert.deepEqual(filtered.entries.map(e=>e.offer.price),[price]); assert.equal(filtered.total,1);
    assert.deepEqual(filtered.rechargeMethods,all.rechargeMethods);
  }
  assert.equal(directoryQuotes(product,{delivery:'recharge',recharge:'invalid'}).total,3);
  assert.deepEqual(directoryQuotes(product,{delivery:'account',recharge:'ios'}).entries.map(e=>e.offer.price),[20]);
  assert.equal(directoryQuotes(product,{delivery:'recharge',currency:'USD'}).rechargeMethods.reduce((n,g)=>n+g.count,0),0);
  assert.equal(directoryQuotes(product,{delivery:'recharge',channel:'ldxp'}).rechargeMethods.reduce((n,g)=>n+g.count,0),0);
});
