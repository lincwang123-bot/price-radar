import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {createPublicNetworkFetch} from '../../lib/public-network-fetch.mjs';
import {htmlFailure,htmlText,readHtml} from '../../lib/public-catalog-html.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {robotsPolicy} from './public-html.mjs';

export const XIAOHEIWAN_X_SUBSCRIPTION_ORIGIN='https://upgrade.xiaoheiwan.com';
export const XIAOHEIWAN_X_SUBSCRIPTION_MAX_REQUESTS=2;
const ORIGIN=XIAOHEIWAN_X_SUBSCRIPTION_ORIGIN,URL=ORIGIN+'/x-subscription-guide';
const TIERS=['Plus','Premium','Super','Ultra'];
const invalid=()=>{throw htmlFailure('小黑丸 X 订阅公开套餐表单或价格证据不一致');};
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const content=node=>node?htmlText(node.parts.map(part=>typeof part==='string'?part:content(part)).join(' ')):'';
const hasType=(value,type)=>[value?.['@type']].flat().some(v=>[type,`https://schema.org/${type}`,`http://schema.org/${type}`].includes(v));
const validTarget=target=>target?.origin===ORIGIN&&typeof target.id==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(target.id)
  &&typeof target.name==='string'&&target.name.trim()&&target.name.length<=120;
const amount=value=>{
  const text=String(value??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;
  const number=Number(text);return number>0&&number<=1000000?number:null;
};

// Read the public, selectable purchase form, not a dollar-to-yuan estimate.
// The form has its own checkout CAPTCHA; it is never solved or submitted.
export function parseXiaoheiwanXSubscription(html,target,capturedAt){
  if(!validTarget(target))invalid();
  const doc=readHtml(html),services=doc.graph.filter(row=>hasType(row,'Service'));
  const headings=doc.all.filter(node=>node.tag==='h1');
  if(services.length!==1||headings.length!==1||content(headings[0])!=='X 新会员订阅 人工购买协助')invalid();
  const service=services[0],offers=service.offers;
  if(service.url!==URL||service['@id']!==URL+'#service'||service.name!=='X 会员人工购买协助'
    ||!Array.isArray(offers)||offers.length!==TIERS.length)invalid();
  const canonical=doc.all.filter(node=>node.tag==='link'&&node.attrs.rel==='canonical');
  if(!canonical.length||canonical.some(node=>node.attrs.href!==URL))invalid();
  const forms=doc.all.filter(node=>node.tag==='form');
  if(forms.length!==1)invalid();
  const form=forms[0],nodes=descendants(form);
  if(form.attrs.action&&new globalThis.URL(form.attrs.action,ORIGIN).origin!==ORIGIN)invalid();
  const accountLabels=nodes.filter(node=>node.tag==='label'&&/^X 用户名或账号邮箱/.test(content(node)));
  if(accountLabels.length!==1||!descendants(accountLabels[0]).some(node=>node.tag==='input'&&'required' in node.attrs
    &&!['password','hidden'].includes(node.attrs.type)))invalid();
  const buttons=nodes.filter(node=>node.tag==='button'&&/^X\s/.test(content(node)));
  if(buttons.length!==TIERS.length)invalid();
  const visible=new Map();
  for(const button of buttons){
    const match=content(button).match(/^X\s+(Plus|Premium|Super|Ultra)\s+(?:常用\s+)?[¥￥]\s*(\d+(?:\.\d{1,2})?)\s+官方\s*\$(\d+(?:\.\d{1,2})?)\s*\/\s*月(?:\s|$)/);
    if(!match||button.attrs.type!=='button'||!['true','false'].includes(button.attrs['aria-pressed'])||'disabled' in button.attrs
      ||visible.has(match[1])||!amount(match[2])||!amount(match[3]))invalid();
    visible.set(match[1],{price:amount(match[2]),usd:amount(match[3]),selected:button.attrs['aria-pressed']==='true',text:content(button)});
  }
  const selected=[...visible].filter(([,value])=>value.selected);
  if(selected.length!==1)invalid();
  const summary=nodes.filter(node=>node.tag==='p'&&/^本次应付/.test(content(node)));
  const matchedSummary=summary.length===1&&content(summary[0]).match(/^本次应付[：:]\s*X\s+(Plus|Premium|Super|Ultra)[，,]\s*[¥￥]\s*(\d+(?:\.\d{1,2})?)\s+CNY$/);
  if(!matchedSummary||selected[0][0]!==matchedSummary[1]||selected[0][1].price!==amount(matchedSummary[2]))invalid();
  const submits=nodes.filter(node=>node.tag==='button'&&node.attrs.type==='submit');
  const submitPrice=submits.length===1&&content(submits[0]).match(/^生成支付订单\s*[¥￥]\s*(\d+(?:\.\d{1,2})?)$/);
  if(!submitPrice||amount(submitPrice[1])!==selected[0][1].price)invalid();

  const tables=doc.all.filter(node=>node.tag==='table');
  if(tables.length!==1)invalid();
  const rows=descendants(tables[0]).filter(node=>node.tag==='tr');
  if(rows.length!==TIERS.length+1||rows[0].children.map(content).join('|')!=='套餐|官方|人民币')invalid();
  const table=new Map();
  for(const row of rows.slice(1)){
    const cells=row.children.map(content),usd=cells[1]?.match(/^\$(\d+(?:\.\d{1,2})?)$/),cny=cells[2]?.match(/^[¥￥](\d+(?:\.\d{1,2})?)$/);
    if(cells.length!==3||!TIERS.includes(cells[0])||table.has(cells[0])||!usd||!cny||!amount(usd[1])||!amount(cny[1]))invalid();
    table.set(cells[0],{usd:amount(usd[1]),price:amount(cny[1])});
  }
  const paragraphs=doc.all.filter(node=>node.tag==='p').map(content);
  const feeParagraphs=paragraphs.filter(text=>/官方税费、地区价格和后续调价不包含在此换算中/.test(text));
  const scopeParagraphs=paragraphs.filter(text=>/这里提供的是人工购买协助/.test(text)&&/最终结果以官方资格、地区和账号状态为准/.test(text));
  if(feeParagraphs.length!==1||scopeParagraphs.length!==1||!paragraphs.some(text=>/页面参考价格/.test(text)))invalid();
  const feeEvidence=feeParagraphs[0],scopeEvidence=scopeParagraphs[0],seen=new Set();
  const parsed=offers.map(offer=>{
    const match=String(offer?.name??'').match(/^X (Plus|Premium|Super|Ultra) 会员人工购买协助$/);
    if(!match||!hasType(offer,'Offer')||offer.url!==URL||offer.priceCurrency!=='CNY'
      ||offer['@id']!==URL+'#offer-'+match[1].toLowerCase()||seen.has(match[1])
      ||!['https://schema.org/LimitedAvailability','https://schema.org/InStock'].includes(offer.availability))invalid();
    const tier=match[1],price=amount(offer.price),card=visible.get(tier),tablePrice=table.get(tier);
    if(!price||!card||!tablePrice||card.price!==price||tablePrice.price!==price||card.usd!==tablePrice.usd)invalid();
    seen.add(tier);
    const title=`X 融合订阅 ${tier} · 1个月代充（人工购买协助）`;
    const description=`本商品为 X 融合订阅 ${tier} 月度人工购买协助，需填写用户的 X 用户名或账号邮箱，支付后人工处理。${scopeEvidence}${feeEvidence}`;
    return {offerId:`${target.id}:${tier.toLowerCase()}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
      title,category:'X 融合订阅',price,listedPrice:price,feeAmount:null,priceBasis:'listed',currency:'CNY',
      status:offer.availability.endsWith('/LimitedAvailability')?'low_stock':'in_stock',stockCount:null,url:URL,capturedAt,deliveryMode:'manual',
      extra:{deliveryEvidence:deliveryEvidence({productTitle:title,description,descriptionScope:'product',category:'X 融合订阅'}),
        publicProductTitle:offer.name,publicDescription:description,publicPlanEvidence:card.text,scopeEvidence,feeEvidence,
        priceEvidence:'页面参考标价：可选表单、公开套餐表与 Service JSON-LD 一致；未创建订单或验证手续费',
        stockEvidence:'公开 Service 声明可购买；人工处理能力和账号资格未验证，库存数量未知',warrantyEvidence:'',
        catalogFormat:'xiaoheiwan-x-subscription-public',collectionMethod:'structured-service-form'}};
  });
  return TIERS.map(tier=>parsed.find(row=>row.offerId.endsWith(':'+tier.toLowerCase())));
}

export async function collectXiaoheiwanXSubscription(target,options={}){
  if(!validTarget(target))invalid();
  const deadline=Math.min(options.deadline||Infinity,Date.now()+30000);
  const fetchImpl=options.fetchImpl??createPublicNetworkFetch(ORIGIN,{maxRequests:2,totalTimeoutMs:30000});
  let policy,lastStart=0,count=0;
  const read=async url=>{
    if(![ORIGIN+'/robots.txt',URL].includes(url)||++count>2)invalid();
    if(policy&&!policy.allows(url))throw htmlFailure('小黑丸公开页面读取被 robots 禁止','ROBOTS_DISALLOWED');
    const wait=Math.max(0,(policy?.delay||750)-(Date.now()-lastStart));
    if(Date.now()+wait>=deadline)throw new Error('小黑丸公开目录采集超时');
    await(options.sleep||delay)(wait);lastStart=Date.now();
    if(lastStart>=deadline)throw new Error('小黑丸公开目录采集超时');
    await options.beforeRequest?.(url);
    return safeFetchText(url,{fetchImpl,allowedOrigins:[ORIGIN],timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now())),maxBytes:1024*1024,maxRedirects:0,
      headers:{'user-agent':'AiradarBot/1.0 (+https://airadar.vip)',accept:'text/html,text/plain'}});
  };
  try{policy=robotsPolicy(await read(ORIGIN+'/robots.txt'));}catch(error){if(error.status!==404)throw error;policy=robotsPolicy('');}
  return parseXiaoheiwanXSubscription(await read(URL),target,options.capturedAt||new Date().toISOString());
}
