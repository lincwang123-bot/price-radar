import {createHash} from 'node:crypto';
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync,fsyncSync,fstatSync,statSync,unlinkSync,renameSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const fail=message=>Object.assign(new Error(message),{code:'PREFLIGHT_INTERNAL_ERROR'});

// Both the immediate preflight service and the scheduled collector can write
// here. Persist the cooldown and serialize request starts across processes;
// a crash leaves the lock in place for operator inspection, never a blind reset.
export function sharedMerchantReadRate(fetchImpl,{dataDir,origin,minimumMs,interval=()=>minimumMs,deadline,sleep=delay}) {
 if(!dataDir)throw fail('共享公开读取限速目录未配置');
 const directory=path.join(dataDir,'merchant-preflights','.public-read-rate');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const key=createHash('sha256').update(origin).digest('hex'),file=path.join(directory,key+'.json'),lock=file+'.lock';
 return async(value,init={})=>{
  let fd;
  try{fd=openSync(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw fail('本站公开读取限速锁被占用，请稍后检查');throw error;}
  const owned=fstatSync(fd),temporary=file+'.'+process.pid+'.tmp';let canRelease=true;
  const save=(at,spacing)=>{canRelease=false;writeFileSync(temporary,JSON.stringify({lastCompletedAt:at,nextAllowedAt:at+spacing}),{mode:0o600});const out=openSync(temporary,'r');try{fsyncSync(out);}finally{closeSync(out);}renameSync(temporary,file);canRelease=true;};
  try{
   let nextAllowedAt=0,lastCompletedAt=0;
   try{const state=JSON.parse(readFileSync(file,'utf8'));if(!Number.isSafeInteger(state.nextAllowedAt)||state.nextAllowedAt<0||!Number.isSafeInteger(state.lastCompletedAt)||state.lastCompletedAt<0)throw fail('公开读取限速状态无效');nextAllowedAt=state.nextAllowedAt;lastCompletedAt=state.lastCompletedAt;}
   catch(error){if(error.code!=='ENOENT')throw error;}
   const spacing=Math.max(minimumMs,interval());
   if(!Number.isFinite(spacing)||spacing<0)throw new Error('公开读取间隔无效');
   // The policy may have become stricter after the robots response.
   if(lastCompletedAt)nextAllowedAt=Math.max(nextAllowedAt,lastCompletedAt+spacing);
   const wait=Math.max(0,nextAllowedAt-Date.now());
   if(Date.now()+wait>=deadline)throw new Error('公开目录采集超时');
   if(wait)await sleep(wait,undefined,{signal:init.signal});
   init.signal?.throwIfAborted();
   if(Date.now()<nextAllowedAt||Date.now()>=deadline)throw new Error('公开目录采集超时');
   save(Date.now(),spacing);
   try{return await fetchImpl(value,init);}
   finally{save(Date.now(),spacing);}
  } finally {
   closeSync(fd);
   const current=statSync(lock);
   if(canRelease&&current.ino===owned.ino&&current.dev===owned.dev)unlinkSync(lock);
  }
 };
}
