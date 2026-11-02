// Public weekly listing report. Prices come from collected quotes and the
// snapshots written while the site observes them. Nothing here is a paid price,
// a reputation score, or an official endorsement.
import {retentionDay} from './retention-store.mjs';
import {retiredCatalogItem} from './catalog-policy.mjs';
import {outboundHref,resolveOutboundOffer} from './outbound.mjs';
import {sponsorMerchantAllowed} from './merchant-analytics.mjs';

export const WEEKLY_PRODUCTS=Object.freeze([
 'chatgpt-plus','chatgpt-go','chatgpt-pro-5x','chatgpt-pro-20x',
 'claude-pro','claude-max-5x','claude-max-20x',
 'gemini-pro','gemini-ultra','super-grok','cursor-pro',
]);
const MONTHLY=/^(?:1m|30d):/;
const WEEK=/^(\d{4})-W(\d{2})$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const text=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim();

export class WeeklyReportError extends Error{
 constructor(message,status=422){super(message);this.status=status;}
}

export function isoWeek(day){
 if(!DAY.test(day))return null;
 const [year,month,date]=day.split('-').map(Number);
 const current=new Date(Date.UTC(year,month-1,date));
 if(current.toISOString().slice(0,10)!==day)return null;
 const weekday=current.getUTCDay()||7;
 current.setUTCDate(current.getUTCDate()+4-weekday);
 const isoYear=current.getUTCFullYear();
 const start=new Date(Date.UTC(isoYear,0,1));
 const week=Math.ceil((((current-start)/86400000)+1)/7);
 return `${isoYear}-W${String(week).padStart(2,'0')}`;
}
export function isoWeekBounds(week){
 const match=WEEK.exec(week);
 if(!match)return null;
 const year=Number(match[1]),index=Number(match[2]);
 if(index<1||index>53)return null;
 const jan4=new Date(Date.UTC(year,0,4));
 const monday=new Date(jan4);
 monday.setUTCDate(jan4.getUTCDate()-((jan4.getUTCDay()||7)-1)+(index-1)*7);
 const start=monday.toISOString().slice(0,10);
 if(isoWeek(start)!==week)return null;
 const sunday=new Date(monday);
 sunday.setUTCDate(monday.getUTCDate()+6);
 return {week,start,end:sunday.toISOString().slice(0,10)};
}
export function addIsoWeeks(week,delta){
 const bounds=isoWeekBounds(week);
 if(!bounds||!Number.isInteger(delta))return null;
 const [year,month,date]=bounds.start.split('-').map(Number);
 const next=new Date(Date.UTC(year,month-1,date));
 next.setUTCDate(next.getUTCDate()+delta*7);
 return isoWeek(next.toISOString().slice(0,10));
}
export function currentIsoWeek(now=new Date()){return isoWeek(retentionDay(now));}
export function weekLabel(week){
 const bounds=isoWeekBounds(week);
 return bounds?`${bounds.week.slice(0,4)}年第${Number(bounds.week.slice(6))}周`:'';
}

export function ensureWeeklySchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS retention_market_weeks(
  week TEXT NOT NULL, group_id TEXT NOT NULL, product_key TEXT NOT NULL,
  low REAL NOT NULL, latest_low REAL NOT NULL, median REAL, high REAL,
  offer_count INTEGER, shop_count INTEGER, shops TEXT NOT NULL, payload TEXT NOT NULL,
  observed_at TEXT NOT NULL, PRIMARY KEY(week, group_id));
 CREATE TABLE IF NOT EXISTS retention_weekly_notes(
  week TEXT PRIMARY KEY, passphrase TEXT NOT NULL DEFAULT '', post_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS retention_weekly_sponsors(
  id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT NOT NULL, merchant_public_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL, blurb TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(week, merchant_public_id));`);
}

function tableExists(db,name){
 if(!db)return false;
 return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function cleanShops(value){
 let parsed=value;
 if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{parsed=[];}}
 if(!Array.isArray(parsed))return [];
 const shops=[];
 for(const shop of parsed){
  if(!shop||typeof shop.id!=='string'||!sponsorMerchantAllowed(shop.id))continue;
  const host=text(shop.host||shop.id.slice(7)).toLowerCase().slice(0,253);
  const name=text(shop.name||host).slice(0,80);
  if(!name||!host)continue;
  shops.push({id:shop.id.toLowerCase(),name,host});
  if(shops.length>=80)break;
 }
 return shops;
}
function payloadOf(group,shopsComplete){
 return JSON.stringify({
  name:text(group.name).slice(0,120),
  spec:text(group.spec).slice(0,160),
  comparisonKey:text(group.comparisonKey).slice(0,240),
  currency:text(group.currency).slice(0,12),
  family:text(group.family).slice(0,40),
  productKey:text(group.productKey).slice(0,80),
  shopsComplete:!!shopsComplete,
 });
}
export function snapshotWeeklyMarket(db,groups,now=new Date()){
 if(!db||!Array.isArray(groups))return;
 ensureWeeklySchema(db);
 const week=currentIsoWeek(now),stamp=new Date(now).toISOString();
 const save=db.prepare(`INSERT INTO retention_market_weeks(week,group_id,product_key,low,latest_low,median,high,offer_count,shop_count,shops,payload,observed_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(week,group_id) DO UPDATE SET product_key=excluded.product_key,
   low=MIN(retention_market_weeks.low,excluded.low), latest_low=excluded.latest_low, median=excluded.median,
   high=excluded.high, offer_count=excluded.offer_count, shop_count=excluded.shop_count, shops=excluded.shops,
   payload=excluded.payload, observed_at=excluded.observed_at`);
 for(const group of groups){
  if(!group||retiredCatalogItem(group)||group.state!=='available'||!Number.isFinite(Number(group.price)))continue;
  if(typeof group.id!=='string'||typeof group.productKey!=='string')continue;
  const shops=cleanShops(group.shops);
  const median=Number.isFinite(Number(group.median))?Number(group.median):null;
  const high=Number.isFinite(Number(group.maxPrice))?Number(group.maxPrice):null;
  save.run(week,group.id,group.productKey,Number(group.price),Number(group.price),median,high,
   Number.isFinite(Number(group.offerCount))?Number(group.offerCount):null,
   Number.isFinite(Number(group.shopCount))?Number(group.shopCount):null,
   JSON.stringify(shops),payloadOf(group,group.shopsComplete!==false),stamp);
 }
}

function readPayload(value){
 try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'?parsed:null;}catch{return null;}
}
function changePct(next,previous){
 if(!Number.isFinite(next)||!Number.isFinite(previous)||!(previous>0))return null;
 return (next-previous)/previous*100;
}
function dailyLows(db,start,end){
 if(!tableExists(db,'retention_market_daily'))return new Map();
 const rows=db.prepare('SELECT group_id,MIN(low) low,COUNT(*) days FROM retention_market_daily WHERE day>=? AND day<=? GROUP BY group_id').all(start,end);
 return new Map(rows.map(row=>[row.group_id,{low:row.low,days:row.days}]));
}
function snapshotRows(db,week){
 if(!tableExists(db,'retention_market_weeks'))return [];
 return db.prepare('SELECT * FROM retention_market_weeks WHERE week=?').all(week);
}
function knownMeta(db){
 const meta=new Map();
 if(!tableExists(db,'retention_market'))return meta;
 for(const row of db.prepare('SELECT payload FROM retention_market').all()){
  const group=readPayload(row.payload);
  if(!group||retiredCatalogItem(group)||typeof group.id!=='string')continue;
  meta.set(group.id,group);
 }
 return meta;
}
function movesFor(db,start,end,meta){
 if(!tableExists(db,'retention_market_daily'))return [];
 const grouped=new Map();
 for(const row of db.prepare('SELECT group_id,day,last_price FROM retention_market_daily WHERE day>=? AND day<=? ORDER BY day').all(start,end)){
  if(!grouped.has(row.group_id))grouped.set(row.group_id,[]);
  grouped.get(row.group_id).push(row);
 }
 const moves=[];
 for(const [id,series] of grouped){
  const group=meta.get(id);
  if(!group||series.length<2)continue;
  const first=series[0],last=series.at(-1);
  const change=changePct(last.last_price,first.last_price);
  if(!Number.isFinite(change)||Math.abs(change)<1)continue;
  moves.push({id,name:group.name,spec:group.spec,currency:group.currency,family:group.family,productKey:group.productKey,comparisonKey:group.comparisonKey,firstPrice:first.last_price,lastPrice:last.last_price,change,days:series.length,from:first.day,to:last.day});
 }
 return moves.sort((a,b)=>a.change-b.change||String(a.name).localeCompare(String(b.name),'zh-CN')).slice(0,16);
}
function shopSet(rows){
 const shops=new Map();
 let complete=true;
 for(const row of rows){
  const payload=readPayload(row.payload);
  if(payload&&payload.shopsComplete===false)complete=false;
  for(const shop of cleanShops(row.shops))if(!shops.has(shop.id))shops.set(shop.id,shop);
 }
 return {shops,complete,present:rows.length>0};
}
export function xPostUrl(value){
 const raw=text(value);
 if(!raw)return '';
 if(raw.length>300)return null;
 let url;
 try{url=new URL(raw);}catch{return null;}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(host))return null;
 if(!/^\/[^/]+\/status\/\d+/.test(url.pathname))return null;
 url.hash='';
 return url.href;
}
function editableWeek(week,now){
 const bounds=isoWeekBounds(week);
 if(!bounds)return null;
 const current=currentIsoWeek(now);
 const newest=addIsoWeeks(current,1),oldest=addIsoWeeks(current,-16);
 if(!newest||!oldest||week>newest||week<oldest)return null;
 return bounds;
}
export function defaultStatsRange(week,now=new Date()){
 const bounds=isoWeekBounds(week),today=retentionDay(now);
 if(!bounds)return {from:today,to:today};
 const to=bounds.end<today?bounds.end:today;
 return {from:bounds.start,to:to<bounds.start?bounds.start:to};
}
export function weeklyNote(db,week){
 ensureWeeklySchema(db);
 return db.prepare('SELECT passphrase,post_url FROM retention_weekly_notes WHERE week=?').get(week)||{passphrase:'',post_url:''};
}
export function weeklySponsors(db,week){
 ensureWeeklySchema(db);
 if(!tableExists(db,'merchant_applications'))return db.prepare('SELECT id,blurb,merchant_public_id,merchant_id FROM retention_weekly_sponsors WHERE week=? ORDER BY id').all(week);
 return db.prepare(`SELECT s.id,s.blurb,s.merchant_public_id,s.merchant_id,a.shop_name,a.status FROM retention_weekly_sponsors s
  LEFT JOIN merchant_applications a ON a.public_id=s.merchant_public_id WHERE s.week=? ORDER BY s.id`).all(week);
}
const adminEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function weeklyAdminContent({csrf,week,choices,note,sponsors,merchants,stats,error}){
 const token=`<input type="hidden" name="csrf" value="${adminEsc(csrf)}"><input type="hidden" name="week" value="${adminEsc(week)}"><input type="hidden" name="from" value="${adminEsc(stats.from||'')}"><input type="hidden" name="to" value="${adminEsc(stats.to||'')}">`;
 const views=stats.viewsKnown?String(stats.views):'未采集';
 const click=row=>stats.clicksKnown?String(row.clicks):'未采集';
 return `${error?`<p class="status-warning" role="alert">${adminEsc(error)}</p>`:''}<p>口令和赞助位按周保存，只在对应周报公开。口令只出现在当前这一周；赞助店铺必须已经收录，跳转走现有的出站确认，便于把点击记到这家店。这里不改审核状态，也不发邮件。</p>
 <form method="get" action="/admin/weekly"><label>编辑哪一周 <select name="week">${choices.map(item=>`<option value="${adminEsc(item)}"${item===week?' selected':''}>${adminEsc(weekLabel(item))}</option>`).join('')}</select></label><label>统计开始 <input type="date" name="from" value="${adminEsc(stats.from||'')}" required></label><label>统计结束 <input type="date" name="to" value="${adminEsc(stats.to||'')}" required></label><button>查看</button></form>
 <section><h2>本周口令</h2><p>留空就在公开页隐藏。活动帖只接受 X 或 Twitter 的 status 链接。</p><form method="post" action="/admin/weekly">${token}<label>口令 <input name="passphrase" maxlength="40" value="${adminEsc(note.passphrase||'')}" placeholder="例如 WEEKEND"></label><label>X 活动帖 <input name="post_url" maxlength="300" value="${adminEsc(note.post_url||'')}" placeholder="https://x.com/name/status/123"></label><button name="action" value="save_note">保存口令</button></form></section>
 <section><h2>本周赞助</h2><p>公开页会标明「赞助位，不代表推荐或担保」。没有可核验的公开报价时只显示说明，不给出跳转。</p><form method="post" action="/admin/weekly">${token}<label>已收录店铺 <select name="merchant" required><option value="">选择店铺</option>${merchants.map(shop=>`<option value="${adminEsc(shop.public_id)}">${adminEsc(shop.shop_name)} · ${adminEsc(shop.identity.slice(7))}</option>`).join('')}</select></label><label>赞助了什么 <input name="blurb" maxlength="80" required placeholder="例如：本周 ChatGPT Plus 月付挂牌"></label><button name="action" value="add_sponsor">加入本周</button></form>
 ${sponsors.length?sponsors.map(shop=>`<article><strong>${adminEsc(shop.shop_name||shop.merchant_id)}</strong><p>${adminEsc(shop.blurb)}</p><p class="muted">${adminEsc(shop.status||'记录中的身份')} · ${adminEsc(shop.merchant_id)}</p><form method="post" action="/admin/weekly">${token}<input type="hidden" name="id" value="${shop.id}"><button name="action" value="remove_sponsor">从本周移除</button></form></article>`).join(''):'<p>这一周还没有赞助位。</p>'}${merchants.length?'':'<p>当前没有可放入赞助位的已收录店铺。共享平台或无法按域名归属的店铺不会出现在这里。</p>'}</section>
 <section><h2>这段日期的周报统计</h2><p class="privacy-note">浏览量沿用公开页统计，只计成功打开周报固定地址的文档请求，不保存 IP、浏览器原文或查询参数；刷新会重复计数。出站点击沿用原有跳转统计，按日去重，只统计从周报赞助位离开、并且符合统计条件的点击。没有启用对应统计时显示「未采集」，不会把缺失写成 0。这些数字不是成交，也不是人数。</p><p>周报浏览量：${adminEsc(views)}</p>${stats.error?`<p>${adminEsc(stats.error)}</p>`:''}<div class="table"><table><thead><tr><th>店铺</th><th>赞助说明</th><th>周报出站点击</th></tr></thead><tbody>${stats.sponsors?.length?stats.sponsors.map(row=>`<tr><td>${adminEsc(row.name)}${row.configured?'':'<small>名单里已没有这家店，点击记录仍保留</small>'}</td><td>${adminEsc(row.blurb||'—')}</td><td>${adminEsc(click(row))}</td></tr>`).join(''):'<tr><td colspan="3">这段日期没有周报赞助位，也没有记到从周报离开的点击。</td></tr>'}</tbody></table></div></section>`;
}
export function adminWeekChoices(now=new Date()){
 const current=currentIsoWeek(now),weeks=[];
 for(let delta=1;delta>=-16;delta--)weeks.push(addIsoWeeks(current,delta));
 return weeks.filter(Boolean);
}
export function listApprovedWeeklyMerchants(db){
 if(!tableExists(db,'merchant_applications'))return [];
 return db.prepare("SELECT public_id,shop_name,identity FROM merchant_applications WHERE status='approved' ORDER BY shop_name,public_id").all()
  .filter(row=>sponsorMerchantAllowed(row.identity)).slice(0,100);
}
export function saveWeeklyNote(db,{week,passphrase,postUrl,actor='',now=new Date()}={}){
 ensureWeeklySchema(db);
 const bounds=editableWeek(week,now);
 if(!bounds)throw new WeeklyReportError('只能编辑本周、下一周和最近 16 周的口令');
 const words=text(passphrase);
 if([...words].length>40||/[<>]/.test(words))throw new WeeklyReportError('口令请控制在 40 个字以内，并且不要包含 HTML');
 const link=xPostUrl(postUrl);
 if(link==null)throw new WeeklyReportError('活动帖请填写 https://x.com/账号/status/数字 链接，或留空');
 db.prepare(`INSERT INTO retention_weekly_notes(week,passphrase,post_url,updated_at,actor) VALUES(?,?,?,?,?)
  ON CONFLICT(week) DO UPDATE SET passphrase=excluded.passphrase,post_url=excluded.post_url,updated_at=excluded.updated_at,actor=excluded.actor`)
  .run(bounds.week,words,link,new Date(now).toISOString(),text(actor).slice(0,80));
 return {week:bounds.week,passphrase:words,postUrl:link};
}
export function addWeeklySponsor(db,{week,merchantPublicId,blurb,now=new Date()}={}){
 ensureWeeklySchema(db);
 const bounds=editableWeek(week,now);
 if(!bounds)throw new WeeklyReportError('只能编辑本周、下一周和最近 16 周的赞助位');
 const note=text(blurb);
 if(!note||[...note].length>80||/[<>]/.test(note))throw new WeeklyReportError('请用 80 字以内说明这项赞助，不要包含 HTML');
 const id=text(merchantPublicId).slice(0,64);
 const merchant=tableExists(db,'merchant_applications')?db.prepare("SELECT public_id,identity,status FROM merchant_applications WHERE public_id=?").get(id):null;
 if(!merchant||merchant.status!=='approved'||!sponsorMerchantAllowed(merchant.identity))throw new WeeklyReportError('只能选择当前已收录、并且可以按店铺统计跳转的商家');
 const count=db.prepare('SELECT COUNT(*) n FROM retention_weekly_sponsors WHERE week=?').get(bounds.week).n;
 if(count>=6)throw new WeeklyReportError('每一周最多 6 个赞助位');
 try{
  db.prepare('INSERT INTO retention_weekly_sponsors(week,merchant_public_id,merchant_id,blurb,created_at) VALUES(?,?,?,?,?)').run(bounds.week,merchant.public_id,merchant.identity.toLowerCase(),note,new Date(now).toISOString());
 }catch(error){
  if(String(error.message).includes('UNIQUE'))throw new WeeklyReportError('这家店铺已经在本周赞助名单里');
  throw error;
 }
 return {week:bounds.week};
}
export function removeWeeklySponsor(db,{week,id,now=new Date()}={}){
 ensureWeeklySchema(db);
 const bounds=editableWeek(week,now);
 const sponsorId=Number(id);
 if(!bounds||!Number.isInteger(sponsorId))throw new WeeklyReportError('没有找到要移除的赞助位');
 const removed=db.prepare('DELETE FROM retention_weekly_sponsors WHERE id=? AND week=?').run(sponsorId,bounds.week).changes;
 if(!removed)throw new WeeklyReportError('没有找到要移除的赞助位',404);
}
export function weeklySponsorHref(db,merchantId,now=Date.now()){
 if(!db||!sponsorMerchantAllowed(merchantId)||!tableExists(db,'snapshots'))return null;
 const identity=merchantId.toLowerCase();
 for(const source of ['direct-shops','ldxp-goods']){
  const latest=db.prepare('SELECT snapshot_id FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);
  if(!latest)continue;
  const offers=db.prepare('SELECT offer_id,product_id FROM offers WHERE source=? AND snapshot_id=? AND merchant_id=? LIMIT 30').all(source,latest.snapshot_id,identity);
  for(const offer of offers){
   const fields={source,snapshot:latest.snapshot_id,product:offer.product_id,offer:offer.offer_id};
   const row=resolveOutboundOffer(db,fields,now);
   if(!row||row.merchant_id.toLowerCase()!==merchantId.toLowerCase())continue;
   const href=outboundHref({source,snapshot_id:latest.snapshot_id,product_id:offer.product_id,offer_id:offer.offer_id},{},{placement:'weekly_report'});
   if(!href)continue;
   const destination=new URL(row.destination);
   return {href,destination:row.destination,host:destination.hostname.replace(/^www\./,'')};
  }
 }
 return null;
}
function publicSponsors(privateDb,quotesDb,week,now){
 if(!tableExists(privateDb,'retention_weekly_sponsors')||!tableExists(privateDb,'merchant_applications'))return [];
 const sponsors=[];
 for(const row of privateDb.prepare('SELECT merchant_public_id,blurb FROM retention_weekly_sponsors WHERE week=? ORDER BY id').all(week)){
  const merchant=privateDb.prepare('SELECT shop_name,identity,status FROM merchant_applications WHERE public_id=?').get(row.merchant_public_id);
  if(!merchant||merchant.status!=='approved'||!sponsorMerchantAllowed(merchant.identity))continue;
  const link=weeklySponsorHref(quotesDb,merchant.identity,+now);
  sponsors.push({name:merchant.shop_name,blurb:row.blurb,href:link?.href||'',host:link?.host||'',destination:link?.destination||''});
 }
 return sponsors;
}
function publicPassphrase(privateDb,week,current){
 if(!current||!tableExists(privateDb,'retention_weekly_notes'))return null;
 const row=privateDb.prepare('SELECT passphrase,post_url FROM retention_weekly_notes WHERE week=?').get(week);
 const passphrase=text(row?.passphrase);
 if(!passphrase)return null;
 return {passphrase,postUrl:xPostUrl(row.post_url)||''};
}
export function weeklyWeeksWithData(db,now=new Date()){
 const today=retentionDay(now),current=isoWeek(today),weeks=new Set([current]);
 if(tableExists(db,'retention_market_weeks'))for(const row of db.prepare('SELECT DISTINCT week FROM retention_market_weeks').all())weeks.add(row.week);
 if(tableExists(db,'retention_market_daily'))for(const row of db.prepare('SELECT DISTINCT day FROM retention_market_daily WHERE day<=?').all(today)){const week=isoWeek(row.day);if(week)weeks.add(week);}
 return [...weeks].filter(week=>{const bounds=isoWeekBounds(week);return bounds&&bounds.start<=today;}).sort().slice(-12);
}
function merchantName(privateDb,merchantId){
 if(!tableExists(privateDb,'merchant_applications'))return merchantId.slice(7);
 return privateDb.prepare('SELECT shop_name FROM merchant_applications WHERE identity=?').get(merchantId)?.shop_name||merchantId.slice(7);
}
export function weeklySponsorStats(privateDb,analytics,{from,to}={}){
 if(!DAY.test(from||'')||!DAY.test(to||'')||from>to||(Date.parse(to)-Date.parse(from))/86400000>366)return {error:'请选择不超过 366 天的起止日期'};
 ensureWeeklySchema(privateDb);
 const viewsKnown=typeof analytics?.weeklyReportViews==='function';
 const clicksKnown=!!analytics?.db&&tableExists(analytics.db,'merchant_outbound_days');
 const clicks=new Map();
 if(clicksKnown)for(const row of analytics.db.prepare("SELECT merchant_id,SUM(clicks) clicks FROM merchant_outbound_days WHERE placement='weekly_report' AND day>=? AND day<=? GROUP BY merchant_id").all(from,to))clicks.set(row.merchant_id,Number(row.clicks));
 const grouped=new Map();
 for(const row of privateDb.prepare('SELECT week,merchant_id,blurb FROM retention_weekly_sponsors ORDER BY id').all()){
  const bounds=isoWeekBounds(row.week);
  if(!bounds||bounds.end<from||bounds.start>to)continue;
  const current=grouped.get(row.merchant_id)||{merchantId:row.merchant_id,name:merchantName(privateDb,row.merchant_id),blurbs:[],configured:true};
  current.blurbs.push(row.blurb);
  grouped.set(row.merchant_id,current);
 }
 for(const [merchantId] of clicks)if(!grouped.has(merchantId))grouped.set(merchantId,{merchantId,name:merchantName(privateDb,merchantId),blurbs:[],configured:false});
 const sponsors=[...grouped.values()].map(row=>({...row,blurb:[...new Set(row.blurbs)].join('；'),clicks:clicksKnown?clicks.get(row.merchantId)||0:null})).sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN'));
 return {from,to,views:viewsKnown?analytics.weeklyReportViews(from,to):null,viewsKnown,clicksKnown,sponsors};
}

export function buildWeeklyReport({quotesDb=null,privateDb=null,market=null,now=new Date(),week=currentIsoWeek(now)}={}){
 const today=retentionDay(now),current=isoWeek(today),bounds=isoWeekBounds(week||current);
 if(!bounds||bounds.start>today)return null;
 const isCurrent=bounds.week===current;
 if(privateDb)ensureWeeklySchema(privateDb);
 const snapshots=privateDb?snapshotRows(privateDb,bounds.week):[];
 const daily=privateDb?dailyLows(privateDb,bounds.start,today<bounds.end?today:bounds.end):new Map();
 const live=new Map();
 for(const group of market?.groups||[]){
  if(!group||retiredCatalogItem(group)||group.state!=='available'||!Number.isFinite(Number(group.price)))continue;
  live.set(group.id,group);
 }
 if(!isCurrent&&!snapshots.length&&!daily.size)return null;
 const meta=new Map(live);
 if(privateDb)for(const [id,group] of knownMeta(privateDb))if(!meta.has(id))meta.set(id,group);
 for(const row of snapshots){
  const payload=readPayload(row.payload);
  if(payload&&!retiredCatalogItem(payload))meta.set(row.group_id,{...payload,id:row.group_id});
 }
 const previousBounds=isoWeekBounds(addIsoWeeks(bounds.week,-1));
 const previousSnapshots=privateDb&&previousBounds?snapshotRows(privateDb,previousBounds.week):[];
 const previousDaily=privateDb&&previousBounds?dailyLows(privateDb,previousBounds.start,previousBounds.end):new Map();
 const snapshotById=new Map(snapshots.map(row=>[row.group_id,row]));
 const previousById=new Map(previousSnapshots.map(row=>[row.group_id,row]));
 const rows=[];
 for(const [id,group] of meta){
  if(!WEEKLY_PRODUCTS.includes(group.productKey)||!MONTHLY.test(group.comparisonKey||''))continue;
  const shot=snapshotById.get(id),prior=previousById.get(id),priorDaily=previousDaily.get(id);
  let coverage=null,low=null,latestLow=null,median=null,offerCount=null,shopCount=null;
  if(shot){
   coverage='snapshot';low=shot.low;latestLow=shot.latest_low;median=shot.median;offerCount=shot.offer_count;shopCount=shot.shop_count;
  }else if(isCurrent&&live.has(id)){
   const currentGroup=live.get(id);
   coverage='live';low=currentGroup.price;latestLow=currentGroup.price;median=Number.isFinite(Number(currentGroup.median))?Number(currentGroup.median):null;offerCount=currentGroup.offerCount;shopCount=currentGroup.shopCount;
  }else if(daily.has(id)){
   coverage='daily';low=daily.get(id).low;
  }else continue;
  const previousLow=prior?prior.low:priorDaily?priorDaily.low:null;
  rows.push({id,name:group.name,spec:group.spec,comparisonKey:group.comparisonKey,currency:group.currency,family:group.family,productKey:group.productKey,low,latestLow,median,offerCount,shopCount,coverage,previousLow,lowChange:changePct(low,previousLow),medianChange:shot&&prior&&Number.isFinite(shot.median)&&Number.isFinite(prior.median)?changePct(shot.median,prior.median):null});
 }
 const order=new Map(WEEKLY_PRODUCTS.map((key,index)=>[key,index]));
 const currencyRank=currency=>currency==='CNY'?0:currency==='USD'?1:currency==='USDT'?2:3;
 rows.sort((a,b)=>(order.get(a.productKey)-order.get(b.productKey))||Number(a.comparisonKey.startsWith('30d'))-Number(b.comparisonKey.startsWith('30d'))||currencyRank(a.currency)-currencyRank(b.currency)||a.currency.localeCompare(b.currency)||a.spec.localeCompare(b.spec,'zh-CN'));
 const shown=rows.slice(0,40);
 const currentShops=shopSet(snapshots);
 const priorShops=shopSet(previousSnapshots);
 let newShops=null;
 if(priorShops.present){
  newShops=[...currentShops.shops.values()].filter(shop=>!priorShops.shops.has(shop.id)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 }
 const limitations=[];
 if(!privateDb)limitations.push('行情保留库没有启用，所以这次只显示当前观察，不会留下供下周比较的快照。');
 else if(!previousSnapshots.length)limitations.push(previousDaily.size?'上一周还没有周快照。最低挂牌价可以和那一周的每日最低记录比较；中位数、报价数、店铺数和新出现的店铺要从有快照的一周才开始对照。':'上一周没有已保存的观察，不能计算涨跌，也不能判断哪些店铺是新出现的。');
 if(shown.some(row=>row.coverage==='daily'))limitations.push('这一周没有完整周快照，缺少快照的规格只显示每日记录中的最低挂牌价。中位数、报价数和店铺数当时没有保存。');
 if(shown.some(row=>row.coverage==='live'))limitations.push('还没有写入本周快照的规格，显示的是本次观察。');
 if(isCurrent&&today<bounds.end)limitations.push(`本周还没有结束。数字截至北京时间 ${today}，之后的观察会继续写入 ${bounds.week}。`);
 if((currentShops.present||priorShops.present)&&(!currentShops.complete||!priorShops.complete))limitations.push('有规格的店铺名单超过保存上限，新出现的店铺可能没有列全。');
 if(rows.length>shown.length)limitations.push('主要规格较多，这一页只列出前 40 条。');
 const recorded=privateDb&&tableExists(privateDb,'retention_market_daily')?privateDb.prepare('SELECT COUNT(DISTINCT day) n FROM retention_market_daily WHERE day>=? AND day<=?').get(bounds.start,today<bounds.end?today:bounds.end).n:0;
 const description=`${weekLabel(bounds.week)}的 AI 订阅公开挂牌观察，列出 ${shown.length} 个有记录的主要规格。最低价、中位数和店铺数都来自本站收录的公开报价，不是成交价，也不代表推荐。`;
 return {
  week:bounds.week,label:weekLabel(bounds.week),start:bounds.start,end:bounds.end,today,current:isCurrent,partial:isCurrent&&today<bounds.end,
  rows:shown,moves:movesFor(privateDb,bounds.start,today<bounds.end?today:bounds.end,meta),newShops,newShopCount:newShops?newShops.length:null,
  limitations,daysRecorded:recorded,description,
  passphrase:privateDb?publicPassphrase(privateDb,bounds.week,isCurrent):null,
  sponsors:privateDb?publicSponsors(privateDb,quotesDb,bounds.week,now):[],
  archive:(privateDb?weeklyWeeksWithData(privateDb,now):[current]).map(item=>({week:item,label:weekLabel(item)})),
 };
}
