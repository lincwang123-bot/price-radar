import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('home and category overviews show one static risk note before the product list',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'risk-note',fetchedAt:new Date().toISOString(),products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[{offerId:'risk-quote',title:'ChatGPT Plus 代充 1个月',storeName:'测试店铺',price:100,currency:'CNY',status:'in_stock',stockCount:1,url:'https://example.com/product/1'}]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.address().port;
  for(const route of ['/','/index.html','/?family=chatgpt']){
   const response=await fetch(base+route),html=await response.text();
   assert.equal(response.status,200);
   const notes=[...html.matchAll(/<aside class="directory-risk-note"[^>]*>[\s\S]*?<\/aside>/g)];
   assert.equal(notes.length,1,route+' renders exactly one note');
   const note=notes[0][0];
   assert.match(note,/role="note" aria-label="交易风险提醒"/);
   assert.match(note,/本站仅提供信息导航，不参与交易或售后/);
   assert.match(note,/收录不代表交易安全保证/);
   assert.match(note,/核实商品规格与售后条款/);
   assert.match(note,/警惕低价诱导和私下转账/);
   assert.doesNotMatch(note,/<button|<script|<aside[^>]*\shidden(?:\s|=|>)|role="alert"/);
   assert.ok(html.indexOf('<div class="directory-intro">')<notes[0].index);
   assert.ok(notes[0].index<html.indexOf('<section class="directory-category"'));
   assert.match(html,/data-directory-product="chatgpt-plus"/);
   assert.match(html,/data-delivery-link="recharge"/);
  }
  const quoteHtml=await(await fetch(base+'/?family=chatgpt&product=chatgpt-plus')).text();
  assert.doesNotMatch(quoteHtml,/<aside class="directory-risk-note"/,'quote detail retains its existing transaction prompt without another banner');
  assert.match(quoteHtml,/id="store-risk-modal" hidden/);
 }finally{
  if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}
  db.close();
 }
});

test('risk note is present even while the home directory has no offers',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const html=await(await fetch('http://127.0.0.1:'+app.address().port+'/')).text();
  assert.equal((html.match(/<aside class="directory-risk-note"/g)||[]).length,1);
 }finally{
  if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}
  db.close();
 }
});
