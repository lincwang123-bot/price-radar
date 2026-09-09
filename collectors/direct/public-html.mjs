import { setTimeout as delay } from 'node:timers/promises';
import { safeFetchText, safeFetchJson } from '../../lib/safe-fetch.mjs';
import { isAuthorizedMerchantTarget } from '../../lib/merchant-target-capability.mjs';
import { publicHttpsUrl } from '../../lib/public-network-fetch.mjs';
import { discoverCatalog, parsePublicProduct, publicPageUrl, htmlFailure, htmlText } from '../../lib/public-catalog-html.mjs';
import { recognizesPublicStoreScript, parsePublicStoreList, parsePublicStoreDetail, PUBLIC_STORE_ENDPOINT } from '../../lib/public-store-api.mjs';

export const PUBLIC_HTML_MAX_REQUESTS = 20;
// Reserve two API probes, robots.txt and the catalog page within the same
// 20-request network budget. Extra discovery pages still consume that budget.
const MAX_PRODUCTS = PUBLIC_HTML_MAX_REQUESTS - 4, MAX_DISCOVERY_PAGES = 3;
const BOT = 'AiradarBot';

const robotsPath = value => encodeURI(value).replaceAll('%25', '%').replace(/%[a-f0-9]{2}/gi, encoded => {
  const char = String.fromCharCode(parseInt(encoded.slice(1), 16));
  return /[a-z0-9._~-]/i.test(char) ? char : encoded.toUpperCase();
});
function matchesRule(path, pattern) {
  const end = pattern.endsWith('$'), parts = (end ? pattern.slice(0, -1) : pattern).split('*');
  if (!path.startsWith(parts[0])) return false;
  if (parts.length === 1) return !end || path === parts[0];
  let position = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (end && i === parts.length - 1) return path.endsWith(part) && path.length - part.length >= position;
    const next = path.indexOf(part, position); if (next < 0) return false; position = next + part.length;
  }
  return true;
}

function robotsPolicy(text) {
  if (Buffer.byteLength(text) > 512 * 1024) throw htmlFailure('公开目录响应超过限制', 'COLLECTOR_LIMIT');
  const groups = []; let group = null;
  const sitemaps = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    // RFC 9309 section 2.3.1.5: keep parseable rules even among invalid lines.
    const m = line.match(/^([\w-]+):\s*(.*)$/); if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!/^(?:\*|[a-z_-]+)$/i.test(val)) continue;
      if (!group || group.hasRules) groups.push(group = { agents: [], rules: [] }); group.agents.push(val.toLowerCase());
    }
    else if (key === 'sitemap') sitemaps.push(val);
    else if (key === 'allow' || key === 'disallow' || key === 'crawl-delay') {
      if (!group) continue;
      group.hasRules = true;
      if (key === 'crawl-delay') { if (!/^\d+(?:\.\d+)?$/.test(val)) throw htmlFailure(); group.delay = Number(val) * 1000; }
      else if (val.startsWith('/')) {
        if (val.length > 1024 || group.rules.length >= 2000) throw htmlFailure('公开目录响应超过限制', 'COLLECTOR_LIMIT');
        group.rules.push({ allow: key === 'allow', path: robotsPath(val) });
      }
    }
  }
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && BOT.toLowerCase().includes(a)));
  const relevant = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const rules = relevant.flatMap(g => g.rules);
  return { sitemaps, delay: Math.max(750, ...relevant.map(g => g.delay || 0)), allows: url => {
    const u = new URL(url), path = robotsPath(u.pathname + u.search);
    const matched = rules.filter(rule => matchesRule(path, rule.path))
      .sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
    return matched[0]?.allow ?? true;
  } };
}

export async function collectPublicHtml(target, options = {}) {
  if (!isAuthorizedMerchantTarget(target) || target.shopNo || target.token || typeof options.fetchImpl !== 'function'
    || publicHttpsUrl(target.origin).origin !== target.origin) throw htmlFailure('公开页面目标未登记或读取器未受限', 'PREFLIGHT_INTERNAL_ERROR');
  const origin = target.origin, deadline = Math.min(options.deadline || Infinity, Date.now() + 30000);
  const fetchOptions = { fetchImpl: options.fetchImpl, allowedOrigins: [origin], timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 0,
    headers: { 'user-agent': BOT + '/1.0 (+https://airadar.vip)', accept: 'text/html,application/ld+json,text/plain,application/xml' } };
  let requests = 0, lastStart = 0, policy;
  const read = async (url, json = false) => {
    if (policy && !policy.allows(url)) throw htmlFailure('公开页面读取被 robots 禁止', 'ROBOTS_DISALLOWED');
    if (++requests > PUBLIC_HTML_MAX_REQUESTS - 2) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
    const wait = Math.max(0, (policy?.delay || 750) - (Date.now() - lastStart));
    if (Date.now() + wait >= deadline) throw new Error('公开目录采集超时');
    await (options.sleep || delay)(wait); lastStart = Date.now();
    return (json ? safeFetchJson : safeFetchText)(url, { ...fetchOptions, timeoutMs: Math.max(1, Math.min(8000, deadline - Date.now())) });
  };
  try { policy = robotsPolicy(await read(origin + '/robots.txt')); }
  catch (error) { if (error.status !== 404) throw error; policy = robotsPolicy(''); }
  const pages = [origin + '/'], visited = new Set(), entries = new Map(), scripts = new Set();
  while (pages.length) {
    const url = pages.shift(); if (visited.has(url)) continue;
    if (visited.size >= MAX_DISCOVERY_PAGES) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
    visited.add(url);
    const result = discoverCatalog(await read(url), origin);
    result.scriptUrls.forEach(url => scripts.add(url));
    for (const row of result.entries) {
      const prior = entries.get(row.url);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw htmlFailure();
      entries.set(row.url, row);
    }
    if (entries.size > MAX_PRODUCTS) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
    for (const page of result.catalogLinks) if (!visited.has(page) && !pages.includes(page)) pages.push(page);
    // No guessed API or sitemap paths: only discover sitemap URLs declared in robots.
    if (!entries.size && !pages.length && visited.size === 1) {
      for (const map of policy.sitemaps.slice(0, 2)) {
        const sitemap = publicPageUrl(map, origin, 'sitemap'); if (!sitemap) continue;
        const xml = await read(sitemap);
        if (!/<urlset\b/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) continue;
        for (const loc of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
          const product = publicPageUrl(htmlText(loc[1]), origin);
          if (product) entries.set(product, { url: product });
        }
        if (entries.size > MAX_PRODUCTS) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
      }
    }
  }
  if (!entries.size) {
    for (const scriptUrl of [...scripts].slice(0, 2)) {
      if (!recognizesPublicStoreScript(await read(scriptUrl))) continue;
      const listed = parsePublicStoreList(await read(origin + PUBLIC_STORE_ENDPOINT, true)), offers = [];
      for (const row of listed) {
        const detail = await read(`${origin}${PUBLIC_STORE_ENDPOINT}/${encodeURIComponent(row.slug)}`, true);
        offers.push(parsePublicStoreDetail(detail, row, target, options.capturedAt || new Date().toISOString()));
      }
      return offers;
    }
    throw htmlFailure('尚未识别公开商品列表', 'UNSUPPORTED_PUBLIC_HTML');
  }
  const offers = [];
  for (const entry of entries.values()) offers.push(parsePublicProduct(await read(entry.url), entry, target, options.capturedAt || new Date().toISOString()));
  return offers; // Never publish a partially read or inconsistent listed catalogue.
}
