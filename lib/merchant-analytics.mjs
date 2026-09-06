import {createHmac,randomBytes} from 'node:crypto';
import {OUTBOUND_PLACEMENTS,publicAddress,safeMerchantUrl} from './outbound.mjs';
import {merchantIdForUrl} from './offer-provenance.mjs';
export function sponsorMerchantAllowed(value){
 if(typeof value!=='string'||!value.startsWith('domain:'))return false;
 const host=value.slice(7);if(!/^[a-z0-9.-]+$/i.test(host)||!safeMerchantUrl('https://'+host))return false;
 return merchantIdForUrl('https://'+host)===value;
}
const dayOf=d=>new Date(new Date(d).getTime()+8*3600000).toISOString().slice(0,10);
const BOT=/bot|spider|crawl|headless|curl|wget|python|monitor|preview|price.?radar.?qa|lighthouse/i;
const field=(v,max=250)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export function initMerchantAnalytics(db,secret){
 db.exec(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,source TEXT NOT NULL,product_id TEXT NOT NULL,offer_id TEXT NOT NULL,label TEXT NOT NULL,placement TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,status TEXT NOT NULL,reviewed_at TEXT);
 CREATE TABLE IF NOT EXISTS merchant_outbound_events(id TEXT PRIMARY KEY,day TEXT NOT NULL,created_at TEXT NOT NULL,visitor TEXT NOT NULL,merchant_id TEXT NOT NULL,product_id TEXT NOT NULL,quote_id TEXT NOT NULL,placement TEXT NOT NULL,campaign_id TEXT NOT NULL,kind TEXT NOT NULL,UNIQUE(day,visitor,quote_id,placement,campaign_id,kind));
 CREATE INDEX IF NOT EXISTS outbound_event_day ON merchant_outbound_events(day);
 CREATE TABLE IF NOT EXISTS merchant_outbound_days(day TEXT NOT NULL,merchant_id TEXT NOT NULL,product_id TEXT NOT NULL,placement TEXT NOT NULL,campaign_id TEXT NOT NULL,clicks INTEGER NOT NULL DEFAULT 0,impressions INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,merchant_id,product_id,placement,campaign_id));`);
 let bucket=-1,total=0;const limits=new Map();
 function identity(req,date){
  const h=req.headers||{},ua=String(h['user-agent']||'');
  if(req.method!=='GET'||!ua.includes('Mozilla/')||BOT.test(ua)||/(?:^|;)\s*airadar_admin=/.test(h.cookie||'')||/prefetch|prerender/i.test(`${h.purpose||''} ${h['sec-purpose']||''}`)||h['sec-fetch-dest']&&h['sec-fetch-dest']!=='document')return null;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))return null;
  const ip=String(h['cf-connecting-ip']||'');if(!publicAddress(ip))return null;
  const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other';
  return createHmac('sha256',secret).update(dayOf(date)+'|'+ip+'|'+browser).digest('hex');
 }
 function purge(date=new Date()){db.prepare('DELETE FROM merchant_outbound_events WHERE day < ?').run(dayOf(new Date(new Date(date).getTime()-30*86400000)));}
 function campaignsFor({source,productId},date=new Date()){
  return db.prepare("SELECT * FROM campaigns WHERE source=? AND product_id=? AND status='approved' AND reviewed_at IS NOT NULL AND start_at<=? AND end_at>? AND placement='sponsored_product' ORDER BY start_at,id LIMIT 200").all(source,productId,date.toISOString(),date.toISOString()).filter(c=>sponsorMerchantAllowed(c.merchant_id)).slice(0,3);
 }
 function record(req,row,{placement,campaign},kind,date){
  const visitor=identity(req,date);if(!visitor||!OUTBOUND_PLACEMENTS.has(placement))return false;
  const minute=Math.floor(date.getTime()/60000);if(minute!==bucket){bucket=minute;total=0;limits.clear();}
  if(total>=600||(limits.get(visitor)||0)>=30)return false;total++;limits.set(visitor,(limits.get(visitor)||0)+1);
  const day=dayOf(date),campaignId=campaign?.id||'',quote=JSON.stringify([row.source,row.merchant_id,row.product_id,row.offer_id]);
  try{
   purge(date);db.exec('BEGIN IMMEDIATE');
   const inserted=db.prepare('INSERT OR IGNORE INTO merchant_outbound_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),day,date.toISOString(),visitor,row.merchant_id,row.product_id,quote,placement,campaignId,kind);
   if(Number(inserted.changes))db.prepare('INSERT INTO merchant_outbound_days VALUES(?,?,?,?,?,?,?) ON CONFLICT(day,merchant_id,product_id,placement,campaign_id) DO UPDATE SET clicks=clicks+excluded.clicks,impressions=impressions+excluded.impressions').run(day,row.merchant_id,row.product_id,placement,campaignId,kind==='click'?1:0,kind==='impression'?1:0);
   db.exec('COMMIT');return !!Number(inserted.changes);
  }catch{try{db.exec('ROLLBACK');}catch{}return false;}
 }
 return {purge,campaignsFor,
  recordClick:(req,row,context,date=new Date())=>record(req,row,context,'click',date),
  recordImpression(req,campaign,date=new Date()){
   const active=campaignsFor({source:campaign.source,productId:campaign.product_id},date).find(c=>c.id===campaign.id);if(!active)return false;
   return record(req,active,{placement:active.placement,campaign:active},'impression',date);
  },
  saveCampaign(input,{approve=false,now=new Date()}={}){
   for(const k of ['id','merchant_id','source','product_id','offer_id','label'])if(!field(input[k],k==='label'?80:250))throw new Error('Invalid campaign '+k);
   if(!sponsorMerchantAllowed(input.merchant_id))throw new Error('Shared or unresolved merchant requires verified platform shop identity before Sponsorship');
   if(input.placement!=='sponsored_product')throw new Error('Only product Sponsors are supported in P0');
   const start=Date.parse(input.start_at),end=Date.parse(input.end_at);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>366*86400000)throw new Error('Invalid campaign dates');
   const status=approve?'approved':input.status==='paused'?'paused':'draft';
   db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET merchant_id=excluded.merchant_id,source=excluded.source,product_id=excluded.product_id,offer_id=excluded.offer_id,label=excluded.label,placement=excluded.placement,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status,reviewed_at=excluded.reviewed_at').run(input.id,input.merchant_id,input.source,input.product_id,input.offer_id,input.label,input.placement,new Date(start).toISOString(),new Date(end).toISOString(),status,approve?now.toISOString():null);
   return {id:input.id,status};
  },
  listCampaigns:()=>db.prepare('SELECT * FROM campaigns ORDER BY start_at DESC LIMIT 200').all(),
  report(days=30,date=new Date()){
   purge(date);const since=dayOf(new Date(date.getTime()-(days===7?6:29)*86400000));
   return db.prepare('SELECT merchant_id,product_id,placement,campaign_id,SUM(clicks) clicks,SUM(impressions) impressions FROM merchant_outbound_days WHERE day>=? AND day<=? GROUP BY merchant_id,product_id,placement,campaign_id ORDER BY clicks DESC LIMIT 200').all(since,dayOf(date)).map(r=>({...r,ctr:r.impressions?r.clicks/r.impressions:null}));
  }
 };
}
