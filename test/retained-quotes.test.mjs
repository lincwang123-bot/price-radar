import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot,metaSet} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {projectProduct,quoteAvailable} from '../lib/quote-policy.mjs';
import {readRetentionMarket} from '../lib/retention-market.mjs';
import {shopPublicId} from '../lib/merchant-x.mjs';

test('failed old observations display bilingually without changing minima, notification eligibility or successful capture dates',async()=>{
 const db=openDb(':memory:'),now=Date.now(),at=new Date(now-2*86400000).toISOString();let app;
 const offer=(id,price,extra={})=>({offerId:id,storeName:'Retained QA '+id,title:'ChatGPT Plus 月卡代充 新开续费均可',price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://retained-'+id+'.example.org/product',capturedAt:at,extra:{quoteHealth:{status:'stale',maxAgeMinutes:1440}},...extra});
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'retained',fetchedAt:new Date(now).toISOString(),products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[offer('old',80),offer('fresh',120,{capturedAt:new Date(now).toISOString(),extra:{quoteHealth:{status:'ok'}}}),offer('sold',1,{status:'out_of_stock',stockCount:0}),offer('expired',2,{expiresAt:new Date(now-1).toISOString()}),offer('merely-aged',3,{extra:{quoteHealth:{status:'cached',maxAgeMinutes:1440}}}),offer('blocked',4,{url:'https://fk.10886.xyz/product'})]}]});
  const snapshot=db.prepare('SELECT * FROM snapshots').get(),product=db.prepare('SELECT * FROM products').get();
  const projected=projectProduct(db,'direct-shops',snapshot,product,{now});
  const old=projected.offers.find(o=>o.offer_id==='old');assert.equal(old.quote_stale,true);assert.equal(old.quote_retained,true);assert.equal(quoteAvailable('direct-shops',old),false);assert.equal(old.captured_at,at);assert.equal(old.last_verified_at,at);
  assert.equal(projected.offers.find(o=>o.offer_id==='expired').quote_retained,false);assert.equal(projected.offers.find(o=>o.offer_id==='merely-aged').quote_retained,false);
  const market=readRetentionMarket(db,{now:new Date(now)});assert.equal(market.groups.length,1);assert.equal(market.groups[0].price,120);assert.equal(market.groups[0].offerCount,1);
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=async p=>(await fetch(base+p)).text();
  for(const prefix of ['','/en']){
   const html=await get(prefix+'/prices/chatgpt-plus?delivery=recharge');
   assert.deepEqual([...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>+m[1]),[80,120]);
   assert.match(html,prefix?/Latest refresh failed/:/本次更新失败，价格待核对/);assert.ok(html.includes('datetime="'+at+'"'));
   assert.match(html,/href="https:\/\/retained-old.example.org\/product"/);
   const home=await get(prefix+'/');assert.match(home,/data-directory-minimum[^>]*>¥120/);assert.doesNotMatch(home,/data-directory-minimum[^>]*>¥80/);
   const selected=await get(prefix+'/prices/chatgpt-plus?delivery=recharge&spec='+encodeURIComponent(old.comparison_key));assert.match(selected,/data-comparable-summary/);assert.match(selected,/¥120/);
   const shop=await get(prefix+'/shop?id='+shopPublicId('domain:retained-old.example.org'));assert.match(shop,/80/);assert.match(shop,prefix?/1 previously observed quotes/:/1 条上次采集报价/);
  }
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});

test('source-wide collection failure also retains the last recorded observation without claiming it is current',()=>{
 const db=openDb(':memory:'),at=new Date(Date.now()-3600000).toISOString();
 try{
  storeSnapshot(db,{source:'ldxp-goods',snapshotId:'source-failure',fetchedAt:at,products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'source-old',title:'ChatGPT Plus 月卡代充 新开续费均可',price:100,currency:'CNY',status:'in_stock',stockCount:1,url:'https://source.example.org/product',capturedAt:at}]}]});
  metaSet(db,'health:ldxp-goods',JSON.stringify({status:'failed',checkedAt:new Date().toISOString()}));
  const projected=projectProduct(db,'ldxp-goods',db.prepare('SELECT * FROM snapshots').get(),db.prepare('SELECT * FROM products').get());
  assert.equal(projected.offers[0].quote_retained,true);assert.equal(projected.offers[0].last_verified_at,at);assert.equal(projected.lowest_price,null);
 }finally{db.close();}
});
