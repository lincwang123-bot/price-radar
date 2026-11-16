import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {createPublicNetworkFetch} from '../../lib/public-network-fetch.mjs';
import {htmlFailure,htmlText,readHtml} from '../../lib/public-catalog-html.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {robotsPolicy} from './public-html.mjs';

export const SMBD_X_SUBSCRIPTION_ORIGIN='https://subscriptionsmartbd.com';
export const SMBD_X_SUBSCRIPTION_PATH='/product/grok-x-subscription-bangladesh/';
const ORIGIN=SMBD_X_SUBSCRIPTION_ORIGIN,URL=ORIGIN+SMBD_X_SUBSCRIPTION_PATH;
const TIERS=['Plus','Premium','Super','Ultra'],BILLING=['Monthly','Yearly'];
const invalid=()=>{throw htmlFailure('SMBD 融合订阅变量、价格或交付证据不一致');};
const validTarget=target=>target?.origin===ORIGIN&&/^[a-zA-Z0-9_-]{1,100}$/.test(target.id||'')&&typeof target.name==='string'&&target.name.trim()&&target.name.length<=120;
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const content=node=>node?htmlText(node.parts.map(part=>typeof part==='string'?part:content(part)).join(' ')):'';
const hasType=(value,type)=>[value?.['@type']].flat().includes(type);
const amount=value=>/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(String(value))?Number(String(value).replaceAll(',','')):NaN;

// Woo embeds inert JSON in an HTML attribute. The generic text sanitizer has a
// 4K field limit and strips markup inside JSON strings, so decode exactly one
// bounded HTML-attribute layer here, never evaluate storefront scripts.
function variations(html){
  const forms=[...html.matchAll(/<form\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].filter(m=>/\bdata-product_variations\s*=/.test(m[0]));
  if(forms.length!==1)invalid();
  const match=forms[0][0].match(/\bdata-product_variations\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if(!match)invalid();
  const decoded=(match[1]??match[2]).replace(/&(?:#(x[0-9a-f]+|\d+)|quot|apos|amp|lt|gt|nbsp);/gi,(entity,code)=>{
    if(code){const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);if(n<=0||n>0x10ffff||n>=0xd800&&n<=0xdfff)invalid();return String.fromCodePoint(n);}
    return {'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' '}[entity.toLowerCase()];
  });
  let rows;try{rows=JSON.parse(decoded);}catch{invalid();}
  if(!Array.isArray(rows)||rows.length!==8)invalid();return rows;
}

export function parseSmbdXSubscription(html,target,capturedAt=new Date().toISOString()){
  if(!validTarget(target)||!Number.isFinite(Date.parse(capturedAt)))invalid();
  const doc=readHtml(html),rows=variations(html);
  const forms=doc.all.filter(n=>n.attrs['data-product_variations']);
  if(forms.length!==1||forms[0].attrs['data-product_id']!=='48929'||forms[0].attrs.action!==URL)invalid();
  const headings=doc.all.filter(n=>n.tag==='h1');
  if(headings.length!==1||content(headings[0])!=='The X Subscription (Grok + Cursor + X Premium)')invalid();
  for(const canonical of doc.all.filter(n=>n.tag==='link'&&n.attrs.rel==='canonical'))if(canonical.attrs.href!==URL)invalid();
  const products=doc.graph.filter(p=>hasType(p,'Product'));
  if(products.length!==1||products[0].sku!=='X-SUB-GROK-BD-26')invalid();
  const schema=products[0].offers;
  if(!hasType(schema,'AggregateOffer')||schema.url!==URL||schema.priceCurrency!=='BDT'||Number(schema.offerCount)!==rows.length
    ||!/^https?:\/\/schema.org\/(?:InStock|OutOfStock)$/.test(schema.availability||''))invalid();
  for(const [name,expected] of [['attribute_plan',TIERS],['attribute_billing',BILLING]]){
    const selects=descendants(forms[0]).filter(n=>n.tag==='select'&&n.attrs.name===name);
    if(selects.length!==1)invalid();
    const values=selects[0].children.filter(n=>n.tag==='option'&&n.attrs.value).map(n=>{if(content(n)!==n.attrs.value)invalid();return n.attrs.value;});
    if(values.length!==expected.length||expected.some(v=>!values.includes(v)))invalid();
  }
  const panels=doc.all.filter(n=>n.attrs.id==='tab-description');if(panels.length!==1)invalid();
  const parts=descendants(panels[0]).filter(n=>/^(?:h[23]|p|li|tr)$/.test(n.tag)).map(content).filter(Boolean);
  const terms=parts.join('\n');
  if(terms.length>30000||!terms.includes('individual Plus, Premium, Super and Ultra')
    ||!terms.includes('Keep the email/account details for the eligible Grok, Cursor or X account accessible.')
    ||!terms.includes('confirm the applicable activation or account-linking steps for your selected package')
    ||!terms.includes('purchased paid subscription/access remaining active during the purchased validity'))invalid();
  const warrantyStart=parts.findIndex(p=>p.includes('Warranty & Selling Price Notice'));
  if(warrantyStart<0)invalid();
  const warranty=parts.slice(warrantyStart).join('\n');
  // Keep the complete raw warranty separately (it mentions a plan becoming
  // "Free", not a free SKU). Fail closed on an overall denial rather than
  // letting that denial disappear from the classifier's concise evidence.
  for(const statement of warranty.split(/[\n.!?。！？]+/)){
    const denial=/\b(?:no|without)\s+(?:any\s+)?(?:warranty|after[- ]sales(?:\s+support)?)\b|\b(?:not|never)\s+(?:provide|offer|include)\s+(?:any\s+)?warranty\b|无质保|无售后|不提供质保|不支持售后/i.test(statement);
    const limited=/\b(?:for|against|on)\s+(?:(?:account|provider)\s+)?(?:bans?|restrictions?|usage limits?|outages?|device issues?|policy changes?)\b|(?:仅|只|针对).*(?:封号|用量限制|设备问题|政策变动)/i.test(statement);
    if(denial&&!limited)invalid();
  }
  const deliveryFees=parts.filter(p=>/^(?:Regular Delivery|Express Delivery|Express Fee):?\s/i.test(p)).join('\n');
  const policy=schema.hasMerchantReturnPolicy;
  if(policy?.applicableCountry!=='BD'||!/^https?:\/\/schema.org\/MerchantReturnNotPermitted$/.test(policy.returnPolicyCategory||''))invalid();
  const ids=new Set(),combinations=new Set(),offers=[];
  for(const row of rows){
    const tier=row.attributes?.attribute_plan,billing=row.attributes?.attribute_billing,key=`${tier}:${billing}`;
    if(!TIERS.includes(tier)||!BILLING.includes(billing)||Object.keys(row.attributes||{}).length!==2||combinations.has(key)
      ||!Number.isSafeInteger(row.variation_id)||row.variation_id<=0||ids.has(row.variation_id)
      ||row.sku!==`X-${{Plus:'PLU',Premium:'PRE',Super:'SUP',Ultra:'ULT'}[tier]}-${billing==='Monthly'?'M':'Y'}-26`
      ||!Number.isFinite(row.display_price)||row.display_price<=0||row.display_price>1000000||row.display_price!==amount(row.display_price)
      ||row.display_regular_price!==row.display_price||row.is_virtual!==true||row.is_downloadable!==false
      ||row.backorders_allowed!==false||row.min_qty!==1||row.max_qty!==1||row.is_sold_individually!=='yes'
      ||typeof row.is_in_stock!=='boolean'||typeof row.is_purchasable!=='boolean'||row.variation_is_active!==true||row.variation_is_visible!==true)invalid();
    ids.add(row.variation_id);combinations.add(key);
    const priceText=htmlText(row.price_html),priceMatch=priceText.match(/^([\d,]+(?:\.\d{1,2})?)\s*৳$/);
    if(!priceMatch||amount(priceMatch[1])!==row.display_price)invalid();
    const originalDescription=htmlText(row.variation_description);
    if(!originalDescription.startsWith(`The X Subscription ${tier} ${billing.toLowerCase()} plan.`))invalid();
    if(tier==='Plus'&&!originalDescription.includes('Grok Bot is not included.'))invalid();
    const title=`The X Subscription ${tier} · ${billing==='Monthly'?'1 个月':'12 个月'} · 人工代开通`;
    const description=`The X Subscription ${tier}。${billing==='Monthly'?'1 个月':'12 个月'}个人套餐；人工代充至买家现有账号，需符合原站账号关联条件。${originalDescription}`;
    const evidence=deliveryEvidence({productTitle:title,category:'X 融合订阅',description,descriptionScope:'product'});
    const url=new globalThis.URL(URL);url.searchParams.set('attribute_plan',tier);url.searchParams.set('attribute_billing',billing);
    offers.push({offerId:`${target.id}:${row.variation_id}`,sourceId:target.id,sourceName:target.name,storeName:target.name,title,category:'X 融合订阅',
      price:row.display_price,listedPrice:row.display_price,feeAmount:null,priceBasis:'listed',currency:'BDT',
      status:row.is_in_stock&&row.is_purchasable?'in_stock':'out_of_stock',stockCount:null,url:url.href,capturedAt,deliveryMode:null,
      extra:{publicProductId:'48929',publicVariantId:row.variation_id,publicProductCode:row.sku,originalTitle:content(headings[0]),
        originalVariantDescription:originalDescription,deliveryEvidence:evidence,publicDescription:evidence.description,publicTerms:terms,warrantyEvidence:warranty,
        returnPolicy:policy.returnPolicyCategory,returnPolicyCountry:'BD',
        priceEvidence:'原站 WooCommerce display_price 与该变体 price_html、BDT AggregateOffer 核对；付款手续费未知',
        deliveryFeeEvidence:deliveryFees+'\n交付/加急服务不等于付款手续费，不计入默认标价；付款手续费未验证',
        stockEvidence:'变体 is_in_stock/is_purchasable；未公布库存数量，max_qty=1 只是单笔购买限制',
        catalogFormat:'smbd-x-subscription-woocommerce',collectionMethod:'reviewed-public-html'}});
  }
  if(amount(schema.lowPrice)!==Math.min(...offers.map(o=>o.price))||amount(schema.highPrice)!==Math.max(...offers.map(o=>o.price))
    ||/InStock$/.test(schema.availability)!==offers.some(o=>o.status==='in_stock'))invalid();
  return offers;
}

export async function collectSmbdXSubscription(target,options={}){
  if(!validTarget(target))invalid();
  const deadline=Math.min(options.deadline||Infinity,Date.now()+30000);
  const fetchImpl=options.fetchImpl??createPublicNetworkFetch(ORIGIN,{maxRequests:2,totalTimeoutMs:30000});
  let policy,lastStart=0,count=0;
  const read=async url=>{
    if(![ORIGIN+'/robots.txt',URL].includes(url))invalid();
    if(policy&&!policy.allows(url))throw htmlFailure('SMBD robots 禁止读取','ROBOTS_DISALLOWED');
    if(++count>2)throw htmlFailure('SMBD 请求达到上限','COLLECTOR_LIMIT');
    const wait=Math.max(0,Math.max(1100,policy?.delay||0)-(Date.now()-lastStart));
    if(Date.now()+wait>=deadline)throw Error('SMBD 采集超时');
    await(options.sleep||delay)(wait);lastStart=Date.now();if(lastStart>=deadline)throw Error('SMBD 采集超时');
    await options.beforeRequest?.(url);
    return safeFetchText(url,{fetchImpl,allowedOrigins:[ORIGIN],allowedMethods:['GET'],method:'GET',credentials:'omit',maxRedirects:0,
      timeoutMs:Math.max(1,Math.min(10000,deadline-Date.now())),maxBytes:1024*1024,
      headers:{'user-agent':'AiradarBot/1.0 (+https://airadar.vip)',accept:'text/html,text/plain'}});
  };
  try{policy=robotsPolicy(await read(ORIGIN+'/robots.txt'));}catch(error){if(error.status!==404)throw error;policy=robotsPolicy('');}
  return parseSmbdXSubscription(await read(URL),target,options.capturedAt||new Date().toISOString());
}
