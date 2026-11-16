import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('home minimum uses fresh eligible shop prices and states the winning specification',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 const now=new Date().toISOString();
 const quote=(id,price,over={})=>({offerId:id,title:'Claude Pro 代充 1个月 新开续费均可',price,status:'in_stock',stockCount:1,currency:'CNY',url:'https://16688.com.cn/goods/'+id,capturedAt:now,...over});
 try{
  storeSnapshot(db,{source:'ldxp-goods',snapshotId:'home-min',fetchedAt:now,products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',lowestPrice:1,offers:[quote('good',120,{status:'low_stock'}),quote('year',600,{title:'Claude Pro 代充 12个月 新开续费均可'}),quote('sold',1,{status:'out_of_stock',stockCount:0}),quote('stale',2,{capturedAt:'2020-01-01T00:00:00Z'}),quote('warranty',3,{title:'Claude Pro 代充 1个月 无质保 新开续费均可'}),quote('unknown',null),quote('unverified',6,{status:'unknown'}),quote('expired',7,{expiresAt:'2020-01-01T00:00:00Z'}),quote('usd',4,{currency:'USD'})]},{productId:'chatgpt-go',name:'ChatGPT Go',platform:'ChatGPT',currency:'CNY',offers:[quote('go',30,{title:'ChatGPT Go 代充 新开续费均可'})]},{productId:'gemini-ultra',name:'Gemini Ultra',platform:'Gemini',currency:'CNY',offers:[quote('ultra',5,{title:'Gemini Ultra 代充 新开续费均可',capturedAt:'2020-01-01T00:00:00Z'})]}]});
  storeSnapshot(db,{source:'cardnav-official',snapshotId:'reference',fetchedAt:now,products:[{productId:'claude-pro',name:'Claude Pro',platform:'Claude',currency:'CNY',offers:[quote('official',0,{status:'official'})]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const html=await(await fetch(base+'/')).text();
  const row=key=>html.match(new RegExp('<article class="directory-row" data-directory-product="'+key+'">[\\s\\S]*?</article>'))?.[0]||'';
  assert.match(row('claude-pro'),/data-directory-minimum[^>]*>¥120\s*<small>起<\/small>/);
  assert.match(row('claude-pro'),/1 个月 · 代充/);
  assert.match(row('claude-pro'),/data-delivery-link="recharge"/);
  assert.match(row('claude-pro'),/查看店铺 ›/);
  assert.doesNotMatch(row('claude-pro'),/¥(?:0|1|2|3|600)<|\$4/);
  assert.match(row('chatgpt-go'),/data-directory-minimum>¥30\s*<small>起<\/small>/);
  assert.match(row('chatgpt-go'),/商家标价 · 条件待确认/);
  assert.doesNotMatch(row('chatgpt-go'),/data-directory-range/);
  assert.equal(row('gemini-ultra'),'');
  const catalog=await(await fetch(base+'/catalog')).text();assert.match(catalog,/<details class="directory-more">/);assert.match(catalog,/data-directory-product="gemini-ultra"/);assert.match(catalog,/暂无有效报价/);
  assert.doesNotMatch(row('gemini-ultra'),/data-directory-minimum/);
  const detail=await(await fetch(base+'/?family=claude&product=claude-pro')).text();
  assert.match(detail,/data-price="600"/);assert.match(detail,/data-currency="USD"/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});

test('unconfirmed homepage prices show the observed starting price without mixing currencies or stale and sold-out offers',async()=>{
 const db=openDb(':memory:');let app;
 try{
  const offer=(offerId,price,extra={})=>({offerId,title:'ChatGPT Go 代充1个月',price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://shop.example.com/'+offerId,...extra});
  storeSnapshot(db,{source:'direct-shops',snapshotId:'observed-range',products:[{productId:'chatgpt-go',name:'ChatGPT Go',currency:'CNY',offers:[offer('a',39),offer('b',49),offer('usd',2,{currency:'USD'}),offer('sold',1,{status:'sold_out',stockCount:0}),offer('stale',3,{capturedAt:'2020-01-01T00:00:00Z'})]}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
  const html=await(await fetch(origin+'/')).text(),card=html.match(/<a class="directory-delivery-card" data-delivery-link="recharge"[\s\S]*?<\/a>/)[0];
  assert.match(card,/data-directory-minimum>¥39\s*<small>起<\/small>/);assert.match(card,/商家标价 · 条件待确认/);assert.match(card,/另有其他币种/);
  assert.doesNotMatch(card,/data-directory-range|¥49|¥1<|¥3<|\$2/);
  const href=card.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&'),detail=await(await fetch(origin+href)).text();assert.match(detail,/data-price="39"/);assert.match(detail,/data-price="49"/);assert.doesNotMatch(detail,/data-comparable-summary/);
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();}db.close();}
});
