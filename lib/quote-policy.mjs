import { metaGet, offersOfProduct } from './db.mjs';
import { candleSeriesPoints, isPartialSnapshot, retentionFlags, snapshotHasDetail, snapshotSeriesPoint } from './offer-history-read.mjs';
import { publicOfferAllowed, SHOP_SOURCES } from './public-offers.mjs';
import { offerSpec } from './offer-spec.mjs';
import { offerChannel, filterFramework } from './channels.mjs';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';
import { offerProvenance } from './offer-provenance.mjs';
import {projectCheckoutPrice,compareCheckoutPrices} from './checkout-price.mjs';

const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
// Legacy Plus IDs described delivery before per-offer evidence existed. Keep
// their stored rows/history, but never let that old bucket decide delivery.
const PLUS_IDS = new Set(['chatgpt-plus','chatgpt-plus-recharge','chatgpt-plus-recharge-12m']);
export function sourceHealth(db, source) { return parse(metaGet(db, `health:${source}`)); }
export function offerListed(o) { return ['in_stock','available','online','low_stock'].includes(String(o.status || '').toLowerCase()) && (o.stock_count ?? o.stockCount) !== 0; }
export function quoteAvailable(source,o) { return !o.quote_stale && offerListed(o) && o.price != null && Number.isFinite(Number(o.price)) && (SHOP_SOURCES.has(source) ? Number(o.price)>0 : Number(o.price)>=0); }
function quoteCurrency(offers, fallback) { const values=new Set(offers.map(o=>o.currency||fallback||null)); return values.size===1?[...values][0]:null; }
function quoteFreshUntil(source,snapshot,offer,health) {
  const evidence=parse(offer.extra).quoteHealth;
  const at=Date.parse(offer.captured_at||offer.capturedAt||snapshot.fetched_at);
  const maxAge=Number(evidence?.maxAgeMinutes||health.maxAgeMinutes||1440)*60000;
  // Age uses > while explicit expiry uses <=. Keep the original boundaries.
  const ageLimit=SHOP_SOURCES.has(source)?!Number.isFinite(at)?-Infinity:Number.isNaN(maxAge)?Infinity:Math.floor(at+maxAge)+1:Infinity;
  const expires=Date.parse(offer.expires_at||offer.expiresAt);
  return Math.min(ageLimit,Number.isFinite(expires)?expires:Infinity);
}
export function quoteStale(db, source, snapshot, offer, { historical = false, now = Date.now(), health:providedHealth } = {}) {
  const extra = parse(offer.extra), evidence = extra.quoteHealth;
  const health = historical ? {} : providedHealth ?? sourceHealth(db, source);
  if (health.status === 'failed' && Date.parse(health.checkedAt) >= Date.parse(snapshot.fetched_at)) return true;
  if (source === 'direct-shops' && evidence) {
    if (!['ok','cached'].includes(evidence.status)) return true;
  } else if (Number(snapshot.stale) === 1 || (health.status === 'stale' && Date.parse(health.checkedAt) >= Date.parse(snapshot.fetched_at))) return true;
  const at = Date.parse(offer.captured_at || offer.capturedAt || snapshot.fetched_at);
  const reference = historical ? Date.parse(snapshot.fetched_at) : now;
  const maxAge = Number(evidence?.maxAgeMinutes || health.maxAgeMinutes || 1440) * 60000;
  if (SHOP_SOURCES.has(source) && (!Number.isFinite(at) || reference - at > maxAge)) return true;
  const expires = Date.parse(offer.expires_at || offer.expiresAt);
  return Number.isFinite(expires) && expires <= reference;
}
// Zero and malformed values use the default; -1/off explicitly restore legacy retention.
function retainedQuoteMaxAgeMs() {
  const value=process.env.AIRADAR_RETAINED_QUOTE_MAX_HOURS;
  if(value?.trim().toLowerCase()==='off'||value?.trim()==='-1')return Infinity;
  const hours=Number(value);
  return (Number.isFinite(hours)&&hours>0?hours:72)*3600000;
}
export function projectProduct(db, source, snapshot, product, options = {}) {
  options={...options,now:options.now??Date.now(),health:options.historical?{}:options.health??sourceHealth(db,source)};
  const retainedMaxAge=retainedQuoteMaxAgeMs();
  const raw = options.offers || offersOfProduct(db, source, snapshot.snapshot_id, product.product_id);
  const offers = raw.filter(o => {
    if (!publicOfferAllowed(source,o,product)) return false;
    const classified = source === 'direct-shops' ? classifyDirectOffer({...o,sourceId:o.source_id||o.sourceId}) : null;
    return !classified || classified.id === product.product_id || PLUS_IDS.has(classified.id) && PLUS_IDS.has(product.product_id);
  }).map(o => {
    const spec = SHOP_SOURCES.has(source) ? offerSpec(o,product) : {key:`other:${o.currency || product.currency || ''}`,label:'',known:true};
    const provenance=offerProvenance(source,o,snapshot);
    const stale=quoteStale(db,source,snapshot,o,options);
    const evidence=parse(o.extra).quoteHealth;
    const failed=evidence?.status==='stale'||options.health.status==='failed'&&Date.parse(options.health.checkedAt)>=Date.parse(snapshot.fetched_at);
    const observedAt=Date.parse(o.captured_at||o.capturedAt||snapshot.fetched_at),expiresAt=Date.parse(o.expires_at||o.expiresAt);
    const retainable=stale&&!options.historical&&SHOP_SOURCES.has(source)&&failed&&offerListed(o)&&Number.isFinite(observedAt)&&observedAt<=options.now+300000&&(!Number.isFinite(expiresAt)||expiresAt>options.now);
    const retained=retainable&&options.now-observedAt<=retainedMaxAge;
    if(options.publicOnly&&retainable&&!retained)return null;
    if(!stale&&!options.historical)options.onValidUntil?.(quoteFreshUntil(source,snapshot,o,options.health));
    if(retained)options.onValidUntil?.(Math.min(Number.isFinite(expiresAt)?expiresAt:Infinity,Math.floor(observedAt+retainedMaxAge)+1));
    return {...o,...provenance,source,last_updated_at:o.last_updated_at||provenance.last_updated_at,last_verified_at:o.last_verified_at||provenance.last_verified_at,recorded_at:o.recorded_at||provenance.recorded_at,currency:o.currency||product.currency||null,
      delivery_kind:spec.delivery_kind,delivery_label:spec.delivery_label,delivery_known:spec.delivery_known,delivery_conflict:spec.delivery_conflict,
      purchase_conditions:spec.purchase_conditions, comparison_eligible:spec.comparison_eligible, comparison_key:spec.key, superseded_comparison_key:spec.superseded_comparison_key, comparison_label:spec.label, comparison_known:spec.known, quote_stale:stale,quote_retained:retained};
  }).filter(Boolean);
  if(options.checkoutPricing&&!options.historical&&SHOP_SOURCES.has(source))for(let i=0;i<offers.length;i++){
    offers[i]=projectCheckoutPrice(offers[i],{now:options.now,priceBasis:options.priceBasis});
    if(offers[i].checkout_quote)options.onValidUntil?.(Date.parse(offers[i].checkout_quote.expiresAt));
  }
  offers.sort((a,b) => Number(a.quote_stale)-Number(b.quote_stale) || Number(!offerListed(a))-Number(!offerListed(b)) || compareCheckoutPrices(a,b));
  const keys = new Set(offers.map(o => o.comparison_key));
  const comparable = keys.size <= 1 && offers.every(o => o.comparison_known && o.comparison_eligible!==false);
  const available = offers.filter(o => quoteAvailable(source,o));
  const selected = available[0] || offers[0] || null;
  const neutralName = SHOP_SOURCES.has(source) && PLUS_IDS.has(product.product_id) ? {name:'ChatGPT Plus',product_type:'订阅/会员'} : {};
  return {...product, ...neutralName, source, currency:quoteCurrency(offers,product.currency), offers, comparable, comparison_key:keys.size === 1 ? [...keys][0] : 'mixed', selected_offer:selected, lowest_price:comparable ? available[0]?.price ?? null : null, offer_count:offers.length, in_stock_count:available.length, stale:offers.length > 0 && offers.every(o=>o.quote_stale)};
}
export function productQuoteGroups(product) {
  const groups = new Map();
  for (const offer of product.offers || []) { const key=offer.comparison_key; if(!groups.has(key))groups.set(key,[]); groups.get(key).push(offer); }
  return [...groups].map(([key,offers])=>{ const available=offers.filter(o=>quoteAvailable(product.source,o)); const comparable=offers.every(o=>o.comparison_known && o.comparison_eligible!==false); return {...product,currency:quoteCurrency(offers,product.currency),comparison_key:key,comparison_label:offers[0].comparison_label,offers,comparable,selected_offer:available[0]||offers[0],lowest_price:comparable?available[0]?.price??null:null,in_stock_count:available.length,offer_count:offers.length,stale:offers.every(o=>o.quote_stale)}; });
}
function projectSnapshot(db, snapshot, {source, productId, comparisonKey, channel, framework}) {
  const offers=filterFramework(offersOfProduct(db,source,snapshot.snapshot_id,productId).filter(o=>!channel||channel==='all'||offerChannel(o).id===channel),framework);
  const projected=projectProduct(db,source,snapshot,snapshot,{historical:true,offers});
  const selected=comparisonKey ? productQuoteGroups(projected).find(group=>group.comparison_key===comparisonKey) : projected;
  return [{...snapshot,...(selected||{lowest_price:null,in_stock_count:0,offer_count:0,comparable:false})}];
}
function overlaySeries(db, snapshots, query) {
  const filtered=(query.channel&&query.channel!=='all')||(query.framework&&query.framework!=='all');
  const prefix=[];
  let index=0;
  for(;index<snapshots.length;index++){
    const snapshot=snapshots[index];
    if(!(query.flags.cutoff&&snapshot.fetched_at<query.flags.cutoff))break;
    if(snapshotHasDetail(db,query.source,snapshot.snapshot_id))break;
    prefix.push(snapshot);
  }
  const rest=[];
  for(const snapshot of snapshots.slice(index)){
    if(query.flags.dedupe&&isPartialSnapshot(db,query.source,snapshot.snapshot_id)){
      if(filtered)continue;
      const point=snapshotSeriesPoint(db,query.source,snapshot,query.productId,query.comparisonKey);
      if(point)rest.push(point);
      continue;
    }
    rest.push(...projectSnapshot(db,snapshot,query));
  }
  if(!prefix.length||filtered)return rest;
  // K 线只补到下一条仍有明细的快照之前，迁移删到一半时不会和原明细各画一次。
  const nextDetail=rest[0]?.fetched_at;
  const before=nextDetail&&(!query.flags.cutoff||nextDetail<query.flags.cutoff)?nextDetail:query.flags.cutoff;
  const candles=candleSeriesPoints(db,{
    source:query.source,productId:query.productId,comparisonKey:query.comparisonKey,
    since:prefix[0].fetched_at,before,hours:query.flags.candleHours,
  });
  return [...candles,...rest];
}
export function quoteSeries(db,{source,productId,since,comparisonKey,channel,framework='all',limit}) {
  const boundedLimit=limit==null?-1:Math.max(1,Math.min(10000,Math.trunc(Number(limit))||120));
  const snapshots=db.prepare('SELECT p.*,s.fetched_at,s.generated_at,s.published_at,s.stale FROM products p JOIN snapshots s ON s.source=p.source AND s.snapshot_id=p.snapshot_id WHERE p.source=? AND p.product_id=? AND (? IS NULL OR s.fetched_at>=?) ORDER BY s.fetched_at DESC,s.rowid DESC LIMIT ?').all(source,productId,since||null,since||null,boundedLimit).reverse();
  const projectAll=()=>snapshots.flatMap(snapshot=>projectSnapshot(db,snapshot,{source,productId,comparisonKey,channel,framework}));
  const flags=retentionFlags(db);
  const oldest=snapshots[0];
  if(!oldest||(!flags.cutoff&&!flags.dedupe))return projectAll();
  const crosses=!!(flags.cutoff&&oldest.fetched_at<flags.cutoff);
  const partial=!!(flags.dedupe&&windowHasPartial(db,source,snapshots));
  if(!crosses&&!partial)return projectAll();
  return overlaySeries(db,snapshots,{source,productId,since,comparisonKey,channel,framework,flags});
}
function windowHasPartial(db, source, snapshots) {
  for(let index=0;index<snapshots.length;index+=200){
    const slice=snapshots.slice(index,index+200);
    const marks=slice.map(()=>'?').join(',');
    if(db.prepare(`SELECT 1 FROM offer_compacted WHERE source=? AND partial=1 AND snapshot_id IN (${marks}) LIMIT 1`).get(source,...slice.map(row=>row.snapshot_id)))return true;
  }
  return false;
}
