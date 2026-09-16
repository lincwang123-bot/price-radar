import {lstatSync,readFileSync,writeFileSync,renameSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';

export const RECEIPT_DIRECTORY='/opt/linc/backups/price-radar';
const LEVEL='aes-256-gcm+sha256+sqlite-quick-check';
const MAX_AGE=36*3600000;
export function normalizeReceipt(input,now=Date.now()) {
  if(input?.version!==1||input.verification!==LEVEL||!Number.isSafeInteger(input.encryptedBytes)||input.encryptedBytes<37)throw new Error('Invalid receipt');
  const checked=Date.parse(input.checkedAt),created=Date.parse(input.createdAt);
  if(!Number.isFinite(checked)||!Number.isFinite(created)||created>checked||checked>now+300000)throw new Error('Invalid receipt timestamps');
  return {version:1,createdAt:new Date(created).toISOString(),checkedAt:new Date(checked).toISOString(),encryptedBytes:input.encryptedBytes,verification:LEVEL};
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
  if(current.checkedAt&&Date.parse(current.checkedAt)>Date.parse(receipt.checkedAt))throw new Error('Receipt would downgrade a newer backup');
  const pending=path.join(directory,`.mac-receipt-${randomBytes(8).toString('hex')}.pending`);
  try{writeFileSync(pending,JSON.stringify(receipt),{flag:'wx',mode:0o600});renameSync(pending,path.join(directory,'mac-receipt.json'));}
  finally{rmSync(pending,{force:true});}
  return receipt;
}
export function offsiteReceiptStatus(directory=RECEIPT_DIRECTORY,now=Date.now()) {
  const file=path.join(directory,'mac-receipt.json');
  try{
    const dir=lstatSync(directory);if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('Invalid receipt directory');
    const info=lstatSync(file);if(!info.isFile()||info.size>2048)throw new Error('Invalid receipt file');
    const value=normalizeReceipt(JSON.parse(readFileSync(file,'utf8')),now);
    const stale=now-Date.parse(value.checkedAt)>MAX_AGE;
    return {...value,configured:true,ok:!stale,state:stale?'stale':'recent'};
  }catch(error){return {configured:error.code!=='ENOENT',ok:false,state:error.code==='ENOENT'?'unconfigured':'invalid'};}
}
export async function publishReceipt(status,{spawnRemote=spawn,timeoutMs=20000,signal}={}) {
  const payload=JSON.stringify(receiptFromStatus(status));signal?.throwIfAborted();
  const child=spawnRemote('/usr/bin/ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','linc-vps','node --disable-warning=ExperimentalWarning /opt/linc/apps/price-radar/scripts/receive-backup-receipt.mjs'],{stdio:['pipe','ignore','pipe']});
  child.stderr.resume();let stdinError=false;child.stdin.on('error',()=>{stdinError=true;});
  const stop=()=>child.kill('SIGKILL'),timer=setTimeout(stop,timeoutMs);signal?.addEventListener('abort',stop,{once:true});
  try{
    const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
    child.stdin.end(payload);
    if(await result!==0||stdinError||signal?.aborted)throw new Error('Mac backup receipt upload failed');
    return {ok:true,sentAt:new Date().toISOString()};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
