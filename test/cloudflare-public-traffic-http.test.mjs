import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';

const NOW=Date.parse('2026-10-11T14:55:00.000Z');
const TOKEN='fixture-private-cloudflare-token',ZONE='1'.repeat(32);
const ENV={CLOUDFLARE_ANALYTICS_API_TOKEN:TOKEN,CLOUDFLARE_ANALYTICS_ZONE_ID:ZONE};
const response=(dayUv=6170,monthUv=45870)=>({ok:true,json:async()=>({data:{viewer:{zones:[{day:[{uniq:{uniques:dayUv},sum:{requests:52950}}],month:[{uniq:{uniques:monthUv},sum:{requests:2116323}}]}]}}})});
function scheduling(){
 const intervals=new Set(),timeouts=new Set();
 const add=(set,fn)=>{const timer={fn,unref(){}};set.add(timer);return timer;};
 return {intervals,timeouts,setInterval:fn=>add(intervals,fn),clearInterval:timer=>intervals.delete(timer),setTimeout:fn=>add(timeouts,fn),clearTimeout:timer=>timeouts.delete(timer)};
}
async function fixture({trafficEnv=ENV,trafficOptions={}}={}){
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','cloudflare-http-fixture-secret'.repeat(3),{now:new Date(NOW)});
 const iso=new Date(NOW).toISOString();
 storeSnapshot(db,{source:'direct-shops',snapshotId:'cf-home-fixture',fetchedAt:iso,products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'one',title:'ChatGPT Plus iOS 代充 1个月',price:129,status:'in_stock',currency:'CNY',url:'https://fixture.example/buy/1',capturedAt:iso}]}]});
 const scheduler=scheduling();
 const app=createApp({db,analytics,trafficEnv,trafficOptions:{now:()=>NOW,scheduler,...trafficOptions},retentionOptions:{env:{},secret:'cf-http-retention-test'.repeat(4)}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const port=app.address().port,base='http://127.0.0.1:'+port;
 return {app,analytics,scheduler,port,get:async(route='/')=>{const res=await fetch(base+route);return {res,html:await res.text()};},async close(){
  if(app.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
  await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();await new Promise(setImmediate);
  assert.equal(scheduler.intervals.size,0);assert.equal(scheduler.timeouts.size,0);
  analytics.close();db.close();
 }};
}
const refresh=f=>[...f.scheduler.intervals][0].fn();

test('Cloudflare homepages render one background snapshot in both languages without request-time API calls or credentials',async()=>{
 let calls=0,time=NOW,resolveFirst;
 const first=new Promise(resolve=>{resolveFirst=resolve;});
 const f=await fixture({trafficOptions:{now:()=>time,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
  return calls===1?first:response(6180,45880);
 }}});
 try{
  const cold=await f.get();assert.doesNotMatch(cold.html,/<section class="public-traffic/);assert.equal(calls,1);
  resolveFirst(response());await refresh(f);
  for(const route of ['/','/en/']){
   const {res,html}=await f.get(route);assert.equal(res.status,200);assert.match(html,/public-traffic--cloudflare/);assert.match(html,/6,170/);assert.match(html,/45,870/);
   assert.doesNotMatch(html,new RegExp(TOKEN+'|'+ZONE));assert.doesNotMatch(html,/累计浏览量|Total pageviews|2,116,323|52,950/);
   assert.match(html,route==='/en/'?/Source: Cloudflare/:/来源：Cloudflare/);
   const hit=await f.get(route);assert.equal(hit.res.headers.get('x-price-radar-home-cache'),'HIT');assert.equal(hit.html,html);
  }
  assert.equal(calls,1,'HTTP requests must not fetch analytics');
  const privacy=await f.get('/privacy');assert.match(privacy.html,/Cloudflare 公开访问汇总/);assert.match(privacy.html,/不新增浏览器追踪脚本或 Cookie/);assert.doesNotMatch(privacy.html,new RegExp(TOKEN));
  time+=300000;await refresh(f);assert.equal(calls,2);
  for(const route of ['/','/en/']){const next=await f.get(route);assert.equal(next.res.headers.get('x-price-radar-home-cache'),'MISS');assert.match(next.html,/6,180/);assert.match(next.html,/45,880/);}
 }finally{resolveFirst(response());await f.close();}
 await assert.rejects(fetch('http://127.0.0.1:'+f.port));
});

test('partial Cloudflare configuration never falls back to first-party visitor figures',async()=>{
 for(const trafficEnv of [{CLOUDFLARE_ANALYTICS_API_TOKEN:TOKEN},{CLOUDFLARE_ANALYTICS_ZONE_ID:ZONE},{CLOUDFLARE_ANALYTICS_API_TOKEN:''}]){
  let calls=0;const f=await fixture({trafficEnv,trafficOptions:{fetchImpl:async()=>{calls++;throw Error('must not fetch without credentials');}}});
  try{await refresh(f);assert.equal(calls,0);for(const route of ['/','/en/'])assert.doesNotMatch((await f.get(route)).html,/<section class="public-traffic/);}
  finally{await f.close();}
 }
 const local=await fixture({trafficEnv:{}});
 try{for(const route of ['/','/en/']){const {html}=await local.get(route);assert.match(html,/<section class="public-traffic"/);assert.doesNotMatch(html,/public-traffic--cloudflare"/);}}
 finally{await local.close();}
});

test('failed refresh and restart use the last good private cache, while a cold failure remains hidden',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'airadar-cloudflare-http-')),cachePath=path.join(directory,'traffic.json');
 try{
 const trafficEnv={...ENV,CLOUDFLARE_TRAFFIC_CACHE_PATH:cachePath};
 let fail=false;
 const first=await fixture({trafficEnv,trafficOptions:{fetchImpl:async()=>{if(fail)throw Error(TOKEN);return response();}}});
 try{
  await refresh(first);assert.match((await first.get()).html,/45,870/);
  const cached=await readFile(cachePath,'utf8');assert.doesNotMatch(cached,new RegExp(TOKEN+'|'+ZONE));
  fail=true;await refresh(first);assert.match((await first.get()).html,/45,870/);
 }finally{await first.close();}
 const restarted=await fixture({trafficEnv,trafficOptions:{fetchImpl:async()=>{throw Error(TOKEN);}}});
 try{await refresh(restarted);for(const route of ['/','/en/']){const {html}=await restarted.get(route);assert.match(html,/45,870/);assert.doesNotMatch(html,new RegExp(TOKEN));}}
 finally{await restarted.close();}
 const cold=await fixture({trafficOptions:{fetchImpl:async()=>{throw Error(TOKEN);}}});
 try{await refresh(cold);assert.doesNotMatch((await cold.get()).html,/<section class="public-traffic/);}
 finally{await cold.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
});
