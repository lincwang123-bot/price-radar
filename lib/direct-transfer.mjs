import {constants,openSync,closeSync,readSync,writeFileSync,fsyncSync,lstatSync,mkdirSync,renameSync,unlinkSync,rmdirSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {directTargets,collectorFor,SHOP_API_TARGET_IDS} from '../collectors/direct/registry.mjs';
import {isAccessDeniedError} from './safe-fetch.mjs';

export const DIRECT_TRANSFER_TARGET_IDS=SHOP_API_TARGET_IDS;
export const DIRECT_TRANSFER_MAX_BYTES=8*1024*1024;
const MAX_AGE=4*3600000,MAX_FUTURE=120000;
function parseJson(value){try{return JSON.parse(value);}catch{throw new Error('批次 JSON 格式无效');}}
const targets=()=>directTargets(DIRECT_TRANSFER_TARGET_IDS).filter(t=>t.kind==='shopApi');
function targetFor(id){const target=targets().find(t=>t.id===id);if(!target)throw new Error('未登记的传输目标');return target;}
function timestamp(value,now){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value))throw new Error('时间格式无效');const t=Date.parse(value);if(!Number.isFinite(t)||t<now-MAX_AGE||t>now+MAX_FUTURE)throw new Error('时间过期或超前');return t;}
function text(value,max,{required=false}={}){if(value==null&&!required)return '';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('商品文本无效');return value.trim();}
function normalizeOffer(offer,target,checkedAt,now){
 if(!offer||offer.sourceId!==target.id)throw new Error('报价来源身份不匹配');
 const id=text(offer.offerId,240,{required:true});if(!id.startsWith(target.id+':')||id.length<=target.id.length+1)throw new Error('报价 ID 不匹配');
 if(typeof offer.price!=='number'||!Number.isFinite(offer.price)||offer.price<=0||offer.price>1e9||offer.currency!=='CNY')throw new Error('价格或币种无效');
 if(!['in_stock','low_stock','out_of_stock','unknown'].includes(offer.status))throw new Error('库存状态无效');
 const stock=offer.stockCount??null;if(stock!==null&&(!Number.isSafeInteger(stock)||stock<0||stock>1e9))throw new Error('库存数量无效');
 const url=new URL(text(offer.url,2048,{required:true}));
 if(url.protocol!=='https:'||url.origin!==target.origin||url.username||url.password||url.search||url.hash||!/^\/item\/[a-zA-Z0-9_-]+$/.test(url.pathname))throw new Error('商品 URL 不在允许范围');
 if(id.slice(target.id.length+1)!==decodeURIComponent(url.pathname.slice('/item/'.length)))throw new Error('商品 URL 与报价 ID 不匹配');
 const at=timestamp(offer.capturedAt,now);if(at>Date.parse(checkedAt))throw new Error('商品时间晚于店铺检查时间');
 if(offer.expiresAt!=null&&(typeof offer.expiresAt!=='string'||!Number.isFinite(Date.parse(offer.expiresAt))||Date.parse(offer.expiresAt)<=now))throw new Error('报价已过期');
 // Deliberate allowlist projection: never accept source_type, health,
 // credentials, checkout fields or any sender-controlled provenance.
 return {offerId:id,sourceId:target.id,sourceName:target.name,storeName:target.name,title:text(offer.title,2000,{required:true}),category:text(offer.category,300),price:offer.price,listedPrice:offer.price,feeAmount:null,priceBasis:'listed',currency:'CNY',status:offer.status,stockCount:stock,url:url.href,capturedAt:offer.capturedAt,expiresAt:offer.expiresAt??null,deliveryMode:['auto','manual'].includes(offer.deliveryMode)?offer.deliveryMode:null,extra:{quoteHealth:{status:'cached',maxAgeMinutes:240}}};
}
export function validateDirectTransfer(input,{now=Date.now()}={}){
 const encoded=typeof input==='string'||Buffer.isBuffer(input)?input:JSON.stringify(input);
 if(Buffer.byteLength(encoded)>DIRECT_TRANSFER_MAX_BYTES)throw new Error('批次超过 8MB 上限');
 const batch=parseJson(encoded.toString());
 if(batch?.version!==1||!Array.isArray(batch.targets)||!batch.targets.length||batch.targets.length>20)throw new Error('批次版本或目标数量无效');
 const batchAt=timestamp(batch.checkedAt,now),seen=new Set();
 const normalized=batch.targets.map(record=>{
  const target=targetFor(record?.targetId);if(seen.has(target.id))throw new Error('重复目标');seen.add(target.id);
  if(timestamp(record.checkedAt,now)>batchAt)throw new Error('店铺时间晚于批次时间');
  if(!['ok','failed'].includes(record.status)||!Array.isArray(record.offers)||record.offers.length>2000||(record.status==='failed'&&record.offers.length))throw new Error('店铺状态或商品数量无效');
  const ids=new Set(),offers=record.offers.map(o=>{const clean=normalizeOffer(o,target,record.checkedAt,now);if(ids.has(clean.offerId))throw new Error('重复商品');ids.add(clean.offerId);return clean;});
  return {targetId:target.id,status:record.status,checkedAt:record.checkedAt,offers};
 });
 return {version:1,checkedAt:batch.checkedAt,targets:normalized};
}

/** No scheduling, credentials, outbound writes or external checkout requests. */
export async function collectDirectTransfer({targetIds=DIRECT_TRANSFER_TARGET_IDS,fetchImpl=globalThis.fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onDiagnostic=()=>{}}={}){
 if(!Array.isArray(targetIds)||!targetIds.length||targetIds.length>20||new Set(targetIds).size!==targetIds.length)throw new Error('目标数量无效');
 const selected=targetIds.map(targetFor),records=[],denied=new Set();let requests=0;
 // Delay at transport level, including between categories and stores.
 const limitedFetch=async(url,options)=>{if(requests>=160)throw Object.assign(new Error('批次请求超过上限'),{code:'REQUEST_LIMIT'});if(requests++)await sleep(1000);return fetchImpl(url,options);};
 for(const target of selected){
  const checkedAt=new Date(now()).toISOString();
  if(denied.has(target.origin)){onDiagnostic({targetId:target.id,reason:'ORIGIN_ACCESS_DENIED'});records.push({targetId:target.id,status:'failed',checkedAt,offers:[]});continue;}
  try{
   const offers=await collectorFor(target)(target,{capturedAt:checkedAt,fetchImpl:limitedFetch,requestDelayMs:0});
   const clean=validateDirectTransfer({version:1,checkedAt:new Date(now()).toISOString(),targets:[{targetId:target.id,status:'ok',checkedAt,offers}]},{now:now()});
   records.push(clean.targets[0]);
  }catch(error){const accessDenied=isAccessDeniedError(error);if(accessDenied)denied.add(target.origin);onDiagnostic({targetId:target.id,reason:accessDenied?'ACCESS_DENIED':error.code==='REQUEST_LIMIT'?'REQUEST_LIMIT':'COLLECT_OR_VALIDATION_FAILED'});records.push({targetId:target.id,status:'failed',checkedAt,offers:[]});}
 }
 return validateDirectTransfer({version:1,checkedAt:new Date(now()).toISOString(),targets:records},{now:now()});
}

function stat(file){try{return lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function directory(dataDir,{create=false}={}){
 const base=path.resolve(dataDir),baseStat=stat(base);if(!baseStat||baseStat.isSymbolicLink()||!baseStat.isDirectory())throw new Error('dataDir 必须为已存在的非符号链接目录');
 const dir=path.join(base,'direct-imports');if(create&&!stat(dir))mkdirSync(dir,{mode:0o700});
 const info=stat(dir);if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw new Error('拒绝符号链接或非目录 imports');return info?dir:null;
}
function readFile(file){const info=stat(file);if(!info)return null;if(info.isSymbolicLink()||!info.isFile())throw new Error('拒绝符号链接或非普通文件');if(info.size>DIRECT_TRANSFER_MAX_BYTES)throw new Error('文件超过上限');const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const buffer=Buffer.alloc(DIRECT_TRANSFER_MAX_BYTES+1);let offset=0,n;while((n=readSync(fd,buffer,offset,buffer.length-offset,null))>0){offset+=n;if(offset>DIRECT_TRANSFER_MAX_BYTES)throw new Error('文件超过上限');}return buffer.subarray(0,offset).toString('utf8');}finally{closeSync(fd);}}
function persisted(record,now){return validateDirectTransfer({version:1,checkedAt:record.checkedAt,targets:[record]},{now}).targets[0];}
function atomic(file,record){
 const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp';let fd;
 try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);closeSync(fd);fd=undefined;if(stat(file)?.isSymbolicLink())throw new Error('拒绝符号链接');renameSync(temp,file);}
 finally{if(fd!==undefined)closeSync(fd);if(stat(temp))unlinkSync(temp);}
}
export function importDirectTransfer(input,{dataDir,now=Date.now()}={}){
 const batch=validateDirectTransfer(input,{now}),dir=directory(dataDir,{create:true}),lock=path.join(dir,'.lock');
 mkdirSync(lock,{mode:0o700});
 try{
  const written=[],unchanged=[],pending=[];
  // Preflight all targets before writing any: invalid or backward batches
  // cannot partially refresh the other targets.
  for(const record of batch.targets){
   const file=path.join(dir,record.targetId+'.json'),previous=readFile(file);
   if(previous!==null){const old=parseJson(previous);if(old.targetId!==record.targetId||!Number.isFinite(Date.parse(old.checkedAt)))throw new Error('已有导入记录无效');
    const delta=Date.parse(record.checkedAt)-Date.parse(old.checkedAt);
    if(delta<0)throw new Error('拒绝旧批次逆序覆盖');
    if(delta===0){if(JSON.stringify(record)!==JSON.stringify(persisted(old,now)))throw new Error('同时间记录内容冲突');unchanged.push(record.targetId);continue;}
   }
   pending.push([file,record]);
  }
  for(const [file,record] of pending){atomic(file,record);written.push(record.targetId);}
  return {written,unchanged};
 }finally{rmdirSync(lock);}
}
/** Missing files are absent; invalid/expired files are failures with no offers. */
export function readDirectImports(dataDir,{now=Date.now()}={}){
 let dir;try{dir=directory(dataDir);}catch{return [];}
 if(!dir)return [];
 return targets().flatMap(target=>{
  const file=path.join(dir,target.id+'.json');
  try{if(!stat(file))return [];const record=parseJson(readFile(file));if(record.targetId!==target.id)throw new Error('文件身份不匹配');return [{target,...persisted(record,now)}];}
  catch{return [{target,targetId:target.id,status:'failed',checkedAt:null,offers:[]}];}
 });
}
