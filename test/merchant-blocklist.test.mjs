import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantUrlBlocked,merchantOfferBlocked} from '../lib/merchant-blocklist.mjs';
import {publicOfferAllowed} from '../lib/public-offers.mjs';
import {directTargets,collectorFor} from '../collectors/direct/registry.mjs';
import {openDb,storeSnapshot,recentSnapshots,productsOfSnapshot} from '../lib/db.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {resolveOutboundOffer} from '../lib/outbound.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
test('unavailable AI666 and RedeemGPT are paused without blocking ai666.io',()=>{
 for(const url of ['https://ai666.id/','https://faka.redeemgpt.com/']){
  assert.equal(merchantUrlBlocked(url),true);
  for(const field of ['url','source_url','sourceUrl'])assert.equal(merchantOfferBlocked({[field]:url}),true);
 }
 for(const id of ['ai666','redeemgpt']){
  for(const field of ['source_id','sourceId'])assert.equal(merchantOfferBlocked({[field]:id,url:'https://example.com/'}),true);
  assert.ok(!directTargets().some(target=>target.id===id));
  assert.deepEqual(directTargets([id]),[]);
 }
 for(const url of ['https://www.ai666.io/','https://ai666.io/']){
  assert.equal(merchantUrlBlocked(url),false);
  assert.equal(merchantOfferBlocked({url}),false);
 }
});
test('manual or approved-merchant probing cannot re-enable blocked network requests',async()=>{
 let requests=0;
 await assert.rejects(probeMerchantCatalog({shopUrl:'https://fk.10886.xyz/',identity:'domain:fk.10886.xyz'},{merchantFetchFactory:()=>{requests++;throw new Error('must not fetch');}},new Date().toISOString(),Date.now()+30000),/暂停采集/);
 assert.equal(requests,0);
});
test('operator block excludes only the requested shop and prevents future direct collection',()=>{
 for(const url of ['https://fk.10886.xyz/','https://FK.10886.XYZ./item/4','http://www.fk.10886.xyz/item/4'])assert.equal(merchantUrlBlocked(url),true);
 for(const url of ['https://openzy.co/','https://OPENZY.CO./products/x','https://www.openzy.co/products/chatgpt-go-card'])assert.equal(merchantUrlBlocked(url),true);
 for(const url of ['https://other.10886.xyz/','https://fk.10886.xyz.other.com/','https://example.com/?url=fk.10886.xyz','https://other-openzy.co/','https://example.com/?url=openzy.co'])assert.equal(merchantUrlBlocked(url),false);
 assert.deepEqual(directTargets(['fk10886']),[]);assert.ok(!directTargets().some(t=>t.id==='fk10886'));
 assert.throws(()=>collectorFor({id:'fk10886',origin:'https://fk.10886.xyz',kind:'kami'}),/暂停采集/);
 for(const source of ['direct-shops','ldxp-goods','unknown'])assert.equal(publicOfferAllowed(source,{url:'https://fk.10886.xyz/item/4'}),false);
 for(const source of ['direct-shops','ldxp-goods','unknown'])assert.equal(publicOfferAllowed(source,{url:'https://openzy.co/products/chatgpt-go-card'}),false);
 for(const source of ['direct-shops','ldxp-goods','unknown'])assert.equal(publicOfferAllowed(source,{source_id:'merchant-8e24ef59bd36ee07',url:'https://example.com/x'}),false);
});
test('existing snapshots cannot display or redirect to the blocked shop; history is retained',()=>{
 const db=openDb(':memory:'),at=new Date().toISOString();
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'s',fetchedAt:at,products:[{productId:'claude-pro-month',name:'Claude Pro',currency:'CNY',offers:[{offerId:'blocked',title:'Claude Pro 代充1个月 新开续费均可',status:'in_stock',price:1,currency:'CNY',url:'https://fk.10886.xyz/item/18',capturedAt:at},{offerId:'other',title:'Claude Pro 代充1个月 新开续费均可',status:'in_stock',price:100,currency:'CNY',url:'https://other-shop.com/item/18',capturedAt:at}]}]});
  const p=projectProduct(db,'direct-shops',recentSnapshots(db,'direct-shops',1)[0],productsOfSnapshot(db,'direct-shops','s')[0]);
  assert.equal(p.offers.length,1);assert.equal(p.lowest_price,100);
  assert.equal(resolveOutboundOffer(db,{source:'direct-shops',snapshot:'s',product:'claude-pro-month',offer:'blocked'}),null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n,2);
 }finally{db.close();}
});
