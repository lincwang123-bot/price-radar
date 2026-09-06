import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,openDbReadOnly,storeSnapshot,offersOfProduct} from '../lib/db.mjs';
import {offerProvenance,quoteSourceLabel,merchantIdForUrl,merchantKeyForOffer,quoteTimeInfo} from '../lib/offer-provenance.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {projectProduct} from '../lib/quote-policy.mjs';
const at='2026-09-06T00:00:00Z';
test('共享平台根域不能作为商家，未归属报价键稳定且按报价隔离',()=>{
 for(const host of ['16688.com.cn','www.16688.com.cn','wzyp.cn','www.wzyp.cn','16688.com.cn.','www.16688.com.cn.','wzyp.cn.','priceai.cc.','www.priceai.cc.'])assert.equal(merchantIdForUrl(`https://${host}/item/1`),null);
 assert.equal(merchantIdForUrl('https://store.wzyp.cn/'),'domain:store.wzyp.cn');
 const row={source:'priceai',product_id:'p',offer_id:'a',url:'https://16688.com.cn/item/1',merchant_id:'domain:16688.com.cn'};
 const key=merchantKeyForOffer(row);assert.match(key,/^unresolved-quote:[a-f0-9]{64}$/);
 assert.equal(key,merchantKeyForOffer({...row,url:'https://16688.com.cn:443/item/1',snapshot_id:'later',price:100}));
 assert.equal(key,merchantKeyForOffer({...row,url:'https://www.16688.com.cn./item/1'}));
 assert.equal(merchantIdForUrl('https://www.shop.example./item'),'domain:shop.example');
 for(const change of [{offer_id:'b'},{product_id:'q'},{source:'direct-shops'},{url:'https://16688.com.cn/item/2'}])assert.notEqual(key,merchantKeyForOffer({...row,...change}));
 assert.equal(merchantKeyForOffer({...row,url:'https://shop.example/item'}),'domain:shop.example');
 assert.equal(merchantKeyForOffer({...row,url:'javascript:alert(1)'}),null);
 assert.equal(offerProvenance('priceai',row,{fetchedAt:at}).merchant_id,null);
});
function snapshot(id,price,source='direct-shops') {return {source,snapshotId:String(id),fetchedAt:`2026-09-06T0${id}:00:00Z`,products:[{productId:'p',offers:[{offerId:'o',url:'https://shop.example/item/1',sourceId:'shop',price,currency:'CNY',status:'in_stock',source_type:'merchant_direct'}]}]};}
test('来源等级由适配器决定，第三方载荷不能伪造商家直连或官方',()=>{
 for(const source of ['priceai','cardnav-official','goaihop-relay','ldxp-goods'])assert.equal(offerProvenance(source,{source_type:'merchant_direct'},{fetchedAt:at}).source_type,'third_party');
 assert.equal(offerProvenance('direct-shops',{source_type:'merchant_direct'},{fetchedAt:at}).source_type,'original_crawl');
 assert.equal(quoteSourceLabel({source:'priceai',source_type:'merchant_direct'}),'第三方采集');
 assert.equal(merchantIdForUrl('https://www.shop.example/item/1'),merchantIdForUrl('https://shop.example/another'));
 assert.equal(merchantIdForUrl('javascript:alert(1)'),null);
});
test('价格变化历史持续入库，未变化只更新核验时间，A→B→A保留三次',()=>{
 const db=openDb(':memory:');try{
 for(const [id,price] of [[1,100],[2,100],[3,80],[4,100]])storeSnapshot(db,snapshot(id,price));
 const get=id=>offersOfProduct(db,'direct-shops',String(id),'p')[0];
 assert.equal(get(1).last_updated_at,get(2).last_updated_at);
 assert.notEqual(get(1).last_verified_at,get(2).last_verified_at);
 assert.notEqual(get(2).last_updated_at,get(3).last_updated_at);
 assert.equal(get(4).price,100);assert.equal(get(4).source_type,'original_crawl');
 assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,4);
 assert.equal(get(1).merchant_id,get(4).merchant_id);
 }finally{db.close();}
});
test('旧报价可推导中性标签/时间，陈旧文案不声称购买认证',()=>{
 const value=quoteTimeInfo({source:'priceai',captured_at:at,quote_stale:true},{now:Date.parse(at)+3600000});
 assert.equal(value.relative,'1 小时前');assert.match(value.staleLabel,/价格可能/);
 assert.equal(quoteSourceLabel({source:'direct-shops'}),'原店采集');
 assert.equal(quoteTimeInfo({}).relative,'时间未提供');
});
test('旧库只读页面不迁移写库；writer幂等增加列且保留全部原报价',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'provenance-test-')),file=path.join(dir,'quotes.sqlite');
 let db;
 try {
   db=openDb(file);storeSnapshot(db,snapshot(1,100));
   db.exec('DROP INDEX idx_offers_identity_recorded');
   for(const column of ['source_type','source_url','last_updated_at','last_verified_at','merchant_id','recorded_at'])db.exec(`ALTER TABLE offers DROP COLUMN ${column}`);
   db.close();db=openDbReadOnly(file);
   const s=db.prepare('SELECT * FROM snapshots').get(),p=db.prepare('SELECT * FROM products').get();
   assert.equal(projectProduct(db,'direct-shops',s,p,{historical:true}).offers[0].source_type,'original_crawl');
   assert.ok(!db.prepare('PRAGMA table_info(offers)').all().some(c=>c.name==='source_type'));
   db.close();db=openDb(file);assert.ok(db.prepare('PRAGMA table_info(offers)').all().some(c=>c.name==='source_type'));
   assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,1);
   db.close();db=openDb(file);storeSnapshot(db,snapshot(2,80));assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,2);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
