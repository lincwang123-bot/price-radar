import {createHash} from 'node:crypto';
import {projectProduct,quoteAvailable} from './quote-policy.mjs';
import {buildProductDirectory,directoryQuoteIdentity} from './product-directory.mjs';
import {merchantIdForUrl} from './offer-provenance.mjs';
import {safeMerchantUrl} from './outbound.mjs';
import {retentionDay} from './retention-store.mjs';

const digest=v=>createHash('sha256').update(v).digest('hex');
const soldOut=o=>Number(o.stock_count)===0&&o.stock_count!=null||['out_of_stock','sold_out','soldout'].includes(String(o.status).toLowerCase());
export function readRetentionMarket(db,{now=new Date()}={}){
 const lists=[];
 for(const source of ['direct-shops','priceai','ldxp-goods','cardnav-official','goaihop-relay']){
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
 const products=buildProductDirectory(lists).flatMap(c=>c.products.map(p=>({key:p.key,name:p.name,family:c.key})));
 const groups=new Map();
 for(const list of lists.filter(list=>!['cardnav-official','goaihop-relay'].includes(list.source)))for(const product of list.products)for(const o of product.offers){
  const definition=directoryQuoteIdentity(list,product,o);
  if(!definition||!o.comparison_known||!/^\d+[md]:/.test(o.comparison_key||'')||!safeMerchantUrl(o.url)||!['CNY','USD','EUR','GBP','HKD','TWD','JPY','KRW','SGD','AUD','CAD','INR','TRY','BRL','MYR','THB','VND','IDR','CHF','AED','USDT','USDC'].includes(o.currency))continue;
  const id=digest(definition.key+'|'+o.comparison_key).slice(0,24);
  if(!groups.has(id))groups.set(id,{id,productKey:definition.key,name:definition.name,family:definition.category,spec:o.comparison_label,comparisonKey:o.comparison_key,currency:o.currency,entries:[]});
  groups.get(id).entries.push(o);
 }
 return {observedAt:now.toISOString(),products,groups:[...groups.values()].map(g=>{
  const deduped=new Map();
  const rank=o=>(o.quote_stale?100:0)+({ 'direct-shops':0,priceai:1,'ldxp-goods':2 }[o.source]??3);
  for(const o of g.entries){const key=o.url+'|'+o.comparison_key,previous=deduped.get(key);
   if(!previous||rank(o)<rank(previous)||rank(o)===rank(previous)&&Date.parse(o.last_verified_at||o.captured_at||'')>Date.parse(previous.last_verified_at||previous.captured_at||''))deduped.set(key,o);
  }
  const entries=[...deduped.values()];
  const available=entries.filter(o=>quoteAvailable(o.source,o)),prices=available.map(o=>Number(o.price));
  const state=available.length?'available':entries.length&&entries.every(o=>!o.quote_stale&&soldOut(o))?'unavailable':'unknown';
  const {entries:unused,...group}=g;
  return {...group,state,price:prices.length?Math.min(...prices):null,maxPrice:prices.length?Math.max(...prices):null,
   offerCount:available.length,shopCount:new Set(available.map(o=>merchantIdForUrl(o.url)).filter(Boolean)).size,
   observedAt:now.toISOString(),fingerprint:digest(JSON.stringify(entries.map(o=>[o.url,o.price,o.status,o.quote_stale,o.last_verified_at||o.captured_at]).sort((a,b)=>a[0].localeCompare(b[0]))))};
 })};
}
export function observeMarket(db,market,now=new Date()){
 const day=retentionDay(now),stamp=now.toISOString();
 db.exec('BEGIN IMMEDIATE');
 try{
  const active=new Set(market.groups.map(g=>g.id));
  for(const old of db.prepare('SELECT * FROM retention_market').all())if(!active.has(old.id)){
   const payload=JSON.parse(old.payload);db.prepare('UPDATE retention_market SET payload=?,observed_at=? WHERE id=?').run(JSON.stringify({...payload,state:'unknown',price:null,maxPrice:null,offerCount:0,shopCount:0,observedAt:stamp}),stamp,old.id);
  }
  for(const g of market.groups){
   const old=db.prepare('SELECT fingerprint,observed_at FROM retention_market WHERE id=?').get(g.id);
   const fresh=!old||old.fingerprint!==g.fingerprint||retentionDay(old.observed_at)!==day;
   db.prepare('INSERT INTO retention_market VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_key=excluded.product_key,payload=excluded.payload,observed_at=excluded.observed_at,fingerprint=excluded.fingerprint').run(g.id,g.productKey,JSON.stringify(g),stamp,g.fingerprint);
   if(fresh&&g.state==='available'&&Number.isFinite(g.price))db.prepare(`INSERT INTO retention_market_daily VALUES(?,?,?,?,?,?,?,1)
    ON CONFLICT(day,group_id) DO UPDATE SET low=MIN(low,excluded.low),high=MAX(high,excluded.high),last_price=excluded.last_price,last_at=excluded.last_at,observations=observations+1`).run(day,g.id,g.price,g.price,g.price,stamp,stamp);
  }
  db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
export function marketHistory(db,id,days=30,now=new Date()){
 const since=retentionDay(new Date(+now-(days-1)*86400000)),today=retentionDay(now);
 const rows=db?db.prepare('SELECT * FROM retention_market_daily WHERE group_id=? AND day>=? AND day<=? ORDER BY day').all(id,since,today):[];
 return {days:rows.length,low:rows.length?Math.min(...rows.map(r=>r.low)):null,high:rows.length?Math.max(...rows.map(r=>r.high)):null,
  firstAt:rows[0]?.first_at||null,lastAt:rows.at(-1)?.last_at||null,series:rows.map(r=>({day:r.day,low:r.low,high:r.high,price:r.last_price,observations:r.observations}))};
}
export function weeklyMarket(db,market,{now=new Date(),date=retentionDay(now)}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>retentionDay(now))return null;
 const end=new Date(date+'T15:59:59.999Z'),items=[];
 for(const row of db?db.prepare('SELECT payload FROM retention_market').all():[]){
  const g=JSON.parse(row.payload),history=marketHistory(db,g.id,7,end);if(history.days<2)continue;
  const first=history.series[0].price,last=history.series.at(-1).price,change=(last-first)/first*100;
  if(!Number.isFinite(change)||Math.abs(change)<1)continue;
  items.push({...g,history,firstPrice:first,lastPrice:last,change});
 }
 items.sort((a,b)=>a.change-b.change||a.productKey.localeCompare(b.productKey));
 return {date,since:retentionDay(new Date(+end-6*86400000)),items:items.slice(0,20),daysRecorded:db?.prepare('SELECT COUNT(DISTINCT day) n FROM retention_market_daily WHERE day>=? AND day<=?').get(retentionDay(new Date(+end-6*86400000)),date)?.n||0};
}
