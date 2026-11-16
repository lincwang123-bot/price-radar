import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {OUTBOUND_PLACEMENTS,publicAddress,safeMerchantUrl,WEBSITE_SPONSOR_SOURCE,websiteSponsorOffer,quoteSponsorOffer} from './outbound.mjs';
import {merchantIdForUrl} from './offer-provenance.mjs';
import {sponsorPlan,sponsorError,SPONSOR_CAPACITY,SPONSOR_THEMES} from './sponsor-plans.mjs';
import {sponsorPagePath} from './sponsor-tracking.mjs';
import {reportSponsorDetail} from './sponsor-report-data.mjs';
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
 const columns=new Set(db.prepare('PRAGMA table_info(campaigns)').all().map(c=>c.name));
 for(const [name,type] of [['page_key',"TEXT NOT NULL DEFAULT ''"],['page_label',"TEXT NOT NULL DEFAULT ''"],['version','INTEGER NOT NULL DEFAULT 1'],['amount_cny','INTEGER NOT NULL DEFAULT 0'],['note',"TEXT NOT NULL DEFAULT ''"],['theme',"TEXT NOT NULL DEFAULT 'amber'"],['headline',"TEXT NOT NULL DEFAULT ''"],['tagline',"TEXT NOT NULL DEFAULT ''"],['destination_url',"TEXT NOT NULL DEFAULT ''"]])if(!columns.has(name))db.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${type}`);
 if(!db.prepare('PRAGMA table_info(merchant_outbound_days)').all().some(c=>c.name==='visible'))db.exec('ALTER TABLE merchant_outbound_days ADD COLUMN visible INTEGER NOT NULL DEFAULT 0');
 // The old aggregates cannot identify a page. Preserve them verbatim under ''.
 // A single transaction prevents a partial schema switch or lost historical totals.
 if(!db.prepare('PRAGMA table_info(merchant_outbound_days)').all().some(c=>c.name==='page_path')){
  db.exec('BEGIN IMMEDIATE');try{
   db.exec(`CREATE TABLE merchant_outbound_events_v2(id TEXT PRIMARY KEY,day TEXT NOT NULL,created_at TEXT NOT NULL,visitor TEXT NOT NULL,merchant_id TEXT NOT NULL,product_id TEXT NOT NULL,quote_id TEXT NOT NULL,placement TEXT NOT NULL,campaign_id TEXT NOT NULL,kind TEXT NOT NULL,page_path TEXT NOT NULL DEFAULT '',UNIQUE(day,visitor,quote_id,placement,campaign_id,page_path,kind));
    INSERT INTO merchant_outbound_events_v2(id,day,created_at,visitor,merchant_id,product_id,quote_id,placement,campaign_id,kind) SELECT id,day,created_at,visitor,merchant_id,product_id,quote_id,placement,campaign_id,kind FROM merchant_outbound_events;
    CREATE TABLE merchant_outbound_days_v2(day TEXT NOT NULL,merchant_id TEXT NOT NULL,product_id TEXT NOT NULL,placement TEXT NOT NULL,campaign_id TEXT NOT NULL,clicks INTEGER NOT NULL DEFAULT 0,impressions INTEGER NOT NULL DEFAULT 0,visible INTEGER NOT NULL DEFAULT 0,page_path TEXT NOT NULL DEFAULT '',contact_clicks INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,merchant_id,product_id,placement,campaign_id,page_path));
    INSERT INTO merchant_outbound_days_v2(day,merchant_id,product_id,placement,campaign_id,clicks,impressions,visible) SELECT day,merchant_id,product_id,placement,campaign_id,clicks,impressions,visible FROM merchant_outbound_days;`);
   const totals=table=>JSON.stringify(db.prepare('SELECT COUNT(*) n,COALESCE(SUM(clicks),0) clicks,COALESCE(SUM(impressions),0) impressions,COALESCE(SUM(visible),0) visible FROM '+table).get());
   if(totals('merchant_outbound_days')!==totals('merchant_outbound_days_v2')||db.prepare('SELECT COUNT(*) n FROM merchant_outbound_events').get().n!==db.prepare('SELECT COUNT(*) n FROM merchant_outbound_events_v2').get().n)throw Error('Sponsor metric migration verification failed');
   db.exec(`DROP TABLE merchant_outbound_events;ALTER TABLE merchant_outbound_events_v2 RENAME TO merchant_outbound_events;
    DROP TABLE merchant_outbound_days;ALTER TABLE merchant_outbound_days_v2 RENAME TO merchant_outbound_days;
    CREATE INDEX outbound_event_day ON merchant_outbound_events(day);COMMIT;`);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 db.exec('CREATE INDEX IF NOT EXISTS outbound_campaign_day ON merchant_outbound_days(campaign_id,day); CREATE INDEX IF NOT EXISTS outbound_merchant_day ON merchant_outbound_days(merchant_id,day)');
 db.exec('CREATE INDEX IF NOT EXISTS campaign_page_dates ON campaigns(placement,page_key,status,start_at,end_at); CREATE TABLE IF NOT EXISTS sponsor_actions(id INTEGER PRIMARY KEY,campaign_id TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,version INTEGER NOT NULL)');
 let bucket=-1;const totals=new Map(),limits=new Map();
 function identity(req,date){
  const h=req.headers||{},ua=String(h['user-agent']||'');
  if(req.method!=='GET'||!ua.includes('Mozilla/')||BOT.test(ua)||/(?:^|;)\s*airadar_admin=/.test(h.cookie||'')||/prefetch|prerender/i.test(`${h.purpose||''} ${h['sec-purpose']||''}`)||h['sec-fetch-dest']&&h['sec-fetch-dest']!=='document')return null;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))return null;
  const ip=String(h['cf-connecting-ip']||'');if(!publicAddress(ip))return null;
  const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other';
  return createHmac('sha256',secret).update(dayOf(date)+'|'+ip+'|'+browser).digest('hex');
 }
 function purge(date=new Date()){db.prepare('DELETE FROM merchant_outbound_events WHERE day < ?').run(dayOf(new Date(new Date(date).getTime()-30*86400000)));}
 function activeCampaigns(date=new Date()){
  return db.prepare("SELECT * FROM campaigns WHERE status='approved' AND reviewed_at IS NOT NULL AND start_at<=? AND end_at>? ORDER BY start_at,id LIMIT 4000").all(date.toISOString(),date.toISOString()).filter(c=>sponsorMerchantAllowed(c.merchant_id));
 }
 function campaignsFor({source,productId},date=new Date()){return activeCampaigns(date).filter(c=>c.source===source&&c.product_id===productId);}
 function activeCampaign(id,date){return db.prepare("SELECT * FROM campaigns WHERE id=? AND status='approved' AND reviewed_at IS NOT NULL AND start_at<=? AND end_at>?").get(id,date.toISOString(),date.toISOString());}
 const audit=(id,action,version,actor,date)=>db.prepare('INSERT INTO sponsor_actions(campaign_id,created_at,actor,action,version) VALUES(?,?,?,?,?)').run(id,date.toISOString(),String(actor||'operator').slice(0,100),action,version);
 function viewToken(c,date=new Date(),pagePath=''){
  if(pagePath&&sponsorPagePath(pagePath,c)!==pagePath)throw sponsorError('广告统计页面无效',400);
  const until=Math.floor(date.getTime()/1000)+3600,version=c.version||1,page=Buffer.from(pagePath).toString('base64url');
  const data=`v2.${until}.${version}.${page}`;
  return data+'.'+createHmac('sha256',secret).update('sponsor-view|'+c.id+'|'+data).digest('hex');
 }
 function verifyViewToken(c,token,date=new Date()){
  if(!c||typeof token!=='string'||token.length>2048)return null;
  // Cached pages can still carry the former one-hour token, with no page attribution.
  const legacy=/^(\d{10})\.([a-f0-9]{64})$/.exec(token);
  const modern=/^(v2\.(\d{10})\.(\d{1,10})\.([A-Za-z0-9_-]*))\.([a-f0-9]{64})$/.exec(token);
  if(!legacy&&!modern)return null;
  const until=Number(legacy?legacy[1]:modern[2]);
  if(until<date.getTime()/1000||until>date.getTime()/1000+3605)return null;
  const signed=legacy?'sponsor-view|'+c.id+'|'+until:'sponsor-view|'+c.id+'|'+modern[1];
  const signature=legacy?legacy[2]:modern[5],expected=createHmac('sha256',secret).update(signed).digest();
  if(!timingSafeEqual(Buffer.from(signature,'hex'),expected))return null;
  if(legacy)return '';
  if(Number(modern[3])!==(c.version||1))return null;
  const pagePath=Buffer.from(modern[4],'base64url').toString('utf8');
  if(Buffer.from(pagePath).toString('base64url')!==modern[4]||pagePath&&sponsorPagePath(pagePath,c)!==pagePath)return null;
  return pagePath;
 }
 function record(req,row,{placement,campaign,pagePath=''},kind,date){
  const visitor=identity(req,date);if(!visitor||!OUTBOUND_PLACEMENTS.has(placement)||typeof pagePath!=='string'||pagePath&&( !campaign||sponsorPagePath(pagePath,campaign)!==pagePath))return false;
  const minute=Math.floor(date.getTime()/60000);if(minute!==bucket){bucket=minute;totals.clear();limits.clear();}
  // SSR pages may contain many natural quotes. Reserve independent pools so
  // impression bursts cannot consume clicks or sponsor accounting capacity.
  const pool=kind==='impression'?(placement==='product'?'organic':'sponsor'):'interaction';
  const key=pool+'|'+visitor,visitorCap=pool==='organic'?300:30,globalCap=pool==='organic'?6000:600;
  if((totals.get(pool)||0)>=globalCap||(limits.get(key)||0)>=visitorCap)return false;
  totals.set(pool,(totals.get(pool)||0)+1);limits.set(key,(limits.get(key)||0)+1);
  const day=dayOf(date),campaignId=campaign?.id||'',quote=JSON.stringify([row.source,row.merchant_id,row.product_id,row.offer_id]);
  try{
   purge(date);db.exec('BEGIN IMMEDIATE');
   const inserted=db.prepare('INSERT OR IGNORE INTO merchant_outbound_events(id,day,created_at,visitor,merchant_id,product_id,quote_id,placement,campaign_id,kind,page_path) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),day,date.toISOString(),visitor,row.merchant_id,row.product_id,quote,placement,campaignId,kind,pagePath);
   if(Number(inserted.changes))db.prepare('INSERT INTO merchant_outbound_days(day,merchant_id,product_id,placement,campaign_id,clicks,impressions,visible,page_path,contact_clicks) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day,merchant_id,product_id,placement,campaign_id,page_path) DO UPDATE SET clicks=clicks+excluded.clicks,impressions=impressions+excluded.impressions,visible=visible+excluded.visible,contact_clicks=contact_clicks+excluded.contact_clicks').run(day,row.merchant_id,row.product_id,placement,campaignId,kind==='click'?1:0,kind==='impression'?1:0,kind==='visible'?1:0,pagePath,kind==='contact_click'?1:0);
   db.exec('COMMIT');return !!Number(inserted.changes);
  }catch{try{db.exec('ROLLBACK');}catch{}return false;}
 }
 function report(days=30,date=new Date(),campaignsOnly=false){
  const since=dayOf(new Date(date.getTime()-(days===7?6:29)*86400000));
  // Sponsor accounting must include low-volume campaigns outside the general traffic top 200.
  const scope=campaignsOnly?" AND campaign_id<>''":'',limit=campaignsOnly?'':' LIMIT 200';
  return db.prepare(`SELECT merchant_id,product_id,placement,campaign_id,SUM(clicks) clicks,SUM(impressions) impressions,SUM(visible) visible FROM merchant_outbound_days WHERE day>=? AND day<=?${scope} GROUP BY merchant_id,product_id,placement,campaign_id ORDER BY clicks DESC${limit}`).all(since,dayOf(date)).map(r=>({...r,ctr:r.impressions?r.clicks/r.impressions:null}));
 }
 return {purge,campaignsFor,activeCampaigns,viewToken,verifyViewToken,report,reportCampaigns:(days,date)=>report(days,date,true),reportSponsorDetail:(options,date)=>reportSponsorDetail(db,options,date),
  recordVisible(req,id,token,date=new Date()){
   if(typeof id!=='string'||id.length>250||typeof token!=='string')return false;
   const c=activeCampaign(id,date);if(!c||!sponsorMerchantAllowed(c.merchant_id))return false;
   const pagePath=verifyViewToken(c,token,date);if(pagePath===null)return false;
   return record({...req,method:'GET',headers:{...req.headers,'sec-fetch-dest':'document'}},c,{placement:c.placement,campaign:c,pagePath},'visible',date);
  },
  recordClick:(req,row,context,date=new Date())=>record(req,row,context,'click',date),
  recordContact:(req,row,context,date=new Date())=>context?.campaign&&activeCampaign(context.campaign.id,date)?record(req,row,context,'contact_click',date):false,
  recordOrganicImpression(req,row,date=new Date()){
   if(process.env.AIRADAR_ORGANIC_IMPRESSIONS==='off'||!['source','merchant_id','product_id','offer_id'].every(key=>field(row?.[key])))return false;
   return record(req,row,{placement:'product'},'impression',date);
  },
  recordImpression(req,campaign,date=new Date(),pagePath=''){
   const active=campaignsFor({source:campaign.source,productId:campaign.product_id},date).find(c=>c.id===campaign.id);if(!active)return false;
   return record(req,active,{placement:active.placement,campaign:active,pagePath},'impression',date);
  },
  saveCampaign(input,{approve=false,now=new Date(),actor='operator'}={}){
   for(const k of ['id','merchant_id','source','product_id','offer_id','label'])if(!field(input[k],k==='label'?80:250))throw new Error('Invalid campaign '+k);
   if(!sponsorMerchantAllowed(input.merchant_id))throw new Error('Shared or unresolved merchant requires verified platform shop identity before Sponsorship');
   if(!sponsorPlan(input.placement))throw sponsorError('广告位置无效');
   const start=Date.parse(input.start_at),end=Date.parse(input.end_at);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>366*86400000)throw new Error('Invalid campaign dates');
   const status=approve?'approved':input.status==='paused'?'paused':'draft',pageKey=input.page_key||input.source+'/'+input.product_id,pageLabel=String(input.page_label||pageKey).slice(0,150),amount=Number(input.amount_cny||0),note=String(input.note||'');
   if(!field(pageKey)||!Number.isSafeInteger(amount)||amount<0||amount>1000000||note.length>1000)throw sponsorError('请核对页面、金额及内部备注');
   const theme=input.theme||'amber',headline=String(input.headline||'').trim(),tagline=String(input.tagline||'').trim();
   if(!SPONSOR_THEMES.some(t=>t.key===theme)||(headline&&!field(headline,32))||(tagline&&!field(tagline,48)))throw sponsorError('请核对广告配色、主标题（32字内）和副标题（48字内）');
   const destination=input.destination_url||'';
   if(destination||input.source===WEBSITE_SPONSOR_SOURCE){
    const pinned={...input,destination_url:destination,page_key:pageKey};
    if(!field(destination,2048)||!(input.source===WEBSITE_SPONSOR_SOURCE?websiteSponsorOffer(pinned):quoteSponsorOffer(pinned)))throw sponsorError('广告落地页需使用归属一致的有效 HTTPS 地址及有效投放页面');
   }
   db.exec('BEGIN IMMEDIATE');try{
    const old=db.prepare('SELECT version FROM campaigns WHERE id=?').get(input.id);
    if(input.version!=null&&Number(input.version)!==(old?.version||0))throw sponsorError('活动已更新，请刷新后重试',409);
    if(approve){
     const overlaps=db.prepare("SELECT * FROM campaigns WHERE placement=? AND page_key=? AND status='approved' AND id<>? AND start_at<? AND end_at>?").all(input.placement,pageKey,input.id,new Date(end).toISOString(),new Date(start).toISOString());
     if(overlaps.some(c=>c.merchant_id===input.merchant_id))throw sponsorError('同一商家在该页面已有重叠档期',409);
     const points=overlaps.flatMap(c=>[[Math.max(start,Date.parse(c.start_at)),1],[Math.min(end,Date.parse(c.end_at)),-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let concurrent=0;for(const [,delta]of points){concurrent+=delta;if(concurrent>=SPONSOR_CAPACITY)throw sponsorError('该页面档期已达到 4 家上限，请调整时间',409);}
    }
    const version=(old?.version||0)+1;
    db.prepare('INSERT INTO campaigns(id,merchant_id,source,product_id,offer_id,label,placement,start_at,end_at,status,reviewed_at,page_key,page_label,version,amount_cny,note,theme,headline,tagline,destination_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET merchant_id=excluded.merchant_id,source=excluded.source,product_id=excluded.product_id,offer_id=excluded.offer_id,label=excluded.label,placement=excluded.placement,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status,reviewed_at=excluded.reviewed_at,page_key=excluded.page_key,page_label=excluded.page_label,version=excluded.version,amount_cny=excluded.amount_cny,note=excluded.note,theme=excluded.theme,headline=excluded.headline,tagline=excluded.tagline,destination_url=excluded.destination_url').run(input.id,input.merchant_id,input.source,input.product_id,input.offer_id,input.label,input.placement,new Date(start).toISOString(),new Date(end).toISOString(),status,approve?now.toISOString():null,pageKey,pageLabel,version,amount,note,theme,headline,tagline,destination);
    audit(input.id,status,version,actor,now);db.exec('COMMIT');return {id:input.id,status,version};
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  setCampaignStatus(id,status,{version,actor='operator',now=new Date()}={}){
   if(!['paused','draft'].includes(status))throw sponsorError('无效操作');db.exec('BEGIN IMMEDIATE');try{const row=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!row)throw sponsorError('活动不存在',404);if(Number(version)!==row.version)throw sponsorError('活动已更新，请刷新后重试',409);db.prepare('UPDATE campaigns SET status=?,version=version+1 WHERE id=?').run(status,id);audit(id,status,row.version+1,actor,now);db.exec('COMMIT');return true;}catch(error){db.exec('ROLLBACK');throw error;}
  },
  actions:id=>db.prepare('SELECT * FROM sponsor_actions WHERE campaign_id=? ORDER BY id DESC LIMIT 30').all(id),
  listCampaigns:()=>db.prepare('SELECT * FROM campaigns ORDER BY start_at DESC,id').all()
 };
}
