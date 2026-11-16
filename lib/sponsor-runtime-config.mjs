import {readFileSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {resolve} from 'node:path';

const empty=Object.freeze({destinations:[],creatives:[]});
const cache=new Map();
const text=value=>typeof value==='string'&&value.length>0&&value.length<=2048;
function https(value){
 try{const url=new URL(value);return text(value)&&url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
const assetPattern=/^\/assets\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:jpe?g|webp|png)$/;
function destination(entry){
 if(!entry||!https(entry.destination)||!https(entry.websiteUrl)||!text(entry.merchantId)||!entry.merchantId.startsWith('domain:'))return null;
 if(entry.downloadKind!==undefined&&!text(entry.downloadKind)||entry.affiliate!==undefined&&typeof entry.affiliate!=='boolean')return null;
 return {destination:https(entry.destination),merchantId:entry.merchantId,websiteUrl:https(entry.websiteUrl),downloadKind:entry.downloadKind,affiliate:entry.affiliate};
}
function creative(entry){
 if(!entry||!text(entry.source)||!text(entry.merchant_id)||!Array.isArray(entry.destinations)||!entry.destinations.length||entry.destinations.some(value=>!https(value)))return null;
 if(!assetPattern.test(entry.image)||entry.imageWebp!==undefined&&!assetPattern.test(entry.imageWebp))return null;
 if(!Number.isInteger(entry.width)||entry.width<1||entry.width>10000||!Number.isInteger(entry.height)||entry.height<1||entry.height>10000)return null;
 const result={source:entry.source,merchant_id:entry.merchant_id,destinations:entry.destinations.map(https),image:entry.image,width:entry.width,height:entry.height};
 for(const key of ['placement','page_key','imageWebp','imageAlt','title','description','notice','action']){
  if(entry[key]!==undefined&&!text(entry[key]))return null;
  if(entry[key]!==undefined)result[key]=entry[key];
 }
 if(entry.telegram!==undefined){if(!https(entry.telegram))return null;result.telegram=https(entry.telegram);}
 return result;
}
// Server-owned JSON may live outside the checkout, for example in /etc/price-radar-example/.
// Configuration is cached for the process lifetime; restart after changing the file.
export function loadSponsorRuntimeConfig(path=process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG){
 if(!path)return empty;
 if(cache.has(path))return cache.get(path);
 let config=empty;
 try{
  const parsed=JSON.parse(readFileSync(path,'utf8'));
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))config={
   destinations:Array.isArray(parsed.destinations)?parsed.destinations.map(destination).filter(Boolean):[],
   creatives:Array.isArray(parsed.creatives)?parsed.creatives.map(creative).filter(Boolean):[],
  };
 }catch{/* Invalid or unavailable configuration leaves runtime overrides empty. */}
 cache.set(path,config);return config;
}
export function resetSponsorRuntimeConfigCache(){cache.clear();}
export function runtimeSponsorCreative(c){
 return loadSponsorRuntimeConfig().creatives.find(entry=>c&&entry.source===c.source&&entry.merchant_id===c.merchant_id&&entry.destinations.includes(c.destination_url)&&(!entry.placement||entry.placement===c.placement)&&(!entry.page_key||entry.page_key===c.page_key))||null;
}
export function runtimeSponsorAsset(pathname){
 const directory=process.env.AIRADAR_SPONSOR_ASSET_DIR;
 if(!directory||!assetPattern.test(pathname)||!loadSponsorRuntimeConfig().creatives.some(entry=>entry.image===pathname||entry.imageWebp===pathname))return null;
 let fd;
 try{
  fd=openSync(resolve(directory,pathname.slice('/assets/'.length)),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(!fstatSync(fd).isFile())return null;
  return {body:readFileSync(fd),type:pathname.endsWith('.webp')?'image/webp':pathname.endsWith('.png')?'image/png':'image/jpeg'};
 }catch{return null;}finally{if(fd!==undefined)closeSync(fd);}
}
