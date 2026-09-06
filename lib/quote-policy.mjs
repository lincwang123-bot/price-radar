import { metaGet, offersOfProduct } from './db.mjs';
import { publicOfferAllowed, SHOP_SOURCES } from './public-offers.mjs';
import { offerSpec } from './offer-spec.mjs';
import { offerChannel, filterFramework } from './channels.mjs';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';

const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
export function sourceHealth(db, source) { return parse(metaGet(db, `health:${source}`)); }
export function offerListed(o) { return ['in_stock','available','online','low_stock'].includes(String(o.status || '').toLowerCase()) && (o.stock_count ?? o.stockCount) !== 0; }
export function quoteAvailable(source,o) { return !o.quote_stale && offerListed(o) && o.price != null && Number.isFinite(Number(o.price)) && (SHOP_SOURCES.has(source) ? Number(o.price)>0 : Number(o.price)>=0); }
function quoteCurrency(offers, fallback) { const values=new Set(offers.map(o=>o.currency||fallback||null)); return values.size===1?[...values][0]:null; }
export function quoteStale(db, source, snapshot, offer, { historical = false, now = Date.now() } = {}) {
  const extra = parse(offer.extra), evidence = extra.quoteHealth;
  const health = historical ? {} : sourceHealth(db, source);
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
export function projectProduct(db, source, snapshot, product, options = {}) {
  const raw = options.offers || offersOfProduct(db, source, snapshot.snapshot_id, product.product_id);
  const offers = raw.filter(o => {
    if (!publicOfferAllowed(source,o)) return false;
    const classified = source === 'direct-shops' ? classifyDirectOffer({...o,sourceId:o.source_id||o.sourceId}) : null;
    return !classified || classified.id === product.product_id;
  }).map(o => {
    const spec = SHOP_SOURCES.has(source) ? offerSpec(o,product) : {key:`other:${o.currency || product.currency || ''}`,label:'',known:true};
    return {...o, currency:o.currency||product.currency||null, comparison_key:spec.key, comparison_label:spec.label, comparison_known:spec.known, quote_stale:quoteStale(db,source,snapshot,o,options)};
  });
  offers.sort((a,b) => Number(a.quote_stale)-Number(b.quote_stale) || Number(!offerListed(a))-Number(!offerListed(b)) || Number(a.price)-Number(b.price));
  const keys = new Set(offers.map(o => o.comparison_key));
  const comparable = keys.size <= 1 && offers.every(o => o.comparison_known);
  const available = offers.filter(o => quoteAvailable(source,o));
  const selected = available[0] || offers[0] || null;
  return {...product, source, currency:quoteCurrency(offers,product.currency), offers, comparable, comparison_key:keys.size === 1 ? [...keys][0] : 'mixed', selected_offer:selected, lowest_price:comparable ? available[0]?.price ?? null : null, offer_count:offers.length, in_stock_count:available.length, stale:offers.length > 0 && offers.every(o=>o.quote_stale)};
}
export function productQuoteGroups(product) {
  const groups = new Map();
  for (const offer of product.offers || []) { const key=offer.comparison_key; if(!groups.has(key))groups.set(key,[]); groups.get(key).push(offer); }
  return [...groups].map(([key,offers])=>{ const available=offers.filter(o=>quoteAvailable(product.source,o)); const comparable=offers.every(o=>o.comparison_known); return {...product,currency:quoteCurrency(offers,product.currency),comparison_key:key,comparison_label:offers[0].comparison_label,offers,comparable,selected_offer:available[0]||offers[0],lowest_price:comparable?available[0]?.price??null:null,in_stock_count:available.length,offer_count:offers.length,stale:offers.every(o=>o.quote_stale)}; });
}
export function quoteSeries(db,{source,productId,since,comparisonKey,channel,framework='all',limit}) {
  const boundedLimit=limit==null?-1:Math.max(1,Math.min(10000,Math.trunc(Number(limit))||120));
  const snapshots=db.prepare('SELECT p.*,s.fetched_at,s.generated_at,s.published_at,s.stale FROM products p JOIN snapshots s ON s.source=p.source AND s.snapshot_id=p.snapshot_id WHERE p.source=? AND p.product_id=? AND (? IS NULL OR s.fetched_at>=?) ORDER BY s.fetched_at DESC,s.rowid DESC LIMIT ?').all(source,productId,since||null,since||null,boundedLimit).reverse();
  return snapshots.flatMap(s=>{
    const p=s;
    const offers=filterFramework(offersOfProduct(db,source,s.snapshot_id,productId).filter(o=>!channel||channel==='all'||offerChannel(o).id===channel),framework);
    const projected=projectProduct(db,source,s,p,{historical:true,offers});
    const selected=comparisonKey ? productQuoteGroups(projected).find(p=>p.comparison_key===comparisonKey) : projected;
    return [{...s,...(selected||{lowest_price:null,in_stock_count:0,offer_count:0,comparable:false})}];
  });
}
