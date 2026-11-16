import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {createPublicNetworkFetch} from '../../lib/public-network-fetch.mjs';
import {discoverCatalog,htmlFailure,htmlText,publicPageUrl,readHtml} from '../../lib/public-catalog-html.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {subscriptionTerm} from '../../lib/subscription-term.mjs';
import {robotsPolicy} from './public-html.mjs';

export const DGT_X_SUBSCRIPTION_ORIGIN='https://dgtsell.com';
export const DGT_X_SUBSCRIPTION_MAX_REQUESTS=20;
const ORIGIN=DGT_X_SUBSCRIPTION_ORIGIN;
const invalid=()=>{throw htmlFailure('DGT 新版 X 订阅公开商品信息不完整或不一致');};
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const content=node=>node?htmlText(node.parts.map(part=>typeof part==='string'?part:content(part)).join(' ')):'';
const comparable=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// DGT renders the subtitle separator as a middle dot, but uses a vertical
// bar in its catalog and JSON-LD. Normalize only that presentation difference.
const comparableName=value=>comparable(value).replace(/·/g,'|');
const same=(a,b)=>comparableName(a)===comparableName(b);
const hasType=(value,type)=>[value?.['@type']].flat().some(v=>[type,`https://schema.org/${type}`,`http://schema.org/${type}`].includes(v));
const bundleName=value=>{
  const name=comparableName(value);
  if(!/^x订阅(?:plus|premium|super|ultra)\|/.test(name))return false;
  return name.includes('cursor')&&name.includes('grok')&&name.includes('x会员')&&name.includes('三合一')
    ||/^x订阅super\|cursor\+grok15倍额度\|官方\$100\/月$/.test(name)
    ||/^x订阅ultra\|cursor\+grok50倍额度\|官方\$200\/月$/.test(name);
};
const validTarget=target=>target?.origin===ORIGIN&&typeof target.id==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(target.id)
  &&typeof target.name==='string'&&target.name.trim()&&target.name.length<=120;
const detailUrl=value=>{
  const url=publicPageUrl(value,ORIGIN);
  return url&&/^\/products\/[a-zA-Z0-9_-]+$/.test(new URL(url).pathname)?url:null;
};
function amount(value){
  const text=String(value??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;
  const number=Number(text);return number>0&&number<=1000000?number:null;
}

// DGT deliberately has a short H1 and a separate subtitle. Keep all three
// independent identity checks: catalog title, visible H1+subtitle and JSON-LD.
export function parseDgtXProduct(html,entry,target,capturedAt){
  if(!validTarget(target)||detailUrl(entry?.url)!==entry.url||!bundleName(entry.name))invalid();
  const doc=readHtml(html),products=doc.graph.filter(row=>hasType(row,'Product'));
  const headings=doc.all.filter(node=>node.tag==='h1');
  if(products.length!==1||headings.length!==1)invalid();
  const product=products[0],heading=headings[0];
  const subtitles=heading.parent.children.filter(node=>node.tag==='p');
  if(subtitles.length!==1)invalid();
  const title=`${content(heading)}｜${content(subtitles[0])}`;
  if(!bundleName(title)||!same(title,entry.name)||!same(title,product.name))invalid();
  const offer=product.offers;
  if(!hasType(offer,'Offer')||Array.isArray(offer)||offer.priceCurrency!=='CNY'
    ||typeof product.sku!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(product.sku))invalid();
  const canonicals=doc.all.filter(node=>node.tag==='link'&&node.attrs.rel==='canonical');
  if(!product.url||!offer.url||!canonicals.length)invalid();
  for(const url of [product.url,offer.url,...canonicals.map(node=>node.attrs.href)])if(detailUrl(url)!==entry.url)invalid();
  const buyArea=heading.parent.parent;
  if(!buyArea||buyArea.tag==='root'||['main','body'].includes(buyArea.tag))invalid();
  const priceNodes=descendants(buyArea).filter(node=>node.attrs.class?.split(/\s+/).includes('price-text'));
  if(priceNodes.length!==1)invalid();
  const visiblePrice=content(priceNodes[0]).match(/^[¥￥]\s*(\d+(?:\.\d{1,2})?)$/);
  const price=amount(offer.price);
  if(!price||!visiblePrice||amount(visiblePrice[1])!==price||(entry.price!=null&&entry.price!==price))invalid();

  const buyText=content(buyArea),counts=[...buyText.matchAll(/仅剩\s*(\d+)\s*件/g)].map(match=>Number(match[1]));
  const soldOut=/已售罄|售罄|暂无库存|库存\s*(?:为|[:：])?\s*0(?:\s*件)?(?:\s|$)/.test(buyText);
  const inStock=['https://schema.org/InStock','http://schema.org/InStock'].includes(offer.availability);
  const outOfStock=['https://schema.org/OutOfStock','http://schema.org/OutOfStock','https://schema.org/SoldOut'].includes(offer.availability);
  if((!inStock&&!outOfStock)||counts.length>1||(counts.length&&(!Number.isSafeInteger(counts[0])||counts[0]<1))
    ||(inStock&&(soldOut||counts.length!==1))||(outOfStock&&(!soldOut||counts.length)))invalid();

  // Only the leading product-specific terms paragraph establishes delivery,
  // period and warranty. The following comparisons/FAQ mention other plans.
  const detailHeadings=doc.all.filter(node=>node.tag==='h2'&&content(node)==='商品详情');
  if(detailHeadings.length!==1)invalid();
  const paragraphs=descendants(detailHeadings[0].parent).filter(node=>node.tag==='p');
  const description=content(paragraphs[0]);
  if(!/^说明[：:]/.test(description)||description.length>1000
    ||!comparable(htmlText(product.description)).startsWith(comparable(description))
    ||!/本商品/.test(description)||!/成品号/.test(description)||!/人工开通/.test(description)
    ||subscriptionTerm(description)!=='1m')invalid();
  // The comparison model reads duration from the priced title. This suffix
  // is derived from the verified single-product terms, never the general FAQ.
  const displayTitle=`${title} · 1个月成品号`;
  const evidence=deliveryEvidence({productTitle:displayTitle,category:'X 融合订阅',description,descriptionScope:'product'});
  if(!evidence.description)invalid();
  const warranty=description.split(/(?<=[。；;])/).filter(line=>/质保|售后|保修|退款|不退|不换|warrant/i.test(line)).join('');
  return {offerId:`${target.id}:${product.sku}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
    title:displayTitle,category:'X 融合订阅',price,listedPrice:price,feeAmount:null,priceBasis:'listed',currency:'CNY',
    status:inStock?'in_stock':'out_of_stock',stockCount:inStock?counts[0]:0,url:entry.url,capturedAt,deliveryMode:'manual',
    extra:{deliveryEvidence:evidence,publicProductTitle:title,publicDescription:description,warrantyEvidence:warranty,
      priceEvidence:'公开商品页标价与 Product JSON-LD 一致；未验证付款手续费',
      stockEvidence:inStock?`公开商品页：仅剩 ${counts[0]} 件`:'公开商品页：售罄',
      catalogFormat:'dgt-x-subscription-public',collectionMethod:'structured-product'}};
}

export async function collectDgtXSubscription(target,options={}){
  if(!validTarget(target))invalid();
  const deadline=Math.min(options.deadline||Infinity,Date.now()+30000);
  const fetchImpl=options.fetchImpl??createPublicNetworkFetch(ORIGIN,{maxRequests:DGT_X_SUBSCRIPTION_MAX_REQUESTS,totalTimeoutMs:30000});
  let policy,lastStart=0,requests=0;
  const read=async url=>{
    if(new URL(url).origin!==ORIGIN||!['/robots.txt','/products'].includes(new URL(url).pathname)&&!detailUrl(url))invalid();
    if(policy&&!policy.allows(url))throw htmlFailure('DGT 公开页面读取被 robots 禁止','ROBOTS_DISALLOWED');
    if(++requests>DGT_X_SUBSCRIPTION_MAX_REQUESTS)throw htmlFailure('DGT 公开目录请求达到上限','COLLECTOR_LIMIT');
    const wait=Math.max(0,(policy?.delay||750)-(Date.now()-lastStart));
    if(Date.now()+wait>=deadline)throw new Error('DGT 公开目录采集超时');
    await(options.sleep||delay)(wait);lastStart=Date.now();
    if(lastStart>=deadline)throw new Error('DGT 公开目录采集超时');
    await options.beforeRequest?.(url);
    return safeFetchText(url,{fetchImpl,allowedOrigins:[ORIGIN],timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now())),
      maxBytes:1024*1024,maxRedirects:0,headers:{'user-agent':'AiradarBot/1.0 (+https://airadar.vip)',accept:'text/html,text/plain'}});
  };
  try{policy=robotsPolicy(await read(ORIGIN+'/robots.txt'));}catch(error){if(error.status!==404)throw error;policy=robotsPolicy('');}
  const html=await read(ORIGIN+'/products'),doc=readHtml(html),catalog=discoverCatalog(html,ORIGIN);
  // /products is the full public catalog. Category links need not be followed;
  // an actual next-page link means this bounded contract is no longer complete.
  if(catalog.catalogLinks.some(url=>new URL(url).search)||doc.all.some(node=>node.tag==='a'&&(node.attrs.rel==='next'||/^(?:下一页|next)$/i.test(content(node)))))invalid();
  for(const node of doc.all.filter(node=>node.tag==='a'&&node.attrs.href)){
    let card=node.parent;
    while(card.parent&&card.tag!=='article'&&!/(?:^|\s)product-card(?:\s|$)/.test(card.attrs.class||''))card=card.parent;
    const name=content(descendants(card).find(child=>/^h[23]$/.test(child.tag)));
    if(card.tag!=='root'&&bundleName(name)&&!detailUrl(node.attrs.href))invalid();
  }
  const entries=catalog.entries.filter(entry=>bundleName(entry.name));
  if(!entries.length)invalid();
  if(entries.length+requests>DGT_X_SUBSCRIPTION_MAX_REQUESTS)throw htmlFailure('DGT 公开目录请求达到上限','COLLECTOR_LIMIT');
  const offers=[],ids=new Set(),capturedAt=options.capturedAt||new Date().toISOString();
  for(const entry of entries){
    const offer=parseDgtXProduct(await read(entry.url),entry,target,capturedAt);
    if(ids.has(offer.offerId))invalid();ids.add(offer.offerId);offers.push(offer);
  }
  return offers;
}
