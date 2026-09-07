import test from 'node:test';
import assert from 'node:assert/strict';
import { directOfferExclusionReason } from '../collectors/direct/catalog.mjs';
import { publicOfferAllowed } from '../lib/public-offers.mjs';
import { openDb, storeSnapshot } from '../lib/db.mjs';
import { projectProduct, quoteSeries, productQuoteGroups } from '../lib/quote-policy.mjs';
import { parseDujiaoProducts } from '../collectors/direct/dujiao.mjs';

const offer = description => ({ title:'Business Pro 5X 附Json 附帳密可自己復活', status:'in_stock', extra:{deliveryEvidence:{skuTitle:'Business Pro 5X',descriptionScope:'sku',description}} });
test('Dujiao parent variant-specific disclaimer does not remove the warranted recharge SKU',()=>{
  const rows=parseDujiaoProducts({data:[{id:1,title:'ChatGPT Plus',description:'成品号无售后；代充全程质保',skus:[
    {id:2,title:'成品号',price:100,auto_stock_available:2},
    {id:3,title:'代充',price:120,auto_stock_available:2}
  ]}]},{id:'burstpro-ai',name:'QA',origin:'https://burstpro-ai.online'});
  assert.equal(rows.length,2);
  assert.equal(directOfferExclusionReason(rows[0]),null,'mixed parent description alone cannot establish SKU warranty');
  assert.equal(directOfferExclusionReason(rows[1]),null);
  rows[0].extra.deliveryEvidence.skuTitle='成品号无售后';
  assert.equal(directOfferExclusionReason(rows[0]),'no_warranty');
});
test('description scope gates automatic exclusions including legacy SKU rows',()=>{
  for(const scope of ['sku','product','product_multi','']){
    for(const skuTitle of ['月卡','']){
      const row=offer('无售后');Object.assign(row.extra.deliveryEvidence,{descriptionScope:scope,skuTitle});
      assert.equal(directOfferExclusionReason(row),scope==='sku'||scope==='product'||(!scope&&!skuTitle)?'no_warranty':null,scope+'/'+skuTitle);
    }
  }
});
test('same SKU controlled description excludes simplified/traditional no-after-sales in object and stored JSON',()=>{
  for(const description of ['质保首登。※速刷商品 不提供售後，請注意!pro 5x过期不影響使用','无售后','沒有質保','售後概不負責']){
    for(const stringify of [false,true]){
      const row=offer(description);if(stringify)row.extra=JSON.stringify(row.extra);
      assert.equal(directOfferExclusionReason(row),'no_warranty',description);
      for(const source of ['direct-shops','priceai','ldxp-goods'])assert.equal(publicOfferAllowed(source,row),false);
    }
  }
});
test('limited exclusions and negated exclusions do not mean no warranty',()=>{
  for(const description of ['封號不質保不售後，正常使用保30天','封号不保','不是不提供售后，正常提供售后','并非无质保','並非沒有售後','不看說明不售後','未按说明操作不售后'])assert.equal(directOfferExclusionReason(offer(description)),null,description);
  assert.equal(directOfferExclusionReason(offer('封号不保。本商品无售后')),'no_warranty');
});
test('parent titles and arbitrary extra text cannot exclude another SKU',()=>{
  assert.equal(directOfferExclusionReason({title:'月卡',extra:{description:'无售后',deliveryEvidence:{productTitle:'其他SKU无售后',category:'无售后',skuTitle:'质保月卡',description:'正常售后'}}}),null);
  assert.equal(directOfferExclusionReason({...offer('正常售后'),extra:'bad json'}),null);
});
test('existing stored snapshots are filtered for current, history and alert group projection without deleting rows',()=>{
  const db=openDb(':memory:');
  try{
    for(const snapshotId of ['old','new'])storeSnapshot(db,{source:'priceai',snapshotId,fetchedAt:new Date().toISOString(),products:[{productId:'claude-pro-month',name:'Claude Pro',currency:'CNY',offers:[
      {...offer('不提供售後'),title:'Claude Pro 代充 1个月',offerId:'bad',price:1,currency:'CNY',url:'https://example.com/bad'},
      {...offer('封号不保，正常使用质保'),title:'Claude Pro 代充 1个月',offerId:'good',price:100,currency:'CNY',url:'https://example.com/good'}
    ]}]});
    const snapshot=db.prepare("SELECT * FROM snapshots WHERE snapshot_id='new'").get();
    const product=db.prepare("SELECT * FROM products WHERE snapshot_id='new'").get();
    const current=projectProduct(db,'priceai',snapshot,product);
    assert.equal(current.offer_count,1);assert.equal(current.lowest_price,100);
    assert.equal(productQuoteGroups(current)[0].lowest_price,100);
    const history=quoteSeries(db,{source:'priceai',productId:'claude-pro-month'});
    assert.equal(history.length,2);assert.ok(history.every(point=>point.lowest_price===100&&point.offer_count===1));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n,4);
  }finally{db.close()}
});
