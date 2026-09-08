import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {deliveryForm} from '../../lib/offer-spec.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';

const ORIGIN='https://www.bbshare.site';
// robots + home + at most 18 listed detail pages; never access the disallowed /api/.
export const BBSHARE_MAX_REQUESTS=20;
const invalid=()=>{throw Object.assign(new Error('BBShare 公开商品目录信息不完整或不一致'),{code:'INVALID_CATALOG'});};
function validateTarget(target){
 if(target?.origin!==ORIGIN||!(target.id==='bbshare'||isAuthorizedMerchantTarget(target)))throw Object.assign(new Error('BBShare 目标未登记'),{code:'PREFLIGHT_INTERNAL_ERROR'});
}
const plain=value=>deliveryEvidence({productTitle:value}).productTitle;
const comparableName=value=>value.replace(/ChatGPT/gi,'GPT').replace(/代充/g,'').replace(/[\s·]/g,'').toLowerCase();
function graph(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>512*1024)invalid();
 const blocks=[...html.matchAll(/<script\b[^>]*id=["']bbshare-prerender-jsonld["'][^>]*>([\s\S]*?)<\/script>/gi)];
 if(blocks.length!==1)invalid();
 try {const payload=JSON.parse(blocks[0][1]);if(!Array.isArray(payload['@graph'])||payload['@graph'].length>20)invalid();return payload['@graph'];}
 catch{invalid();}
}
function productUrl(value){
 if(typeof value!=='string'||!/^https:\/\/www\.bbshare\.site\/products\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)||value.length>200)invalid();
 return value;
}
export function parseBBShareCatalog(html){
 const lists=graph(html).filter(row=>row?.['@type']==='ItemList');
 if(lists.length!==1||!Array.isArray(lists[0].itemListElement))invalid();
 const rows=lists[0].itemListElement;
 if(rows.length<1||rows.length>BBSHARE_MAX_REQUESTS-2)invalid();
 const urls=rows.map(row=>{if(row?.['@type']!=='ListItem'||!plain(row.name))invalid();return productUrl(row.url);});
 if(new Set(urls).size!==urls.length)invalid();
 return urls;
}
export function parseBBShareProduct(html,url,target,capturedAt=new Date().toISOString()){
 validateTarget(target);productUrl(url);
 const products=graph(html).filter(row=>row?.['@type']==='Product');
 if(products.length!==1)invalid();
 const product=products[0],offer=product.offers,name=plain(product.name),category=plain(product.brand?.name);
 const price=Number(offer?.price),slug=url.split('/').at(-1);
 const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||'';
 const visibleName=plain(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
 const visiblePrice=main.match(/<strong\b[^>]*>微信支付[¥￥](\d+(?:\.\d+)?)<\/strong>/)?.[1];
 if(!name||!category||comparableName(name)!==comparableName(visibleName)||product.sku!==slug||offer?.['@type']!=='Offer'||offer.url!==url||offer.priceCurrency!=='CNY'
  ||!/^(?:\d+)(?:\.\d{1,2})?$/.test(String(offer.price))||!Number.isFinite(price)||price<=0||price>1000000||!visiblePrice||Number(visiblePrice)!==price)invalid();
 const field=label=>plain(main.match(new RegExp(`<dt>${label}</dt>\\s*<dd>([\\s\\S]*?)<\\/dd>`))?.[1]);
 const duration=field('订阅周期'),warranty=field('质保期限');
 if(!duration||!warranty)invalid();
 // The site's account description mechanically appends “代充”. Its explicit
 // product title is stronger evidence; never let that template turn an account into recharge.
 const evidence=deliveryEvidence({productTitle:name,category,description:/成品(?:号|账号)|共享/.test(name)?'':product.description,descriptionScope:'product'});
 const delivery=deliveryForm({title:name,category,extra:{deliveryEvidence:evidence}});
 const status={'https://schema.org/InStock':'in_stock','https://schema.org/OutOfStock':'out_of_stock','https://schema.org/SoldOut':'out_of_stock'}[offer.availability]||'unknown';
 return {offerId:`bbshare:${slug}`,sourceId:target.id,sourceName:target.name||'BBShare',storeName:target.name||'BBShare',
  title:[name.toLowerCase().includes(category.toLowerCase())?'':category,name,name.replace(/\s/g,'').includes(duration.replace(/\s/g,''))?'':duration,delivery==='代充'&&!name.includes('代充')?'代充':'',`质保${warranty}`].filter(Boolean).join(' · '),category,price,listedPrice:price,priceBasis:'listed',currency:'CNY',status,stockCount:status==='out_of_stock'?0:null,
  url,capturedAt,extra:{deliveryEvidence:evidence,priceEvidence:'公开商品页标价与结构化价格一致；实际成交以原店为准',stockEvidence:'仅依据公开商品页的 availability 声明，不代表履约核验',warrantyEvidence:`公开页面声明：${warranty}`,catalogFormat:'bbshare-public-html'}};
}
function allowedRobots(text){
 // Fail closed on new restrictions or unrecognized relevant groups. These are
 // the storefront's observed explicit rules, not a robots bypass/fallback.
 const lines=text.split(/\r?\n/).map(line=>line.split('#')[0].trim()).filter(Boolean);
 let wildcard=false,allow=false;
 for(const line of lines){
  if(/^User-agent:/i.test(line)){if(!/^User-agent:\s*\*$/i.test(line))return false;wildcard=true;}
  else if(/^Allow:/i.test(line)){if(!wildcard||!/^Allow:\s*\/$/i.test(line))return false;allow=true;}
  else if(/^Disallow:/i.test(line)&&!/^Disallow:\s*\/(?:api\/|admin\/?)(?:\s*)$/i.test(line))return false;
  else if(!/^(?:Disallow|Sitemap):/i.test(line))return false;
 }
 return wildcard&&allow;
}
export async function collectBBShare(target,options={}){
 validateTarget(target);
 if(isAuthorizedMerchantTarget(target)&&typeof options.fetchImpl!=='function')throw new Error('BBShare 动态目标需要受限读取器');
 const fetchOptions={allowedOrigins:[ORIGIN],fetchImpl:options.fetchImpl,timeoutMs:8000,maxBytes:512*1024,maxRedirects:0};
 const sleep=options.sleep||delay;
 let lastStart=0;
 const read=async url=>{await sleep(Math.max(0,1000-(Date.now()-lastStart)));lastStart=Date.now();return safeFetchText(url,fetchOptions);};
 const robots=await read(ORIGIN+'/robots.txt');
 if(!allowedRobots(robots))throw Object.assign(new Error('BBShare 公开页面读取规则未明确允许'),{code:'ROBOTS_DISALLOWED'});
 const urls=parseBBShareCatalog(await read(ORIGIN+'/')),offers=[];
 for(const url of urls){
  offers.push(parseBBShareProduct(await read(url),url,target,options.capturedAt));
 }
 return offers; // Any missing/mismatched detail fails the whole attempt; no partial catalogue.
}
