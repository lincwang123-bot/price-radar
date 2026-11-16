import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchJson,safeFetchText} from '../../lib/safe-fetch.mjs';
import {createPublicNetworkFetch} from '../../lib/public-network-fetch.mjs';
import {htmlFailure,htmlText,readHtml} from '../../lib/public-catalog-html.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {merchantUrlBlocked} from '../../lib/merchant-blocklist.mjs';
import {robotsPolicy} from './public-html.mjs';

const CATFK='https://catfk.com',TIERS=['Plus','Premium','Super','Ultra'];
export const CHONG_X_SUBSCRIPTION_MAX_REQUESTS=7;
// Reviewed original-page -> checkout links and checkout merchant identities.
// Prices are deliberately not stored here: both current public sources must agree.
const SITES=Object.freeze({
  'https://chonggrok.com':{token:'chonggrok.com',keys:['lqv3wb','ivo8jk','i775fl','s4k30d'],section:'joint-plans',structured:true},
  'https://chongai.pro':{token:'XITC8AKP',keys:['yfr72m','7tsryw','r8ooh5','cfw289'],section:'plans',structured:false},
});
const invalid=()=>{throw htmlFailure('Chong 新版 X 联合订阅的原站与公开结算商品信息不一致');};
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const content=node=>node?htmlText(node.parts.map(part=>typeof part==='string'?part:content(part)).join(' ')):'';
const hasType=(value,type)=>[value?.['@type']].flat().some(t=>[type,`https://schema.org/${type}`,`http://schema.org/${type}`].includes(t));
const siteFor=target=>{
  const site=SITES[target?.origin];
  if(!site||typeof target.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(target.id)
    ||typeof target.name!=='string'||!target.name.trim()||target.name.length>120)invalid();
  return site;
};
const amount=value=>{
  const text=String(value??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;
  const number=Number(text);return number>0&&number<=1000000?number:null;
};

// Next/React sends this page in an initially hidden, subsequently completed
// segment. Interpret only the exact reviewed completion marker; execute no JS
// and never make arbitrary hidden nodes or unresolved stream segments visible.
function completedHtml(html){
  if(typeof html!=='string'||Buffer.byteLength(html)>1024*1024)throw htmlFailure('公开目录响应超过限制','COLLECTOR_LIMIT');
  const segments=[...html.matchAll(/<div\b[^>]*\bid=["']S:0["'][^>]*>/g)];
  if(!segments.length)return html;
  const completions=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\$RC\(\s*"B:0"\s*,\s*"S:0"\s*\)/.test(m[1]));
  if(segments.length!==1||completions.length!==1
    ||[...html.matchAll(/<template\s+id="B:0"\s*><\/template>/g)].length!==1
    ||!/^<div\s+hidden(?:="")?\s+id="S:0"\s*>$/.test(segments[0][0]))invalid();
  return html.replace(segments[0][0],'<div id="S:0">');
}

export function parseChongXLanding(html,target){
  const site=siteFor(target),doc=readHtml(completedHtml(html));
  const canonicals=doc.all.filter(n=>n.tag==='link'&&n.attrs.rel==='canonical');
  if(!canonicals.length||canonicals.some(n=>n.attrs.href!==target.origin+'/x-subscription'))invalid();
  const h1s=doc.all.filter(n=>n.tag==='h1');if(h1s.length!==1)invalid();
  const heading=content(h1s[0]),hero=content(h1s[0].parent);
  if(!/Grok.*Cursor.*X.*三合一.*订阅|X\s*联合订阅/i.test(heading)
    ||!/(?:\bThe X Subscription\b|X\s*联合订阅)/i.test(hero)||!/\bGrok\b/i.test(hero)||!/\bCursor\b/i.test(hero)||!/\bX\b/i.test(hero))invalid();
  const sections=doc.all.filter(n=>n.tag==='section'&&n.attrs.id===site.section);
  if(sections.length!==1)invalid();
  const cards=descendants(sections[0]).filter(n=>n.tag==='article');
  if(cards.length!==TIERS.length)invalid();
  const entries=cards.map(card=>{
    const nodes=descendants(card),headings=nodes.filter(n=>n.tag==='h3');if(headings.length!==1)invalid();
    const tier=content(headings[0]),index=TIERS.indexOf(tier);if(index<0)invalid();
    const links=nodes.filter(n=>n.tag==='a'&&n.attrs.href?.startsWith(CATFK));
    const key=site.keys[index],url=`${CATFK}/item/${key}`;
    const action=site.structured?/^立即下单/:new RegExp(`^立即抢购 ${tier}（新窗口）$`);
    if(links.length!==1||links[0].attrs.href!==url||!action.test(content(links[0])))invalid();
    const prices=nodes.filter(n=>n.tag==='p').map(n=>content(n).match(/^[¥￥]\s*(\d+(?:\.\d{1,2})?)\s*\/\s*月$/)).filter(Boolean);
    if(prices.length!==1||!amount(prices[0][1]))invalid();
    return {tier,key,url,price:amount(prices[0][1]),period:'1m',landingUrl:target.origin+'/x-subscription'};
  });
  if(new Set(entries.map(e=>e.tier)).size!==TIERS.length)invalid();
  const lists=doc.graph.filter(row=>hasType(row,'ItemList'));
  if((site.structured&&lists.length!==1)||lists.length>1)invalid();
  if(lists.length){
    const rows=lists[0].itemListElement;if(!Array.isArray(rows)||rows.length!==entries.length)invalid();
    for(const entry of entries){
      const matches=rows.map(row=>row.item).filter(item=>item?.offers?.url===entry.url);
      if(matches.length!==1)invalid();
      const item=matches[0],offer=item.offers;
      if(!hasType(item,'Product')||item.name!==`${entry.tier} 联合订阅（月度）`||!hasType(offer,'Offer')
        ||offer.priceCurrency!=='CNY'||amount(offer.price)!==entry.price)invalid();
    }
  }
  return entries.sort((a,b)=>TIERS.indexOf(a.tier)-TIERS.indexOf(b.tier));
}

export function parseChongXProduct(payload,entry,target,capturedAt){
  const site=siteFor(target),index=TIERS.indexOf(entry?.tier),data=payload?.data;
  if(index<0||entry.key!==site.keys[index]||entry.url!==`${CATFK}/item/${entry.key}`||entry.landingUrl!==target.origin+'/x-subscription'
    ||entry.period!=='1m'||!amount(entry.price)||payload?.code!==1||!data||Array.isArray(data))invalid();
  const rawTitle=htmlText(data.name),description=htmlText(data.description);
  if(data.goods_key!==entry.key||data.user?.token!==site.token||data.status!==1||data.verify!==1||data.goods_type!=='card'
    ||rawTitle!==`${entry.tier} 联合会员`||amount(data.price)!==entry.price||amount(data.real_price)!==entry.price
    ||data.discount?.available!==0||data.multipleoffers?.available!==0||data.fullgift?.available!==0
    ||data.extend?.send_order!==0||data.extend?.limit_count!==1)invalid();
  const describedTier=description.match(/^官方\s*\d+(?:\.\d+)?\s*美元\s*\/\s*月\s*的\s*(Plus|Premium|Super|Ultra)\s*会员/i)?.[1];
  if(describedTier?.toLowerCase()!==entry.tier.toLowerCase()||!/客服[\s\S]*充值/.test(description)
    ||!/邮箱[\s\S]*验证码[\s\S]*充值/.test(description)
    ||/成品|共享|合租|团队|席位|账号出售|年卡|季卡|周卡|日卡|可选|任选|二选一/.test(description))invalid();
  const title=`The X Subscription ${entry.tier} · 1个月代充`;
  // The short checkout name alone never establishes X identity. The verified
  // original card supplies it; checkout supplies this exact SKU's delivery.
  const evidence=deliveryEvidence({productTitle:title,category:'X 融合订阅',description,descriptionScope:'product'});
  return {offerId:`catfk:${site.token}:${entry.key}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
    title,category:'X 融合订阅',price:entry.price,listedPrice:entry.price,feeAmount:null,priceBasis:'listed',currency:'CNY',
    status:'available',stockCount:null,url:entry.url,capturedAt,deliveryMode:'manual',
    extra:{shopUrl:`${CATFK}/shop/${site.token}`,originShopUrl:target.origin,landingUrl:entry.landingUrl,catfkToken:site.token,
      publicProductTitle:rawTitle,publicDescription:description,deliveryEvidence:evidence,
      priceEvidence:'原站套餐当前 CNY 月价与同链接 CatFK 商品 price / real_price 一致；未验证付款手续费',
      stockEvidence:'原站展示立即下单或抢购入口；公开商品 status=1、verify=1；未提供库存数量',
      securityNotice:'商家交付说明要求邮箱验证码，存在账号安全风险；本站不收集、不提交验证码或账号凭据。',
      catalogFormat:'chong-x-subscription-public',collectionMethod:'original-card-and-public-goods-info'}};
}

export async function collectChongXSubscription(target,options={}){
  siteFor(target);
  const deadline=Math.min(options.deadline||Infinity,Date.now()+30000),factory=options.publicFetchFactory??createPublicNetworkFetch;
  const origins=[target.origin,CATFK],clients=new Map(origins.map((origin,i)=>[origin,factory(origin,{maxRequests:i?5:2,totalTimeoutMs:30000})]));
  const policies=new Map();let requests=0,lastStart=0;
  const read=async(url,key)=>{
    const parsed=new URL(url),origin=parsed.origin,policy=policies.get(origin);
    if(!clients.has(origin)||parsed.search||parsed.hash||parsed.username||parsed.password
      ||!((origin===target.origin&&['/robots.txt','/x-subscription'].includes(parsed.pathname))
        ||(origin===CATFK&&['/robots.txt','/shopApi/Shop/goodsInfo'].includes(parsed.pathname))))invalid();
    if(key!=null&&(!SITES[target.origin].keys.includes(key)||parsed.pathname!=='/shopApi/Shop/goodsInfo'))invalid();
    if(origins.some(merchantUrlBlocked))throw htmlFailure('店铺已被站方暂停采集','COLLECTION_SCOPE_RESTRICTED');
    if(policy&&!policy.allows(url))throw htmlFailure('公开目录读取被 robots 禁止','ROBOTS_DISALLOWED');
    if(++requests>CHONG_X_SUBSCRIPTION_MAX_REQUESTS)throw htmlFailure('公开目录请求达到上限','COLLECTOR_LIMIT');
    const wait=Math.max(0,(policy?.delay||750)-(Date.now()-lastStart));
    if(Date.now()+wait>=deadline)throw new Error('Chong 公开目录采集超时');
    await(options.sleep||delay)(wait);lastStart=Date.now();
    if(lastStart>=deadline)throw new Error('Chong 公开目录采集超时');
    // Recheck at the actual send boundary; an approval can change while waiting.
    if(origins.some(merchantUrlBlocked))throw htmlFailure('店铺已被站方暂停采集','COLLECTION_SCOPE_RESTRICTED');
    await options.beforeRequest?.(url);
    if(Date.now()>=deadline)throw new Error('Chong 公开目录采集超时');
    const init={fetchImpl:clients.get(origin),allowedOrigins:[origin],maxRedirects:0,maxBytes:1024*1024,
      timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now())),headers:{'user-agent':'AiradarBot/1.0 (+https://airadar.vip)',accept:key?'application/json':'text/html,text/plain'}};
    // goodsInfo is the shop's verified read-only public product endpoint. Never
    // call getGoodsPrice, Pay, order, carts, login or credentials endpoints.
    return key?safeFetchJson(url,{...init,allowedMethods:['POST'],method:'POST',headers:{...init.headers,'content-type':'application/json'},body:JSON.stringify({goods_key:key})}):safeFetchText(url,init);
  };
  const robots=async origin=>{try{policies.set(origin,robotsPolicy(await read(origin+'/robots.txt')));}catch(error){if(error.status!==404)throw error;policies.set(origin,robotsPolicy(''));}};
  await robots(target.origin);
  const entries=parseChongXLanding(await read(target.origin+'/x-subscription'),target);
  await robots(CATFK);
  const offers=[],capturedAt=options.capturedAt||new Date().toISOString();
  for(const entry of entries)offers.push(parseChongXProduct(await read(CATFK+'/shopApi/Shop/goodsInfo',entry.key),entry,target,capturedAt));
  return offers;
}
