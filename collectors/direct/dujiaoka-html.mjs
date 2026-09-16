import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';

const ORIGIN='https://fufaka.shop';
export const DUJIAOKA_HTML_MAX_REQUESTS=20;
const invalid=()=>{throw Object.assign(new Error('独角数卡 HTML 目录或商品详情不完整'),{code:'INVALID_CATALOG'});};
const plain=value=>deliveryEvidence({productTitle:value}).productTitle;
function validateTarget(target){
  if(target?.origin!==ORIGIN||!(target.id==='fufaka'||isAuthorizedMerchantTarget(target)))invalid();
}
function productUrl(value,origin) {
  let url;try{url=new URL(value,origin);}catch{invalid();}
  if(url.origin!==origin||url.username||url.password||url.search||url.hash||!/^\/buy\/[1-9]\d{0,9}$/.test(url.pathname))invalid();
  return url.href;
}
export function parseDujiaokaCatalog(html,target){
  validateTarget(target);
  if(typeof html!=='string'||!html.includes('@独角数卡')||!html.includes('id="group-all"')||/\b(?:pagination|load-more|next-page)\b/i.test(html))invalid();
  const urls=[];
  for(const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    if(!/\/buy\//.test(match[1]))continue;
    urls.push(productUrl(match[1],target.origin));
  }
  const distinct=[...new Set(urls)];
  if(!distinct.length||distinct.length>DUJIAOKA_HTML_MAX_REQUESTS-2)invalid();
  return distinct;
}
export function parseDujiaokaProduct(html,url,target,capturedAt=new Date().toISOString()) {
  validateTarget(target);productUrl(url,target.origin);
  const id=new URL(url).pathname.split('/').at(-1);
  const form=html.match(/<form\b[^>]*id="buy-form"[^>]*>([\s\S]*?)<\/form>/i)?.[1];
  if(!form)invalid();
  const visibleName=plain(form.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
  const name=plain(html.match(/<meta\b[^>]*property="og:title"[^>]*content="([^"]*)"/i)?.[1]);
  const prices=[...form.matchAll(/<span\b[^>]*class="buy-price"[^>]*>\s*[¥￥]\s*(\d+(?:\.\d{1,2})?)\s*<\/span>/g)];
  const productId=form.match(/<input\b[^>]*name="gid"[^>]*value="(\d+)"/i)?.[1];
  const stock=plain(form).match(/库存\s*[（(]\s*(\d+)\s*[)）]/)?.[1];
  const description=html.match(/<div\b[^>]*class="card card-body buy-product"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div\b[^>]*class="modal fade"/i)?.[1];
  if(!name||name!==visibleName||id!==productId||prices.length!==1||!description||!Number.isFinite(Date.parse(capturedAt)))invalid();
  const price=Number(prices[0][1]);if(!Number.isFinite(price)||price<=0||price>1000000)invalid();
  const count=stock===undefined?null:Number(stock);if(count!==null&&!Number.isSafeInteger(count))invalid();
  // This legacy storefront has non-SKU bundle links. A single displayed price
  // does not establish which service is supplied; never select a brand by order.
  const brandCount=[/(?:chat\s*)?gpt|codex/i,/claude|克劳德/i,/gemini|谷歌/i,/grok/i].filter(pattern=>pattern.test(name)).length;
  if(brandCount>1||/免翻墙|镜像|三合一|二合一|多合一/.test(name))return null;
  return {offerId:`${target.id}:${id}`,sourceId:target.id,sourceName:target.name,storeName:target.name,title:name,
    price,listedPrice:price,priceBasis:'listed',currency:'CNY',status:count===0?'out_of_stock':count>0?'in_stock':'unknown',stockCount:count,
    url,capturedAt,extra:{catalogFormat:'dujiaoka-hyper-html',shopUrl:target.origin+'/',
      deliveryEvidence:deliveryEvidence({productTitle:name,description,descriptionScope:'product'}),
      priceEvidence:'原商品详情页公开标价；不使用批量价或划线价',stockEvidence:'原商品页公开库存声明，不代表履约保证'}};
}
export async function collectDujiaokaHtml(target,options={}) {
  validateTarget(target);
  const opts={allowedOrigins:[target.origin],fetchImpl:options.fetchImpl,timeoutMs:8000,maxBytes:512*1024,maxRedirects:0};
  let last=0;
  const read=async(url)=>{await(options.sleep||delay)(Math.max(0,1000-(Date.now()-last)));last=Date.now();return safeFetchText(url,opts);};
  let robots='';try{robots=await read(target.origin+'/robots.txt');}catch(error){if(error.status!==404)throw error;}
  if(robots.split(/\r?\n/).some(line=>/^\s*Disallow:\s*\S/i.test(line.split('#')[0])))throw Object.assign(new Error('独角数卡 HTML 公开页面读取受到限制'),{code:'ROBOTS_DISALLOWED'});
  const urls=parseDujiaokaCatalog(await read(target.origin+'/'),target),offers=[];
  for(const url of urls){const offer=parseDujiaokaProduct(await read(url),url,target,options.capturedAt);if(offer)offers.push(offer);}
  return offers;
}
