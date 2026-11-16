import {publicCacheUrl} from './public-cache-key.mjs';
// Anonymous HTML for price, product and catalog pages. Browser responses stay
// no-store; nginx is allowed to keep them briefly via X-Accel-Expires. A
// campaign revision still drops entries immediately. Sponsor impressions and
// growth context captured on the miss are replayed on a hit.
const edgeCookies = new Set(['cf_clearance', '__cf_bm', '_cfuvid', 'airadar_hv']);
const replayHeaders = ['content-type', 'content-language', 'x-robots-tag'];

export function isPublicPageCacheUrl(url) {
  let parsed;
  try { parsed = new URL(url, 'http://localhost'); } catch { return false; }
  if (parsed.pathname.length + parsed.search.length > 2048) return false;
  if (parsed.searchParams.has('shop_q') || parsed.searchParams.has('q')) return false;
  const path = parsed.pathname;
  return path === '/catalog' || path === '/en/catalog' || path === '/product' || /^\/(?:en\/)?prices\/[a-z0-9-]+\/?$/.test(path);
}
function privateCookie(header) {
  return String(header || '').split(';').some(pair => {
    const name = pair.trim().split('=')[0];
    return name && !edgeCookies.has(name);
  });
}
function cacheableHtml(body) {
  const html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!/^\s*<!doctype html>/i.test(html) || !/<\/html>\s*$/i.test(html)) return false;
  if (/\bdata-(?:auth-page|account-page|following-page|unsubscribe-form)\b/i.test(html)) return false;
  if (/<meta\b[^>]*\bname\s*=\s*(['"])csrf(?:-token)?\1/i.test(html) || /<[^>]+\bnonce\s*=/i.test(html)) return false;
  return !/data-reader-nav href="\/account"/.test(html);
}

export function createPublicPageCache({revision = () => '1', now = Date.now, maxAgeMs = 30000, maxBytes = 1024 * 1024, maxEntries = 64, onImpressions = () => {}} = {}) {
  const entries = new Map();
  return {clear: () => entries.clear(), handle(req, res) {
    if (!['GET', 'HEAD'].includes(req.method) || !isPublicPageCacheUrl(req.url) || req.headers.authorization) return false;
    if (privateCookie(req.headers.cookie)) return false;
    if (maxAgeMs <= 0) { res.setHeader('X-Accel-Expires', '0'); return false; }
    const host = String(req.headers.host || '');
    if (!host || host.length > 256) return false;
    let version;
    try { version = revision(); } catch { return false; }
    const time = now();
    const key = host + ' ' + publicCacheUrl(req.url);
    const entry = entries.get(key);
    res.setHeader('X-Accel-Expires', '30');
    if (entry && entry.version === version && time >= entry.at && time < entry.at + maxAgeMs) {
      for (const [name, value] of Object.entries(entry.headers)) res.setHeader(name, value);
      res.setHeader('X-Price-Radar-Page-Cache', 'HIT');
      res.setHeader('X-Accel-Expires', '30');
      if (entry.growthContext) res.growthContext = entry.growthContext;
      onImpressions(req, res, entry.impressions || []);
      res.end(req.method === 'HEAD' ? undefined : entry.body);
      return true;
    }
    entries.delete(key);
    if (req.method !== 'GET') return false;
    res.setHeader('X-Price-Radar-Page-Cache', 'MISS');
    res.homeCacheImpressions = [];
    const end = res.end;
    res.end = function(...args) {
      const body = args[0];
      if (!res.headersSent) res.setHeader('X-Accel-Expires', '0');
      if (res.statusCode === 200 && !res.headersSent && !res.getHeader('set-cookie') && !res.getHeader('vary') && /^text\/html(?:;|$)/i.test(String(res.getHeader('content-type') || '')) && (typeof body === 'string' || Buffer.isBuffer(body)) && Buffer.byteLength(body) <= maxBytes && cacheableHtml(body)) {
        try {
          if (revision() === version) {
            res.setHeader('X-Accel-Expires', '30');
            const headers = {};
            for (const name of replayHeaders) { const value = res.getHeader(name); if (value !== undefined) headers[name] = value; }
            if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
            const stored = Buffer.isBuffer(body) ? Buffer.from(body) : body;
            entries.set(key, {version, at: time, body: stored, headers, impressions: [...(res.homeCacheImpressions || [])], growthContext: res.growthContext || null});
          }
        } catch { /* Cache failure must not prevent the live response. */ }
      }
      return end.apply(this, args);
    };
    return false;
  }};
}
