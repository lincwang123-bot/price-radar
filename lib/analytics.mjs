import {initGrowthAnalytics} from './growth-analytics.mjs';
import {priceRoute} from './price-routes.mjs';
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import {initMerchantAnalytics} from './merchant-analytics.mjs';
import {ARTICLES,contentForPath,articleForPath} from './guides.mjs';
import {isoWeekBounds} from './weekly-report.mjs';

const PUBLIC_PATHS = new Set(["/", "/index.html", "/catalog", "/about", "/contact", "/product", "/alerts", "/sources", "/privacy", "/weekly", "/shop", "/official-prices"]);
const ENGLISH_PUBLIC_PATHS=new Set(['/','/catalog','/official-prices','/shop','/about','/sources']);
const BOT = /bot|spider|crawler|headless|curl|wget|python|httpclient|monitor|uptime|price.?radar.?qa|lighthouse|facebookexternalhit|preview|slurp/i;
export const analyticsDay = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const dayBefore = (date, days) => analyticsDay(new Date(new Date(date).getTime() - days * 86400000));

export function engagedMode(value=process.env.AIRADAR_ANALYTICS_ENGAGED){
 const mode=String(value||'').toLowerCase();return ['report','filter','off'].includes(mode)?mode:'report';
}
function publicIdentity(req,secret){
 if(req.scrapeGuardAction)return null;
  let pathname,publicUrl;
  try {
    publicUrl=new URL(req.url,'https://airadar.vip');pathname=publicUrl.pathname;
    // Only map published English routes, not arbitrary /en/* private paths.
    if(pathname.startsWith('/en/')){
      const candidate=pathname.slice(3);
      if(ENGLISH_PUBLIC_PATHS.has(candidate)||priceRoute({pathname:candidate})){pathname=candidate;publicUrl.pathname=candidate;}
    }
  } catch { return null; }
  const weeklyReport=/^\/weekly\/(\d{4}-W\d{2})$/.exec(pathname);
  if (!PUBLIC_PATHS.has(pathname)&&!contentForPath(pathname)&&!priceRoute(publicUrl)&&!(weeklyReport&&isoWeekBounds(weeklyReport[1]))) return null;
  if(/(?:^|;)\s*airadar_admin=/.test(String(req.headers.cookie||"")))return null;
  const ua = String(req.headers["user-agent"] || "");
  if (!ua || BOT.test(ua) || !/Mozilla\//.test(ua)) return null;
  if (/prefetch|prerender/i.test(String(req.headers.purpose || req.headers["sec-purpose"] || ""))) return null;
  const dest = req.headers["sec-fetch-dest"];
  if (dest && dest !== "document") return null;
  const remote = String(req.socket.remoteAddress || "");
  const trustedProxy = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
  // Production is bound to loopback behind this site's Cloudflare Tunnel. Never trust XFF.
  if(!trustedProxy)return null;
  const address = String(req.headers["cf-connecting-ip"] || "");
  if (!isIP(address) || ["127.0.0.1","::1"].includes(address)) return null;
  // Deliberately coarse: this is an estimated network/browser identity, not a person.
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const visitor = createHmac("sha256", secret).update(address + "|" + browser).digest("hex");

  return {visitor,pathname,weeklyReport};
}

/** No raw addresses, user agents, URLs, query strings, or form content are stored. */
export function openAnalytics(dbPath, secret, { now = new Date(), clock = () => new Date() } = {}) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("统计摘要密钥未配置");
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5;
    CREATE TABLE IF NOT EXISTS analytics_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analytics_days(day TEXT PRIMARY KEY,pv INTEGER NOT NULL DEFAULT 0,uv INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS analytics_visitors(day TEXT NOT NULL,visitor TEXT NOT NULL,PRIMARY KEY(day,visitor));
    CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON analytics_visitors(visitor,day);
    CREATE TABLE IF NOT EXISTS analytics_content_days(day TEXT NOT NULL,article TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,quote_visits INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,article));
    CREATE TABLE IF NOT EXISTS analytics_weekly_views(day TEXT NOT NULL,week TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,week));`);
  db.prepare("INSERT OR IGNORE INTO analytics_meta VALUES('started_at',?)").run(now.toISOString());
  db.prepare("INSERT OR IGNORE INTO analytics_meta VALUES('content_started_at',?)").run(now.toISOString());
  const outbound=initMerchantAnalytics(db,secret);
  const growth=initGrowthAnalytics(db,secret,now);
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_engaged_days(day TEXT PRIMARY KEY,pv INTEGER NOT NULL DEFAULT 0,uv INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS analytics_engaged_visitors(day TEXT NOT NULL,visitor TEXT NOT NULL,PRIMARY KEY(day,visitor));`);
 const recent=new Map(),engagedLimits=new Map();let engagedBucket=-1,engagedCount=0;
 // A coarse in-memory visitor window merges concurrent heartbeat and interaction signals.
 // It deliberately undercounts rapid repeat visits without persisting page identifiers.
 function recordEngaged(req,date=clock(),statusCode=200,response=null){
  if(engagedMode()==='off'||req.method!=='GET'||statusCode!==200||response?.scrapeGuardAction)return false;
  const identity=publicIdentity(req,secret);if(!identity)return false;
  const {visitor}=identity,t=+new Date(date),minute=Math.floor(t/60000);
  if(engagedBucket!==minute){engagedBucket=minute;engagedLimits.clear();engagedCount=0;}
  if(engagedCount>=600||(engagedLimits.get(visitor)||0)>=60)return false;
  engagedCount++;engagedLimits.set(visitor,(engagedLimits.get(visitor)||0)+1);
  for(const [key,at] of recent)if(t-at>=30000)recent.delete(key);
  if(recent.has(visitor))return false;
  try{purge(date);db.exec('BEGIN IMMEDIATE');const day=analyticsDay(date);
   const added=db.prepare('INSERT OR IGNORE INTO analytics_engaged_visitors VALUES(?,?)').run(day,visitor);
   db.prepare('INSERT INTO analytics_engaged_days VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET pv=pv+1,uv=uv+excluded.uv').run(day,Number(added.changes));
   db.exec('COMMIT');recent.set(visitor,t);return true;
  }catch{try{db.exec('ROLLBACK');}catch{}healthy=false;return false;}
 }
 function interaction(req,date){
  let target;
  if(req.method==='GET'&&publicIdentity(req,secret))target=new URL(req.url,'https://airadar.vip');
  else try{target=new URL(req.headers.referer);}catch{return;}
  if(!['https://airadar.vip','https://www.airadar.vip'].includes(target.origin))return;
  recordEngaged({...req,method:'GET',url:target.pathname,headers:{...req.headers,'sec-fetch-dest':'document'}},date);
 }
 const growthRecord=growth.record;
 growth.record=(req,status,context,date=clock(),response)=>{const success=growthRecord(req,status,context,date,response);if(success&&context&&(context.kind!=='product_view'||context.specSelected))interaction(req,date);return success;};
 for(const name of ['recordVisible','recordClick','recordContact'])if(outbound[name]){const original=outbound[name];outbound[name]=function(req,...args){const ok=original(req,...args);if(ok)interaction(req,args.find(v=>v instanceof Date)||clock());return ok;};}
 let lastPurge = "";
  let healthy = true;
  const limits=new Map();let bucket=-1,minuteCount=0;
  function purge(date) {
    const day = analyticsDay(date);
    if (lastPurge !== day) {
      db.prepare("DELETE FROM analytics_visitors WHERE day < ?").run(dayBefore(date, 30));
      db.prepare("DELETE FROM analytics_engaged_visitors WHERE day < ?").run(dayBefore(date,30));
      outbound.purge(date);
      growth.purge(date);
      lastPurge = day;
    }
  }
  purge(now);
  const retentionTimer=setInterval(()=>{try{purge(new Date());}catch{healthy=false;}},3600000);
  retentionTimer.unref();
  return {
    db,
    publicTrafficDatabasePath:dbPath===':memory:'?null:path.resolve(dbPath),
    get publicTrafficHealthy(){return healthy;},
    outbound,growth,recordEngaged,
    get engagedMode(){return engagedMode();},
    close: () => {clearInterval(retentionTimer);db.close();},
    record(req, statusCode, date = clock(), context = null, response = null) {
      if (response?.scrapeGuardAction || req.scrapeGuardAction) return;
      growth.record(req,statusCode,context,date,response);
      if (req.method !== "GET" || statusCode !== 200) return;
      const identity=publicIdentity(req,secret);if(!identity)return;
      const {visitor,pathname,weeklyReport}=identity;
      const minute=Math.floor(new Date(date).getTime()/60000);if(minute!==bucket){limits.clear();minuteCount=0;bucket=minute;}
      if(minuteCount>=600||(limits.get(visitor)||0)>=60)return;
      minuteCount++;limits.set(visitor,(limits.get(visitor)||0)+1);
      const day = analyticsDay(date);
      try {
        purge(date);
        db.exec("BEGIN IMMEDIATE");
        const added = db.prepare("INSERT OR IGNORE INTO analytics_visitors(day,visitor) VALUES(?,?)").run(day, visitor);
        db.prepare("INSERT INTO analytics_days(day,pv,uv) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET pv=pv+1,uv=uv+excluded.uv").run(day, Number(added.changes));
        // Record only a finite, published article ID. Never persist arbitrary
        // paths, referrers, query parameters or a cross-page visitor identity.
        const viewed=articleForPath(pathname);
        if(viewed)db.prepare('INSERT INTO analytics_content_days(day,article,views) VALUES(?,?,1) ON CONFLICT(day,article) DO UPDATE SET views=views+1').run(day,viewed.path);
        if(weeklyReport&&isoWeekBounds(weeklyReport[1]))db.prepare('INSERT INTO analytics_weekly_views(day,week,views) VALUES(?,?,1) ON CONFLICT(day,week) DO UPDATE SET views=views+1').run(day,weeklyReport[1]);
        let referringArticle;
        try{
          const target=new URL(req.url,'https://airadar.vip'),referrer=new URL(String(req.headers.referer||''));
          const quotePage=!!priceRoute(target)||pathname==='/official-prices'||pathname==='/product'&&target.searchParams.has('id')||pathname==='/'&&target.searchParams.has('family');
          if(quotePage&&referrer.origin==='https://airadar.vip'&&!referrer.username&&!referrer.password)referringArticle=articleForPath(referrer.pathname);
        }catch{/* A missing or invalid referrer carries no attribution. */}
        if(referringArticle)db.prepare('INSERT INTO analytics_content_days(day,article,quote_visits) VALUES(?,?,1) ON CONFLICT(day,article) DO UPDATE SET quote_visits=quote_visits+1').run(day,referringArticle.path);
        db.exec("COMMIT"); healthy = true;
      } catch {
        try { db.exec("ROLLBACK"); } catch {}
        healthy = false; // Stats are non-critical: never throw into the public response or log request data.
      }
    },
    contentReport(days=7,date=new Date()){
      const span=days===30?30:7,today=analyticsDay(date),start=dayBefore(date,span-1);
      const startedAt=db.prepare("SELECT value FROM analytics_meta WHERE key='content_started_at'").get().value;
      const stored=new Map(db.prepare('SELECT article,SUM(views) views,SUM(quote_visits) quote_visits FROM analytics_content_days WHERE day>=? AND day<=? GROUP BY article').all(start,today).map(r=>[r.article,r]));
      return {days:span,startedAt,rows:ARTICLES.map(a=>({path:a.path,title:a.title,views:Number(stored.get(a.path)?.views||0),quoteVisits:Number(stored.get(a.path)?.quote_visits||0)}))};
    },
    weeklyReportViews(start,end){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||'')||start>end)return null;
      return Number(db.prepare('SELECT COALESCE(SUM(views),0) n FROM analytics_weekly_views WHERE day>=? AND day<=?').get(start,end).n);
    },
    report(days = 7, date = new Date()) {
      purge(date);
      const span = days === 30 ? 30 : 7, today = analyticsDay(date), start = dayBefore(date, span - 1);
      const startedAt = db.prepare("SELECT value FROM analytics_meta WHERE key='started_at'").get().value;
      const startDay = analyticsDay(startedAt);
      const stored = new Map(db.prepare("SELECT * FROM analytics_days WHERE day >= ? AND day <= ? ORDER BY day").all(start, today).map(r => [r.day,r]));
      const series = Array.from({length:span}, (_,i) => {
        const day = dayBefore(date, span - 1 - i), row = stored.get(day);
        return day < startDay ? {day,pv:null,uv:null,missing:true} : {day,pv:row?.pv || 0,uv:row?.uv || 0,missing:false};
      });
      const total = db.prepare("SELECT COALESCE(SUM(pv),0) pv FROM analytics_days WHERE day >= ? AND day <= ?").get(start,today);
      const unique = db.prepare("SELECT COUNT(DISTINCT visitor) uv FROM analytics_visitors WHERE day >= ? AND day <= ?").get(start,today);
      const engaged=engagedMode()==='off'?{}:{engagedMode:engagedMode(),engagedPv:Number(db.prepare('SELECT COALESCE(SUM(pv),0) n FROM analytics_engaged_days WHERE day>=? AND day<=?').get(start,today).n),engagedUv:Number(db.prepare('SELECT COUNT(DISTINCT visitor) n FROM analytics_engaged_visitors WHERE day>=? AND day<=?').get(start,today).n),engagedHistoricalPv:Number(db.prepare('SELECT COALESCE(SUM(pv),0) n FROM analytics_engaged_days').get().n)};
      if(engagedMode()!=='off')for(const row of series){const e=db.prepare('SELECT pv,uv FROM analytics_engaged_days WHERE day=?').get(row.day);row.engagedPv=row.missing?null:Number(e?.pv||0);row.engagedUv=row.missing?null:Number(e?.uv||0);}
      return { ...engaged, available:true, healthy, days:span, startedAt, timezone:"Asia/Shanghai", pv:Number(total.pv), uv:Number(unique.uv), historicalPv:Number(db.prepare("SELECT COALESCE(SUM(pv),0) pv FROM analytics_days").get().pv), series };
    },
  };
}

export function analyticsCsv(report) {
  if(report.engagedMode)return "\uFEFF日期,页面浏览量,估算独立访客,有效浏览量,有效访客,数据状态\r\n"+report.series.map(r=>`${r.day},${r.pv??""},${r.uv??""},${r.engagedPv??""},${r.engagedUv??""},${r.missing?"尚未开始统计":"已记录"}`).join("\r\n")+"\r\n";
  return "\uFEFF日期,页面浏览量,估算独立访客,数据状态\r\n" + report.series.map(r => `${r.day},${r.pv ?? ""},${r.uv ?? ""},${r.missing ? "尚未开始统计" : "已记录"}`).join("\r\n") + "\r\n";
}
