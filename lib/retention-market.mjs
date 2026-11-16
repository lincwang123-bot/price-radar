import {createHash} from 'node:crypto';
import {retiredCatalogItem} from './catalog-policy.mjs';
import {projectProduct,quoteAvailable} from './quote-policy.mjs';
import {buildProductDirectory,directoryQuoteIdentity} from './product-directory.mjs';
import {merchantIdForOffer} from './offer-provenance.mjs';
import {quoteIdentityKey,QUOTE_IDENTITY_VERSION} from './quote-identity.mjs';
import {safeMerchantUrl} from './outbound.mjs';
import {retentionDay} from './retention-store.mjs';
import {marketAttribution} from './market-attribution.mjs';
import {priceHref} from './price-routes.mjs';
import {snapshotWeeklyMarket} from './weekly-report.mjs';

const digest=v=>createHash('sha256').update(v).digest('hex');
function listingMedian(values){
 const prices=values.filter(price=>Number.isFinite(price)).sort((a,b)=>a-b);
 if(!prices.length)return null;
 const mid=Math.floor(prices.length/2);
 return prices.length%2?prices[mid]:(prices[mid-1]+prices[mid])/2;
}
function listedShops(offers){
 const shops=new Map();let complete=true;
 for(const offer of offers){
  const id=merchantIdForOffer(offer); // live counts shops by merchantIdForOffer
  if(!id||shops.has(id))continue;
  if(shops.size>=80){complete=false;break;}
  let host='';
  try{host=new URL(offer.url).hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');}catch{continue;}
  const name=String(offer.store_name||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,80);
  shops.set(id,{id,name:name||host,host});
 }
 return {shops:[...shops.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),shopsComplete:complete};
}
const soldOut=o=>Number(o.stock_count)===0&&o.stock_count!=null||['out_of_stock','sold_out','soldout'].includes(String(o.status).toLowerCase());
export function readRetentionMarket(db,{now=new Date()}={}){
 const lists=[];
 for(const source of ['direct-shops','ldxp-goods','cardnav-official']){
  const snapshot=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);if(!snapshot)continue;
  const products=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(source,snapshot.snapshot_id).map(p=>{
   const raw=db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? AND product_id=?').all(source,snapshot.snapshot_id,p.product_id),original=new Map(raw.map(o=>[o.offer_id,o]));
   // The shared public projection drops sold-out rows. Preserve only explicit
   // sold-out evidence after all other exclusions and identity checks pass.
   const projected=projectProduct(db,source,snapshot,p,{now:+now,offers:raw.map(o=>soldOut(o)?{...o,status:'in_stock',stock_count:1}:o)});
   projected.offers=projected.offers.map(o=>({...o,status:original.get(o.offer_id).status,stock_count:original.get(o.offer_id).stock_count}));return projected;
  });
  lists.push({source,snapshotId:snapshot.snapshot_id,fetchedAt:snapshot.fetched_at,stale:!!snapshot.stale,products});
 }
 const products=buildProductDirectory(lists).flatMap(c=>c.products.map(p=>({key:p.key,name:p.name,family:c.key,path:priceHref(p.key)})));
 const groups=new Map(),corrections=new Set(),legacyGroups=new Map(),deduped=new Map();
 const rank=o=>(o.quote_stale?100:0)+({ 'direct-shops':0,'ldxp-goods':2 }[o.source]??3);
 const prefer=(o,previous)=>!previous||rank(o)<rank(previous)||rank(o)===rank(previous)&&(Date.parse(o.last_verified_at||o.captured_at||'')||0)>(Date.parse(previous.last_verified_at||previous.captured_at||'')||0);
 for(const list of lists.filter(list=>!['cardnav-official'].includes(list.source)))for(const product of list.products)for(const o of product.offers){
  const definition=directoryQuoteIdentity(list,product,o);
  if(definition && o.superseded_comparison_key){
   corrections.add(digest(definition.key+'|'+o.superseded_comparison_key).slice(0,24));
   if(o.comparison_known && o.comparison_eligible!==false)corrections.add(digest(definition.key+'|'+o.comparison_key).slice(0,24));
  }
  if(!definition||o.comparison_eligible===false||!o.comparison_known||!/^\d+[md]:/.test(o.comparison_key||'')||!safeMerchantUrl(o.url)||!['CNY','USD','EUR','GBP','HKD','TWD','JPY','KRW','SGD','AUD','CAD','INR','TRY','BRL','MYR','THB','VND','IDR','CHF','AED','USDT','USDC'].includes(o.currency))continue;
  const id=digest(definition.key+'|'+o.comparison_key).slice(0,24);
  const key=quoteIdentityKey(o,{productKey:definition.key});
  if(prefer(o,deduped.get(key)?.offer))deduped.set(key,{id,definition,offer:o,key});
  // Compare the prior algorithm only to identify histories whose interpretation
  // changes on upgrade. This does not write or backfill historical prices.
  if(!legacyGroups.has(id))legacyGroups.set(id,new Map());
  const legacy=legacyGroups.get(id),legacyKey=o.url+'|'+o.comparison_key;
  if(prefer(o,legacy.get(legacyKey)?.offer))legacy.set(legacyKey,{offer:o,key});
 }
 for(const {id,definition,offer:o,key} of deduped.values()){
  if(!groups.has(id))groups.set(id,{id,productKey:definition.key,name:definition.name,family:definition.category,spec:o.comparison_label,comparisonKey:o.comparison_key,currency:o.currency,entries:[]});
  groups.get(id).entries.push({offer:o,key});
 }
 const signature=entries=>JSON.stringify([...entries].map(({offer:o,key})=>[key,o.price,o.status,!!o.quote_stale]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 const skuCorrections=[...legacyGroups].filter(([id,entries])=>signature(entries.values())!==signature(groups.get(id)?.entries||[])).map(([id])=>id);
 return {observedAt:now.toISOString(),products,corrections:[...corrections],skuCorrections,groups:[...groups.values()].map(g=>{
  const entries=g.entries.map(e=>e.offer);
  const available=entries.filter(o=>quoteAvailable(o.source,o)),prices=available.map(o=>Number(o.price)),listed=listedShops(available);
  const shopCount=new Set(available.map(merchantIdForOffer).filter(Boolean)).size;
  const state=available.length?'available':entries.length&&entries.every(o=>!o.quote_stale&&soldOut(o))?'unavailable':'unknown';
  const {entries:unused,...group}=g;
  return {...group,comparisonPolicyVersion:2,quoteIdentityVersion:QUOTE_IDENTITY_VERSION,state,price:prices.length?Math.min(...prices):null,maxPrice:prices.length?Math.max(...prices):null,
   offerCount:available.length,shopCount,median:listingMedian(prices),shops:listed.shops,shopsComplete:listed.shopsComplete&&listed.shops.length===shopCount,
   quoteEvidence:available.map(o=>({id:digest(quoteIdentityKey(o,{productKey:g.productKey})).slice(0,32),price:Number(o.price)})).sort((a,b)=>a.id.localeCompare(b.id)),
   observedAt:now.toISOString(),fingerprint:digest(JSON.stringify([QUOTE_IDENTITY_VERSION,g.entries.map(({offer:o,key})=>[key,o.price,o.status,o.quote_stale,o.last_verified_at||o.captured_at]).sort((a,b)=>a[0].localeCompare(b[0]))]))};
 })};
}
export function observeMarket(db,market,now=new Date()){
 const day=retentionDay(now),stamp=now.toISOString();
 db.prepare("INSERT OR IGNORE INTO retention_meta VALUES('comparison_v2_started_at',?)").run(stamp);
 db.exec('BEGIN IMMEDIATE');
 try{
  // Only affected groups start a new comparison boundary. Keep every original
  // row and renewal setting; skip the mixed migration day in public histories.
  for(const id of market.corrections||[])db.prepare('INSERT OR IGNORE INTO retention_meta VALUES(?,?)').run('ambiguity_correction:'+id,stamp);
  for(const id of market.skuCorrections||[]){
   const prior=db.prepare('SELECT payload FROM retention_market WHERE id=?').get(id);
   if(prior&&(JSON.parse(prior.payload).quoteIdentityVersion||1)<QUOTE_IDENTITY_VERSION)db.prepare('INSERT OR IGNORE INTO retention_meta VALUES(?,?)').run('sku_correction:'+id,stamp);
  }
  for(const g of market.groups){
   const correction=db.prepare('SELECT value FROM retention_meta WHERE key=?').get('ambiguity_correction:'+g.id)?.value;
   if(correction){g.comparisonPolicyVersion=3;g.comparisonCorrectedAt=correction;}
   const skuCorrection=db.prepare('SELECT value FROM retention_meta WHERE key=?').get('sku_correction:'+g.id)?.value;
   if(skuCorrection)g.quoteIdentityCorrectedAt=skuCorrection;
  }
  delete market.corrections;
  delete market.skuCorrections;
  const active=new Set(market.groups.map(g=>g.id));
  for(const old of db.prepare('SELECT * FROM retention_market').all())if(!active.has(old.id)){
   const payload=JSON.parse(old.payload);db.prepare('UPDATE retention_market SET payload=?,observed_at=? WHERE id=?').run(JSON.stringify({...payload,state:'unknown',price:null,maxPrice:null,offerCount:0,shopCount:0,observedAt:stamp}),stamp,old.id);
  }
  for(const g of market.groups){
   const old=db.prepare('SELECT fingerprint,observed_at FROM retention_market WHERE id=?').get(g.id);
   const fresh=!old||!db.prepare('SELECT 1 FROM retention_market_daily_v2 WHERE day=? AND group_id=?').get(day,g.id)||old.fingerprint!==g.fingerprint||retentionDay(old.observed_at)!==day||Array.isArray(g.quoteEvidence)&&!db.prepare('SELECT 1 FROM retention_market_evidence WHERE day=? AND group_id=?').get(day,g.id);
   const {quoteEvidence,...publicGroup}=g;
   db.prepare('INSERT INTO retention_market VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_key=excluded.product_key,payload=excluded.payload,observed_at=excluded.observed_at,fingerprint=excluded.fingerprint').run(g.id,g.productKey,JSON.stringify(publicGroup),stamp,g.fingerprint);
   if(fresh&&g.state==='available'&&Number.isFinite(g.price)){
    db.prepare(`INSERT INTO retention_market_daily_v2 VALUES(?,?,?,?,?,?,?,1)
     ON CONFLICT(day,group_id) DO UPDATE SET low=MIN(low,excluded.low),high=MAX(high,excluded.high),last_price=excluded.last_price,last_at=excluded.last_at,observations=observations+1`).run(day,g.id,g.price,g.price,g.price,stamp,stamp);
    if(Array.isArray(quoteEvidence)&&quoteEvidence.length)db.prepare('INSERT INTO retention_market_evidence VALUES(?,?,?,?) ON CONFLICT(day,group_id) DO UPDATE SET observed_at=excluded.observed_at,payload=excluded.payload').run(day,g.id,stamp,JSON.stringify({version:1,identityVersion:g.quoteIdentityVersion||1,quotes:quoteEvidence}));
   }
  }
  snapshotWeeklyMarket(db,market.groups,now);
  db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
export function marketHistory(db,id,days=30,now=new Date(),{legacy=false}={}){
 const table=legacy?'retention_market_daily':'retention_market_daily_v2';
 const since=retentionDay(new Date(+now-(days-1)*86400000)),today=retentionDay(now);
 const corrected=db?.prepare('SELECT value FROM retention_meta WHERE key IN (?,?) ORDER BY value DESC LIMIT 1').get('ambiguity_correction:'+id,'sku_correction:'+id)?.value;
 const rows=(db?db.prepare('SELECT * FROM '+table+' WHERE group_id=? AND day>=? AND day<=? ORDER BY day').all(id,since,today):[]).filter(row=>!corrected||row.day>retentionDay(corrected));
 return {days:rows.length,low:rows.length?Math.min(...rows.map(r=>r.low)):null,high:rows.length?Math.max(...rows.map(r=>r.high)):null,
  firstAt:rows[0]?.first_at||null,lastAt:rows.at(-1)?.last_at||null,series:rows.map(r=>({day:r.day,low:r.low,high:r.high,price:r.last_price,observations:r.observations}))};
}
export function weeklyMarket(db,market,{now=new Date(),date=retentionDay(now),groupId=''}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>retentionDay(now))return null;
 const end=new Date(date+'T15:59:59.999Z'),items=[];
 const started=db?.prepare("SELECT value FROM retention_meta WHERE key='comparison_v2_started_at'").get()?.value;
 const legacy=!!started&&date<retentionDay(started),table=legacy?'retention_market_daily':'retention_market_daily_v2';
 for(const row of db?db.prepare('SELECT payload FROM retention_market').all():[]){
  const g=JSON.parse(row.payload);if(retiredCatalogItem(g)||groupId&&g.id!==groupId)continue;const history=marketHistory(db,g.id,7,end,{legacy});if(history.days<2)continue;
  const first=history.series[0].price,last=history.series.at(-1).price,change=(last-first)/first*100;
  if(!Number.isFinite(change)||Math.abs(change)<1)continue;
  items.push({...g,history,firstPrice:first,lastPrice:last,change,attribution:marketAttribution(db,g.id,history,{legacy})});
 }
 items.sort((a,b)=>a.change-b.change||a.productKey.localeCompare(b.productKey));
 return {date,legacy,since:retentionDay(new Date(+end-6*86400000)),items:items.slice(0,20),daysRecorded:db?.prepare('SELECT COUNT(DISTINCT day) n FROM '+table+' WHERE day>=? AND day<=?').get(retentionDay(new Date(+end-6*86400000)),date)?.n||0};
}
