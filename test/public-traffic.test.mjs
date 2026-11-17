import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {openAnalytics} from '../lib/analytics.mjs';
import {createPublicTraffic} from '../lib/public-traffic.mjs';

const NOW=Date.parse('2026-10-11T08:00:00.000Z');
const good=()=>({available:true,healthy:true,historicalPv:100,pv:80,uv:30,startedAt:'2026-09-01T00:00:00.000Z',timezone:'Asia/Shanghai',secret:'never-publish',series:[{visitor:'private'}]});
function scheduling(){
 const intervals=new Set(),timeouts=new Set();let unrefs=0;
 const add=(set,fn,ms)=>{const timer={fn,ms,unref(){unrefs++;}};set.add(timer);return timer;};
 return {intervals,timeouts,get unrefs(){return unrefs;},setInterval:(fn,ms)=>add(intervals,fn,ms),clearInterval:timer=>intervals.delete(timer),setTimeout:(fn,ms)=>add(timeouts,fn,ms),clearTimeout:timer=>timeouts.delete(timer)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('snapshot whitelists immutable scalar values, and get never runs aggregation',async()=>{
 let calls=0,time=NOW;const scheduler=scheduling();
 const traffic=createPublicTraffic({analytics:{report(days,date){calls++;assert.equal(days,30);assert.equal(date.toISOString(),new Date(time).toISOString());return good();}},now:()=>time,scheduler});
 assert.equal(calls,1);await traffic.ready;
 const snapshot=traffic.get();
 assert.deepEqual(snapshot,{totalPv:100,monthPv:80,monthUv:30,startedAt:'2026-09-01T00:00:00.000Z',updatedAt:new Date(NOW).toISOString()});
 assert.ok(Object.isFrozen(snapshot));assert.doesNotMatch(JSON.stringify(snapshot),/secret|series|visitor|private/);
 for(let i=0;i<100;i++)assert.equal(traffic.get(),snapshot);
 assert.equal(calls,1);assert.equal(scheduler.intervals.size,1);assert.equal([...scheduler.intervals][0].ms,300000);assert.equal(scheduler.unrefs,1);
 time+=300000;await [...scheduler.intervals][0].fn();assert.equal(calls,2);assert.notEqual(traffic.get().updatedAt,snapshot.updatedAt);
 await traffic.close();assert.equal(scheduler.intervals.size,0);assert.equal(scheduler.timeouts.size,0);
 await traffic.refresh();assert.equal(calls,2);
});
test('missing, unhealthy, invalid or failed data stays unavailable, while valid zero is not hidden',async()=>{
 const invalid=[undefined,null,{...good(),available:false},{...good(),healthy:false},{...good(),historicalPv:-1},{...good(),pv:101},{...good(),uv:81},{...good(),uv:0.5},{...good(),historicalPv:Number.MAX_SAFE_INTEGER+1},{...good(),pv:'80'},{...good(),startedAt:'invalid'},{...good(),startedAt:'2027-01-01T00:00:00Z'}];
 for(const result of invalid){const t=createPublicTraffic({analytics:{report:()=>result},now:()=>NOW,scheduler:scheduling()});assert.equal(await t.ready,null);assert.equal(t.get(),null);await t.close();}
 for(const analytics of [undefined,{}, {report(){throw new Error('private database error');}}]){const t=createPublicTraffic({analytics,now:()=>NOW,scheduler:scheduling()});assert.equal(await t.ready,null);await t.close();}
 const t=createPublicTraffic({analytics:{report:()=>({...good(),historicalPv:0,pv:0,uv:0})},now:()=>NOW,scheduler:scheduling()});assert.equal(t.get().totalPv,0);await t.close();
});
test('failed refresh preserves original good snapshot and its freshness timestamp',async()=>{
 let result=good(),time=NOW;const t=createPublicTraffic({analytics:{report:()=>result},now:()=>time,scheduler:scheduling()});
 const first=t.get();time+=300000;result={...good(),healthy:false};await t.refresh();assert.equal(t.get(),first);
 result={...good(),historicalPv:110,pv:90};await t.refresh();assert.equal(t.get().totalPv,110);assert.notEqual(t.get().updatedAt,first.updatedAt);await t.close();
});
class FakeWorker extends EventEmitter{terminations=0;terminate(){this.terminations++;return Promise.resolve(0);}}
test('file analytics uses asynchronous worker only, prevents overlapping refreshes, and terminates successful workers',async()=>{
 const workers=[],scheduler=scheduling();
 const t=createPublicTraffic({analytics:{publicTrafficDatabasePath:'/fixture/stats.sqlite',report(){assert.fail('main thread aggregation');}},now:()=>NOW,scheduler,workerFactory:(url,options)=>{assert.match(url.pathname,/public-traffic-worker\.mjs$/);assert.equal(options.workerData.dbPath,'/fixture/stats.sqlite');const worker=new FakeWorker();workers.push(worker);return worker;}});
 assert.equal(t.get(),null);assert.equal(workers.length,1);const pending=t.refresh();assert.equal(workers.length,1);
 workers[0].emit('message',good());await pending;await t.ready;
 assert.equal(t.get().totalPv,100);assert.equal(workers[0].terminations,1);assert.equal(scheduler.timeouts.size,0);
 const next=t.refresh();assert.equal(workers.length,2);workers[1].emit('message',{...good(),secret:'still private'});await next;assert.equal(workers[1].terminations,1);
 await t.close();assert.equal(scheduler.intervals.size,0);
});
test('worker failures, timeouts, unhealthy writer, and close retain safe state and clean resources',async()=>{
 let healthy=true;const workers=[],scheduler=scheduling(),analytics={publicTrafficDatabasePath:'/fixture/stats.sqlite',get publicTrafficHealthy(){return healthy;}};
 const t=createPublicTraffic({analytics,now:()=>NOW,scheduler,workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;}});
 workers[0].emit('message',good());await t.ready;const first=t.get();
 for(const event of ['error','exit','timeout']){
  const pending=t.refresh(),worker=workers.at(-1);
  if(event==='timeout'){assert.equal([...scheduler.timeouts][0].ms,5000);[...scheduler.timeouts][0].fn();}
  else worker.emit(event,event==='error'?new Error('private error'):1);
  await pending;assert.equal(t.get(),first);assert.equal(worker.terminations,1);assert.equal(scheduler.timeouts.size,0);
 }
 healthy=false;const count=workers.length;await t.refresh();assert.equal(workers.length,count);assert.equal(t.get(),first);
 healthy=true;const pending=t.refresh();await t.close();await pending;assert.equal(workers.at(-1).terminations,1);assert.equal(scheduler.timeouts.size,0);assert.equal(scheduler.intervals.size,0);
 workers.at(-1).emit('message',{...good(),historicalPv:1000});await tick();assert.equal(t.get(),first);
});
test('real file worker matches analytics report using Beijing day boundaries and cross-day UV deduplication',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'airadar-public-traffic-test-')),dbPath=path.join(dir,'analytics.sqlite');
 const a=openAnalytics(dbPath,'test-secret-more-than-thirty-two-characters',{now:new Date('2026-08-01T00:00:00Z')});
 let t;const live=new Set();
 try{
  a.db.prepare('INSERT INTO analytics_days(day,pv,uv) VALUES(?,?,?)').run('2026-08-01',20,5);
  a.db.prepare('INSERT INTO analytics_days(day,pv,uv) VALUES(?,?,?)').run('2026-09-12',2,1);
  a.db.prepare('INSERT INTO analytics_days(day,pv,uv) VALUES(?,?,?)').run('2026-10-11',3,2);
  for(const [day,visitor]of[['2026-09-12','same'],['2026-10-11','same'],['2026-10-11','other']])a.db.prepare('INSERT INTO analytics_visitors(day,visitor) VALUES(?,?)').run(day,visitor);
  const expected=a.report(30,new Date(NOW));
  t=createPublicTraffic({analytics:a,now:()=>NOW,workerFactory:(url,options)=>{const worker=new Worker(url,options);live.add(worker);worker.once('exit',()=>live.delete(worker));return worker;}});
  assert.equal(t.get(),null);const result=await t.ready;
  assert.equal(result.totalPv,expected.historicalPv);assert.equal(result.monthPv,expected.pv);assert.equal(result.monthUv,expected.uv);assert.equal(result.monthUv,2);assert.equal(live.size,0);
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM analytics_days').get().n,3);
 }finally{await t?.close();a.close();assert.equal(live.size,0);rmSync(dir,{recursive:true,force:true});}
});
test('real missing database stays missing, and actual workers exit on timeout and close',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'airadar-public-traffic-failure-')),dbPath=path.join(dir,'missing.sqlite');
 const missing=createPublicTraffic({analytics:{publicTrafficDatabasePath:dbPath},now:()=>NOW});
 try{assert.equal(await missing.ready,null);assert.equal(existsSync(dbPath),false);}finally{await missing.close();rmSync(dir,{recursive:true,force:true});}
 for(const mode of ['timeout','close']){
  let exited=false;
  const traffic=createPublicTraffic({analytics:{publicTrafficDatabasePath:'/unused-test-path'},now:()=>NOW,timeoutMs:25,workerFactory:()=>{
   const worker=new Worker('setInterval(()=>{},1000)',{eval:true});worker.once('exit',()=>{exited=true;});return worker;
  }});
  try{if(mode==='close')await traffic.close();assert.equal(await traffic.ready,null);assert.equal(exited,true,mode);}
  finally{await traffic.close();}
 }
});
test('optional engaged metrics never invalidate official snapshot',async()=>{
 for(const extra of [{},{engagedPv:-1,engagedUv:0},{engagedPv:4,engagedUv:5},{engagedPv:9,engagedUv:1},{engagedPv:2.5,engagedUv:1},{engagedPv:2,engagedUv:1,engagedMode:'off'},{engagedPv:2,engagedUv:1,engagedHistoricalPv:3,engagedMode:'filter'}]){
 const t=createPublicTraffic({analytics:{report:()=>({...good(),historicalPv:8,pv:6,uv:3,...extra})},now:()=>NOW,scheduler:scheduling()});try{const snapshot=await t.ready;assert.equal(snapshot.monthPv,6);assert.equal(snapshot.totalPv,8);if(extra.engagedMode==='filter'){assert.equal(snapshot.engagedMonthPv,2);assert.equal(snapshot.engagedMonthUv,1);assert.equal(snapshot.engagedTotalPv,3);}else assert.equal(snapshot.engagedMonthPv,undefined);}finally{await t.close();}}
});
test('real read-only worker publishes engaged aggregates and respects off',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'engaged-worker-'));const a=openAnalytics(path.join(dir,'stats.sqlite'),'fixture-secret-with-at-least-32-characters',{now:new Date(NOW)});
 try{const r={method:'GET',url:'/',headers:{'user-agent':'Mozilla/5.0 Chrome/1','cf-connecting-ip':'203.0.113.8'},socket:{remoteAddress:'127.0.0.1'}};a.record(r,200,new Date(NOW));a.recordEngaged(r,new Date(NOW));
 for(const mode of ['report','off']){const t=createPublicTraffic({analytics:{publicTrafficDatabasePath:a.publicTrafficDatabasePath,engagedMode:mode},now:()=>NOW});try{const s=await t.ready;assert.equal(s.monthPv,1);assert.equal(s.engagedMonthPv,mode==='off'?undefined:1);assert.doesNotMatch(JSON.stringify(s),/Mozilla|203\.0\.113|visitor|path|secret/);}finally{await t.close();}}
 }finally{a.close();rmSync(dir,{recursive:true,force:true});}
});
