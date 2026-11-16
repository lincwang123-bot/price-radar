import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('fixed research files preserve public evidence, unknown conditions and HTTP download semantics',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
  for(const format of ['csv','json']){
   const path='/research/chatgpt-go/2026-09-30-v1.'+format;
   const response=await fetch(origin+path);assert.equal(response.status,200);
   const expected=readFileSync(new URL('../assets/research/chatgpt-go-20260930-v1.'+format,import.meta.url));
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
   assert.match(response.headers.get('content-type'),format==='csv'?/^text\/csv/:/^application\/json/);
   assert.match(response.headers.get('content-disposition'),/attachment; filename="chatgpt-go-20260930-v1\./);
   assert.match(response.headers.get('x-robots-tag'),/noindex/);
   const head=await fetch(origin+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(+head.headers.get('content-length'),expected.length);
   const cached=await fetch(origin+path,{headers:{'If-None-Match':response.headers.get('etag')}});assert.equal(cached.status,304);assert.equal(await cached.text(),'');
   const post=await fetch(origin+path,{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');await post.body?.cancel();
  }
  const data=await(await fetch(origin+'/research/chatgpt-go/2026-09-30-v1.json')).json();
  assert.equal(data.version,'2026-09-30-v1');assert.equal(data.records.length,3);
  const included=data.records.filter(r=>r.comparison_group);assert.equal(included.length,2);assert.ok(included.every(r=>r.period_months===1&&r.currency==='CNY'&&r.delivery==='recharge'&&r.region==='PH'&&r.purchase_condition==='renewal'));
  assert.equal(Math.round((Math.max(...included.map(r=>r.amount))-Math.min(...included.map(r=>r.amount)))*100)/100,data.derived.absolute_gap);
  assert.equal(data.records[2].period_months,null);assert.equal(data.records[2].purchase_condition,null);assert.equal(data.records[2].comparison_group,null);
  assert.ok(data.records.every(r=>r.collected_at===data.observed_at&&r.listing_url.startsWith('https://')));
  for(const path of ['/research/chatgpt-go/missing.json','/research/chatgpt-go/config.json','/research/radar.sqlite','/research/chatgpt-go/2026-09-30-v1.csv/']){
   const response=await fetch(origin+path);assert.equal(response.status,404,path);await response.body?.cancel();
  }
  const html=await(await fetch(origin+'/guides/chatgpt-go-vs-plus')).text();assert.match(html,/id="go-observation-20260930-v1"/);assert.match(html,/href="\/research\/chatgpt-go\/2026-09-30-v1.csv"/);assert.match(html,/name="robots" content="index, follow/);assert.match(html,/既不是全市场最低价/);
  const home=await(await fetch(origin+'/')).text();assert.doesNotMatch(home,/go-observation-20260930|\/research\/chatgpt-go/);
  const map=await(await fetch(origin+'/sitemap.xml')).text();assert.doesNotMatch(map,/\/research\//);
 }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();}
});
