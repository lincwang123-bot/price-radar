import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {readAssignedLiteral} from '../../lib/static-js-literal.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {robotsPolicy} from './public-html.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const ORIGIN='https://aiterry.shop';
const fail=()=>{throw Object.assign(new Error('Terry 公开零售目录或展示规则已变化'),{code:'INVALID_CATALOG'});};
export function parseTerryCatalog(script,pricing,checkout,target,capturedAt){
 if(!script.includes('product.name=`ChatGPT ${presentation.plan}｜${presentation.route}｜质保订阅一个月`')
  ||!script.includes('<small>¥</small>${p.price}')||!script.includes('库存：${p.stock}')
  ||!pricing.includes('new Map(products.map(p=>[p.id,p.price]))')
  ||!pricing.includes("window.agentPriceMode=d.user?.state==='approved'")
  ||!pricing.includes('p.price=window.agentPriceMode&&d.prices[p.id]!=null?d.prices[p.id]:retail.get(p.id)')
  ||!checkout.includes("url.searchParams.set('buy', id)")||!checkout.includes('`¥${product.price}`'))fail();
 const rows=readAssignedLiteral(script,'products'),presentation=readAssignedLiteral(script,'productPresentation');
 if(!Array.isArray(rows)||!rows.length||rows.length>50||!presentation||Object.keys(presentation).length!==rows.length)fail();
 const ids=new Set();return rows.map(row=>{const spec=presentation[row.id];
  if(!Number.isSafeInteger(row.id)||row.id<1||ids.has(row.id)||!spec||!['Plus','5X','20X'].includes(spec.plan)||typeof spec.route!=='string'||!spec.route.trim()
   ||!Number.isFinite(row.price)||row.price<=0||row.price>1000000||Math.abs(row.price*100-Math.round(row.price*100))>0.000001||!Number.isSafeInteger(row.stock)||row.stock<0)fail();
  ids.add(row.id);const name=`ChatGPT ${spec.plan}｜${spec.route}｜质保订阅一个月`,description=`${spec.route} · 下单后联系客服确认并处理 · 质保订阅一个月`;
  const evidence=deliveryEvidence({productTitle:name,category:'ChatGPT 会员',description,descriptionScope:'product'});
  return {offerId:`${target.id}:retail:${row.id}`,sourceId:target.id,sourceName:target.name,storeName:target.name,title:name,category:'ChatGPT 会员',price:row.price,listedPrice:row.price,priceBasis:'listed',currency:'CNY',
   status:row.stock?'in_stock':'out_of_stock',stockCount:row.stock,url:`${ORIGIN}/?buy=${row.id}`,capturedAt,deliveryMode:'manual',
   extra:{deliveryEvidence:evidence,publicDescription:description,warrantyEvidence:'网页商品说明：质保订阅一个月',priceEvidence:'公开网页零售价；未读取登录后代理价格',stockEvidence:'前台公开脚本声明库存，非订单或销量',catalogFormat:'terry-public-retail',collectionMethod:'public-static-catalog'}};
 });
}
export async function collectTerry(target,options={}){
 if(target.origin!==ORIGIN||typeof options.fetchImpl!=='function')fail();
 let policy,last=0,count=0;const deadline=Math.min(options.deadline||Infinity,Date.now()+30000);
 const read=async url=>{if(policy&&!policy.allows(url))throw Object.assign(new Error('公开目录读取规则未允许'),{code:'ROBOTS_DISALLOWED'});if(++count>5)fail();const wait=Math.max(0,(policy?.delay||1100)-(Date.now()-last));if(Date.now()+wait>=deadline)throw Error('公开目录采集超时');await(options.sleep||delay)(wait);last=Date.now();return safeFetchText(url,{fetchImpl:options.fetchImpl,allowedOrigins:[ORIGIN],timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now())),maxBytes:512*1024,maxRedirects:0,headers:{'user-agent':'AiradarBot/1.0 (+https://airadar.vip)'}});};
 try{policy=robotsPolicy(await read(ORIGIN+'/robots.txt'));}catch(e){if(e.status!==404)throw e;policy=robotsPolicy('');}
 const html=await read(ORIGIN+'/'),sources=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)].map(m=>m[1]);
 const find=name=>{const paths=sources.filter(p=>new RegExp(`^${name}\\.js(?:\\?v=[\\w-]{1,80})?$`).test(p));if(paths.length!==1)fail();return ORIGIN+'/'+paths[0];};
 const script=await read(find('script')),pricing=await read(find('agent-pricing')),checkout=await read(find('checkout-view'));
 return parseTerryCatalog(script,pricing,checkout,target,options.capturedAt||new Date().toISOString());
}
