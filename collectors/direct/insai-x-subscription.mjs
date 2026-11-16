import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchJson,safeFetchText} from '../../lib/safe-fetch.mjs';
import {createPublicNetworkFetch} from '../../lib/public-network-fetch.mjs';
import {htmlFailure,htmlText,readHtml} from '../../lib/public-catalog-html.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {isXSubscription,xSubscriptionTier} from '../../lib/x-subscription-products.mjs';
import {robotsPolicy} from './public-html.mjs';

export const INSAI_X_SUBSCRIPTION_ORIGIN='https://www.inswindai.com';
export const INSAI_X_SUBSCRIPTION_MAX_REQUESTS=12;
const ORIGIN=INSAI_X_SUBSCRIPTION_ORIGIN,ENDPOINT='/api/products?q=Grok';
const invalid=()=>{throw htmlFailure('INSAI 新融合商品身份、规格或价格不完整/不一致');};
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validTarget=target=>target?.origin===ORIGIN&&validId(target.id)&&typeof target.name==='string'&&target.name.trim()&&target.name.length<=120;
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const content=node=>node?htmlText(node.parts.map(part=>typeof part==='string'?part:content(part)).join(' ')):'';
const same=(a,b)=>String(a??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase()===String(b??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();

function validateProduct(row){
  if(!row||!validId(row.id)||!validId(row.code)||typeof row.name!=='string'||!row.name.trim()||row.name.length>500
    ||typeof row.description!=='string'||row.description.length>4000||row.category?.active!==true
    ||!Number.isSafeInteger(row.priceCny)||row.priceCny<=0||row.priceCny>100000000
    ||row.unitMicro!=null||row.minQty!=null||row.fulfillmentType!=='account'
    ||(row.stock!==null&&(!Number.isSafeInteger(row.stock)||row.stock<0))
    ||['variants','skus','options'].some(key=>row[key]!=null&&(!Array.isArray(row[key])||row[key].length)))invalid();
}

// The public detail's server-rendered purchase component carries the exact
// product ID/code/price. Decode only JSON strings; never evaluate Next scripts
// or visit account, checkout, order or fulfillment endpoints.
function purchaseProps(html){
  const chunks=[];
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    const call=match[1].trim().match(/^self\.__next_f\.push\((\[[\s\S]*\])\);?$/);
    if(!call)continue;
    let value;try{value=JSON.parse(call[1]);}catch{invalid();}
    if(value[0]===1&&typeof value[1]==='string')chunks.push(value[1]);
  }
  const found=[];let visited=0;
  function visit(value,depth=0){
    if(++visited>50000||depth>60)invalid();
    if(!value||typeof value!=='object')return;
    if(!Array.isArray(value)&&Object.hasOwn(value,'productId')&&Object.hasOwn(value,'priceCny'))found.push(value);
    for(const child of Object.values(value))visit(child,depth+1);
  }
  for(const line of chunks.join('').split('\n')){
    const json=line.match(/^[a-z0-9]+:([\[{].*)$/i)?.[1];if(!json)continue;
    let value;try{value=JSON.parse(json);}catch{continue;}
    visit(value);
  }
  if(found.length!==1)invalid();return found[0];
}

// Verified 2026-10-18 from /shop's linked public modules: page-e24450bf6576ae7a
// fetches /api/products?q=...; ProductGrid module 4668 links /shop/<id> and calls
// module 4269.Mm(priceCny). In layout-4e9d2eb36d13ebbe.js Mm exports the function
// returning "¥".concat((e/100).toFixed(2)). Re-check every converted price against
// the same product's visible current price, never a crossed-out/related price.
// The UI's sold count is a code-derived hash, NOT observed sales or inventory.
export function parseInsaiXProduct(html,row,target,capturedAt=new Date().toISOString()){
  if(!validTarget(target)||!Number.isFinite(Date.parse(capturedAt)))invalid();validateProduct(row);
  if(!isXSubscription(row.name))invalid();
  const doc=readHtml(html),props=purchaseProps(html);
  for(const [key,value] of Object.entries({productId:row.id,productCode:row.code,productName:row.name,priceCny:row.priceCny,fulfillmentType:row.fulfillmentType,stock:row.stock})){
    if(props[key]!==value)invalid();
  }
  const headings=doc.all.filter(node=>node.tag==='h1');
  if(headings.length!==1||!same(content(headings[0]),row.name))invalid();
  const detailHeadings=doc.all.filter(node=>node.tag==='h2'&&content(node)==='这件商品，你需要知道的');
  if(detailHeadings.length!==1)invalid();
  let scope=detailHeadings[0].parent;
  while(scope&&scope.tag!=='main'&&scope.tag!=='body'&&scope.tag!=='root'&&!descendants(scope).some(node=>node.tag==='li'))scope=scope.parent;
  if(!scope||['root','main','body'].includes(scope.tag)||descendants(scope).filter(node=>node.tag==='h2').length!==1)invalid();
  const fields=descendants(scope).filter(node=>node.tag==='li').flatMap(node=>{
    const spans=node.children.filter(child=>child.tag==='span'),paragraphs=node.children.filter(child=>child.tag==='p');
    return spans.length===1&&paragraphs.length===1?[[content(spans[0]),content(paragraphs[0])]]:[];
  });
  const field=label=>{const values=fields.filter(([key])=>key===label).map(([,value])=>value);if(values.length!==1||!values[0])invalid();return values[0];};
  const specifications=fields.filter(([label,value])=>label==='规格'&&/The X Subscription/i.test(value)).map(([,value])=>value);
  if(specifications.length!==1)invalid();
  const specification=specifications[0];
  const tier=specification.match(/^(?:xAI\s*新版三合一[（(])?(?:The\s+)?X\s+Subscription[）)]?\s*(Plus|Premium|Super|Ultra)\s*档[：:]/i)?.[1];
  const titleTier=row.name.match(/\b(?:Grok|(?:The\s+)?X\s+Subscription)\s+(Plus|Premium|Super|Ultra)\b/i)?.[1];
  if(!tier||!same(tier,titleTier)||!/[、\s]Grok[、\s]/i.test(specification)||!/\bCursor\b/i.test(specification)
    ||!(/\bX\s+Premium\b|\bTwitter\b|推特/.test(specification))||/不含|不包含|旧版|不提供|并非|不是/.test(specification))invalid();
  const period=field('时长'),delivery=field('拿到'),warranty=field('质保');
  if(!/^(?:1\s*个?月|一个月)[。. ]?$/.test(period)||!/(?:成品|独享)账号/.test(delivery)||/共享|合租|多人|拼车/.test(delivery))invalid();
  const labels=doc.all.filter(node=>node.tag==='p'&&content(node).startsWith('当前商品价格'));
  if(labels.length!==1)invalid();
  const buy=labels[0].parent,nodes=descendants(buy);
  const prices=nodes.filter(node=>node.tag==='p'&&/^[¥￥]/.test(content(node))).map(content);
  if(prices.length!==1||!same(prices[0],`¥${(row.priceCny/100).toFixed(2)}`))invalid();
  const soldOut=nodes.some(node=>node.tag==='span'&&/^(?:售罄|已售罄|缺货)$/.test(content(node)));
  const forSale=nodes.some(node=>node.tag==='span'&&content(node)==='在售');
  if(soldOut===forSale||(row.stock===0&&!soldOut)||(row.stock>0&&!forSale))invalid();
  const title=`The X Subscription ${tier} · ${row.name}`;
  // Canonical first sentence names the verified plan, not the component
  // benefit “X Premium”. Keep the merchant's complete original terms below.
  const description=[`The X Subscription ${tier}。`,specification,`交付：${delivery}`,`期限：${period}`,`质保：${warranty}`].join('\n');
  const evidence=deliveryEvidence({productTitle:title,category:'X 融合订阅',description,descriptionScope:'product'});
  if(!evidence.description||xSubscriptionTier({title,extra:{deliveryEvidence:evidence}})!==tier.toLowerCase())invalid();
  return {offerId:`${target.id}:${row.id}`,sourceId:target.id,sourceName:target.name,storeName:target.name,title,
    category:'X 融合订阅',price:row.priceCny/100,listedPrice:row.priceCny/100,feeAmount:null,priceBasis:'listed',currency:'CNY',
    status:soldOut?'out_of_stock':'in_stock',stockCount:row.stock,url:`${ORIGIN}/shop/${row.id}`,capturedAt,deliveryMode:null,
    extra:{originalTitle:row.name,publicProductId:row.id,publicProductCode:row.code,deliveryEvidence:evidence,
      publicDescription:evidence.description,warrantyEvidence:warranty,
      priceEvidence:'匿名公开 API priceCny 分转元，与同商品详情当前标价交叉核对；未验证付款手续费',
      stockEvidence:'商品详情在售/售罄与公开 stock 核对；未公开数量时保留未知，不采用展示销量',
      catalogFormat:'insai-x-subscription-public',collectionMethod:'reviewed-public-module'}};
}

function candidates(payload){
  if(!payload||!Array.isArray(payload.products)||payload.error||payload.success===false||payload.products.length>100
    ||payload.next||payload.hasMore||payload.nextCursor||(payload.total!=null&&payload.total!==payload.products.length))invalid();
  const ids=new Set(),codes=new Set(),selected=[];
  for(const row of payload.products){
    if(!validId(row?.id)||!validId(row.code)||ids.has(row.id)||codes.has(row.code)||typeof row.name!=='string')invalid();
    ids.add(row.id);codes.add(row.code);
    if(isXSubscription(row.name)){validateProduct(row);selected.push(row);}
  }
  if(!selected.length)invalid();
  if(selected.length>INSAI_X_SUBSCRIPTION_MAX_REQUESTS-2)throw htmlFailure('INSAI 新融合详情超过本轮上限','COLLECTOR_LIMIT');
  return selected;
}

export async function collectInsaiXSubscription(target,options={}){
  if(!validTarget(target))invalid();
  const deadline=Math.min(options.deadline||Infinity,Date.now()+30000);
  const fetchImpl=options.fetchImpl??createPublicNetworkFetch(ORIGIN,{maxRequests:INSAI_X_SUBSCRIPTION_MAX_REQUESTS,totalTimeoutMs:30000});
  let policy,lastStart=0,requests=0;
  const read=async (url,json=false)=>{
    const parsed=new URL(url);
    if(parsed.origin!==ORIGIN||!['/robots.txt',ENDPOINT].includes(parsed.pathname+parsed.search)&&!/^\/shop\/[a-zA-Z0-9_-]{1,100}$/.test(parsed.pathname+parsed.search))invalid();
    if(policy&&!policy.allows(url))throw htmlFailure('INSAI 公开读取被 robots 禁止','ROBOTS_DISALLOWED');
    if(++requests>INSAI_X_SUBSCRIPTION_MAX_REQUESTS)throw htmlFailure('INSAI 请求达到上限','COLLECTOR_LIMIT');
    const wait=Math.max(0,Math.max(1100,policy?.delay||0)-(Date.now()-lastStart));
    if(Date.now()+wait>=deadline)throw Error('INSAI 公开目录采集超时');
    await(options.sleep||delay)(wait);lastStart=Date.now();
    if(lastStart>=deadline)throw Error('INSAI 公开目录采集超时');
    await options.beforeRequest?.(url);
    return (json?safeFetchJson:safeFetchText)(url,{fetchImpl,allowedOrigins:[ORIGIN],allowedMethods:['GET'],method:'GET',credentials:'omit',
      timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now())),maxBytes:1024*1024,maxRedirects:0,
      headers:{'user-agent':'AiradarBot/1.0 (+https://airadar.vip)',accept:json?'application/json':'text/html,text/plain'}});
  };
  // Deliberately re-read policies each attempt; access denials never fall back.
  try{policy=robotsPolicy(await read(ORIGIN+'/robots.txt'));}catch(error){if(error.status!==404)throw error;policy=robotsPolicy('');}
  const rows=candidates(await read(ORIGIN+ENDPOINT,true)),offers=[];
  const capturedAt=options.capturedAt||new Date().toISOString();
  for(const row of rows)offers.push(parseInsaiXProduct(await read(`${ORIGIN}/shop/${row.id}`),row,target,capturedAt));
  return offers;
}
