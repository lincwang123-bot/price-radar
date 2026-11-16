// One place to extend crawler access. Search engines and AI indexers/fetchers
// stay allowed. Published CIDR/reverse DNS checks distinguish verified clients
// from UA claims for metrics. Unverified claims still avoid JS challenges and
// use the scrape guard's generous per-IP UA ceiling.
//
// CIDR snapshots live in lib/bot-ranges.json (publisher creationTime + source URL).
// Refresh by re-downloading those URLs; do not invent ranges.
import {readFileSync} from 'node:fs';

const rangeFile = JSON.parse(readFileSync(new URL('./bot-ranges.json', import.meta.url), 'utf8'));

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}
function ipv6Groups(addr) {
  let text = String(addr).toLowerCase().split('%')[0];
  if (text.includes('.')) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill('0'), ...tail] : head;
  if (groups.length !== 8) return null;
  return groups.map(group => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    return parseInt(group, 16);
  });
}
function compileCidr(cidr) {
  const bits = Number(String(cidr).split('/')[1]);
  const addr = String(cidr).split('/')[0];
  if (!Number.isInteger(bits)) return null;
  if (addr.includes(':')) {
    const groups = ipv6Groups(addr);
    if (!groups || groups.some(part => part == null) || bits < 0 || bits > 128) return null;
    return {version: 6, bits, groups};
  }
  const network = ipv4ToInt(addr);
  if (network == null || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return {version: 4, bits, network: (network & mask) >>> 0, mask};
}
function inCidr(ip, network) {
  if (network.version === 4) {
    const value = ipv4ToInt(ip);
    if (value == null) return false;
    return ((value & network.mask) >>> 0) === network.network;
  }
  const groups = ipv6Groups(ip);
  if (!groups || groups.some(part => part == null)) return false;
  let left = network.bits;
  for (let i = 0; i < 8; i++) {
    if (left <= 0) return true;
    const take = Math.min(16, left);
    const mask = take === 16 ? 0xffff : ((0xffff << (16 - take)) & 0xffff);
    if ((groups[i] & mask) !== (network.groups[i] & mask)) return false;
    left -= take;
  }
  return true;
}
function networksFor(keys) {
  const compiled = [];
  for (const key of keys) {
    const row = rangeFile[key];
    if (!row) throw new Error('Missing crawler ranges: ' + key);
    for (const cidr of row.cidrs) {
      const network = compileCidr(cidr);
      if (network) compiled.push(network);
    }
  }
  return compiled;
}

// Order is the robots.txt order. `verify: 'cidr'` never grants verified status on UA alone.
// `verify: 'rdns'` waits for forward-confirmed reverse DNS. `verify: 'ua'` is
// only for operators that do not publish ranges or a reverse-DNS domain.
export const BOT_ALLOWLIST = [
  {id:'openai-gptbot', robots:['GPTBot'], ua:/\bGPTBot\b/i, verify:'cidr', ranges:['openai-gptbot'], source: rangeFile['openai-gptbot'].source},
  {id:'openai-searchbot', robots:['OAI-SearchBot'], ua:/\bOAI-SearchBot\b/i, verify:'cidr', ranges:['openai-searchbot'], source: rangeFile['openai-searchbot'].source},
  {id:'openai-chatgpt-user', robots:['ChatGPT-User'], ua:/\bChatGPT-User\b/i, verify:'cidr', ranges:['openai-chatgpt-user'], source: rangeFile['openai-chatgpt-user'].source},
  {id:'google', robots:['Googlebot','Google-Extended','GoogleOther','Google-InspectionTool'], ua:/\b(?:Googlebot|Google-Extended|GoogleOther|Google-InspectionTool)\b/i, verify:'cidr', ranges:['google-common','google-special'], source: rangeFile['google-common'].source},
  {id:'bingbot', robots:['bingbot'], ua:/\b(?:bingbot|msnbot|BingPreview|adidxbot)\b/i, verify:'cidr', ranges:['bingbot'], source: rangeFile.bingbot.source},
  {id:'applebot', robots:['Applebot','Applebot-Extended'], ua:/\bApplebot(?:-Extended)?\b/i, verify:'cidr', ranges:['applebot'], source: rangeFile.applebot.source},
  {id:'perplexitybot', robots:['PerplexityBot'], ua:/\bPerplexityBot\b/i, verify:'cidr', ranges:['perplexitybot'], source: rangeFile.perplexitybot.source},
  {id:'perplexity-user', robots:['Perplexity-User'], ua:/\bPerplexity-User\b/i, verify:'cidr', ranges:['perplexity-user'], source: rangeFile['perplexity-user'].source},
  {id:'anthropic', robots:['ClaudeBot','Claude-User','Claude-SearchBot','anthropic-ai'], ua:/\b(?:ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai)\b/i, verify:'cidr', ranges:['anthropic'], source: rangeFile.anthropic.source},
  {id:'ccbot', robots:['CCBot'], ua:/\bCCBot\b/i, verify:'cidr', ranges:['ccbot'], source: rangeFile.ccbot.source},
  {id:'baiduspider', robots:['Baiduspider'], ua:/\bBaiduspider\b/i, verify:'rdns', rdns:['baidu.com','baidu.jp']},
  {id:'yandexbot', robots:['YandexBot'], ua:/\b(?:YandexBot|YandexImages|YandexRenderResourcesBot)\b/i, verify:'rdns', rdns:['yandex.ru','yandex.net','yandex.com']},
  {id:'duckduckbot', robots:['DuckDuckBot'], ua:/\b(?:DuckDuckBot|DuckAssistBot)\b/i, verify:'ua'},
  {id:'bytespider', robots:['Bytespider'], ua:/\bBytespider\b/i, verify:'ua'},
  {id:'meta-external', robots:['meta-externalagent','Meta-ExternalFetcher'], ua:/\b(?:meta-externalagent|Meta-ExternalAgent|Meta-ExternalFetcher)\b/i, verify:'ua'},
  {id:'xai', robots:['GrokBot','xAI-SearchBot'], ua:/\b(?:GrokBot|xAI-SearchBot|xAI-Bot)\b/i, verify:'ua'},
  {id:'amazonbot', robots:['Amazonbot'], ua:/\bAmazonbot\b/i, verify:'ua'},
];
for (const bot of BOT_ALLOWLIST) bot.networks = networksFor(bot.ranges || []);

export function botRobotsAgents() {
  const names = [];
  for (const bot of BOT_ALLOWLIST) for (const name of bot.robots) if (!names.includes(name)) names.push(name);
  return names;
}
export function ipInNetworks(ip, networks) {
  return networks.some(network => inCidr(ip, network));
}
function hostMatches(host, suffix) {
  const name = String(host || '').toLowerCase().replace(/\.$/, '');
  const root = String(suffix || '').toLowerCase().replace(/^\*\.?/, '').replace(/^\./, '');
  return name === root || name.endsWith('.' + root);
}

// Returns {bot, access:'verified'|'ua'|'unverified'|'unknown'} or null.
// `unknown` is a reverse-DNS timeout: do not treat the UA as verified and do
// not treat the lookup failure as proof of a fake crawler.
export async function identifyBot(ua, ip, {lookup, cache = new Map(), now = Date.now, timeoutMs = 200} = {}) {
  const claims = BOT_ALLOWLIST.filter(bot => bot.ua.test(String(ua || '')));
  if (!claims.length) return null;
  if (ip) {
    const verified = claims.find(bot => bot.networks.length && ipInNetworks(ip, bot.networks));
    if (verified) return {bot: verified, access: 'verified'};
  }
  const rdnsBots = claims.filter(bot => bot.verify === 'rdns' && bot.rdns?.length);
  if (ip && rdnsBots.length && lookup) {
    const suffixes = [...new Set(rdnsBots.flatMap(bot => bot.rdns))];
    const checked = await confirmReverseDns(ip, suffixes, lookup, cache, now(), timeoutMs);
    if (checked === true) return {bot: rdnsBots[0], access: 'verified'};
    if (checked == null) return {bot: rdnsBots[0], access: 'unknown'};
  }
  const named = claims.find(bot => bot.verify === 'ua');
  if (named) return {bot: named, access: 'ua'};
  return {bot: claims[0], access: 'unverified'};
}

async function confirmReverseDns(ip, suffixes, lookup, cache, now, timeoutMs) {
  const key = ip + '|' + suffixes.join(',');
  const cached = cache.get(key);
  if (cached && cached.until > now) return cached.ok;
  if (cached?.pending) return cached.pending;
  const pending = (async () => {
    try {
      const hosts = await withTimeout(lookup.reverse(ip), timeoutMs);
      const host = (hosts || []).map(item => String(item).toLowerCase()).find(item => suffixes.some(suffix => hostMatches(item, suffix)));
      if (!host) return false;
      const family = String(ip).includes(':') ? 6 : 4;
      const addresses = await withTimeout(lookup.resolve(host, family), timeoutMs);
      return (addresses || []).includes(ip);
    } catch { return null; }
  })();
  cache.set(key, {pending, until: now});
  const ok = await pending;
  cache.set(key, {ok, until: now + (ok === true ? 6 * 3600 * 1000 : ok === false ? 10 * 60 * 1000 : 30 * 1000)});
  return ok;
}
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
