import {deliveryEvidence} from './delivery-evidence.mjs';
import {htmlFailure,publicPageUrl} from './public-catalog-html.mjs';

export const PUBLIC_CENTS_ENDPOINT='/api/products';
const invalid=()=>{throw htmlFailure();};
const plain=value=>deliveryEvidence({description:value}).description;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Read linked public modules as text only. A named storefront, its API call,
// product route and imported CNY formatter must all agree before using cents.
// Static demo products in the formatter module are never inventory or prices.
export function publicCentsContract(script,moduleUrl,linkedModules){
 if(typeof script!=='string'||Buffer.byteLength(script)>1024*1024)return null;
 if(!/fetch\([`"']\/api\/products[`"']\)/.test(script)||!/\.products\b/.test(script)||!/\.categories\b/.test(script)
  ||!/href:[`"']\/products\/[`"']\+\w+\.id\b/.test(script))return null;
 const local=script.match(/children:\[[`"']¥[`"'],(\w+)\(\w+\.price\)\]/)?.[1];
 if(!local)return null;
 for(const match of script.matchAll(/import\{([^}]+)\}from["'](\.\/catalog-[\w-]+\.js)["']/g)){
  const binding=match[1].split(',').map(s=>s.trim()).find(s=>s===local||s.endsWith(' as '+local));
  if(!binding)continue;
  const url=new URL(match[2],moduleUrl),origin=new URL(moduleUrl).origin;
  if(publicPageUrl(url.href,origin,'script')!==url.href||!linkedModules.includes(url.href))continue;
  return {formatterUrl:url.href,exportName:binding.split(/\s+as\s+/)[0]};
 }
 return null;
}
export function confirmsCentsFormatter(script,contract){
 if(typeof script!=='string'||Buffer.byteLength(script)>1024*1024)return false;
 const exports=script.match(/export\{([^}]+)\}/)?.[1].split(',').map(s=>s.trim())||[];
 const binding=exports.find(s=>s===contract.exportName||s.endsWith(' as '+contract.exportName));
 if(!binding)return false;
 const local=escape(binding.split(/\s+as\s+/)[0]);
 return new RegExp(`(?:^|[,;\\s])${local}=(\\w+)=>\\(\\1/100\\)\\.toFixed\\(2\\)(?=[,;])`).test(script);
}

export function parsePublicCentsCatalog(payload,target,capturedAt){
 if(!payload||!Array.isArray(payload.products)||!Array.isArray(payload.categories)||payload.products.length>2000||payload.categories.length>100)invalid();
 if(payload.hasMore||payload.next||(payload.total!=null&&payload.total!==payload.products.length)||(payload.count!=null&&payload.count!==payload.products.length))throw htmlFailure('公开目录请求达到上限','COLLECTOR_LIMIT');
 const categories=new Map(),ids=new Set(),offers=[];
 for(const c of payload.categories){
  if(!c||typeof c.id!=='string'||!c.id||categories.has(c.id)||!plain(c.name)||typeof c.active!=='boolean')invalid();
  categories.set(c.id,c);
 }
 for(const row of payload.products){
  if(!row||typeof row.id!=='string'||!/^[\w-]{1,150}$/.test(row.id)||ids.has(row.id)||typeof row.active!=='boolean')invalid();
  ids.add(row.id);if(!row.active)continue;
  const category=categories.get(row.category);
  if(!category?.active||!plain(row.name)||!Number.isSafeInteger(row.price)||row.price<=0||row.price>100000000
   ||(row.currency!=null&&row.currency!=='CNY')||row.sku!=null||typeof row.canPurchase!=='boolean'
   ||!['available','sold_out','unknown'].includes(row.stockState)
   ||(row.stockQuantity!=null&&(!Number.isSafeInteger(row.stockQuantity)||row.stockQuantity<0)))invalid();
  if((row.stockState==='available'&&(!row.canPurchase||!(row.stockQuantity>0)))
   ||(row.stockState==='sold_out'&&(row.canPurchase||row.stockQuantity!==0))
   ||(row.stockState==='unknown'&&(row.canPurchase||row.stockQuantity!=null)))invalid();
  const evidence=deliveryEvidence({productTitle:row.name,category:category.name,description:[row.summary,row.description].filter(v=>typeof v==='string').join('\n'),descriptionScope:'product'});
  offers.push({offerId:`${target.id}:public-cents:${row.id}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
   title:evidence.productTitle,category:evidence.category,price:row.price/100,listedPrice:row.price/100,priceBasis:'listed',currency:'CNY',
   status:row.stockState==='available'?'in_stock':row.stockState==='sold_out'?'out_of_stock':'unavailable',stockCount:row.stockQuantity??null,
   url:`${target.origin}/products/${encodeURIComponent(row.id)}`,capturedAt,
   extra:{deliveryEvidence:evidence,publicDescription:evidence.description,
    warrantyEvidence:plain([row.name,...evidence.description.split(/(?<=[。；;\n])/)].filter(line=>/质保|售后|保修|不退|不换|退[款差]|warrant/i.test(line)).join('\n')),
    priceEvidence:'实时公开商品接口；已核对商品页面使用人民币分转元显示规则',stockEvidence:'实时 stockState、stockQuantity 与 canPurchase 相互核对',
    catalogFormat:'public-cents-catalog',collectionMethod:'linked-public-module'}});
 }
 return offers;
}
