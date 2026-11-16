import {priceProduct} from './price-routes.mjs';
import {directoryQuoteIdentity,DIRECTORY_CATEGORIES} from './product-directory.mjs';
import {isIP} from 'node:net';
import {publicOfferAllowed} from './public-offers.mjs';
import {quoteStale,quoteAvailable} from './quote-policy.mjs';
import {merchantIdForUrl,merchantKeyForOffer} from './offer-provenance.mjs';
import {directOfferExclusionReason} from '../collectors/direct/catalog.mjs';
import {reviewedSponsorDestination} from './sponsor-destinations.mjs';
export const OUTBOUND_PLACEMENTS=new Set(['home','product','sponsored_product','sponsored_category','sponsored_home','weekly_report']);
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
// Website campaigns use their own target, without manufacturing a catalog quote.
export const WEBSITE_SPONSOR_SOURCE='sponsor-websites';
export function websiteSponsorOffer(c){
  const destination=safeMerchantUrl(c?.destination_url);
  const reviewed=reviewedSponsorDestination(destination,c?.merchant_id);
  const scopeAllowed=c?.placement==='sponsored_home'?c.page_key==='home':c?.placement==='sponsored_category'?DIRECTORY_CATEGORIES.some(p=>p.key===c.page_key):c?.placement==='sponsored_product'&&!!priceProduct(c.page_key);
  if(!destination||c.source!==WEBSITE_SPONSOR_SOURCE||c.product_id!=='website'||c.offer_id!==c.merchant_id?.slice(7)||(!reviewed&&merchantIdForUrl(destination)!==c.merchant_id)||!scopeAllowed)return null;
  return {source:c.source,snapshot_id:String(c.version),product_id:c.product_id,offer_id:c.offer_id,merchant_id:c.merchant_id,store_name:c.label,title:c.tagline||'',url:destination,destination,...(reviewed?{website_url:reviewed.websiteUrl,download_kind:reviewed.downloadKind,affiliate:reviewed.affiliate}:{})};
}
// An approved advertisement owns its reviewed destination for its entire term.
// It is not a live quote and must not inherit inventory or collection failures.
export function quoteSponsorOffer(c){
  const destination=safeMerchantUrl(c?.destination_url);
  const scopeAllowed=c?.placement==='sponsored_home'?c.page_key==='home':c?.placement==='sponsored_category'?DIRECTORY_CATEGORIES.some(p=>p.key===c.page_key):c?.placement==='sponsored_product'&&/^[a-z][a-z0-9-]{0,149}$/.test(c.page_key||'');
  if(!destination||!['direct-shops','ldxp-goods'].includes(c?.source)||!c.product_id||!c.offer_id||!c.merchant_id?.startsWith('domain:')||merchantIdForUrl(destination)!==c.merchant_id||!scopeAllowed)return null;
  return {source:c.source,snapshot_id:'campaign-'+(c.version||1),product_id:c.product_id,offer_id:c.offer_id,merchant_id:c.merchant_id,store_name:c.label,title:c.page_label||c.label,url:destination,destination};
}
export function outboundHref(offer,product={}, {placement='product',campaignId='',trackingToken=''}={}) {
  const fields={source:offer.source||product.source,snapshot:offer.snapshot_id||product.snapshot_id,product:offer.product_id||product.product_id,offer:offer.offer_id||offer.offerId,placement};
  if(!OUTBOUND_PLACEMENTS.has(placement)||Object.values(fields).some(v=>typeof v!=='string'||!v||v.length>250))return '';
  if(campaignId)fields.campaign=campaignId;
  if(campaignId&&trackingToken)fields.st=trackingToken;
  return '/go?'+new URLSearchParams(fields);
}
export function resolveOutboundOffer(db,{source,snapshot,product,offer},now=Date.now()) {
  const latest=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);
  if(!latest)return null;
  const fetchedAt=Date.parse(latest.fetched_at);
  // Every merchant destination needs a recent source observation, including non-shop adapters.
  if(!Number.isFinite(fetchedAt)||now-fetchedAt>86400000||fetchedAt-now>300000)return null;
  const lookup=db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? AND product_id=? AND offer_id=?');
  const row=lookup.get(source,latest.snapshot_id,product,offer);
  const productRow=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=? AND product_id=?').get(source,latest.snapshot_id,product);
  if(!row||!productRow||!publicOfferAllowed(source,row,productRow)||directOfferExclusionReason({...row,stockCount:row.stock_count})||quoteStale(db,source,latest,row,{now})||!quoteAvailable(source,row))return null;
  const destination=safeMerchantUrl(row.url);if(!destination)return null;
  if(latest.snapshot_id!==snapshot){
    // An open page can outlive a collection cycle. Revalidate the same SKU in
    // the latest snapshot, but never reuse an old link for a different target.
    const previous=lookup.get(source,snapshot,product,offer);
    if(!previous||previous.source_id!==row.source_id||safeMerchantUrl(previous.url)!==destination)return null;
  }
  const host=new URL(destination).hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  const shared=['16688.com.cn','wzyp.cn','catfk.com'].includes(host);
  const merchantId=shared?merchantKeyForOffer({...row,url:destination}):merchantIdForUrl(destination);
  if(!merchantId||!shared&&row.merchant_id&&row.merchant_id!==merchantId)return null;
  return {...row,destination,merchant_id:merchantId};
}
export function handleOutbound(req,res,url,{db,analytics,now=Date.now()}={}) {
  if(url.pathname!=='/go')return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
  const english=url.searchParams.get('lang')==='en';
  if(english)res.setHeader('Content-Language','en');
  const fail=(status)=>{res.statusCode=status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(req.method==='HEAD'?'':english?(status===404?'This link is no longer available. Return to Airadar for current quotes.':'Invalid request.'):(status===404?'链接已失效，请返回网站查看最新内容。':'请求参数不正确'));return true;};
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return fail(405);}
  const allowed=new Set(['source','snapshot','product','offer','placement','campaign','ack','lang','st']);
  if([...url.searchParams.keys()].some(k=>!allowed.has(k)||url.searchParams.getAll(k).length!==1))return fail(400);
  const fields=Object.fromEntries(url.searchParams),placement=fields.placement||'product';
  if(fields.lang&&!['en','zh-CN'].includes(fields.lang))return fail(400);
  if(fields.ack&&fields.ack!=='1')return fail(400);
  if(fields.campaign&&fields.campaign.length>250||fields.st&&(!fields.campaign||fields.st.length>1200))return fail(400);
  if(!OUTBOUND_PLACEMENTS.has(placement)||['source','snapshot','product','offer'].some(k=>!fields[k]||fields[k].length>250))return fail(400);
  let campaign=null,row;
  const scheduled=fields.campaign&&analytics?.outbound?.campaignsFor({source:fields.source,productId:fields.product},new Date(now)).find(c=>c.id===fields.campaign);
  if(scheduled?.destination_url&&scheduled.source!==WEBSITE_SPONSOR_SOURCE){
    campaign=scheduled;row=quoteSponsorOffer(campaign);
    if(!row||fields.snapshot!==row.snapshot_id||fields.offer!==row.offer_id||placement!==campaign.placement)return fail(404);
  }else if(fields.source===WEBSITE_SPONSOR_SOURCE){
    campaign=analytics?.outbound?.campaignsFor({source:fields.source,productId:fields.product},new Date(now)).find(c=>c.id===fields.campaign);
    row=websiteSponsorOffer(campaign);
    if(!row||fields.snapshot!==row.snapshot_id||fields.offer!==row.offer_id||placement!==campaign.placement)return fail(404);
  }else row=resolveOutboundOffer(db,fields,now);
  if(!row)return fail(404);
  if(fields.campaign||placement.startsWith('sponsored_')){
    if(row.merchant_id.startsWith('unresolved-quote:'))return fail(404);
    campaign=analytics?.outbound?.campaignsFor({source:row.source,productId:row.product_id},new Date(now)).find(c=>c.id===fields.campaign&&c.offer_id===row.offer_id&&c.merchant_id===row.merchant_id&&c.placement===placement);
    if(!campaign)return fail(404);
  }
  if(fields.ack!=='1'){
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const next=new URLSearchParams(url.searchParams);next.set('ack','1');
    res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    if(row.download_kind==='android-apk'){
      const title=english?'Download Android APK':'下载 Android APK';
      const description=english?'This link goes directly to an Android APK download, not a product page. It is for Android devices only.':'这是直接下载安装包的链接，不会进入产品介绍页。安装包仅适用于 Android 设备。';
      const disclosure=english?'Affiliate link: Airadar may earn a commission from eligible purchases. The app is provided by the third party.':'推广链接：有效成交后本站可能获得佣金。应用由第三方提供。';
      const button=english?'Continue to Android APK download':'继续下载 Android APK';
      res.end(req.method==='HEAD'?'':`<!doctype html><html lang="${english?'en':'zh-CN'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Airadar</title><style>body{font:17px/1.7 system-ui;color:#253c34;background:#f7f9f8;margin:0}main{max-width:680px;margin:8vh auto;padding:25px}a{color:#24624c}a.button{display:inline-block;padding:12px 20px;border-radius:9px;background:#245c46;color:white;text-decoration:none}p{overflow-wrap:anywhere}</style><main><h1>${title}</h1><p>${description}</p><p>${english?'Product website':'产品网站'}：${esc(new URL(row.website_url).hostname)}</p><p>${english?'Tracking redirect':'推广跳转'}：${esc(new URL(row.destination).hostname)}</p><p>${disclosure}</p><p><a class="button" rel="nofollow sponsored" href="${esc('/go?'+next)}">${button} ↗</a></p><a href="${english?'/en/':'/'}">${english?'Return to Airadar':'返回首页'}</a></main></html>`);return true;
    }
    if(english){res.end(req.method==='HEAD'?'':'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue to merchant · Airadar</title><style>body{font:17px/1.7 system-ui;color:#253c34;background:#f7f9f8;margin:0}main{max-width:680px;margin:8vh auto;padding:25px}a{color:#24624c}a.button{display:inline-block;padding:12px 20px;border-radius:9px;background:#245c46;color:white;text-decoration:none}p{overflow-wrap:anywhere}</style><main><h1>You are leaving Airadar</h1><p>This independent merchant provides the product and after-sales service. Confirm the price, delivery method, account requirements and refund terms. Airadar does not collect payment or guarantee fulfilment.</p><p>Destination: <strong>'+esc(new URL(row.destination).hostname)+'</strong></p><p><a class="button" href="'+esc('/go?'+next)+'">Continue to merchant ↗</a></p><a href="/en/">Return to Airadar</a></main></html>');return true;}
    res.end(req.method==='HEAD'?'':`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>确认前往商家</title><body><main><h1>即将前往外部商家</h1><p>外部商家独立提供商品与售后，请自行核对价格、交付和退款条件。AIradar 不代收款，也不保证履约。</p><p>目标域名：${esc(new URL(row.destination).hostname)}</p><p><a href="${esc('/go?'+next)}">我已了解，继续前往</a></p><a href="/">返回首页</a></main></body></html>`);return true;
  }
  if(!placement.startsWith('sponsored_')){const product=priceProduct(directoryQuoteIdentity({source:row.source},{product_id:row.product_id},row)?.key);if(product)res.growthContext={kind:'outbound',productKey:product.key};}
  res.statusCode=302;res.setHeader('Location',row.destination);res.end();
  try{
    const pagePath=fields.st?analytics?.outbound?.verifyViewToken(campaign,fields.st,new Date(now)):'';
    // Stale cached pages may still navigate; unverified attribution never creates a metric.
    if(req.method==='GET'&&pagePath!=null)analytics?.outbound?.recordClick(req,row,{placement,campaign,pagePath},new Date(now));
  }catch{/* Metrics never prevent a valid redirect. */}
  return true;
}
