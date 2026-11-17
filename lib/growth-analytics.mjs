import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {PRICE_PRODUCTS,priceProduct} from './price-routes.mjs';
const day=value=>new Date(+new Date(value)+8*3600000).toISOString().slice(0,10);
const KINDS=['product_view','spec_selected','outbound','follow','renewal','share','return_visit'];
export function growthSource(req){
 // Recognize only reviewed campaign tags; never retain arbitrary query values.
 try{const params=new URL(req.url,'https://airadar.vip').searchParams;
  if(['utm_source','utm_medium','utm_campaign'].every(key=>params.getAll(key).length===1)&&params.get('utm_source')==='tapeout'&&params.get('utm_medium')==='deweb'&&['deweb-entry','ai-cost-helper'].includes(params.get('utm_campaign')))return 'tapeout_deweb';
 }catch{/* Malformed request URLs carry no campaign attribution. */}
 try{const u=new URL(req.headers.referer);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return 'direct_unknown';
  const h=u.hostname.toLowerCase().replace(/^www\./,'');
  if(h==='airadar.vip')return 'internal';
  if(['google.com','google.com.hk','google.co.jp','google.co.uk','bing.com','baidu.com','duckduckgo.com','yahoo.com'].includes(h))return 'search';
  if(['x.com','twitter.com','t.co','t.me','telegram.org','reddit.com','facebook.com'].includes(h))return 'social';
  if(['chatgpt.com','perplexity.ai','claude.ai','gemini.google.com'].includes(h))return 'ai_referral';
  return 'referral';
 }catch{return 'direct_unknown';}
}
export function growthVisitor(req,secret){
 const ua=String(req.headers['user-agent']||'');
 if(!/Mozilla\//.test(ua)||/bot|spider|crawler|headless|curl|wget|python|monitor|price.?radar.?qa|lighthouse|preview|slurp/i.test(ua)||/(?:^|;)\s*airadar_admin=/.test(String(req.headers.cookie||''))||/prefetch|prerender/i.test(String(req.headers.purpose||req.headers['sec-purpose']||'')))return null;
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return null;
 const ip=String(req.headers['cf-connecting-ip']||'');if(!isIP(ip)||['127.0.0.1','::1'].includes(ip))return null;
 const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other';
 return createHmac('sha256',secret).update(ip+'|'+browser).digest('hex');
}
export function initGrowthAnalytics(db,secret,now=new Date()){
 db.exec(`CREATE TABLE IF NOT EXISTS growth_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS growth_events(day TEXT NOT NULL,visitor TEXT NOT NULL,product TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(day,visitor,product,kind));
 CREATE INDEX IF NOT EXISTS growth_events_day ON growth_events(day);
 CREATE TABLE IF NOT EXISTS growth_days(day TEXT NOT NULL,product TEXT NOT NULL,kind TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,product,kind));
 CREATE TABLE IF NOT EXISTS growth_sources(day TEXT NOT NULL,visitor TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(day,visitor,source));`);
 db.prepare("INSERT OR IGNORE INTO growth_meta VALUES('started_at',?)").run(now.toISOString());
 let minute=-1,total=0;const rate=new Map();
 const purge=date=>{const cutoff=day(new Date(+date-30*86400000));db.prepare('DELETE FROM growth_events WHERE day<?').run(cutoff);db.prepare('DELETE FROM growth_sources WHERE day<?').run(cutoff);};
 return {
  purge,
  record(req,status,context,date=new Date(),response=null){
   if(response?.scrapeGuardAction||req.scrapeGuardAction)return;
   if(!context||!KINDS.includes(context.kind)||!priceProduct(context.productKey)&&!(context.kind==='return_visit'&&context.productKey==='all'))return;
   if(context.kind==='outbound'?status!==302||req.method!=='GET':status!==200)return;
   if(context.kind==='product_view'&&(req.method!=='GET'||req.headers['sec-fetch-dest']&&req.headers['sec-fetch-dest']!=='document'))return;
   const visitor=growthVisitor(req,secret);if(!visitor)return;
   const m=Math.floor(+date/60000);if(m!==minute){minute=m;rate.clear();total=0;}if(total>=600||(rate.get(visitor)||0)>=60)return;total++;rate.set(visitor,(rate.get(visitor)||0)+1);
   const kinds=context.kind==='product_view'&&context.specSelected?['product_view','spec_selected']:context.kind==='follow'&&context.renewalSet?['follow','renewal']:[context.kind];
   try{db.exec('BEGIN IMMEDIATE');
    for(const kind of kinds){const added=db.prepare('INSERT OR IGNORE INTO growth_events VALUES(?,?,?,?)').run(day(date),visitor,context.productKey,kind).changes;if(added)db.prepare('INSERT INTO growth_days VALUES(?,?,?,1) ON CONFLICT(day,product,kind) DO UPDATE SET n=n+1').run(day(date),context.productKey,kind);}
    if(context.kind==='product_view')db.prepare('INSERT OR IGNORE INTO growth_sources VALUES(?,?,?)').run(day(date),visitor,growthSource(req));
    db.exec('COMMIT');return true;
   }catch{if(db.isTransaction)db.exec('ROLLBACK');}
  },
  report(days=7,date=new Date()){
   const span=days===30?30:7,since=day(new Date(+date-(span-1)*86400000)),until=day(date),startedAt=db.prepare("SELECT value FROM growth_meta WHERE key='started_at'").get().value;
   const counts=Object.fromEntries(KINDS.map(kind=>[kind,Number(db.prepare('SELECT COUNT(DISTINCT visitor) n FROM growth_events WHERE day>=? AND day<=? AND kind=?').get(since,until,kind).n)]));
   const products=PRICE_PRODUCTS.map(p=>({...p,...Object.fromEntries(KINDS.slice(0,5).map(kind=>[kind,Number(db.prepare('SELECT COUNT(DISTINCT visitor) n FROM growth_events WHERE day>=? AND day<=? AND kind=? AND product=?').get(since,until,kind,p.key).n)]))}));
   const sources=db.prepare('SELECT source,COUNT(DISTINCT visitor) n FROM growth_sources WHERE day>=? AND day<=? GROUP BY source').all(since,until);
   return {days:span,startedAt,counts,products,sources};
  }
 };
}
