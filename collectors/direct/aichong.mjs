import { safeFetchJson, safeFetchText } from '../../lib/safe-fetch.mjs';

const ORIGIN = 'https://aichong.xin';
const MAX_PRODUCTS = 100;
function validateTarget(target) {
  if (target?.id !== 'aichong' || target?.origin !== ORIGIN) throw new Error('Aichong 目标未登记');
}

export function parseAichong(payload, target, capturedAt = new Date().toISOString()) {
  validateTarget(target);
  // The older landing page links to a marketplace. Only publish this as its
  // own storefront while the public API explicitly enables local checkout.
  if (payload?.self_pay !== true || !Array.isArray(payload.products) || payload.products.length > MAX_PRODUCTS) {
    throw new Error('Aichong 独立目录无效或超过上限');
  }
  const seen = new Set();
  return payload.products.flatMap(row => {
    if (!row || Number(row.active) !== 1) return [];
    const id = Number(row.id);
    const priceText = String(row.price ?? '').trim();
    const price = Number(priceText);
    const name = String(row.name ?? '').replace(/\s+/g, ' ').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !name || !/^\d+(?:\.\d+)?$/.test(priceText) || !Number.isFinite(price) || price <= 0) return [];
    if (seen.has(id)) throw new Error('Aichong 商品 ID 重复');
    seen.add(id);
    const status = {ok:'in_stock', low:'low_stock', out:'out_of_stock'}[row.stock] ?? 'unknown';
    // The description and chips carry actual duration/delivery details. Do not
    // include the crossed-out official price or infer duration from warranty.
    const title = [name, row.desc, ...(Array.isArray(row.chips) ? row.chips : []), row.price_suffix].filter(x => typeof x === 'string' && x.trim()).join(' · ');
    return [{offerId:`aichong:${id}`,sourceId:'aichong',sourceName:target.name || 'AI补给站',storeName:target.name || 'AI补给站',title,category:String(row.category ?? ''),price,listedPrice:price,priceBasis:'listed',feeAmount:null,currency:'CNY',status,stockCount:status === 'out_of_stock' ? 0 : null,url:`${ORIGIN}/buy.html?id=${id}`,capturedAt,expiresAt:null,deliveryMode:null}];
  });
}

export async function collectAichong(target, options = {}) {
  validateTarget(target);
  const fetchOptions = {allowedOrigins:[ORIGIN],fetchImpl:options.fetchImpl,timeoutMs:12000,maxBytes:512*1024,maxRedirects:0};
  const robots = await safeFetchText(`${ORIGIN}/robots.txt`, fetchOptions);
  // robots currently includes a Cloudflare managed preamble followed by the
  // landing page. Restrict parsing to its directives before the HTML begins.
  const rules = robots.split(/<!doctype|<html/i)[0];
  const wildcard = rules.split(/User-agent:/i).find(group => /^\s*\*\s*(?:\r?\n|$)/.test(group));
  if (!wildcard || !/^Allow:\s*\/\s*$/im.test(wildcard) || /^Disallow:\s*\/(?:\s*$|api(?:\/|\s*$)|buy)/im.test(wildcard)) {
    throw new Error('Aichong robots 不再明确允许目录读取');
  }
  const payload = await safeFetchJson(`${ORIGIN}/api/products`, fetchOptions);
  return parseAichong(payload, target, options.capturedAt);
}
