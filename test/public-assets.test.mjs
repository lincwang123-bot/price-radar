import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {brandMark} from '../lib/brand-icons.mjs';

test('shared CSS is versioned, public assets revalidate and private endpoints never inherit cache headers',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const login=await fetch(base+'/login'),html=await login.text();assert.match(login.headers.get('cache-control'),/no-store/);
  const src=/href="(\/assets\/site\.css\?v=[a-f0-9]+)"/.exec(html)?.[1];assert.ok(src);assert.doesNotMatch(html,/<style>[^<]*\.directory-row/);
  for(const path of [src,'/assets/account.js','/assets/account.css','/assets/retention.js','/assets/retention.css']){
   const get=await fetch(base+path);assert.equal(get.status,200);assert.match(get.headers.get('cache-control'),/public/);const body=await get.text();assert.ok(body.length>10);
   const etag=get.headers.get('etag');assert.ok(etag);
   const unchanged=await fetch(base+path,{headers:{'If-None-Match':etag}});assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
   const head=await fetch(base+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(+head.headers.get('content-length'),Buffer.byteLength(body));
   assert.equal((await fetch(base+path,{method:'POST'})).status,405);
  }
  assert.match((await fetch(base+src)).headers.get('cache-control'),/immutable/);
  assert.doesNotMatch((await fetch(base+'/assets/site.css?v=old')).headers.get('cache-control'),/immutable/);
  for(const path of ['/','/login','/api/retention/state','/account','/admin'])assert.match((await fetch(base+path,{redirect:'manual'})).headers.get('cache-control'),/no-store/);
  assert.match(brandMark('Suno'),/loading="lazy"/);assert.doesNotMatch(brandMark('ChatGPT'),/loading="lazy"/);
 }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();}
});
