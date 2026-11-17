import {engagedMode} from './analytics.mjs';
// Conservative, scoring guard for bulk price scraping.
// Normal browsers, shared NATs, and verified search/AI crawlers are let through.
// High-confidence enumeration, rotating IPs, or persistent hammering
// receives an invisible JS cookie redirect. Persistent failures then get 429.
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {appendFileSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs';
import {dirname, basename, join} from 'node:path';
import {isIP} from 'node:net';
import {promises as dns} from 'node:dns';
import {identifyBot} from './bot-allowlist.mjs';

const processSecret = process.env.AIRADAR_GUARD_SECRET && process.env.AIRADAR_GUARD_SECRET.length >= 16
  ? process.env.AIRADAR_GUARD_SECRET
  : randomBytes(32).toString('hex');
const defaultLookup = {
  reverse: ip => dns.reverse(ip),
  resolve: (host, family) => family === 6 ? dns.resolve6(host) : dns.resolve4(host),
};

export function signVisitor(secret, now) {
  const exp = Math.floor(now / 1000 / 1800) * 1800 + 3600;
  const nonce = randomBytes(12).toString('hex');
  const sig = createHmac('sha256', secret).update('hv|' + exp + '|' + nonce).digest('base64url').slice(0, 32);
  return exp + '.' + nonce + '.' + sig;
}
export function visitorCookieValid(secret, value, now) {
  const match = /^([0-9]{9,12})\.(?:([a-f0-9]{24})\.)?([A-Za-z0-9_-]{32})$/.exec(String(value || ''));
  if (!match) return false;
  const exp = Number(match[1]);
  const nowSeconds = now / 1000;
  if (exp < nowSeconds - 60 || exp > nowSeconds + 7200) return false;
  const sig = createHmac('sha256', secret).update('hv|' + exp + (match[2] ? '|' + match[2] : '')).digest('base64url').slice(0, 32);
  return safeEqual(match[3], sig);
}
export function signQuote(secret, params, now) {
  const exp = Math.floor(now / 1000 / 600) * 600 + 1800;
  const body = ['qh', params.source, params.id, params.spec || '', params.channel || '', params.framework || '', String(exp)].join('|');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return exp + '.' + sig;
}
export function quoteTokenValid(secret, token, params, now) {
  const match = /^([0-9]{9,12})\.([A-Za-z0-9_-]{43,128})$/.exec(String(token || ''));
  if (!match) return false;
  const exp = Number(match[1]);
  const nowSeconds = now / 1000;
  if (exp < nowSeconds - 60 || exp > nowSeconds + 3600) return false;
  const body = ['qh', params.source, params.id, params.spec || '', params.channel || '', params.framework || '', String(exp)].join('|');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return safeEqual(match[2], sig);
}
function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function visitorCookieScript(now = Date.now()) {
  const delay=Number(process.env.AIRADAR_ANALYTICS_ENGAGED_DELAY_MS);
  const heartbeat=engagedMode()==='off'?'':`<script>(function(){var sent=false;function send(){if(sent)return;sent=true;var body=JSON.stringify({p:location.pathname});if(navigator.sendBeacon)navigator.sendBeacon('/api/public-engaged',new Blob([body],{type:'application/json'}));else fetch('/api/public-engaged',{method:'POST',body:body,keepalive:true,headers:{'Content-Type':'application/json'}}).catch(function(){});}setTimeout(send,${Number.isFinite(delay)&&delay>=0?delay:4000});window.addEventListener('scroll',send,{once:true,passive:true});})();</script>`;
  if (String(process.env.AIRADAR_SCRAPE_GUARD || 'enforce').toLowerCase() === 'off') return heartbeat;
  // Public HTML can be cached across visitors: use the legacy cohort token here.
  // Only individualized challenge tokens participate in cookie-sharing detection.
  const exp = Math.floor(now / 1000 / 1800) * 1800 + 3600;
  const token = exp + '.' + createHmac('sha256', processSecret).update('hv|' + exp).digest('base64url').slice(0,32);
  return heartbeat+`<script>(function(){try{var hv=document.cookie.match(/(?:^|; *)airadar_hv=([0-9]+[.][a-f0-9]{24}[.][A-Za-z0-9_-]{32})/);if(!hv||Number(hv[1].split('.')[0])*1000<Date.now())document.cookie='airadar_hv=${token}; Path=/; Max-Age=2592000; SameSite=Lax';var n=performance.getEntriesByType('navigation')[0];var list=n&&n.serverTiming;var edge=list&&Array.prototype.filter.call(list,function(item){return item.name==='edge';})[0];if(!edge||!/^(HIT|STALE|UPDATING)$/.test(edge.description))return;var body=JSON.stringify({p:location.pathname,s:String(location.search||'').slice(0,800)});if(navigator.sendBeacon)navigator.sendBeacon('/api/public-hit',new Blob([body],{type:'application/json'}));}catch(e){}})();</script>`;
}

function setting(options, key) {
  if (options.env && Object.hasOwn(options.env, key)) return options.env[key];
  if (Object.hasOwn(process.env, key)) return process.env[key];
  return undefined;
}
function integer(options, key, fallback, min, max) {
  const value = Number(setting(options, key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
function clientAddress(req) {
  const remote = req.socket?.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return null;
  let ip = String(req.headers?.['cf-connecting-ip'] || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (!isIP(ip) || ip === '127.0.0.1' || ip === '::1') return null;
  return ip;
}
function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}
function internalReferer(req) {
  try {
    const url = new URL(req.headers.referer || req.headers.referrer || '');
    return url.hostname.replace(/^www\./, '').toLowerCase() === 'airadar.vip';
  } catch { return false; }
}
function browserNavigation(req) {
  const headers = req.headers || {};
  return headers['sec-fetch-dest'] === 'document' && headers['sec-fetch-mode'] === 'navigate' && /Mozilla\//.test(String(headers['user-agent'] || ''));
}
// Only quote selectors enter surface keys and diagnostics; tracking/search text is excluded.
const priceQueryKeys = ['family','product','source','id','spec','channel','framework','region','currency','period','billing','plan','duration','purpose','pricing','pricing_type','delivery','purchase','recharge','eligibility','brand'];
export function priceSurfaceKey(url) {
  const query = new URLSearchParams();
  for (const key of priceQueryKeys) for (const value of url.searchParams.getAll(key).sort()) query.append(key, value.slice(0, 256));
  return url.pathname + (query.size ? '?' + query : '');
}
export function isPriceSurface(url) {
  return /^\/(?:en\/)?(?:index\.html|catalog|product|prices\/[a-z0-9-]+|official-prices(?:\/[a-z0-9-]+)?)?\/?$/.test(url.pathname) || url.pathname === '/en';
}
// Canonicalize IPv6 before grouping, including compressed and embedded IPv4 forms.
function ipPrefix(ip) {
  if (isIP(ip) === 4) return ip.split('.').slice(0,3).join('.') + '.0/24';
  let value = ip;
  if (value.includes('.')) value = value.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_,a,b,c,d) => ((+a<<8)+ +b).toString(16)+':'+((+c<<8)+ +d).toString(16));
  const sides=value.split('::'), left=sides[0].split(':').filter(Boolean), right=(sides[1]||'').split(':').filter(Boolean);
  const parts=sides.length===2 ? [...left,...Array(8-left.length-right.length).fill('0'),...right] : left;
  return parts.slice(0,4).map(part=>parseInt(part,16).toString(16)).join(':')+'::/64';
}
function fingerprint(req) {
  const headers = req.headers || {};
  const raw = ['user-agent', 'accept', 'accept-language', 'accept-encoding', 'sec-ch-ua', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].map(name => String(headers[name] || '').slice(0, 180)).join('\n');
  return createHash('sha256').update(raw).digest('hex').slice(0, 20);
}
function quoteParams(url) {
  return {
    source: url.searchParams.get('source') || 'direct-shops',
    id: url.searchParams.get('id') || '',
    spec: url.searchParams.get('spec') || '',
    channel: url.searchParams.get('channel') || '',
    framework: url.searchParams.get('framework') || '',
  };
}

export function createScrapeGuard(options = {}) {
  const mode = String(setting(options, 'AIRADAR_SCRAPE_GUARD') || 'enforce').toLowerCase();
  const secret = options.secret || processSecret;
  const now = options.now || Date.now;
  const lookup = options.lookup || defaultLookup;
  const logger = options.logger || console;
  const windowMs = integer(options, 'AIRADAR_SCRAPE_CLUSTER_WINDOW_MS', 120000, 1000, 3600000);
  const clusterIps = integer(options, 'AIRADAR_SCRAPE_CLUSTER_IPS', 12, 3, 10000);
  const clusterPaths = integer(options, 'AIRADAR_SCRAPE_CLUSTER_PATHS', 8, 2, 10000);
  const internalRatio = Math.min(1, Math.max(0, Number(setting(options, 'AIRADAR_SCRAPE_CLUSTER_INTERNAL') ?? 0.8)));
  const ipPages = integer(options, 'AIRADAR_SCRAPE_IP_PAGES', 60, 5, 100000);
  const burstLimit = integer(options, 'AIRADAR_SCRAPE_BURST', 40, 5, 100000);
  const blockAfter = integer(options, 'AIRADAR_SCRAPE_BLOCK_AFTER', 8, 2, 1000);
  const uaPerMin = integer(options, 'AIRADAR_SCRAPE_UA_BOT_PER_MIN', 12000, 1, 1000000);
  const quotePerMin = integer(options, 'AIRADAR_QUOTE_HISTORY_PER_MIN', 120, 1, 100000);
  const beaconPerMin = integer(options, 'AIRADAR_EDGE_HIT_PER_MIN', 300, 1, 100000);
  // New controls (all counts use CLUSTER_WINDOW_MS, default 120s).
  const browserPages = integer(options, 'AIRADAR_SCRAPE_BROWSER_PAGES', 24, 16, 100000);
  const browserHits = integer(options, 'AIRADAR_SCRAPE_BROWSER_HITS', 120, 30, 100000);
  const prefixPages = integer(options, 'AIRADAR_SCRAPE_PREFIX_PAGES', 60, 24, 100000);
  const prefixHits = integer(options, 'AIRADAR_SCRAPE_PREFIX_HITS', 300, 60, 100000);
  const cookieIps = integer(options, 'AIRADAR_SCRAPE_COOKIE_IPS', 12, 3, 10000);
  // Set to 0 to restore the old sec-fetch cluster exemption.
  const browserCluster = String(setting(options, 'AIRADAR_SCRAPE_BROWSER_CLUSTER') ?? '1') !== '0';
  // Daily JSONL files; delete dated files older than retention on the next write.
  const logPath = setting(options, 'AIRADAR_SCRAPE_LOG_PATH') ?? 'analytics/scrape-guard';
  const logDays = integer(options, 'AIRADAR_SCRAPE_LOG_DAYS', 7, 1, 365);
  let lastPruneDay = '';
  function diagnostic(req, url, action, signal) {
    if (!logPath) return;
    const time = now(), day = new Date(time).toISOString().slice(0,10);
    try {
      mkdirSync(dirname(logPath), {recursive:true});
      if (lastPruneDay !== day) {
        for (const file of readdirSync(dirname(logPath))) {
          const suffix=file.slice(basename(logPath).length);
          if (file.startsWith(basename(logPath)) && /^\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(suffix) && Date.parse(suffix.slice(1,11)) < Date.parse(day)-(logDays-1)*86400000) unlinkSync(join(dirname(logPath),file));
        }
        lastPruneDay=day;
      }
      const ip=clientAddress(req);
      appendFileSync(logPath+'.'+day+'.jsonl', JSON.stringify({time:new Date(time).toISOString(),action,signal,ipPrefix:ip?ipPrefix(ip):null,ua:String(req.headers?.['user-agent']||'').slice(0,160),path:priceSurfaceKey(url).slice(0,600),validCookie:visitorCookieValid(secret,cookieValue(req.headers?.cookie,'airadar_hv'),time),method:req.method})+'\n', {mode:0o600});
    } catch { /* Diagnostic IO must never interrupt serving. */ }
  }
  const buckets = new Map();
  const dnsCache = new Map();
  const quoteHits = new Map();
  const uaHits = new Map();
  const beaconHits = new Map();
  const counts = {allowed:0, challenged:0, blocked:0, wouldChallenge:0, wouldBlock:0, botVerified:0, botUa:0, botUnknown:0, crawlerBlocked:0, otherBlocked:0, humanPass:0};
  let lastLog = 0;
  const timer = setInterval(() => prune(now()), Math.min(windowMs, 60000));
  timer.unref?.();

  function prune(time) {
    for (const [key, bucket] of buckets) {
      bucket.events = bucket.events.filter(event => time - event.t < windowMs);
      bucket.challenges = (bucket.challenges || []).filter(stamp => time - stamp < windowMs);
      if (!bucket.events.length && !bucket.challenges.length) buckets.delete(key);
    }
    if (buckets.size > 4000) {
      const extra = buckets.size - 3000;
      let removed = 0;
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (++removed >= extra) break;
      }
    }
  }
  function logSummary(force) {
    const time = now();
    if (!force && time - lastLog < 10000) return;
    if (!counts.challenged && !counts.blocked && !counts.wouldChallenge && !counts.wouldBlock) return;
    lastLog = time;
    const rate = counts.challenged ? (counts.humanPass / counts.challenged) : 0;
    logger.log(`[scrape-guard] mode=${mode} challenged=${counts.challenged} blocked=${counts.blocked} crawler_429=${counts.crawlerBlocked} other_429=${counts.otherBlocked} would_challenge=${counts.wouldChallenge} would_block=${counts.wouldBlock} human_after_challenge=${counts.humanPass} false_positive_rate=${rate.toFixed(3)} bot_verified=${counts.botVerified} bot_ua=${counts.botUa} allowed=${counts.allowed}`);
  }
  function limited(map, key, limit, time) {
    const windowStart = time - 60000;
    const hits = (map.get(key) || []).filter(stamp => stamp >= windowStart);
    hits.push(time);
    map.set(key, hits.length > 20000 ? hits.slice(-20000) : hits);
    return hits.length > limit;
  }

  async function decide(req, url) {
    const time = now();
    const ip = clientAddress(req);
    const bot = ip || req.headers?.['user-agent'] ? await identifyBot(req.headers?.['user-agent'], ip, {lookup, cache: dnsCache, now: () => time}) : null;
    if (bot?.access === 'verified') { counts.botVerified++; return {action:'allow', signal:'verified-bot'}; }
    if (bot?.access === 'unknown') { counts.botUnknown++; return {action:'allow', signal:'rdns-unknown'}; }
    if (bot?.access === 'ua' || bot?.access === 'unverified') {
      counts.botUa++;
      if (ip && limited(uaHits, bot.bot.id + '|' + ip, uaPerMin, time)) return {action:'block', signal:'ua-ceiling'};
      return {action:'allow', signal:'ua-bot'};
    }
    if (!ip) return {action:'allow', signal:'no-ip'};
    const validCookie = visitorCookieValid(secret, cookieValue(req.headers?.cookie, 'airadar_hv'), time);
    // Cached HTML cohort cookies prove JS execution, not a unique visitor.
    // They remain valid but retain anonymous enumeration budgets.
    const personalCookie = validCookie && cookieValue(req.headers?.cookie, 'airadar_hv').split('.').length === 3;
    const browser = browserNavigation(req);
    // Older browsers and webviews may omit Fetch Metadata. Missing headers
    // alone cannot justify the single-IP non-browser burst rules.
    const possibleBrowser = browser || /Mozilla\//.test(String(req.headers?.['user-agent'] || '')) && /text\/html/i.test(String(req.headers?.accept || ''));
    const price = isPriceSurface(url);
    if (!price) return {action:'allow', signal:'not-price'};
    prune(time);
    const key = fingerprint(req);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = {events:[], challenges:[], passed:false}; buckets.set(key, bucket); }
    bucket.events.push({t: time, ip, path: priceSurfaceKey(url), internal: internalReferer(req), cookie: personalCookie, price, browser});
    if (bucket.events.length > 800) bucket.events.splice(0, bucket.events.length - 800);
    if (validCookie && bucket.challenges.length && !bucket.passed) { bucket.passed = true; counts.humanPass++; }
    const recent = bucket.events.filter(event => time - event.t < windowMs && event.price);
    const signals = [];
    const internalMisses = recent.filter(event => event.internal && !event.cookie);
    const ratio = recent.length ? internalMisses.length / recent.length : 0;
    const distinctIps = new Set(internalMisses.map(event => event.ip));
    const distinctPaths = new Set(internalMisses.map(event => event.path));
    const currentInternal = internalReferer(req) && !personalCookie && price;
    if (currentInternal && (browserCluster || !browser) && distinctIps.size >= clusterIps && distinctPaths.size >= clusterPaths && ratio + 1e-9 >= internalRatio) signals.push('cluster');
    const mine = recent.filter(event => event.ip === ip);
    const myPaths = new Set(mine.map(event => event.path));
    if (!bot && !personalCookie && !possibleBrowser && myPaths.size >= ipPages) signals.push('ip-pages');
    const burst = mine.filter(event => time - event.t < 30000);
    if (!bot && !personalCookie && !possibleBrowser && burst.length >= burstLimit) signals.push('burst');
    const cookie = cookieValue(req.headers?.cookie, 'airadar_hv');
    const groupKeys = ['ip:'+ip, 'prefix:'+ipPrefix(ip)];
    // Legacy cookies have no per-visitor nonce and cannot safely identify sharing.
    if (validCookie && cookie.split('.').length === 3) groupKeys.push('cookie:'+createHash('sha256').update(cookie).digest('hex'));
    const groups = groupKeys.map(groupKey=>{
      let group=buckets.get(groupKey);
      if(!group){group={events:[],challenges:[]};buckets.set(groupKey,group);}
      group.events.push({t:time,ip,path:priceSurfaceKey(url),cookie:personalCookie});
      if(group.events.length>2000)group.events.shift();
      return group;
    });
    const anonymous = group=>group.events.filter(event=>!event.cookie);
    if(!personalCookie){
      const single=anonymous(groups[0]), prefix=anonymous(groups[1]);
      if(new Set(single.map(event=>event.path)).size>=browserPages || single.length>=browserHits)signals.push('browser-enumeration');
      if(new Set(prefix.map(event=>event.path)).size>=prefixPages || prefix.length>=prefixHits)signals.push('prefix-enumeration');
    } else if(groups[2] && new Set(groups[2].events.map(event=>event.ip)).size>=cookieIps) signals.push('shared-cookie');
    if (!signals.length) return {action:'allow', signal:'pass'};
    const prior = Math.max(...[bucket,...groups].map(group=>group.challenges.length));
    if (prior >= blockAfter) return {action:'block', signal: signals.join('+')};
    return {action:'challenge', signal: signals.join('+'), bucket, groups};
  }

  function writeChallenge(res) {
    const token = signVisitor(secret, now());
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>AIradar</title><script>document.cookie='airadar_hv=${token}; Path=/; Max-Age=2592000; SameSite=Lax';location.replace(location.href);</script></head><body data-airadar-challenge="1"></body></html>`;
    res.scrapeGuardAction = 'challenge';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Accel-Expires', '0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Length', Buffer.byteLength(html));
    res.end(html);
  }
  function writeBusy(res) {
    res.scrapeGuardAction = 'block';
    res.statusCode = 429;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Expires', '0');
    res.setHeader('Retry-After', '30');
    res.end('请求过于频繁，请稍后再试。\n');
  }

  return {
    mode, secret,
    stats: () => ({...counts, falsePositiveRate: counts.challenged ? counts.humanPass / counts.challenged : 0}),
    close() { clearInterval(timer); },
    quoteToken(params, time = now()) { return mode === 'off' ? '' : signQuote(secret, params, time); },
    quoteAllowed(url) {
      if (mode === 'off') return true;
      const params = quoteParams(url);
      if (!params.id || params.id.length > 256 || params.spec.length > 4096) return false;
      return quoteTokenValid(secret, url.searchParams.get('t') || '', params, now());
    },
    quoteLimited(req) {
      const ip = clientAddress(req);
      if (!ip) return false;
      return limited(quoteHits, ip, quotePerMin, now());
    },
    beaconLimited(req) {
      const ip = clientAddress(req);
      if (!ip) return false;
      return limited(beaconHits, ip, beaconPerMin, now());
    },
    async handle(req, res, url) {
      if (mode === 'off') return false;
      if (url.pathname === '/api/quote-history') {
        // Public crawler claims must not fall into the non-crawler API quota.
        // The route still validates its signed quote token independently.
        const bot=await identifyBot(req.headers?.['user-agent'],clientAddress(req),{lookup,cache:dnsCache,now});
        if(bot)return false;
        if (this.quoteLimited(req)) { diagnostic(req,url,mode==='log'?'would_block':'block','quote-rate'); if(mode==='log')return false; counts.blocked++; counts.otherBlocked++; writeBusy(res); logSummary(false); return true; }
        return false;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return false;
      if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/')) return false;
      if (['/robots.txt', '/sitemap.xml', '/favicon.ico', '/llms.txt', '/llms-full.txt'].includes(url.pathname)) return false;
      if(url.pathname === '/advertise' || url.pathname === '/en/advertise')return false;
      const decision = await decide(req, url);
      if (decision.action === 'allow') { counts.allowed++; return false; }
      diagnostic(req,url,mode==='log'?'would_'+decision.action:decision.action,decision.signal);
      if (mode === 'log') {
        decision.bucket?.challenges.push(now());
        for(const group of decision.groups||[])group.challenges.push(now());
        if (decision.action === 'block') counts.wouldBlock++; else counts.wouldChallenge++;
        logSummary(false);
        return false;
      }
      if (req.method === 'HEAD' && decision.action !== 'block') return false;
      if (decision.action === 'block') { counts.blocked++; if(decision.signal==='ua-ceiling')counts.crawlerBlocked++;else counts.otherBlocked++; writeBusy(res); logSummary(false); return true; }
      decision.bucket?.challenges.push(now());
      for(const group of decision.groups||[])group.challenges.push(now());
      counts.challenged++;
      writeChallenge(res);
      logSummary(false);
      return true;
    },
  };
}
