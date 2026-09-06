import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('home minimum uses fresh eligible shop prices and states the winning specification',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 const now=new Date().toISOString();
 const quote=(id,price,over={})=>({offerId:id,title:'Claude Pro 代充 1个月',price,status:'in_stock',stockCount:1,currency:'CNY',url:'https://16688.com.cn/goods/'+id,capturedAt:now,...over});
 try{
  storeSnapshot(db,{source:'priceai',snapshotId:'home-min',fetchedAt:now,products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',lowestPrice:1,offers:[quote('good',120,{status:'low_stock'}),quote('year',600,{title:'Claude Pro 代充 12个月'}),quote('sold',1,{status:'out_of_stock',stockCount:0}),quote('stale',2,{capturedAt:'2020-01-01T00:00:00Z'}),quote('warranty',3,{title:'Claude Pro 代充 1个月 无质保'}),quote('unknown',null),quote('unverified',6,{status:'unknown'}),quote('expired',7,{expiresAt:'2020-01-01T00:00:00Z'}),quote('usd',4,{currency:'USD'})]},{productId:'chatgpt-go',name:'ChatGPT Go',platform:'ChatGPT',currency:'CNY',offers:[quote('go',30,{title:'ChatGPT Go 代充'})]},{productId:'gemini-ultra',name:'Gemini Ultra',platform:'Gemini',currency:'CNY',offers:[quote('ultra',5,{title:'Gemini Ultra 代充',capturedAt:'2020-01-01T00:00:00Z'})]}]});
  storeSnapshot(db,{source:'cardnav-official',snapshotId:'reference',fetchedAt:now,products:[{productId:'claude-pro',name:'Claude Pro',platform:'Claude',currency:'CNY',offers:[quote('official',0,{status:'official'})]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const html=await(await fetch(base+'/')).text();
  const row=key=>html.match(new RegExp('<article class="directory-row" data-directory-product="'+key+'">[\\s\\S]*?</article>'))?.[0]||'';
  assert.match(row('claude-pro'),/data-directory-minimum[^>]*>¥120\s*<small>起<\/small>/);
  assert.match(row('claude-pro'),/1 个月 · 代充/);
  assert.match(row('claude-pro'),/查看店铺/);
  assert.doesNotMatch(row('claude-pro'),/¥(?:0|1|2|3|600)<|\$4/);
  assert.match(row('chatgpt-go'),/期限未注明 · 代充/);
  assert.match(row('gemini-ultra'),/暂无有效报价/);
  assert.doesNotMatch(row('gemini-ultra'),/data-directory-minimum/);
  const detail=await(await fetch(base+'/?family=claude&product=claude-pro')).text();
  assert.match(detail,/data-price="600"/);assert.match(detail,/data-currency="USD"/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
