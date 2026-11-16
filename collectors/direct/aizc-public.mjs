import {safeFetchJson} from '../../lib/safe-fetch.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';

export const AIZC_ORIGIN='https://www.aizc.club';
export const AIZC_MAX_REQUESTS=11; // robots + at most ten public list pages
const fail=message=>{throw Object.assign(new Error('AIZC 公开目录：'+message),{code:'INVALID_CATALOG'});};
function authorized(target) {
 if(!isAuthorizedMerchantTarget(target)||target.origin!==AIZC_ORIGIN)fail('来源未授权');
}
function text(value) {
 if(typeof value==='string')return value.trim();
 if(!value||typeof value!=='object'||Array.isArray(value))return '';
 return ['zh-CN','zh_CN','zh-TW','zh','en-US','en'].map(k=>value[k]).find(v=>typeof v==='string'&&v.trim())?.trim()||'';
}
function money(value) {
 if(!['string','number'].includes(typeof value)||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))fail('人民币价格无效');
 const n=Number(value);if(!Number.isFinite(n)||n<=0||n>1000000)fail('人民币价格无效');return n;
}
function identifier(value) {
 if(!['string','number'].includes(typeof value)||!String(value).trim()||String(value).length>200||String(value).includes(':'))fail('商品或 SKU 标识无效');
 return String(value);
}
function pagination(payload,page) {
 const p=payload?.pagination;
 if(![0,200].includes(payload?.status_code)||!Array.isArray(payload?.data)||!p)fail('响应格式无效');
 if(![p.page,p.page_size,p.total,p.total_page].every(Number.isSafeInteger)||p.page!==page||p.page_size!==100
  ||p.total<0||p.total>500||p.total_page<1||p.total_page>10||p.total_page!==Math.max(1,Math.ceil(p.total/100))
  ||page>p.total_page||payload.data.length!==Math.min(100,Math.max(0,p.total-(page-1)*100)))fail('分页或商品数量无效');
 return p;
}
function displayTitle(sku) {
 // Only explicit customer-facing fields qualify; inventory codes never do.
 for(const value of [sku.title,sku.name,sku.label,sku.spec]){
  const title=text(value);
  if(title&&!/^(?:default|默认(?:规格)?|\d+-G\d+|sku[-_ ]?\d+)$/i.test(title))return title;
 }
 return '';
}
export function parseAizcProducts(payload,target,capturedAt=new Date().toISOString(),page=1) {
 authorized(target);pagination(payload,page);
 if(!Number.isFinite(Date.parse(capturedAt)))fail('采集时间无效');
 const seen=new Set(),ids=new Set(),offers=[];
 for(const product of payload.data){
  const productId=identifier(product?.id),title=text(product.title),slug=product.slug;
  if(!title||title.length>500||typeof slug!=='string'||!slug||slug.length>200||/[\s/\\%?#\u0000-\u001f]/u.test(slug)||slug==='.'||slug==='..')fail('商品名称或链接无效');
  if(seen.has(slug)||ids.has(productId))fail('商品链接或标识重复');seen.add(slug);ids.add(productId);
  if(!Array.isArray(product.skus)||!product.skus.length||product.skus.length>100)fail('SKU 列表无效');
  const active=product.skus.filter(s=>s&&s.is_active!==false),skuIds=new Set();
  for(const sku of active){
   const skuId=identifier(sku.id),price=money(sku.price_amount),skuTitle=displayTitle(sku);
   if(skuIds.has(skuId))fail('SKU 标识重复');skuIds.add(skuId);
   if(active.length>1&&!skuTitle)fail('多规格商品缺少公开规格名称');
   if(product.price_amount!==undefined&&money(product.price_amount)!==price)fail('商品与 SKU 价格不一致');
   const deliveryMode=['auto','manual'].includes(product.fulfillment_type)?product.fulfillment_type:null;
   const state=`${sku.stock_status||''} ${product.stock_status||''}`;
   let stockCount=null;
   if(!/unlimited/i.test(state)){
    const count=deliveryMode==='auto'?sku.auto_stock_available:deliveryMode==='manual'?sku.manual_stock_available:null;
    if(Number.isSafeInteger(count)&&count>=0)stockCount=count;
   }
   const status=sku.is_sold_out===true||product.is_sold_out===true||/out[_ -]?of[_ -]?stock|sold[_ -]?out/i.test(state)||stockCount===0?'out_of_stock':/low[_ -]?stock/i.test(state)?'low_stock':stockCount>0||/unlimited|in[_ -]?stock|available/i.test(state)?'in_stock':'unknown';
   offers.push({offerId:`${target.id}:${productId}:${skuId}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
    title:skuTitle||title,category:text(product.category?.name),price,listedPrice:price,feeAmount:null,priceBasis:'listed',currency:'CNY',
    status,stockCount,url:`${AIZC_ORIGIN}/products/${encodeURIComponent(slug)}`,capturedAt,expiresAt:null,deliveryMode,
    extra:{deliveryEvidence:deliveryEvidence({productTitle:title,skuTitle,description:text(product.description),descriptionScope:active.length===1?'product':'product_multi'})}});
  }
 }
 return offers;
}
export async function collectAizcPublic(target,options={}) {
 authorized(target);
 const offers=[],slugs=new Set(),ids=new Set();let expected;
 for(let page=1;page<=10;page++){
  const payload=await safeFetchJson(`${AIZC_ORIGIN}/api/v1/public/products?page=${page}&page_size=100`,{
   ...options,allowedOrigins:[AIZC_ORIGIN],maxRedirects:0,headers:{accept:'application/json'}});
  const p=pagination(payload,page);
  if(expected&&(expected.total!==p.total||expected.total_page!==p.total_page))fail('分页总数变化');expected=p;
  const rows=parseAizcProducts(payload,target,options.capturedAt,page);
  for(const product of payload.data){
   if(slugs.has(product.slug)||ids.has(String(product.id)))fail('跨页商品重复');slugs.add(product.slug);ids.add(String(product.id));
  }
  offers.push(...rows);
  if(page===p.total_page)return offers;
 }
 fail('分页超过上限');
}
