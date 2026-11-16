import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';

test('organic impressions follow SSR pagination and unchanged sort, cache replay dedupes and flags roll back',async()=>{
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','organic-fixture-only'.repeat(3)),iso=new Date().toISOString();
 storeSnapshot(db,{source:'direct-shops',snapshotId:'organic-fixture',fetchedAt:iso,products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:Array.from({length:13},(_,n)=>({offerId:'quote-'+n,title:'ChatGPT Plus 1个月代充 新开续费均可',price:113-n,currency:'CNY',status:'in_stock',url:'https://fixture.example/buy/'+n,capturedAt:iso}))}]});
 const app=createApp({db,analytics,retentionOptions:{env:{},secret:'organic-retention-fixture'.repeat(2)}});
 const flags=['AIRADAR_PUBLIC_HTML_CACHE','AIRADAR_ORGANIC_IMPRESSIONS'],before=flags.map(key=>process.env[key]);
 try{
  for(const key of flags)delete process.env[key];
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
  const get=(path,ip='198.51.100.120',extra={})=>fetch(base+path,{headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':ip,...extra}});
  const count=()=>analytics.outbound.report(7).filter(row=>row.placement==='product').reduce((total,row)=>total+row.impressions,0);
  const prices=html=>[...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(match=>Number(match[1]));
  const first=await get('/prices/chatgpt-plus'),html=await first.text();assert.equal(first.status,200);assert.deepEqual(prices(html),[101,102,103,104,105,106,107,108,109,110]);assert.equal(count(),10);
  const duplicate=await get('/prices/chatgpt-plus');assert.equal(duplicate.headers.get('x-price-radar-page-cache'),'HIT');await duplicate.text();assert.equal(count(),10);
  const hit=await get('/prices/chatgpt-plus?utm_campaign=fixture','198.51.100.121');assert.equal(hit.headers.get('x-price-radar-page-cache'),'HIT');assert.deepEqual(prices(await hit.text()),prices(html));assert.equal(count(),20);
  const second=await get('/prices/chatgpt-plus?page=2');assert.equal(second.headers.get('x-price-radar-page-cache'),'MISS');assert.deepEqual(prices(await second.text()),[111,112,113]);assert.equal(count(),23);
  const head=await get('/prices/chatgpt-plus','198.51.100.122',{'sec-fetch-dest':'empty'});await head.text();assert.equal(count(),23,'non-document prefetch is excluded');
  const product=await get('/product?source=direct-shops&id=chatgpt-plus-recharge&page=2','198.51.100.123');assert.equal(product.status,200);await product.text();assert.equal(count(),33,'legacy product redirects to the first clean page; source pagination is dropped');
  const productHit=await get('/product?source=direct-shops&id=chatgpt-plus-recharge&page=2','198.51.100.124');assert.equal(productHit.headers.get('x-price-radar-page-cache'),'HIT');await productHit.text();assert.equal(count(),43);
  process.env.AIRADAR_ORGANIC_IMPRESSIONS='off';const disabled=await get('/prices/chatgpt-plus','198.51.100.125');await disabled.text();assert.equal(count(),43);
  process.env.AIRADAR_PUBLIC_HTML_CACHE='off';
  for(const path of ['/','/prices/chatgpt-plus','/advertise']){
   const response=await get(path);assert.equal(response.status,200);assert.equal(response.headers.get('x-accel-expires'),'0');assert.equal(response.headers.get('x-price-radar-home-cache'),null);assert.equal(response.headers.get('x-price-radar-page-cache'),null);await response.text();
  }
 }finally{
  flags.forEach((key,index)=>{if(before[index]===undefined)delete process.env[key];else process.env[key]=before[index];});
  if(app.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();await new Promise(setImmediate);analytics.close();db.close();
 }
});
