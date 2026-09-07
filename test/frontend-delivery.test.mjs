import test from 'node:test';import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';import {createApp} from '../lib/web.mjs';
test('home separates delivered accounts and recharge minimum; detail retains all shops and filter state',async()=>{
 const db=openDb(':memory:'),app=createApp({db}),now=new Date().toISOString();
 const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',stockCount:1,status:'in_stock',url:'https://merchant-'+id+'.com/product',capturedAt:now});
 try{
  storeSnapshot(db,{source:'priceai',snapshotId:'delivery-ui',fetchedAt:now,products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[...Array.from({length:25},(_,i)=>offer('recharge'+i,'ChatGPT Plus 代充 1个月',120+i)),offer('account','ChatGPT Plus 成品号 1个月',30),offer('code','ChatGPT Plus CDK 1个月',2),offer('unknown','ChatGPT Plus 1个月',1)]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port,route='/?family=chatgpt&product=chatgpt-plus';
  const html=await(await fetch(base+'/')).text();assert.equal((html.match(/data-directory-product="chatgpt-plus"/g)||[]).length,1);
  const links=kind=>html.match(new RegExp('<a class="directory-delivery-card" data-delivery-link="'+kind+'"[\\s\\S]*?<\\/a>'))[0];
  assert.match(links('recharge'),/¥120/);assert.match(links('account'),/¥30/);for(const kind of ['code','unknown'])assert.doesNotMatch(links(kind),/data-directory-minimum|¥/);
  const prices=text=>[...text.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>Number(m[1]));
  const defaults=await(await fetch(base+route)).text();assert.deepEqual(prices(defaults),Array.from({length:20},(_,i)=>120+i));assert.match(defaults,/25 条店铺报价/);assert.match(defaults,/data-delivery-choice="recharge" aria-current="true"/);
  const account=await(await fetch(base+route+'&delivery=account')).text();assert.deepEqual(prices(account),[30]);assert.match(account,/quote-delivery">成品号/);assert.doesNotMatch(account,/<p class="directory-quote-spec">[^<]*<strong[^>]*>成品号<\/strong>[^<]*成品账号/);
  const unknown=await(await fetch(base+route+'&delivery=unknown')).text();assert.deepEqual(prices(unknown),[1]);assert.match(unknown,/quote-delivery">交付待确认/);
  const filtered=await(await fetch(base+route+'&delivery=recharge&sort=price_desc&currency=CNY&channel=unknown')).text();const hrefs=[...filtered.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));const next=hrefs.find(h=>h.startsWith('/?')&&new URL(h,base).searchParams.get('page')==='2');assert.ok(next);assert.equal(new URL(next,base).searchParams.get('delivery'),'recharge');assert.deepEqual(prices(await(await fetch(base+next)).text()),[124,123,122,121,120]);
  const accountTab=hrefs.find(h=>h.startsWith('/?')&&new URL(h,base).searchParams.get('delivery')==='account');assert.equal(new URL(accountTab,base).searchParams.has('spec'),false);assert.equal(new URL(accountTab,base).searchParams.has('page'),false);
 }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
