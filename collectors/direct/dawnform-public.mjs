import {safeFetchJson} from '../../lib/safe-fetch.mjs';
import {publicHttpsUrl} from '../../lib/public-network-fetch.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';

// Verified merchant reply: only the
// published static catalogue and its public product links; one GET per 10s.
export const DAWNFORM_ORIGIN='https://faka.dawnform.top';
export const DAWNFORM_CATALOG='/public-products.json';
export const DAWNFORM_INTERVAL_MS=10000;
const fail=message=>{throw Object.assign(new Error('静态商品目录：'+message),{code:'INVALID_CATALOG'});};
export function parseDawnformProducts(payload,target,capturedAt=new Date().toISOString()) {
 if(!isAuthorizedMerchantTarget(target)||target.origin!==DAWNFORM_ORIGIN)throw new Error('静态目录来源未授权');
 const updated=Date.parse(payload?.updated_at),now=Date.parse(capturedAt);
 if(payload?.currency!=='CNY'||payload?.site_key!=='self_b'||!Array.isArray(payload?.products)||payload.products.length>500
  ||!Number.isFinite(updated)||!Number.isFinite(now)||updated>now+300000||now-updated>1800000)fail('币种、来源、更新时间或商品数量无效');
 const seen=new Set();
 return payload.products.map(p=>{
  if(!p||typeof p.title!=='string'||!p.title.trim()||p.title.length>500||typeof p.available!=='boolean')fail('名称或在售状态缺失');
  if(['skus','variants','options'].some(k=>p[k]!==undefined&&(!Array.isArray(p[k])||p[k].length)))fail('多规格商品需要独立报价');
  const price=typeof p.price_cny==='string'&&/^\d+(?:\.\d{1,2})?$/.test(p.price_cny)?Number(p.price_cny):typeof p.price_cny==='number'?p.price_cny:NaN;
  if(!Number.isFinite(price)||price<=0||price>1000000||Math.abs(price*100-Math.round(price*100))>0.000001)fail('人民币价格无效');
  let url;try{url=publicHttpsUrl(p.url);}catch{fail('商品链接无效');}
  if(url.origin!==DAWNFORM_ORIGIN||url.search||url.hash||!/^\/products\/[a-zA-Z0-9_-]{1,200}$/.test(url.pathname))fail('商品链接超出公开目录范围');
  if(seen.has(url.href))fail('商品链接重复');seen.add(url.href);
  const title=p.title.trim();
  // quantity is an order quantity in this contract, not inventory. Preserve
  // available without inventing stock, subscription length or warranty.
  return {offerId:`${target.id}:${url.pathname.slice('/products/'.length)}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
   title,category:'',price,listedPrice:price,feeAmount:null,priceBasis:'listed',currency:'CNY',status:p.available?'in_stock':'out_of_stock',stockCount:null,
   url:url.href,capturedAt,expiresAt:null,deliveryMode:null,
   extra:{catalogUpdatedAt:new Date(updated).toISOString(),deliveryEvidence:deliveryEvidence({productTitle:title})}};
 });
}
export async function collectDawnformPublic(target,options={}) {
 if(!isAuthorizedMerchantTarget(target)||target.origin!==DAWNFORM_ORIGIN)throw new Error('静态目录来源未授权');
 const payload=await safeFetchJson(DAWNFORM_ORIGIN+DAWNFORM_CATALOG,{...options,allowedOrigins:[DAWNFORM_ORIGIN],maxRedirects:0,headers:{accept:'application/json'}});
 return parseDawnformProducts(payload,target,options.capturedAt);
}
