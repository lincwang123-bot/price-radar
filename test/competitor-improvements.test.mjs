import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFICIAL_BASELINES,officialBaseline,baselineHtml} from '../lib/official-baselines.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('official web baselines retain source and checked date, without inventing Go prices or regional periods',()=>{
 assert.equal(OFFICIAL_BASELINES.length,15);assert.equal(officialBaseline('chatgpt-go').amount,null);
 assert.match(baselineHtml(officialBaseline('chatgpt-plus'),{now:Date.parse('2026-09-15')}),/USD 20 \/ 月/);
 assert.match(baselineHtml(officialBaseline('chatgpt-plus'),{now:Date.parse('2026-12-01')}),/待重新核对/);
 for(const row of OFFICIAL_BASELINES){assert.ok(row.source.startsWith('https://'));assert.ok(baselineHtml(row).includes(row.checkedAt));}
 assert.doesNotMatch(baselineHtml(officialBaseline('chatgpt-go')),/USD|CNY|\/ 月/);
 assert.equal(baselineHtml(officialBaseline('missing')),'');
 assert.equal(officialBaseline('gemini-advanced').id,'gemini-pro');
 assert.match(baselineHtml(officialBaseline('gemini-pro')),/USD 19.99 \/ 月/);
 assert.match(baselineHtml(officialBaseline('chatgpt-plus')),/不支持 Plus 年付/);
});
test('catalog and new guide are crawlable; baseline works with no regional feed and duplicate shops remain accessible',async()=>{
 const db=openDb(':memory:');let app;
 try{
  storeSnapshot(db,{source:'ldxp-goods',snapshotId:'growth-check',products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[1,2,3].map(i=>({offerId:String(i),title:'ChatGPT Plus 月卡成品号（非日抛）',price:30+i,currency:'CNY',status:'in_stock',url:`https://shop${i}.example/month`,storeName:'店铺'+i}))}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.text();};
  const home=await get('/');assert.match(home,/aria-label="选择使用需求"/);assert.match(home,/href="\/catalog"/);assert.doesNotMatch(home,/directory-more/);
  const catalog=await get('/catalog?family=claude&product=claude-pro');assert.match(catalog,/<h1>全部 AI 产品目录/);assert.match(catalog,/rel="canonical" href="https:\/\/airadar.vip\/catalog"/);assert.match(catalog,/data-directory-product="chatgpt-plus"/);
  assert.equal((await fetch(base+'/catalog/',{redirect:'manual'})).status,301);
  const official=await get('/official-prices');assert.equal((official.match(/data-official-baseline=/g)||[]).length,15);
  assert.equal(((await get('/official-prices?brand=Claude')).match(/data-official-baseline=/g)||[]).length,3);
  assert.equal(((await get('/official-prices?brand=Gemini')).match(/data-official-baseline=/g)||[]).length,1);
  const detail=await get('/prices/chatgpt-plus');assert.match(detail,/USD 20 \/ 月/);assert.match(detail,/非日抛/);assert.doesNotMatch(detail,/data-quote-alternatives/);
  assert.equal((detail.match(/data-directory-quote data-price=/g)||[]).length,3);for(const i of [1,2,3])assert.match(detail,new RegExp('店铺'+i));
  assert.match(await get('/guides/read-price-changes'),/href="\/weekly\?date=2026-09-15&amp;group=8852daf1aef3680c3e4c4308"/);
  const sitemap=await get('/sitemap.xml');assert.match(sitemap,/\/catalog</);assert.match(sitemap,/\/guides\/read-price-changes</);
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();}db.close();}
});
