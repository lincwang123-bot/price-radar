import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantIdForUrl,merchantIdForOffer,merchantKeyForOffer,offerProvenance} from '../lib/offer-provenance.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {handleOutbound,outboundHref,resolveOutboundOffer} from '../lib/outbound.mjs';

const date=new Date('2026-10-02T00:00:00Z');
const offer=(id,shop,over={})=>({source:'direct-shops',product_id:'chatgpt-plus',offer_id:id,title:'ChatGPT Plus 成品账号 1个月',price:100,currency:'CNY',status:'in_stock',stock_count:1,url:'https://catfk.com/goods/'+id,extra:{shopUrl:'https://catfk.com/shop/'+shop},...over});
test('Catfk accounting resolves shop paths and verified collection evidence, never the platform domain',()=>{
 for(const host of ['catfk.com','www.catfk.com','catfk.com.']){
  assert.equal(merchantIdForUrl('https://'+host+'/shop/alpha'),'shop:catfk:alpha');
  for(const tail of ['/','/goods/1','/shop/admin','/shop/alpha?token=other','/shop/alpha#goods'])assert.equal(merchantIdForUrl('https://'+host+tail),null);
 }
 assert.equal(merchantKeyForOffer(offer('1','alpha')),'shop:catfk:alpha');
 assert.equal(merchantKeyForOffer(offer('2','alpha')),'shop:catfk:alpha');
 assert.equal(merchantKeyForOffer(offer('3','beta')),'shop:catfk:beta');
 assert.equal(offerProvenance('direct-shops',offer('1','alpha'),{fetchedAt:date.toISOString()}).merchant_id,'shop:catfk:alpha');
 for(const url of ['http://catfk.com/goods/1','https://catfk.com:8443/goods/1','https://user:password@catfk.com/goods/1'])assert.equal(merchantIdForOffer(offer('1','alpha',{url})),null);
 for(const over of [{source:'ldxp-goods'},{extra:{}},{extra:{shopUrl:'https://wzyp.cn/shop/alpha'}},{extra:'invalid-json'}])assert.match(merchantKeyForOffer(offer('1','alpha',{merchant_id:'domain:catfk.com',...over})),/^unresolved-quote:/);
 assert.notEqual(merchantKeyForOffer(offer('1','alpha',{extra:{}})),merchantKeyForOffer(offer('2','alpha',{extra:{}})));
});
test('Catfk directory counts verified shops once across products and leaves unknown quotes unresolved',()=>{
 const rows=[offer('1','alpha'),offer('2','alpha'),offer('3','beta'),offer('4','unknown',{extra:{}})];
 const directory=buildProductDirectory([{source:'direct-shops',products:[{product_id:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:rows}]}]);
 const product=directory.find(c=>c.key==='chatgpt').products.find(p=>p.key==='chatgpt-plus'),result=directoryQuotes(product);
 assert.equal(result.total,4);assert.equal(result.shopCount,2);assert.equal(result.unresolvedQuoteCount,1);
});
test('Catfk clicks retain valid legacy links and attribute separate shops using fresh evidence',()=>{
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','fixture-only-analytics-secret-32-chars',{now:date});
 try{
  const rows=[offer('1','alpha'),offer('2','alpha'),offer('3','beta'),offer('4','unknown',{extra:{}})];
  storeSnapshot(db,{source:'direct-shops',snapshotId:'catfk-accounting',fetchedAt:date.toISOString(),products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:rows.map(row=>({...row,offerId:row.offer_id,stockCount:row.stock_count}))}]});
  db.prepare("UPDATE offers SET merchant_id='domain:catfk.com'").run();
  for(const row of rows){
   const current=resolveOutboundOffer(db,{source:'direct-shops',snapshot:'catfk-accounting',product:'chatgpt-plus',offer:row.offer_id},date.getTime());assert.ok(current);
   if(row.offer_id==='4')assert.match(current.merchant_id,/^unresolved-quote:/);else assert.equal(current.merchant_id,'shop:catfk:'+(row.offer_id==='3'?'beta':'alpha'));
   const req={method:'GET',headers:{'user-agent':'Mozilla/5.0 Chrome/120','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'}},res={headers:{},setHeader(k,v){this.headers[k]=v;},end(){}};
   const href=outboundHref({...row,snapshot_id:'catfk-accounting'})+'&ack=1';
   handleOutbound(req,res,new URL(href,'https://airadar.vip'),{db,analytics,now:date.getTime()});assert.equal(res.statusCode,302);assert.equal(res.headers.Location,row.url);
  }
  const report=analytics.outbound.report(30,date);assert.equal(report.length,3);
  assert.deepEqual(report.filter(r=>r.merchant_id.startsWith('shop:')).map(r=>[r.merchant_id,r.clicks]).sort(),[['shop:catfk:alpha',2],['shop:catfk:beta',1]]);
  assert.ok(report.every(r=>r.merchant_id!=='domain:catfk.com'));
 }finally{analytics.close();db.close();}
});
