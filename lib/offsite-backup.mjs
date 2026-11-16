import {lstatSync,readFileSync,writeFileSync,renameSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';

export const RECEIPT_DIRECTORY='/srv/price-radar-backups';
const LEVEL='aes-256-gcm+sha256+sqlite-quick-check';
const MAX_AGE=36*3600000;
const WEEKLY_CHECK_MAX_AGE=8*24*3600000;
export function normalizeReceipt(input,now=Date.now()) {
  if(input?.version!==1||input.verification!==LEVEL||!Number.isSafeInteger(input.encryptedBytes)||input.encryptedBytes<37)throw new Error('Invalid receipt');
  const checked=Date.parse(input.checkedAt),created=Date.parse(input.createdAt);
  if(!Number.isFinite(checked)||!Number.isFinite(created)||created>checked||checked>now+300000)throw new Error('Invalid receipt timestamps');
  const receipt={version:1,createdAt:new Date(created).toISOString(),checkedAt:new Date(checked).toISOString(),encryptedBytes:input.encryptedBytes,verification:LEVEL};
  if(input.checkIntervalDays!==undefined) {
    if(input.checkIntervalDays!==7)throw new Error('Invalid check interval');
    receipt.checkIntervalDays=7;
  }
  if(input.sourceCheck!==undefined) {
    const check=input.sourceCheck;
    if(!check||typeof check!=='object'||Array.isArray(check)||check.intervalDays!==7||typeof check.unchanged!=='boolean'||typeof check.checkedAt!=='string')throw new Error('Invalid source check');
    const at=Date.parse(check.checkedAt);
    if(!Number.isFinite(at)||at<checked||at>now+300000)throw new Error('Invalid source check timestamp');
    receipt.sourceCheck={checkedAt:new Date(at).toISOString(),unchanged:check.unchanged,intervalDays:7};
  }
  return receipt;
}
export function receiptFromStatus(status) {
  if(status.ok!==true||status.verified!==true)throw new Error('Only verified local backups can be acknowledged');
  return normalizeReceipt({...status,verification:LEVEL});
}
export function writeReceipt(input,directory=RECEIPT_DIRECTORY) {
  const receipt={...normalizeReceipt(input),receivedAt:new Date().toISOString()};
  mkdirSync(directory,{recursive:true,mode:0o700});
  if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw new Error('Receipt directory must be regular');
  const current=offsiteReceiptStatus(directory);
  if(current.checkedAt&&(Date.parse(current.checkedAt)>Date.parse(receipt.checkedAt)||Date.parse(current.createdAt)>Date.parse(receipt.createdAt)))throw new Error('Receipt would downgrade a newer backup');
  if(current.createdAt===receipt.createdAt&&current.sourceCheck&&Date.parse(current.sourceCheck.checkedAt)>Date.parse(receipt.sourceCheck?.checkedAt||receipt.checkedAt))throw new Error('Receipt would downgrade a newer source check');
  const serialized=JSON.stringify(receipt);
  if(Buffer.byteLength(serialized)>2048)throw new Error('Invalid receipt size');
  const pending=path.join(directory,`.mac-receipt-${randomBytes(8).toString('hex')}.pending`);
  try{writeFileSync(pending,serialized,{flag:'wx',mode:0o600});renameSync(pending,path.join(directory,'mac-receipt.json'));}
  finally{rmSync(pending,{force:true});}
  return receipt;
}
export function offsiteReceiptStatus(directory=RECEIPT_DIRECTORY,now=Date.now()) {
  const file=path.join(directory,'mac-receipt.json');
  try{
    const dir=lstatSync(directory);if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('Invalid receipt directory');
    const info=lstatSync(file);if(!info.isFile()||info.size>2048)throw new Error('Invalid receipt file');
    const value=normalizeReceipt(JSON.parse(readFileSync(file,'utf8')),now);
    const stale=now-Date.parse(value.sourceCheck?.checkedAt||value.checkedAt)>(value.sourceCheck||value.checkIntervalDays===7?WEEKLY_CHECK_MAX_AGE:MAX_AGE);
    return {...value,configured:true,ok:!stale,state:stale?'stale':'recent'};
  }catch(error){return {configured:error.code!=='ENOENT',ok:false,state:error.code==='ENOENT'?'unconfigured':'invalid'};}
}
export async function publishReceipt(status,{spawnRemote=spawn,timeoutMs=20000,signal}={}) {
  const payload=JSON.stringify(receiptFromStatus(status));signal?.throwIfAborted();
  const child=spawnRemote('/usr/bin/ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','your-vps','node --disable-warning=ExperimentalWarning /srv/price-radar/scripts/receive-backup-receipt.mjs'],{stdio:['pipe','ignore','pipe']});
  child.stderr.resume();let stdinError=false;child.stdin.on('error',()=>{stdinError=true;});
  const stop=()=>child.kill('SIGKILL'),timer=setTimeout(stop,timeoutMs);signal?.addEventListener('abort',stop,{once:true});
  try{
    const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
    child.stdin.end(payload);
    if(await result!==0||stdinError||signal?.aborted)throw new Error('Mac backup receipt upload failed');
    return {ok:true,sentAt:new Date().toISOString()};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
