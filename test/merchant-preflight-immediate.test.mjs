import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createMerchantApplication, getMerchantApplication } from '../lib/merchant-onboarding.mjs';
import { queueAutomaticPreflight, latestMerchantPreflight } from '../lib/merchant-preflight-store.mjs';
import { createImmediatePreflightServer, startImmediatePreflight } from '../lib/merchant-preflight-immediate.mjs';
import { processMerchantPreflights } from '../lib/merchant-preflight-worker.mjs';
import { isPreflightRunning } from '../lib/merchant-preflight-lock.mjs';
import { createAdmin, hashAdminPassword } from '../lib/admin.mjs';
import { ADMIN_PREFLIGHT_HASH } from '../lib/admin-preflight-live.mjs';

async function fixture(t) {
  const dir = mkdtempSync('/tmp/airadar-immediate-');
  const dataDir = path.join(dir,'data'), bridgeDir = path.join(dir,'bridge'), resultsDir = path.join(dataDir,'merchant-preflights');
  mkdirSync(dataDir); mkdirSync(bridgeDir);
  const db = openSubmissionsDb(':memory:');
  const socketPath = path.join(dir,'worker.sock');
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const ctx = { dataDir, sleep:async()=>{}, merchantBridgeDir:bridgeDir, merchantFetchFactory:() => async () => {
    calls++; await gate;
    return new Response(JSON.stringify({status_code:200,data:[{id:1,title:'ChatGPT Plus 月卡代充',skus:[{id:1,price_amount:100,auto_stock_available:8}]}],pagination:{total:1,total_page:1,page:1}}),{headers:{'content-type':'application/json'}});
  }};
  const service = createImmediatePreflightServer(ctx);
  await service.listen(socketPath);
  t.after(async () => { release(); await service.close(); db.close(); rmSync(dir,{recursive:true,force:true}); });
  function app(n) { return createMerchantApplication(db,{shopName:'测试商店'+n,shopUrl:`https://immediate-merchant${n}.com/`,platform:'auto',productAreas:['chatgpt'],email:'fixture@example.org',contact:'fixture',details:'',consent:true}); }
  function queue(id, now = new Date()) { return queueAutomaticPreflight(db,id,{bridgeDir,resultsDir,now,force:true}); }
  const run = id => startImmediatePreflight(id,{socketPath});
  const state = id => latestMerchantPreflight(db,id,{resultsDir});
  async function finish(id) {
    release();
    for (let n=0;n<100;n++) { if(state(id)?.result)return state(id); await new Promise(resolve=>setTimeout(resolve,10)); }
    assert.fail('result was not written');
  }
  return {dir,db,ctx,resultsDir,bridgeDir,socketPath,service,app,queue,run,state,finish,release,calls:()=>calls};
}

test('manual click starts only its audited request now, coalesces repeats and never approves or publishes', async t => {
  const f=await fixture(t), first=f.app(1), second=f.app(2);
  f.queue(first.id); const request=f.queue(second.id);
  const response=await f.run(request.id);
  assert.equal(response.state,'running'); assert.equal(f.calls(),1);
  assert.equal(f.state(second.id).status,'running'); assert.equal(f.state(first.id).status,'pending');
  assert.equal(isPreflightRunning(f.resultsDir,request.id),true);
  assert.equal((await f.run(request.id)).state,'running'); assert.equal(f.calls(),1);
  assert.equal(f.queue(second.id,new Date(Date.now()+61000)).id,request.id,'running request survives manual repeat after cooldown');
  // A scheduled batch may test other requests, but cannot duplicate this one.
  const scheduled=processMerchantPreflights(f.ctx);
  assert.equal(f.calls(),2);
  await f.finish(second.id); await scheduled;
  assert.equal(f.calls(),4); assert.equal(isPreflightRunning(f.resultsDir,request.id),false);
  assert.equal(f.state(second.id).status,'ready');
  assert.equal(getMerchantApplication(f.db,second.id).status,'pending');
  assert.equal(existsSync(path.join(f.ctx.dataDir,'radar.sqlite')),false);
  assert.equal(existsSync(path.join(f.ctx.dataDir,'direct-shops-cache')),false);
});

test('manual test bypasses a busy scheduled batch while per-request locks still prevent duplicate work', async t => {
  const f=await fixture(t), first=f.app(1), second=f.app(2);
  f.queue(first.id); const target=f.queue(second.id);
  const scheduled=processMerchantPreflights(f.ctx);
  assert.equal(f.calls(),1);
  assert.equal((await f.run(target.id)).state,'running'); assert.equal(f.calls(),2);
  await f.finish(second.id); await scheduled;
  assert.equal(f.calls(),4);
});

test('private socket enforces request ID only, bounded concurrency and explicit unavailable result', async t => {
  const f=await fixture(t), apps=[1,2,3].map(f.app), requests=apps.map(a=>f.queue(a.id));
  assert.equal(statSync(f.socketPath).mode & 0o777,0o600);
  for (const request of requests.slice(0,2)) assert.equal((await f.run(request.id)).state,'running');
  assert.equal((await f.run(requests[2].id)).state,'busy'); assert.equal(f.calls(),2);
  assert.equal((await f.run('../escape')).state,'invalid');
  assert.equal((await f.run('MT-'+'A'.repeat(24))).state,'invalid');
  const raw = data => new Promise(resolve=>{
    const req=httpRequest({socketPath:f.socketPath,path:'/run',method:'POST',headers:{'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.end(data);
  });
  assert.equal(await raw(JSON.stringify({id:requests[2].id,shopUrl:'https://127.0.0.1'})),400);
  assert.equal(await raw('{'),400); assert.equal(await raw('x'.repeat(1000)),413);
  assert.equal(f.calls(),2);
  assert.equal((await startImmediatePreflight(requests[2].id,{socketPath:path.join(f.dir,'missing.sock')})).state,'unavailable');
  // Deadline resolves and destroys a stalled IPC connection.
  const slow=createServer(()=>{}), slowPath=path.join(f.dir,'slow.sock');
  await new Promise(resolve=>slow.listen(slowPath,resolve));
  try { assert.equal((await startImmediatePreflight(requests[2].id,{socketPath:slowPath,timeoutMs:30})).state,'unavailable'); }
  finally { slow.closeAllConnections(); await new Promise(resolve=>slow.close(resolve)); }
});

test('authenticated manual POST starts immediate IPC; status polling is read-only and keeps review gates', async t => {
  const f=await fixture(t), app=f.app(1), origin='https://airadar.test';
  const password='immediate-admin-test-password';
  let dispatchCalls=0;
  const admin=createAdmin({submissionsDb:f.db,merchantBridgeDir:f.bridgeDir,merchantPreflightResultsDir:f.resultsDir,origin,username:'test',passwordHash:await hashAdminPassword(password),
    immediatePreflight:async id=>{dispatchCalls++;return f.run(id);}});
  const server=createServer(async(req,res)=>{try{await admin(req,res,new URL(req.url,origin));}catch{res.statusCode=500;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`, detail=`/admin/merchants/${app.id}`;
  const get=(url,cookie='')=>fetch(base+url,{redirect:'manual',headers:{cookie}});
  const post=(url,body,cookie='',headers={})=>fetch(base+url,{redirect:'manual',method:'POST',headers:{cookie,origin,accept:'application/json','content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
  assert.equal((await get(detail+'/preflight')).status,303);
  const login=await get('/admin/login'), csrfLogin=/name="csrf" value="([^"]+)"/.exec(await login.text())[1];
  const auth=await post('/admin/login',{username:'test',password,csrf:csrfLogin},login.headers.getSetCookie()[0].split(';')[0]);
  const cookie=auth.headers.getSetCookie()[0].split(';')[0];
  const page=await get(detail,cookie), html=await page.text(), csrf=/name="csrf" value="([^"]+)"/.exec(html)[1];
  assert.ok(page.headers.get('content-security-policy').includes(ADMIN_PREFLIGHT_HASH));
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
  const body={action:'auto_test',version:1,csrf};
  assert.equal((await post(detail,body,cookie,{origin:'https://evil.test'})).status,403);
  assert.equal((await post(detail,{...body,csrf:'forged'},cookie)).status,403);
  assert.equal((await post(detail,{...body,version:9},cookie)).status,409);
  assert.equal(dispatchCalls,0);
  const started=await post(detail,body,cookie), running=await started.json();
  assert.equal(started.status,200); assert.match(running.html,/正在测试/); assert.equal(running.canApprove,false); assert.equal(f.calls(),1);
  await get(detail+'/preflight',cookie); await get(detail+'/preflight',cookie);
  assert.equal(dispatchCalls,1); assert.equal(f.calls(),1);
  const finished=await f.finish(app.id); assert.equal(finished.result.status,'ready');
  const response=await get(detail+'/preflight',cookie), ready=await response.json();
  assert.match(response.headers.get('cache-control'),/no-store/); assert.match(ready.html,/测试完成|商品样例/); assert.equal(ready.canApprove,true);
  assert.equal(getMerchantApplication(f.db,app.id).status,'pending');
  assert.doesNotMatch(ready.html,/复制文案|其他情况的沟通文案/);
  await post(detail,body,cookie); assert.equal(dispatchCalls,1,'recent completed result does not make another network request');
});

test('an orphan request lock is not reported as a newly started manual test', async t => {
  const f=await fixture(t), app=f.app(1), request=f.queue(app.id);
  mkdirSync(f.resultsDir,{recursive:true});
  const lock=path.join(f.resultsDir,'.'+request.id+'.lock');
  writeFileSync(lock,'');
  const old=new Date(Date.now()-120000);utimesSync(lock,old,old);
  assert.equal((await f.run(request.id)).state,'unavailable');assert.equal(f.calls(),0);
  assert.equal(f.state(app.id).status,'pending');
});
