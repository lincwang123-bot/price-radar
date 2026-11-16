import {reviewWithProductFixture as reviewMerchantApplication} from './fixtures/merchant-approval.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createApp} from '../lib/web.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {createMerchantX} from '../lib/merchant-x.mjs';
import {createMerchantApplication} from '../lib/merchant-onboarding.mjs';

const entry=(id,price,patch={})=>({list:{source:'direct-shops'},product:{currency:'CNY'},channel:{id:'independent'},offer:{offer_id:id,title:'ChatGPT Plus 代充 1个月 新开续费均可',price,currency:'CNY',status:'in_stock',stock_count:2,url:'https://'+id+'.example.org/product',...patch}});
const ids=result=>result.entries.map(e=>e.offer.offer_id);
const badges=[{identity:'domain:listed.example.org',identityVerifiedAt:new Date().toISOString()}];
const profiles=[{identity:'domain:linked.example.org'}];

test('identity claims never alter natural price ordering within a currency',()=>{
 const product={quoteEntries:[entry('cheap',80),entry('listed',140),entry('linked',150),entry('linked-month',160,{url:'https://linked.example.org/other'}),entry('usd',2,{currency:'USD'}),entry('sold',1,{status:'out_of_stock',stock_count:0})]};
 const options={merchantBadges:badges,xProfiles:profiles};
 assert.deepEqual(ids(directoryQuotes(product,{...options,sort:'comprehensive'})),['cheap','listed','linked','linked-month','usd']);
 assert.deepEqual(ids(directoryQuotes(product,{...options,sort:'price_asc'})),['cheap','listed','linked','linked-month','usd']);
 assert.deepEqual(ids(directoryQuotes(product,{...options,sort:'price_desc'})),['linked-month','linked','listed','cheap','usd']);
 assert.deepEqual(ids(directoryQuotes(product,options)),['cheap','listed','linked','linked-month','usd']);
 assert.deepEqual(ids(directoryQuotes(product,{sort:'comprehensive'})),['cheap','listed','linked','linked-month','usd']);
 assert.equal(directoryQuotes(product,{...options,sort:'comprehensive'}).total,5);
});

test('shared-host claims and third-party claims never increase natural ranking',()=>{
 const trusted=entry('trusted',200,{url:'https://16688.com.cn/goods/G1',extra:{shopUrl:'https://16688.com.cn/shop/S1',shopNo:'S1'}});
 const neighbor=entry('neighbor',70,{url:'https://16688.com.cn/goods/G2',extra:{shopUrl:'https://16688.com.cn/shop/S2',shopNo:'S2'}});
 const forged={...entry('forged',60,{url:'https://16688.com.cn/goods/G3',extra:{shopUrl:'https://16688.com.cn/shop/S1',shopNo:'S1'}}),list:{source:'ldxp-goods'}};
 const product={quoteEntries:[forged,neighbor,trusted,entry('unlisted',90)]};
 assert.deepEqual(ids(directoryQuotes(product,{sort:'comprehensive',xProfiles:[{identity:'shop:16688:S1'}],merchantBadges:[{identity:'domain:unlisted.example.org',identityVerifiedAt:null}]})),['forged','neighbor','unlisted','trusted']);
});

test('public directory defaults to price ranking before pagination; sort links preserve filters and reset the page',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:');let server;
 try{
  const offers=[...Array.from({length:23},(_,i)=>({offerId:'neutral-'+i,storeName:'Neutral '+i,title:'ChatGPT Plus 代充 1个月 新开续费均可',price:80+i,currency:'CNY',status:'in_stock',url:'https://neutral-'+i+'.example.org/product'})),{offerId:'listed',storeName:'Listed',title:'ChatGPT Plus 代充 1个月 新开续费均可',price:140,currency:'CNY',status:'in_stock',url:'https://listed.example.org/product'},{offerId:'linked',storeName:'Linked',title:'ChatGPT Plus 代充 1个月 新开续费均可',price:150,currency:'CNY',status:'in_stock',url:'https://linked.example.org/product'}];
  storeSnapshot(db,{source:'direct-shops',snapshotId:'sort-fixture',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers}]});
  const {id}=createMerchantApplication(privateDb,{shopName:'Listed',shopUrl:'https://listed.example.org/',platform:'auto',productAreas:['chatgpt'],email:'test@example.org',contact:'test@example.org',consent:true},{clientAddress:'test'});
  reviewMerchantApplication(privateDb,id,{action:'approve',expectedVersion:1,ownershipConfirmed:true,permissionConfirmed:true,note:'Synthetic test fixture'},{notify:false});
  privateDb.exec("UPDATE merchant_mail_outbox SET status='superseded'");
  const readDirectory=()=>{const snapshot=db.prepare('SELECT * FROM snapshots').get();return buildProductDirectory([{source:'direct-shops',products:db.prepare('SELECT * FROM products').all().map(p=>projectProduct(db,'direct-shops',snapshot,p))}]);};
  const x=createMerchantX({privateDb,readDirectory,secret:'test'.repeat(16)}),shop=[...x.catalog().values()].find(s=>s.identity==='domain:linked.example.org');
  const claim=x.start({shopId:shop.id,xHandle:'linked_shop',email:'test@example.org',consent:true},{clientAddress:'test'});
  x.submit({id:claim.id,token:claim.token,proofType:'profile',details:'Synthetic test fixture'});
  x.review(claim.id,{action:'approve',version:2,xConfirmed:true,shopConfirmed:true,note:'Synthetic test fixture'});
  server=createApp({db,submissionsDb:privateDb});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const get=async query=>await(await fetch(base+query)).text();
  const prices=html=>[...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>Number(m[1]));
  const url='/?family=chatgpt&product=chatgpt-plus&delivery=recharge&channel=unknown&currency=CNY';
  const first=await get(url);assert.deepEqual(prices(first),Array.from({length:10},(_,i)=>80+i));
  assert.match(first,/data-sort-choice="price_asc" aria-current="true"/);
  assert.match(first,/条件明确优先/);
  const second=await get(url+'&page=2');assert.deepEqual(prices(second),Array.from({length:10},(_,i)=>90+i));assert.deepEqual(prices(await get(url+'&page=3')),[100,101,102,140,150]);
  const links=[...second.matchAll(/data-sort-choice="([^"]+)" aria-current="[^"]+" href="([^"]+)"/g)];assert.equal(links.length,3);
  for(const [,sort,href] of links){const u=new URL(href.replaceAll('&amp;','&'),base);assert.equal(u.searchParams.get('sort'),sort==='price_asc'?null:sort);assert.equal(u.searchParams.get('channel'),'unknown');assert.equal(u.searchParams.get('delivery'),'recharge');assert.equal(u.searchParams.get('currency'),'CNY');assert.equal(u.searchParams.has('page'),false);}
  assert.deepEqual(prices(await get(url+'&sort=price_asc')).slice(0,3),[80,81,82]);
  assert.deepEqual(prices(await get(url+'&sort=price_desc')).slice(0,3),[150,140,102]);
  assert.deepEqual(prices(await get(url+'&sort=price')).slice(0,3),[80,81,82]);
  assert.deepEqual(prices(await get(url+'&sort=unexpected')).slice(0,3),[80,81,82]);
  const home=await get('/');assert.match(home,/data-directory-minimum[^>]*>¥80\s*<small>起<\/small>/);
  x.review(claim.id,{action:'revoke',version:3,note:'Synthetic revocation check'});
  assert.deepEqual(prices(await get(url)).slice(0,3),[80,81,82]);
  reviewMerchantApplication(privateDb,id,{action:'pause',expectedVersion:2,note:'Synthetic pause check'},{notify:false});
  assert.deepEqual(prices(await get(url)).slice(0,3),[80,81,82]);
 }finally{if(server){await new Promise(r=>server.close(r));await server.merchantWorkflowDone?.();await server.retentionWorkflowDone?.();}privateDb.close();db.close();}
});

test('cheap incomplete quotes lead by default while conditions-first stays an explicit bilingual option',async()=>{
 const db=openDb(':memory:');let app;
 try{
  const offers=[['cheap','ChatGPT Plus 30天月卡代充 卡密永久有效',108.99],['unknown','ChatGPT Plus 代充',109.5],['complete','ChatGPT Plus 月卡代充 新开续费均可',110],['account','ChatGPT Plus 月卡成品号',20]].map(([offerId,title,price])=>({offerId,title,price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://'+offerId+'.example.org/product'}));
  storeSnapshot(db,{source:'direct-shops',snapshotId:'price-first',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=async p=>(await fetch(base+p)).text();
  const prices=html=>[...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>Number(m[1]));
  for(const prefix of ['','/en']){
   const path=prefix+'/prices/chatgpt-plus?delivery=recharge';
   const normal=await get(path),priority=await get(path+'&sort=comprehensive');
   assert.deepEqual(prices(normal),[108.99,109.5,110]);assert.deepEqual(prices(priority),[110,108.99,109.5]);
   assert.match(normal,/data-sort-choice="price_asc" aria-current="true"/);
   assert.match(priority,/data-sort-choice="comprehensive" aria-current="true"/);
   assert.match(normal,prefix?/Conditions first/:/条件明确优先/);
   // Merchant-derived specifications intentionally keep their original language.
   assert.match(normal,/30 天/);
   assert.match(normal,prefix?/Quotes with unconfirmed conditions remain visible/:/条件待确认的报价仍展示/);
   assert.match(normal,/data-quote-quality="C"/);assert.doesNotMatch(normal,/data-comparable-summary/);
   assert.ok(normal.indexOf('class="quote-sort"')<normal.indexOf('<details class="detail-filters">'));
  }
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
