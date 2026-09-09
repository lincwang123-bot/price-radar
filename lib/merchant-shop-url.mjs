import {canonicalShopIdentity,MerchantApplicationError,validatedMerchantPayload} from './merchant-onboarding.mjs';
import {createPublicNetworkFetch} from './public-network-fetch.mjs';
import {safeFetchJson} from './safe-fetch.mjs';

const ORIGIN='https://www.16688.com.cn';
const fail=(status,message)=>{throw new MerchantApplicationError(status,message);};
// Only a platform shop alias can trigger a lookup. Every persisted identity is
// still a canonical /shop/S… URL, so aliases cannot create a second merchant.
function aliasOf(value){
 try{canonicalShopIdentity(value);return null;}catch(original){
  if(typeof value!=='string'||value.length>500)throw original;
  let url;try{url=new URL(value.trim());}catch{throw original;}
  if(url.protocol!=='https:'||!['16688.com.cn','www.16688.com.cn'].includes(url.hostname)||url.username||url.password||url.port||url.search||url.hash)throw original;
  const match=/^\/shop\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})\/?$/.exec(url.pathname);
  if(!match||/^(?:admin|api|shop|goods|login|register|order|orders)$/i.test(match[1]))throw original;
  return match[1];
 }
}
export function createMerchantShopUrlResolver({fetchFactory=createPublicNetworkFetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map(),attempts=new Map();let active=0;
 return async function resolve(value,{requestKey='operator'}={}){
  const alias=aliasOf(value);if(!alias)return value;
  const at=now();
  for(const [key,row] of cache)if(row.until<=at)cache.delete(key);
  for(const [key,row] of attempts)if(row.until<=at)attempts.delete(key);
  const prior=cache.get(alias);if(prior){if(prior.error)throw prior.error;return prior.url;}
  if(pending.has(alias))return pending.get(alias);
  if(active>=4)fail(503,'16688 店铺网址核对繁忙，请稍后重试。');
  const rate=attempts.get(requestKey)||{count:0,until:at+60000};
  if(rate.count>=6)fail(429,'店铺网址核对过于频繁，请一分钟后重试。');
  if(attempts.size>=256&&!attempts.has(requestKey))fail(503,'店铺网址核对繁忙，请稍后重试。');
  rate.count++;attempts.set(requestKey,rate);active++;
  const work=Promise.resolve().then(async()=>{
   try{
    const fetchImpl=fetchFactory(ORIGIN,{maxRequests:1,maxBytes:128*1024,timeoutMs:8000,totalTimeoutMs:8000});
    const p=await safeFetchJson(ORIGIN+'/shopApi/shop/detail',{fetchImpl,method:'POST',allowedMethods:['POST'],allowedOrigins:[ORIGIN],maxRedirects:0,timeoutMs:8000,maxBytes:128*1024,headers:{'content-type':'application/json','accept':'application/json','user-agent':'AiradarBot/1.0'},body:JSON.stringify({shop_no:alias})});
    if(p?.code!==1||!p.data)fail(422,'未找到这个 16688 店铺别名，请核对店铺主页地址。');
    const d=p.data;
    if(!/^S\d{1,20}$/.test(d.shop_no||'')||typeof d.shop_alias!=='string'||d.shop_alias.toLowerCase()!==alias.toLowerCase())fail(422,'16688 返回的店铺信息无法对应此别名，请使用 /shop/S数字 的店铺主页。');
    const url=ORIGIN+'/shop/'+d.shop_no;canonicalShopIdentity(url);
    cache.set(alias,{url,until:now()+60000});return url;
   }catch(error){
    const safe=error instanceof MerchantApplicationError?error:new MerchantApplicationError(503,'暂时无法核对 16688 店铺别名，请稍后重试，或使用 /shop/S数字 的店铺主页。');
    cache.set(alias,{error:safe,until:now()+10000});throw safe;
   }finally{active--;pending.delete(alias);while(cache.size>128)cache.delete(cache.keys().next().value);}
  });pending.set(alias,work);return work;
 };
}
export const resolveMerchantShopUrl=createMerchantShopUrlResolver();
export async function normalizeMerchantSubmission(payload,{applicant=null,resolveShopUrl=resolveMerchantShopUrl,requestKey}={}){
 if(!aliasOf(payload?.shopUrl))return payload;
 // Reject incomplete forms before using the platform's public metadata API.
 // The placeholder is validation-only; it is never stored or fetched.
 validatedMerchantPayload({...payload,...(applicant?{email:applicant.email,contact:applicant.contact}:{}),shopUrl:ORIGIN+'/shop/S1'});
 return {...payload,shopUrl:await resolveShopUrl(payload.shopUrl,{requestKey})};
}
