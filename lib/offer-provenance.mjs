// Adapter-owned provenance. No current integration is a merchant-submitted API
// or a direct official source; payload source_type is never an authority.
import {createHash} from 'node:crypto';
const SOURCES={
  'direct-shops':{type:'original_crawl',name:'原始店铺公开目录',url:null},
  priceai:{type:'third_party',name:'PriceAI公开快照',url:'https://data.priceai.cc/'},
  'cardnav-official':{type:'third_party',name:'CardNav公开参考',url:'https://cardnav.xyz/'},
  'goaihop-relay':{type:'third_party',name:'GoAIHop公开目录',url:'https://goaihop.com/api/relay-packages'},
  'ldxp-goods':{type:'third_party',name:'RelayWatch公开目录',url:'https://relaywatch.online/api/ldxp/goods'},
};
export const QUOTE_SOURCE_TYPES=Object.freeze(['merchant_direct','original_crawl','official','third_party','manual']);
const labels={merchant_direct:'商家同步',original_crawl:'原店采集',official:'官方公开',third_party:'第三方采集',manual:'人工维护'};
const iso=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?new Date(n).toISOString():null;};
function urlOrigin(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.origin:null;}catch{return null;}}
const identityHost=host=>host.toLowerCase().replace(/\.$/,'').replace(/^www\./,'');
export function merchantIdForUrl(value) {
  const origin=urlOrigin(value);if(!origin)return null;
  const host=identityHost(new URL(origin).hostname);
  if(['16688.com.cn','wzyp.cn','priceai.cc','data.priceai.cc','cardnav.xyz','goaihop.com','relaywatch.online'].includes(host))return null;
  return `domain:${host}`;
}
// Accounting identity only, never proof of merchant ownership. Shared platform
// URLs require a verified platform shop ID before becoming merchant identities.
// Ignore persisted/payload merchant_id so legacy domain collisions cannot recur.
export function merchantKeyForOffer(offer={}) {
  if(!urlOrigin(offer.url))return null;
  const merchant=merchantIdForUrl(offer.url);if(merchant)return merchant;
  const canonical=new URL(offer.url);canonical.hostname=identityHost(canonical.hostname);
  const destination=canonical.href;
  const identity=[offer.source??'',offer.product_id??offer.productId??'',offer.offer_id??offer.offerId??'',destination];
  return `unresolved-quote:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}
export function quoteSourceLabel(offer) {return labels[SOURCES[offer?.source]?.type||'third_party'];}
export function quoteUpdatedAt(offer) {return iso(offer?.last_updated_at||offer?.captured_at||offer?.capturedAt);}
export function quoteVerifiedAt(offer) {return iso(offer?.last_verified_at||offer?.captured_at||offer?.capturedAt);}
export function quoteTimeInfo(offer,{now=Date.now()}={}) {
  const updatedAt=quoteUpdatedAt(offer),verifiedAt=quoteVerifiedAt(offer),at=verifiedAt||updatedAt;
  const minutes=at?Math.max(0,Math.floor((now-Date.parse(at))/60000)):null;
  const relative=minutes==null?'时间未提供':minutes<1?'不足 1 分钟前':minutes<60?`${minutes} 分钟前`:minutes<1440?`${Math.floor(minutes/60)} 小时前`:`${Math.floor(minutes/1440)} 天前`;
  return {updatedAt,verifiedAt,relative,absolute:at,staleLabel:offer?.quote_stale?'价格可能已发生变化':''};
}
export function offerProvenance(source,offer={},snapshot={},previous=null) {
  const info=SOURCES[source]||{type:'third_party',name:'未登记公开来源',url:null};
  const observedAt=iso(offer.capturedAt||offer.captured_at||snapshot.generatedAt||snapshot.generated_at||snapshot.fetchedAt||snapshot.fetched_at);
  const recordedAt=iso(snapshot.fetchedAt||snapshot.fetched_at);
  const verifiedAt=info.type==='original_crawl'?observedAt:recordedAt||observedAt;
  const numeric=value=>value==null?null:Number(value);
  const equal=previous&&['currency','status','title','url'].every(k=>(previous[k]??null)===(offer[k]??null))&&numeric(previous.price)===numeric(offer.price)&&numeric(previous.stock_count)===numeric(offer.stockCount??offer.stock_count);
  return {source_type:info.type,source_name:info.name,source_url:info.url||urlOrigin(offer.url),merchant_id:merchantIdForUrl(offer.url),last_updated_at:equal?(iso(previous.last_updated_at)||iso(previous.captured_at)||observedAt):observedAt,last_verified_at:verifiedAt,recorded_at:recordedAt};
}
