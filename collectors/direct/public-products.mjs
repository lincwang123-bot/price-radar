import {safeFetchJson} from '../../lib/safe-fetch.mjs';
import {publicHttpsUrl} from '../../lib/public-network-fetch.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';

const PATH='/api/v1/public/products',PAGE_SIZE=100,MAX_PAGES=5,MAX_PRODUCTS=500;
const fail=message=>{throw Object.assign(new Error('公开商品目录：'+message),{code:'INVALID_CATALOG'});};
const text=value=>typeof value==='string'?value.trim():'';
const integer=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const id=value=>typeof value==='number'&&Number.isSafeInteger(value)?String(value):text(value);
const list=payload=>[payload?.items,payload?.data?.items,payload?.data?.list,payload?.products].find(Array.isArray);

// A flat public catalogue is a separate contract from Dujiao's priced SKUs.
// Select exactly one array; compatibility aliases must never multiply offers.
export function isPublicProductsCatalog(payload){
 const items=list(payload);
 return !!items&&integer(payload?.total??payload?.data?.total)!==null&&items.every(p=>p&&id(p.id??p.slug)&&text(p.name??p.title)&&p.price!==undefined&&text(p.currency)&&text(p.product_url??p.url));
}
function pageData(payload,page){
 if(!isPublicProductsCatalog(payload)||payload.ok===false||payload.success===false)fail('商品字段不完整或接口返回失败');
 const items=list(payload),meta={};
 for(const key of ['page','page_size','total','count']){
  const values=[payload[key],payload.data?.[key]].filter(v=>v!==undefined);
  if(values.some(v=>integer(v)===null)||new Set(values).size>1)fail('分页字段无效或互相冲突：'+key);
  meta[key]=values[0];
 }
 if(meta.page!==page||!meta.page_size||meta.page_size>PAGE_SIZE||meta.total>MAX_PRODUCTS||items.length>meta.page_size||meta.count!==undefined&&meta.count!==items.length)fail('分页数量或页码不匹配');
 if(Math.ceil(meta.total/meta.page_size)>MAX_PAGES)fail('分页超过本轮读取限制');
 return {items,...meta};
}
function offerFor(p,target,capturedAt){
 const productId=id(p.id??p.slug),title=text(p.name??p.title);
 if(productId.length>200||title.length>500)fail('商品标识或名称过长');
 // A parent price may be a starting price. Do not invent a single SKU when
 // the directory explicitly reports variants but supplies no priced SKU data.
 if(['skus','variants','options'].some(k=>p[k]!==undefined&&(!Array.isArray(p[k])||p[k].length)))fail('多规格商品需要独立 SKU 报价');
 if(p.is_active===false||p.deleted_at||['INACTIVE','DRAFT','ARCHIVED','DELETED'].includes(p.product_status))return null;
 const price=typeof p.price==='number'?p.price:typeof p.price==='string'&&/^\d+(?:\.\d+)?$/.test(p.price)?Number(p.price):NaN;
 const currency=text(p.currency).toUpperCase();
 if(!Number.isFinite(price)||price<0||!(/^[A-Z]{3}$/.test(currency)))fail('价格或币种无效');
 if(p.price_cents!==undefined&&(integer(p.price_cents)===null||Math.abs(price*100-p.price_cents)>0.000001))fail('元与分的价格不一致');
 let url;try{url=publicHttpsUrl(text(p.product_url??p.url));}catch{fail('单品链接不是公开 HTTPS 地址');}
 if(url.origin!==target.origin)fail('单品链接超出店铺来源');
 const stocks=[p.stock,p.stock_count,p.available_count].filter(v=>v!==undefined);
 if(stocks.some(v=>integer(v)===null)||new Set(stocks).size>1)fail('库存数量无效或互相冲突');
 const stockCount=stocks[0]??null;
 const sold=p.is_sold_out===true||p.is_available===false||p.status==='out_of_stock'||stockCount===0;
 const status=sold?'out_of_stock':stockCount>0?'in_stock':p.status==='in_stock'?'in_stock':'unknown';
 if(price===0)return null;
 const description=[text(p.subtitle),text(p.description)].filter(Boolean).join('\n');
 const delivery=text(p.fulfillment_type??p.delivery_note).toLowerCase();
 return {offerId:`${target.id}:${productId}`,sourceId:target.id,sourceName:target.name,storeName:target.name,title,
  category:text(p.category_label??p.category),price,listedPrice:price,feeAmount:null,priceBasis:'listed',currency,status,stockCount,url:url.href,
  capturedAt,expiresAt:null,deliveryMode:['auto','manual'].includes(delivery)?delivery:null,
  extra:{deliveryEvidence:deliveryEvidence({productTitle:title,category:text(p.category_label??p.category),description,descriptionScope:'product'})}};
}
export async function collectPublicProducts(target,options={}){
 if(!isAuthorizedMerchantTarget(target))throw new Error('公开目录来源未授权');
 const origin=publicHttpsUrl(target.origin).origin;
 if(origin!==target.origin||!text(target.id)||!text(target.name))fail('来源资料无效');
 const capturedAt=options.capturedAt??new Date().toISOString(),seen=new Set(),offers=[];
 let total=null,size=null;
 for(let page=1;page<=MAX_PAGES;page++){
  const endpoint=new URL(PATH,origin);endpoint.searchParams.set('page',String(page));endpoint.searchParams.set('page_size',String(PAGE_SIZE));
  const payload=await safeFetchJson(endpoint.href,{allowedOrigins:[origin],fetchImpl:options.fetchImpl,timeoutMs:12000,maxBytes:1024*1024,maxRedirects:0,headers:{Accept:'application/json'}});
  const current=pageData(payload,page);
  if(total!==null&&(total!==current.total||size!==current.page_size))fail('翻页期间总数或分页大小变化');
  total=current.total;size=current.page_size;
  for(const p of current.items){
   const productId=id(p.id??p.slug);if(seen.has(productId))fail('分页商品 ID 重复');seen.add(productId);
   const offer=offerFor(p,target,capturedAt);if(offer)offers.push(offer);
  }
  if(seen.size>total)fail('商品数量超过总数');
  if(seen.size===total)return offers;
  if(current.items.length!==size)fail('目录未完整返回');
 }
 fail('分页超过本轮读取限制');
}
