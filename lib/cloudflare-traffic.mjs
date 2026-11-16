import {open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const TIMERS={setInterval,clearInterval,setTimeout,clearTimeout};
const HOUR=3600000,DAY=24*HOUR,STOP=Symbol('cancelled');
const ENDPOINT='https://api.cloudflare.com/client/v4/graphql';
const QUERY=`query AiradarPublicTraffic($zoneTag: string!, $dayStart: Time!, $dayEnd: Time!, $monthStart: Date!, $monthEnd: Date!) {
 viewer { zones(filter: {zoneTag: $zoneTag}) {
  day: httpRequests1hGroups(limit: 1, filter: {datetime_geq: $dayStart, datetime_lt: $dayEnd}) { uniq { uniques } sum { requests } }
  month: httpRequests1dGroups(limit: 1, filter: {date_geq: $monthStart, date_lt: $monthEnd}) { uniq { uniques } sum { requests } }
 } }
}`;
const count=value=>Number.isSafeInteger(value)&&value>=0;
function windows(time){
 const dayEnd=Math.floor(time/HOUR)*HOUR,monthEnd=Math.floor(time/DAY)*DAY;
 return {dayStart:new Date(dayEnd-DAY).toISOString(),dayEnd:new Date(dayEnd).toISOString(),monthStart:new Date(monthEnd-30*DAY).toISOString(),monthEnd:new Date(monthEnd).toISOString()};
}
function timestamp(value){
 if(typeof value!=='string'||value.length>32)return NaN;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value?parsed:NaN;
}
function validSnapshot(input,time){
 if(!input||input.source!=='cloudflare'||!Number.isFinite(time))return null;
 const {dayUv,monthUv,dayRequests,monthRequests}=input;
 if(![dayUv,monthUv,dayRequests,monthRequests].every(count)||dayUv>dayRequests||monthUv>monthRequests)return null;
 const updated=timestamp(input.updatedAt);
 if(!Number.isFinite(updated)||updated<0||updated>time+300000)return null;
 const range=windows(updated);
 for(const field of Object.keys(range))if(input[field]!==range[field])return null;
 // Explicit fields only: never persist or publish API responses, credentials,
 // zone information, visitor identifiers, errors, or future response fields.
 return Object.freeze({source:'cloudflare',dayUv,monthUv,dayRequests,monthRequests,...range,updatedAt:input.updatedAt});
}
function fromResponse(body,updatedAt,time){
 if(!body||body.errors!=null&&(!Array.isArray(body.errors)||body.errors.length))return null;
 const zones=body.data?.viewer?.zones;
 if(!Array.isArray(zones)||zones.length!==1)return null;
 const {day,month}=zones[0]??{};
 // Aggregation happens at Cloudflare with no dimensions. Adding per-day
 // uniques would double-count repeat visitors across the requested window.
 if(!Array.isArray(day)||day.length!==1||!Array.isArray(month)||month.length!==1)return null;
 return validSnapshot({source:'cloudflare',dayUv:day[0]?.uniq?.uniques,monthUv:month[0]?.uniq?.uniques,dayRequests:day[0]?.sum?.requests,monthRequests:month[0]?.sum?.requests,...windows(time),updatedAt},time);
}
async function readCache(file,time){
 let handle;
 try{
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const bytes=Buffer.alloc(8193),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
  if(bytesRead>8192)return null;
  return validSnapshot(JSON.parse(bytes.subarray(0,bytesRead).toString('utf8')),time);
 }catch{return null;}
 finally{try{await handle?.close();}catch{/* Cache is optional. */}}
}
async function writeCache(file,snapshot,isClosed){
 const temporary=`${file}.${randomUUID()}.tmp`;let handle;
 try{
  handle=await open(temporary,'wx',0o600);
  await handle.writeFile(JSON.stringify(snapshot));await handle.close();handle=null;
  if(!isClosed())await rename(temporary,file);
 }catch{/* Keep the live snapshot even when durable storage is unavailable. */}
 finally{try{await handle?.close();}catch{}try{await unlink(temporary);}catch{}}
}

/** The website reads memory only. Cloudflare aggregation and optional private
 * disk snapshots are refreshed asynchronously, independently of page requests. */
export function createCloudflareTraffic({token,zoneId,cachePath,fetchImpl=fetch,now=Date.now,intervalMs=300000,timeoutMs=8000,scheduler=TIMERS}={}){
 let snapshot=null,closed=false,active=null,loaded=false;
 const period=Number.isFinite(intervalMs)&&intervalMs>=1000?intervalMs:300000;
 const timeout=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,8000):8000;
 const credentials=typeof token==='string'&&token.length>0&&token.length<=4096&&!/[\s\r\n]/.test(token)&&typeof zoneId==='string'&&/^[a-f0-9]{32}$/i.test(zoneId);
 const cache=typeof cachePath==='string'&&cachePath?path.resolve(cachePath):null;
 function refresh(){
  if(closed)return Promise.resolve(snapshot);
  if(active)return active.promise;
  const job={controller:new AbortController(),cancel:null,timer:null,promise:null};
  active=job;
  job.promise=Promise.resolve().then(async()=>{
   try{
    if(!loaded){loaded=true;if(cache){const cached=await readCache(cache,now());if(!closed&&cached)snapshot=cached;}}
    if(closed||!credentials)return snapshot;
    const time=now(),updatedAt=new Date(time).toISOString(),range=windows(time);
    const stop=new Promise(resolve=>{job.cancel=()=>{job.controller.abort();resolve(STOP);};});
    job.timer=scheduler.setTimeout(job.cancel,timeout);job.timer?.unref?.();
    const request=async()=>{
     const result=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},signal:job.controller.signal,
      body:JSON.stringify({query:QUERY,variables:{zoneTag:zoneId,dayStart:range.dayStart,dayEnd:range.dayEnd,monthStart:range.monthStart.slice(0,10),monthEnd:range.monthEnd.slice(0,10)}})});
     if(!result?.ok)return null;
     return result.json();
    };
    // The explicit race also bounds clients which ignore AbortSignal, including
    // delayed body parsing. A cancelled/late response can never replace data.
    const body=await Promise.race([request(),stop]);
    if(body!==STOP&&!closed){const next=fromResponse(body,updatedAt,time);if(next){snapshot=next;if(cache)await writeCache(cache,next,()=>closed);}}
   }catch{/* Preserve the last good timestamp; never expose request errors. */}
   finally{
    if(job.timer)scheduler.clearTimeout(job.timer);
    // Release a response stream even on non-2xx results, whose JSON body is
    // intentionally not read. Successful responses have already been consumed.
    job.controller.abort();
    if(active===job)active=null;
   }
   return snapshot;
  });
  return job.promise;
 }
 const ready=refresh();
 const timer=scheduler.setInterval(refresh,period);timer?.unref?.();
 return Object.freeze({get:()=>snapshot,refresh,ready,async close(){
  if(!closed){closed=true;scheduler.clearInterval(timer);}
  const job=active;if(job){job.controller.abort();job.cancel?.();await job.promise;}
 }});
}
