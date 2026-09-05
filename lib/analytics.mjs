import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";

const PUBLIC_PATHS = new Set(["/", "/index.html", "/product", "/alerts", "/sources", "/privacy"]);
const BOT = /bot|spider|crawler|headless|curl|wget|python|httpclient|monitor|uptime|price.?radar.?qa|lighthouse|facebookexternalhit|preview|slurp/i;
export const analyticsDay = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const dayBefore = (date, days) => analyticsDay(new Date(new Date(date).getTime() - days * 86400000));

/** No raw addresses, user agents, URLs, query strings, or form content are stored. */
export function openAnalytics(dbPath, secret, { now = new Date() } = {}) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("统计摘要密钥未配置");
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5;
    CREATE TABLE IF NOT EXISTS analytics_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analytics_days(day TEXT PRIMARY KEY,pv INTEGER NOT NULL DEFAULT 0,uv INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS analytics_visitors(day TEXT NOT NULL,visitor TEXT NOT NULL,PRIMARY KEY(day,visitor));
    CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON analytics_visitors(visitor,day);`);
  db.prepare("INSERT OR IGNORE INTO analytics_meta VALUES('started_at',?)").run(now.toISOString());
  let lastPurge = "";
  let healthy = true;
  const limits=new Map();let bucket=-1,minuteCount=0;
  function purge(date) {
    const day = analyticsDay(date);
    if (lastPurge !== day) {
      db.prepare("DELETE FROM analytics_visitors WHERE day < ?").run(dayBefore(date, 30));
      lastPurge = day;
    }
  }
  purge(now);
  const retentionTimer=setInterval(()=>{try{purge(new Date());}catch{healthy=false;}},3600000);
  retentionTimer.unref();
  return {
    db,
    close: () => {clearInterval(retentionTimer);db.close();},
    record(req, statusCode, date = new Date()) {
      if (req.method !== "GET" || statusCode !== 200) return;
      let pathname;
      try { pathname = new URL(req.url, "http://local").pathname; } catch { return; }
      if (!PUBLIC_PATHS.has(pathname)) return;
      if(/(?:^|;)\s*airadar_admin=/.test(String(req.headers.cookie||"")))return;
      const ua = String(req.headers["user-agent"] || "");
      if (!ua || BOT.test(ua) || !/Mozilla\//.test(ua)) return;
      if (/prefetch|prerender/i.test(String(req.headers.purpose || req.headers["sec-purpose"] || ""))) return;
      const dest = req.headers["sec-fetch-dest"];
      if (dest && dest !== "document") return;
      const remote = String(req.socket.remoteAddress || "");
      const trustedProxy = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
      // Production is bound to loopback behind this site's Cloudflare Tunnel. Never trust XFF.
      if(!trustedProxy)return;
      const address = String(req.headers["cf-connecting-ip"] || "");
      if (!isIP(address) || ["127.0.0.1","::1"].includes(address)) return;
      // Deliberately coarse: this is an estimated network/browser identity, not a person.
      const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
      const visitor = createHmac("sha256", secret).update(address + "|" + browser).digest("hex");
      const minute=Math.floor(new Date(date).getTime()/60000);if(minute!==bucket){limits.clear();minuteCount=0;bucket=minute;}
      if(minuteCount>=600||(limits.get(visitor)||0)>=60)return;
      minuteCount++;limits.set(visitor,(limits.get(visitor)||0)+1);
      const day = analyticsDay(date);
      try {
        purge(date);
        db.exec("BEGIN IMMEDIATE");
        const added = db.prepare("INSERT OR IGNORE INTO analytics_visitors(day,visitor) VALUES(?,?)").run(day, visitor);
        db.prepare("INSERT INTO analytics_days(day,pv,uv) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET pv=pv+1,uv=uv+excluded.uv").run(day, Number(added.changes));
        db.exec("COMMIT"); healthy = true;
      } catch {
        try { db.exec("ROLLBACK"); } catch {}
        healthy = false; // Stats are non-critical: never throw into the public response or log request data.
      }
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
      return { available:true, healthy, days:span, startedAt, timezone:"Asia/Shanghai", pv:Number(total.pv), uv:Number(unique.uv), historicalPv:Number(db.prepare("SELECT COALESCE(SUM(pv),0) pv FROM analytics_days").get().pv), series };
    },
  };
}

export function analyticsCsv(report) {
  return "\uFEFF日期,页面浏览量,估算独立访客,数据状态\r\n" + report.series.map(r => `${r.day},${r.pv ?? ""},${r.uv ?? ""},${r.missing ? "尚未开始统计" : "已记录"}`).join("\r\n") + "\r\n";
}
