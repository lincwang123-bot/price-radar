import { setTimeout as delay } from 'node:timers/promises';
import { safeFetchJson, safeFetchText } from '../../lib/safe-fetch.mjs';
import { isAuthorizedMerchantTarget } from '../../lib/merchant-target-capability.mjs';
import { publicHttpsUrl } from '../../lib/public-network-fetch.mjs';
import { deliveryEvidence } from '../../lib/delivery-evidence.mjs';
import { htmlFailure } from '../../lib/public-catalog-html.mjs';
import { robotsPolicy } from './public-html.mjs';

export const PRODCLUB_ORIGIN = 'https://prodclub.xyz';
export const PRODCLUB_MAX_REQUESTS = 4; // robots plus at most three 20-item pages
const ENDPOINT = '/api/v1/offers', PAGE_SIZE = 20;
const invalid = () => { throw htmlFailure('ProdClub 公开目录格式或商品身份不一致'); };
const plain = value => deliveryEvidence({ description: value }).description;
const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{8,80}$`).test(value);
const minorPrice = value => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000;

function authorizedSource(target) {
  if (!isAuthorizedMerchantTarget(target) || target.origin !== PRODCLUB_ORIGIN || target.shopNo || target.token
    || publicHttpsUrl(target.origin).origin !== target.origin || typeof target.id !== 'string' || !target.id) {
    throw htmlFailure('ProdClub 目标未登记或来源不匹配', 'PREFLIGHT_INTERNAL_ERROR');
  }
  return target;
}

function catalogPage(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error != null || payload.errors != null
    || payload.success === false || payload.code != null || payload.status_code != null
    || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)
    || !Array.isArray(payload.data.items) || !Object.hasOwn(payload.data, 'next_cursor')) invalid();
  const { items, next_cursor: cursor } = payload.data;
  if (items.length > PAGE_SIZE) throw htmlFailure('ProdClub 公开目录响应超过限制', 'COLLECTOR_LIMIT');
  if (cursor !== null && (typeof cursor !== 'string' || !/^[a-zA-Z0-9_=.-]{1,512}$/.test(cursor))) invalid();
  const seen = new Set();
  for (const item of items) {
    if (!validId(item?.id, 'off') || seen.has(item.id)) invalid();
    seen.add(item.id);
  }
  return { items, cursor };
}

// Reviewed 2026-10-09: /r/<code> links the public offer-list component, whose
// BeLsEhcu.js module advertises GET /api/v1/offers?limit=20 and next_cursor.
// The D7l_OWGD.js money formatter divides CNY minor units by 100. CGX_4-qv.js
// uses product.name + plan.name, orderable and /offers/<id>. This adapter never
// requests promo-codes, visit tracking, orders, accounts or payment operations.
export function parseProdClubOffers(payload, target, capturedAt = new Date().toISOString()) {
  const source = authorizedSource(target);
  if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) invalid();
  return catalogPage(payload).items.flatMap(item => {
    // A public response can still contain non-retail or non-CNY alternatives.
    // Only the anonymous standard retail offer and its exact Alipay option are
    // comparable. Never substitute another offer's payment or promotion price.
    if (item.admin_only !== false || item.price_tier !== 'standard' || item.currency !== 'CNY' || item.pay_currency !== 'CNY'
      || !minorPrice(item.price_minor)) return [];
    if (!Array.isArray(item.payment_options) || item.payment_options.length > 20) invalid();
    const alipay = item.payment_options.filter(option => option?.method === 'alipay');
    if (alipay.length !== 1 || alipay[0].offer_id !== item.id || alipay[0].price_tier !== 'standard'
      || alipay[0].price_minor !== item.price_minor) return [];
    const product = item.product, plan = item.plan;
    if (!validId(product?.id, 'prd') || !validId(plan?.id, 'pln') || plan.product_id !== product.id) invalid();
    if (product.status !== 'active' || plan.status !== 'active' || item.status === 'archived') return [];
    if (!Array.isArray(plan.allowed_delivery_methods) || !plan.allowed_delivery_methods.includes(item.delivery_method)) invalid();
    // Only the publicly verified own-account subscription contract is supported.
    // SMS numbers, other delivery modes and unknown periods do not become
    // subscriptions through a plan name or a guessed default duration.
    if (item.delivery_method !== 'own_account' || !['day', 'month', 'year'].includes(plan.duration_unit)
      || !Number.isSafeInteger(plan.duration_value) || plan.duration_value < 1 || plan.duration_value > 3650) return [];
    const productName = plain(product.name), planName = plain(plan.name);
    if (!productName || !planName || productName.length > 200 || planName.length > 200) invalid();
    const period = `${plan.duration_value}${({day:'天',month:'个月',year:'年'})[plan.duration_unit]}`;
    const region = plain(plan.region);
    const title = `${productName} ${planName} ${period} 原号直充${region ? ` ${region}` : ''}`;
    const warrantyDays = Number.isSafeInteger(item.after_sales_days) && item.after_sales_days > 0 && item.after_sales_days <= 3650
      ? `售后期限：${item.after_sales_days}天。` : '';
    const evidence = deliveryEvidence({ productTitle: title,
      description: [plain(plan.benefits), warrantyDays, plain(item.after_sales_terms)].filter(Boolean).join('\n'), descriptionScope: 'product' });
    const soldOut = item.status === 'sold_out' || item.unavailable_reason === 'STOCK_INSUFFICIENT';
    const available = item.status === 'active' && item.orderable === true && alipay[0].orderable === true && item.unavailable_reason === null;
    const status = soldOut ? 'out_of_stock' : available ? 'in_stock' : 'unknown';
    return [{ offerId: `${source.id}:prodclub:${item.id}`, sourceId: source.id, sourceName: 'ProdClub', storeName: source.name || 'ProdClub',
      title: evidence.productTitle, price: item.price_minor / 100, listedPrice: item.price_minor / 100,
      feeAmount: null, priceBasis: 'listed', currency: 'CNY', status, stockCount: soldOut ? 0 : null,
      url: `${PRODCLUB_ORIGIN}/offers/${item.id}`, capturedAt, expiresAt: null,
      extra: { catalogUrl: `${PRODCLUB_ORIGIN}${ENDPOINT}?limit=${PAGE_SIZE}`, catalogFormat: 'prodclub-public-offers',
        collectionMethod: 'reviewed-public-module', publicOfferId: item.id, publicProductId: product.id, publicPlanId: plan.id,
        deliveryEvidence: evidence, publicDescription: evidence.description, warrantyEvidence: evidence.description,
        priceEvidence: '匿名公开标准零售价；CNY 分转元；同一商品支付宝价格一致；未采用推广码或其他支付报价',
        stockEvidence: '公开商品状态及 orderable；服务商品未公开数量时保留未知数量' } }];
  });
}

export async function collectProdClub(target, options = {}) {
  authorizedSource(target);
  if (typeof options.fetchImpl !== 'function') throw htmlFailure('ProdClub 读取器未受限', 'PREFLIGHT_INTERNAL_ERROR');
  const now = options.now || Date.now;
  const deadline = Math.min(options.deadline || Infinity, now() + 30_000);
  const capturedAt = options.capturedAt || new Date(now()).toISOString();
  let policy = options.robotsPolicy, lastStart = policy ? now() : -Infinity, requests = policy ? 1 : 0;
  const read = async (url, json = false) => {
    if (publicHttpsUrl(url).origin !== PRODCLUB_ORIGIN) throw htmlFailure();
    if (policy && !policy.allows(url)) throw htmlFailure('ProdClub 公开读取被 robots 禁止', 'ROBOTS_DISALLOWED');
    if (++requests > PRODCLUB_MAX_REQUESTS) throw htmlFailure('ProdClub 公开目录请求达到上限', 'COLLECTOR_LIMIT');
    const wait = Math.max(0, Math.max(1100, policy?.delay || 0) - (now() - lastStart));
    if (now() + wait >= deadline) throw new Error('ProdClub 公开目录采集超时');
    await (options.sleep || delay)(wait);
    if (now() >= deadline) throw new Error('ProdClub 公开目录采集超时');
    lastStart = now();
    return (json ? safeFetchJson : safeFetchText)(url, { fetchImpl: options.fetchImpl,
      allowedOrigins: [PRODCLUB_ORIGIN], allowedMethods: ['GET'], method: 'GET', credentials: 'omit',
      maxBytes: json ? 1024 * 1024 : 512 * 1024, maxRedirects: 0, timeoutMs: Math.max(1, Math.min(8000, deadline - now())),
      headers: { 'user-agent': 'AiradarBot/1.0 (+https://airadar.vip)', accept: json ? 'application/json' : 'text/plain' } });
  };
  if (!policy) {
    try { policy = robotsPolicy(await read(PRODCLUB_ORIGIN + '/robots.txt')); }
    catch (error) { if (error.status !== 404) throw error; policy = robotsPolicy(''); }
  }
  const offers = [], seen = new Set(), cursors = new Set(); let cursor = null;
  do {
    const url = new URL(ENDPOINT, PRODCLUB_ORIGIN); url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await read(url.href, true), page = catalogPage(payload);
    for (const item of page.items) { if (seen.has(item.id)) invalid(); seen.add(item.id); }
    offers.push(...parseProdClubOffers(payload, target, capturedAt));
    cursor = page.cursor;
    if (cursor && cursors.has(cursor)) invalid();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return offers;
}
