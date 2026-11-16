import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('quote navigation preserves filters, targets visible sections and keeps reference evidence in SSR',async()=>{
 const db=openDb(':memory:');let app;
 try{
  const offers=Array.from({length:24},(_,i)=>({offerId:'nav-'+i,title:'ChatGPT Plus iOS 代充 1个月 新开续费均可',price:90+i,currency:'CNY',status:'in_stock',stockCount:2,url:'https://merchant.example/goods/'+i}));
  storeSnapshot(db,{source:'direct-shops',snapshotId:'navigation',products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers}]});
  app=createApp({db,adsenseEnv:{},retentionOptions:{env:{}}});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+app.address().port;
  for(const prefix of ['','/en']){
   const response=await fetch(origin+prefix+'/prices/chatgpt-plus?delivery=recharge&recharge=ios&currency=CNY');
   assert.equal(response.status,200);const html=await response.text();
   assert.match(html,/<section id="quote-filters"[^>]*tabindex="-1"/);
   assert.match(html,/<section id="quote-results"[^>]*tabindex="-1"/);
   assert.match(html,/<details class="official-baseline official-baseline-compact"[^>]*><summary>/);
   assert.match(html,/<time datetime="2026-10-28">2026-10-28<\/time>/);
   assert.match(html,/https:\/\/help.openai.com\/en\/articles\/6950777-what-is-chatgpt-plus/);
   const links=[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(m=>new URL(m[1].replaceAll('&amp;','&'),origin));
   const descending=links.find(u=>u.searchParams.get('sort')==='price_desc');
   assert.equal(descending.hash,'#quote-results');assert.equal(descending.searchParams.get('recharge'),'ios');assert.equal(descending.searchParams.get('currency'),'CNY');
   const next=links.find(u=>u.searchParams.get('page')==='2');assert.equal(next.hash,'#quote-results');assert.equal(next.pathname,prefix+'/prices/chatgpt-plus');
   const nextHtml=await(await fetch(next)).text();
   assert.deepEqual([...nextHtml.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>Number(m[1])),[100,101,102,103,104,105,106,107,108,109]);
   assert.match(html,/<link rel="canonical" href="https:\/\/airadar.vip\/(?:en\/)?prices\/chatgpt-plus">/);
  }
  const script=await fetch(origin+'/assets/directory.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
