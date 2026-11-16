import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFICIAL_BASELINES,officialBaseline} from '../lib/official-baselines.mjs';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('Muse references are two dated USD monthly vendor plans, not merchant or API offers',()=>{
 const rows=OFFICIAL_BASELINES.filter(row=>row.platform==='Muse');
 assert.deepEqual(rows.map(({id,name,amount,currency,period,checkedAt})=>({id,name,amount,currency,period,checkedAt})),[
  {id:'muse-power',name:'Muse Power',amount:20,currency:'USD',period:'month',checkedAt:'2026-10-17'},
  {id:'muse-max',name:'Muse Maximum',amount:100,currency:'USD',period:'month',checkedAt:'2026-10-17'},
 ]);
 for(const row of rows){
  assert.equal(row.source,'https://www.meta.com/help/subscriptions/1021145227643680/');
  assert.match(row.note,/地区/);
  assert.match(row.note,/结算/);
  assert.doesNotMatch(row.note,/无限|永久免费|人民币|成品号/);
 }
 assert.match(officialBaseline('muse-power').note,/每周 5 亿 Muse tokens/);
 assert.match(officialBaseline('muse-max').note,/每周 30 亿 Muse tokens/);
});

test('Muse is searchable in official references without creating regional or merchant quotes',async()=>{
 const db=openDb(':memory:');const app=createApp({db});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.address().port;
 const get=async path=>{const response=await fetch(base+path);assert.equal(response.status,200);return response.text();};
 try{
  for(const path of ['/official-prices?q=muse','/official-prices?brand=Muse']){
   const html=await get(path);
   assert.equal((html.match(/data-official-baseline=/g)||[]).length,2);
   assert.match(html,/Muse Power · 官方价格参考/);
   assert.match(html,/Muse Maximum · 官方价格参考/);
   assert.match(html,/USD 20 \/ 月/);assert.match(html,/USD 100 \/ 月/);
   assert.match(html,/2 个官方月付参考 · 0 个地区套餐/);
   assert.match(html,/option value="Muse"/);
   assert.doesNotMatch(html,/<article class="official-card"/);
  }
  const power=await get('/official-prices?q=Muse%20Power');
  assert.equal((power.match(/data-official-baseline=/g)||[]).length,1);
  assert.match(power,/data-official-baseline="muse-power"/);
  assert.doesNotMatch(await get('/official-prices?brand=Claude'),/data-official-baseline="muse-/);
  assert.match(await get('/catalog'),/data-directory-product="muse-power"/);
  assert.match(await get('/catalog'),/data-directory-product="muse-max"/);
  for(const table of ['snapshots','products','offers'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
 }finally{
  app.closeAllConnections();await new Promise(r=>app.close(r));
  await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();
 }
});
