import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCloudflareTraffic} from '../lib/cloudflare-traffic.mjs';

const NOW=Date.parse('2026-10-11T09:27:31.000Z');
const token= 'example-fixture-sk-00000000000000000000000000000000',zoneId='a'.repeat(32);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function scheduling(){
 const intervals=new Set(),timeouts=new Set();
 const add=(set,fn,ms)=>{const timer={fn,ms,unref(){}};set.add(timer);return timer;};
 return {intervals,timeouts,setInterval:(fn,ms)=>add(intervals,fn,ms),clearInterval:t=>intervals.delete(t),setTimeout:(fn,ms)=>add(timeouts,fn,ms),clearTimeout:t=>timeouts.delete(t)};
}
const payload=()=>({data:{viewer:{zones:[{day:[{uniq:{uniques:6170},sum:{requests:52950}}],month:[{uniq:{uniques:45870},sum:{requests:2116323}}]}]}}});
const response=(body=payload(),status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const expected=()=>({source:'cloudflare',dayUv:6170,monthUv:45870,dayRequests:52950,monthRequests:2116323,dayStart:'2026-10-10T09:00:00.000Z',dayEnd:'2026-10-11T09:00:00.000Z',monthStart:'2026-09-11T00:00:00.000Z',monthEnd:'2026-10-11T00:00:00.000Z',updatedAt:new Date(NOW).toISOString()});
const create=options=>createCloudflareTraffic({token,zoneId,now:()=>NOW,scheduler:scheduling(),fetchImpl:async()=>response(),...options});

test('Cloudflare sends scoped aggregate query and exposes only immutable safe metrics',async()=>{
 let calls=0,request;const scheduler=scheduling();
 const traffic=create({scheduler,fetchImpl:async(url,options)=>{calls++;request={url,options};const body=payload();body.private=token;body.data.viewer.zones[0].secret= 'example-fixture-sk-00000000000000000000000000000000';return response(body);}});
 assert.equal(traffic.get(),null);await traffic.ready;
 assert.equal(request.url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(request.options.method,'POST');
 assert.equal(request.options.headers.Authorization,`Bearer ${token}`);assert.equal(request.options.redirect,'error');
 assert.ok(request.options.signal instanceof AbortSignal);
 const {query,variables}=JSON.parse(request.options.body);
 assert.match(query,/day:\s*httpRequests1hGroups\(limit:\s*1/);assert.match(query,/month:\s*httpRequests1dGroups\(limit:\s*1/);
 assert.doesNotMatch(query,/dimensions/);assert.doesNotMatch(request.options.body,new RegExp(token));
 assert.deepEqual(variables,{zoneTag:zoneId,dayStart:'2026-10-10T09:00:00.000Z',dayEnd:'2026-10-11T09:00:00.000Z',monthStart:'2026-09-11',monthEnd:'2026-10-11'});
 assert.deepEqual(traffic.get(),expected());assert.ok(Object.isFrozen(traffic.get()));
 assert.doesNotMatch(JSON.stringify(traffic.get()),/private|token|zoneTag|Authorization/);
 for(let i=0;i<100;i++)assert.equal(traffic.get().dayUv,6170);
 assert.equal(calls,1);assert.equal(scheduler.timeouts.size,0);assert.equal([...scheduler.intervals][0].ms,300000);
 await traffic.close();assert.equal(scheduler.intervals.size,0);await traffic.refresh();assert.equal(calls,1);
});

test('whole-window unique counts are never computed by summing grouped daily or hourly rows',async()=>{
 const body=payload();body.data.viewer.zones[0].month.push({uniq:{uniques:40},sum:{requests:100}});
 const traffic=create({fetchImpl:async()=>response(body)});assert.equal(await traffic.ready,null);await traffic.close();
});

test('HTTP, GraphQL and malformed values fail closed without exposing private errors',async()=>{
 const cases=[response(payload(),403),response({...payload(),errors:[{message:token}]}),response({...payload(),errors:0}),response({}),response({data:{viewer:{zones:[]}}}),response({data:{viewer:{zones:[{},{}]}}})];
 for(const invalid of [-1,1.2,'6170',Number.MAX_SAFE_INTEGER+1,null]){const body=payload();body.data.viewer.zones[0].day[0].uniq.uniques=invalid;cases.push(response(body));}
 for(const which of ['day','month']){const body=payload();body.data.viewer.zones[0][which][0].sum.requests=1;cases.push(response(body));}
 for(const result of cases){const traffic=create({fetchImpl:async()=>result});assert.equal(await traffic.ready,null);assert.equal(traffic.get(),null);await traffic.close();}
 for(const fetchImpl of [async()=>{throw new Error(token);},async()=>({ok:true,json:async()=>{throw new Error(token);}})]){const traffic=create({fetchImpl});assert.equal(await traffic.ready,null);await traffic.close();}
});

test('valid zero remains visible, and missing credentials never cause a request',async()=>{
 const body=payload();for(const group of Object.values(body.data.viewer.zones[0])){group[0].uniq.uniques=0;group[0].sum.requests=0;}
 const zero=create({fetchImpl:async()=>response(body)});await zero.ready;assert.equal(zero.get().dayUv,0);assert.equal(zero.get().monthRequests,0);await zero.close();
 for(const settings of [{token:''},{zoneId:''},{zoneId:'wrong'},{token:'bad\nheader'}]){const traffic=create({...settings,fetchImpl:async()=>assert.fail('request without valid credentials')});assert.equal(await traffic.ready,null);await traffic.close();}
});

test('HTTP failures abort unread response streams instead of waiting for garbage collection',async()=>{
 for(const status of [401,403,429,503]){
  let signal,aborts=0;const scheduler=scheduling();
  const traffic=create({scheduler,fetchImpl:async(_url,options)=>{
   signal=options.signal;signal.addEventListener('abort',()=>{aborts++;});
   return {ok:false,status,json:async()=>assert.fail('error response bodies must not be exposed')};
  }});
  assert.equal(await traffic.ready,null);assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(scheduler.timeouts.size,0);
  await traffic.close();assert.equal(aborts,1);assert.equal(scheduler.intervals.size,0);
 }
});

test('refreshes do not overlap and failures keep the last good timestamp',async()=>{
 let calls=0,resolveFetch,time=NOW;const traffic=create({now:()=>time,fetchImpl:()=>{calls++;return new Promise(resolve=>{resolveFetch=resolve;});}});
 await tick();const overlap=traffic.refresh();assert.equal(calls,1);resolveFetch(response());await overlap;await traffic.ready;
 const first=traffic.get();time+=300000;const refresh=traffic.refresh();await tick();assert.equal(calls,2);resolveFetch(response({},503));await refresh;assert.equal(traffic.get(),first);
 time+=300000;const success=traffic.refresh();await tick();resolveFetch(response());await success;assert.notEqual(traffic.get().updatedAt,first.updatedAt);await traffic.close();
});

test('timeout bounds a non-cooperative fetch, aborts and permits subsequent refresh',async()=>{
 const scheduler=scheduling();let calls=0,signal;
 const traffic=create({scheduler,fetchImpl:async(_url,options)=>{calls++;signal=options.signal;return calls===1?new Promise(()=>{}):response();}});
 await tick();assert.equal([...scheduler.timeouts][0].ms,8000);[...scheduler.timeouts][0].fn();
 assert.equal(await traffic.ready,null);assert.equal(signal.aborted,true);assert.equal(scheduler.timeouts.size,0);
 await traffic.refresh();assert.equal(traffic.get().monthUv,45870);await traffic.close();assert.equal(scheduler.intervals.size,0);
});

test('response body parsing is also bounded and close suppresses late results',async()=>{
 for(const mode of ['timeout','close']){
  const scheduler=scheduling();let resolveBody,signal;
  const traffic=create({scheduler,fetchImpl:async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(resolve=>{resolveBody=resolve;})};}});
  await tick();if(mode==='timeout')[...scheduler.timeouts][0].fn();else await traffic.close();
  assert.equal(await traffic.ready,null);assert.equal(signal.aborted,true);resolveBody(payload());await tick();assert.equal(traffic.get(),null);
  await traffic.close();assert.equal(scheduler.timeouts.size,0);assert.equal(scheduler.intervals.size,0);
 }
});

test('cache writes are atomic mode 600 and contain no credentials or unapproved fields',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'airadar-cloudflare-cache-')),cachePath=path.join(dir,'traffic.json');let traffic;
 try{
  traffic=create({cachePath});await traffic.ready;
  assert.deepEqual(JSON.parse(await readFile(cachePath,'utf8')),expected());assert.equal((await stat(cachePath)).mode&0o777,0o600);assert.deepEqual(await readdir(dir),['traffic.json']);
  assert.doesNotMatch(await readFile(cachePath,'utf8'),new RegExp(token));await traffic.close();
  let unblock;traffic=create({cachePath,now:()=>NOW+3600000,fetchImpl:()=>new Promise(resolve=>{unblock=resolve;})});
  // The cache becomes available independently of the eventual network response.
  // Disk reads are not setImmediate-bound, so wait on real timers until the snapshot is visible.
  for(let i=0;i<50&&!traffic.get();i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(traffic.get(),expected());await traffic.close();assert.equal(await traffic.ready,traffic.get());unblock?.(response());
 }finally{await traffic?.close();await rm(dir,{recursive:true,force:true});}
});

test('corrupt or unreasonable cache is ignored; cache failures do not hide valid API data',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'airadar-cloudflare-invalid-')),cachePath=path.join(dir,'traffic.json');
 try{
  const invalid=['{broken',JSON.stringify({...expected(),source:'local'}),JSON.stringify({...expected(),monthUv:-1}),JSON.stringify({...expected(),dayEnd:'2030-01-01T00:00:00.000Z'}),JSON.stringify({...expected(),monthStart:'2026-09-01T00:00:00.000Z'}),JSON.stringify({...expected(),updatedAt:'2030-01-01T00:00:00.000Z'}),'x'.repeat(9000)];
  for(const content of invalid){await writeFile(cachePath,content);const traffic=create({cachePath,fetchImpl:async()=>response({},503)});assert.equal(await traffic.ready,null);await traffic.close();}
  const traffic=create({cachePath:path.join(dir,'missing-parent','traffic.json')});await traffic.ready;assert.deepEqual(traffic.get(),expected());await traffic.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('cache loading whitelists values and preserves stale timestamp instead of making them fresh',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'airadar-cloudflare-whitelist-')),cachePath=path.join(dir,'traffic.json');let traffic;
 try{await writeFile(cachePath,JSON.stringify({...expected(),token,visitors:['private']}));traffic=create({cachePath,now:()=>NOW+86400000,fetchImpl:async()=>response({},503)});await traffic.ready;assert.deepEqual(traffic.get(),expected());assert.ok(Object.isFrozen(traffic.get()));}
 finally{await traffic?.close();await rm(dir,{recursive:true,force:true});}
});

test('UTC window calculation handles month and year boundaries without calendar-month substitution',async()=>{
 const traffic=create({now:()=>Date.parse('2027-01-01T00:12:00.000Z')});await traffic.ready;
 assert.equal(traffic.get().dayStart,'2026-12-31T00:00:00.000Z');assert.equal(traffic.get().monthStart,'2026-12-02T00:00:00.000Z');assert.equal(traffic.get().monthEnd,'2027-01-01T00:00:00.000Z');await traffic.close();
});

test('background interval refreshes independently of reads, and immediate close prevents a request',async()=>{
 let calls=0,time=NOW;const scheduler=scheduling();
 const traffic=create({scheduler,now:()=>time,fetchImpl:async()=>{calls++;return response();}});await traffic.ready;
 time+=300000;await [...scheduler.intervals][0].fn();assert.equal(calls,2);assert.equal(traffic.get().updatedAt,new Date(time).toISOString());await traffic.close();
 const never=create({fetchImpl:async()=>assert.fail('closed service must not fetch')});await never.close();assert.equal(await never.ready,null);
});
