import {isIP} from 'node:net';
import {publicOfferAllowed} from './public-offers.mjs';
import {quoteStale,quoteAvailable} from './quote-policy.mjs';
import {merchantIdForUrl} from './offer-provenance.mjs';
import {directOfferExclusionReason} from '../collectors/direct/catalog.mjs';
export const OUTBOUND_PLACEMENTS=new Set(['home','product','sponsored_product']);
export function publicAddress(address) {
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return a>0&&a<224&&a!==10&&a!==127&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));}
  return isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address);
}
export function safeMerchantUrl(value) {
  try{const u=new URL(value),h=u.hostname.toLowerCase().replace(/\.$/,'');
    if(u.protocol!=='https:'||u.username||u.password||!h.includes('.')&&!h.includes(':')||h==='localhost'||/\.(localhost|local|internal)$/.test(h))return null;
    const address=h.replace(/^\[|\]$/g,'');if(isIP(address)&&!publicAddress(address))return null;
    if(!isIP(address)&&(h.length>253||h.split('.').some(label=>! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))return null;
    return u.href;
  }catch{return null;}
}
export function outboundHref(offer,product={}, {placement='product',campaignId=''}={}) {
  const fields={source:offer.source||product.source,snapshot:offer.snapshot_id||product.snapshot_id,product:offer.product_id||product.product_id,offer:offer.offer_id||offer.offerId,placement};
  if(!OUTBOUND_PLACEMENTS.has(placement)||Object.values(fields).some(v=>typeof v!=='string'||!v||v.length>250))return '';
  if(campaignId)fields.campaign=campaignId;
  return '/go?'+new URLSearchParams(fields);
}
export function resolveOutboundOffer(db,{source,snapshot,product,offer},now=Date.now()) {
  const latest=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);
  if(!latest||latest.snapshot_id!==snapshot)return null;
  const fetchedAt=Date.parse(latest.fetched_at);
  // Every merchant destination needs a recent source observation, including non-shop adapters.
  if(!Number.isFinite(fetchedAt)||now-fetchedAt>86400000||fetchedAt-now>300000)return null;
  const row=db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? AND product_id=? AND offer_id=?').get(source,snapshot,product,offer);
  if(!row||!publicOfferAllowed(source,row)||directOfferExclusionReason({...row,stockCount:row.stock_count})||quoteStale(db,source,latest,row,{now})||!quoteAvailable(source,row))return null;
  const destination=safeMerchantUrl(row.url);if(!destination)return null;
  const merchantId=merchantIdForUrl(destination);if(!merchantId||row.merchant_id&&row.merchant_id!==merchantId)return null;
  return {...row,destination,merchant_id:merchantId};
}
export function handleOutbound(req,res,url,{db,analytics,now=Date.now()}={}) {
  if(url.pathname!=='/go')return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
  const fail=(status)=>{res.statusCode=status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(req.method==='HEAD'?'':status===404?'报价链接已失效，请返回商品页查看最新报价。':'请求参数不正确');return true;};
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return fail(405);}
  const allowed=new Set(['source','snapshot','product','offer','placement','campaign','ack']);
  if([...url.searchParams.keys()].some(k=>!allowed.has(k)||url.searchParams.getAll(k).length!==1))return fail(400);
  const fields=Object.fromEntries(url.searchParams),placement=fields.placement||'product';
  if(fields.ack&&fields.ack!=='1')return fail(400);
  if(fields.campaign&&fields.campaign.length>250)return fail(400);
  if(!OUTBOUND_PLACEMENTS.has(placement)||['source','snapshot','product','offer'].some(k=>!fields[k]||fields[k].length>250))return fail(400);
  const row=resolveOutboundOffer(db,fields,now);if(!row)return fail(404);
  let campaign=null;
  if(fields.campaign||placement==='sponsored_product'){
    campaign=analytics?.outbound?.campaignsFor({source:row.source,productId:row.product_id},new Date(now)).find(c=>c.id===fields.campaign&&c.offer_id===row.offer_id&&c.merchant_id===row.merchant_id&&c.placement===placement);
    if(!campaign)return fail(404);
  }
  if(fields.ack!=='1'){
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const next=new URLSearchParams(url.searchParams);next.set('ack','1');
    res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.end(req.method==='HEAD'?'':`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>确认前往商家</title><body><main><h1>即将前往外部商家</h1><p>外部商家独立提供商品与售后，请自行核对价格、交付和退款条件。Airadar 不代收款，也不保证履约。</p><p>目标域名：${esc(new URL(row.destination).hostname)}</p><p><a href="${esc('/go?'+next)}">我已了解，继续前往</a></p><a href="/">返回首页</a></main></body></html>`);return true;
  }
  res.statusCode=302;res.setHeader('Location',row.destination);res.end();
  try{if(req.method==='GET')analytics?.outbound?.recordClick(req,row,{placement,campaign},new Date(now));}catch{/* Metrics never prevent a valid redirect. */}
  return true;
}
