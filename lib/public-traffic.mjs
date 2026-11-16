import {Worker} from 'node:worker_threads';

const TIMERS={setInterval,clearInterval,setTimeout,clearTimeout};
const count=value=>Number.isSafeInteger(value)&&value>=0;
function snapshotFrom(report,updatedAt){
 if(!report||report.available!==true||report.healthy!==true)return null;
 const {historicalPv:totalPv,pv:monthPv,uv:monthUv,startedAt}=report;
 if(![totalPv,monthPv,monthUv].every(count)||monthPv>totalPv||monthUv>monthPv)return null;
 if(typeof startedAt!=='string'||startedAt.length>64)return null;
 const start=Date.parse(startedAt),updated=Date.parse(updatedAt);
 if(!Number.isFinite(start)||!Number.isFinite(updated)||start>updated)return null;
 // Never copy the report wholesale: it can contain private or future fields.
 return Object.freeze({totalPv,monthPv,monthUv,startedAt:new Date(start).toISOString(),updatedAt});
}

/** Public requests only read a small immutable snapshot. File-backed aggregates
 * run in a short-lived read-only worker, never on the web server's event loop. */
export function createPublicTraffic({analytics,now=Date.now,intervalMs=300000,timeoutMs=5000,scheduler=TIMERS,workerFactory=(url,options)=>new Worker(url,options)}={}){
 let snapshot=null,closed=false,active=null;
 const period=Number.isFinite(intervalMs)&&intervalMs>=1000?intervalMs:300000;
 const timeout=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,5000):5000;
 function refresh(){
  if(closed)return Promise.resolve(snapshot);
  if(active)return active.promise;
  let updatedAt,dbPath;
  try{
   if(analytics?.publicTrafficHealthy===false)return Promise.resolve(snapshot);
   updatedAt=new Date(now()).toISOString();dbPath=analytics?.publicTrafficDatabasePath;
   if(typeof dbPath!=='string'||!dbPath||dbPath===':memory:'){
    const next=snapshotFrom(analytics?.report?.(30,new Date(updatedAt)),updatedAt);
    if(next)snapshot=next;
    return Promise.resolve(snapshot);
   }
  }catch{return Promise.resolve(snapshot);}
  let resolve;
  const job={worker:null,timer:null,finishing:false,promise:new Promise(done=>{resolve=done;})};
  active=job;
  const finish=async report=>{
   if(job.finishing)return;
   job.finishing=true;
   if(job.timer)scheduler.clearTimeout(job.timer);
   try{await job.worker?.terminate();}catch{/* A worker already exiting needs no recovery. */}
   if(!closed){
    try{if(analytics?.publicTrafficHealthy!==false){const next=snapshotFrom(report,updatedAt);if(next)snapshot=next;}}catch{/* Keep the last good snapshot and timestamp. */}
   }
   if(active===job)active=null;
   resolve(snapshot);
  };
  job.finish=finish;
  try{
   job.worker=workerFactory(new URL('./public-traffic-worker.mjs',import.meta.url),{workerData:{dbPath,date:updatedAt}});
   job.worker.on('message',finish);
   job.worker.on('error',()=>finish(null));
   job.worker.on('exit',()=>finish(null));
   job.timer=scheduler.setTimeout(()=>finish(null),timeout);
   job.timer?.unref?.();
  }catch{void finish(null);}
  return job.promise;
 }
 const ready=refresh();
 const timer=scheduler.setInterval(refresh,period);timer?.unref?.();
 return Object.freeze({get:()=>snapshot,refresh,ready,async close(){
  if(!closed){closed=true;scheduler.clearInterval(timer);}
  if(active){const job=active;void job.finish(null);await job.promise;}
 }});
}
