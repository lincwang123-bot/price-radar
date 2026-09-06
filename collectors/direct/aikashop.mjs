import { safeFetchText } from '../../lib/safe-fetch.mjs';
const ORIGIN='https://aikashop.com';
const PRODUCT_PATH='/products/suno.html';
export function parseAikaShop(html,target,capturedAt=new Date().toISOString()) {
  if(target?.origin!==ORIGIN||target?.id!=='aikashop')throw new Error('AikaShop目标未登记');
  const match=String(html).match(/<script\b[^>]*id=["']plansData["'][^>]*data-product=["']Suno["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)throw new Error('AikaShop缺少明确Suno SKU目录');
  const rows=JSON.parse(match[1]);
  if(!Array.isArray(rows)||!rows.length||rows.length>12)throw new Error('AikaShop SKU数量无效');
  const seen=new Set();
  return rows.map(row=>{
    const plan=/^(Pro|Premier) (月卡|季卡|年卡)$/.exec(row.name||'');
    const price=Number(row.cny);
    if(!plan||!Number.isFinite(price)||price<=0||seen.has(row.name))throw new Error('AikaShop SKU规格/价格不可靠');
    seen.add(row.name);
    const months={月卡:1,季卡:3,年卡:12}[plan[2]];
    return {offerId:`aikashop:suno-${plan[1].toLowerCase()}-${months}m`,sourceId:'aikashop',sourceName:'AI卡商城',storeName:'AI卡商城',title:`Suno ${plan[1]} 代充 ${months}个月`,category:'Suno',price,currency:'CNY',status:'unknown',stockCount:null,url:ORIGIN+PRODUCT_PATH,capturedAt,extra:{priceBasis:'listed',stockEvidence:'页面无逐SKU库存证据；挂牌目录不等于可售',warrantyEvidence:'站方页面声明30天售后，未验证履约'}};
  });
}
export async function collectAikaShop(target,options={}) {
  if(target?.origin!==ORIGIN||target?.id!=='aikashop')throw new Error('AikaShop目标未登记');
  const fetchOptions={allowedOrigins:[ORIGIN],fetchImpl:options.fetchImpl,timeoutMs:12000,maxBytes:512*1024,maxRedirects:0};
  const robots=await safeFetchText(ORIGIN+'/robots.txt',fetchOptions);
  // Fail closed if operator changes its presently explicit all-path permission.
  if(!/User-agent:\s*\*\s*\nAllow:\s*\//i.test(robots)||/Disallow:\s*\/(?:\s|$)|Disallow:\s*\/products/i.test(robots))throw new Error('AikaShop robots不再明确允许目录读取');
  const html=await safeFetchText(ORIGIN+PRODUCT_PATH,fetchOptions);
  return parseAikaShop(html,target,options.capturedAt);
}
