import { safeFetchJson, isAccessDeniedError } from '../../lib/safe-fetch.mjs';
import { deliveryEvidence } from '../../lib/delivery-evidence.mjs';
import { directOfferExclusionReason, classifyDirectOffer } from './catalog.mjs';
import { isAuthorizedMerchantTarget } from '../../lib/merchant-target-capability.mjs';
import { checkoutQuote } from '../../lib/checkout-price.mjs';

// Verified 2026-09-06 from existing public /goods/G… links, then the public
// goods/detail response. No shop-number enumeration or authenticated APIs.
export const PLATFORM16688_SHOPS = Object.freeze([
  ['S937885', '52XUEAI', 'G29719488'],
  ['S134923', '66AI小铺', 'G85815217'],
  ['S159512', '91TOPGO', 'G65106678'],
  ['S799620', 'A1gmail', 'G39427834'],
  ['S166169', 'AI咕咕嘎嘎【直充源头】', 'G10064336'],
  ['S205325', 'AI奥特曼|代充源头招代理', 'G13465107'],
  ['S526627', 'AI批发', 'G42991898'],
  ['S686646', 'AI源头', 'G48579114'],
  ['S943903', 'AI练习生', 'G23269024'],
  ['S909910', 'CodexTool', 'G88018639'],
  ['S848708', 'GiPiTa 菲区源头', 'G42128095'],
  ['S790246', 'Jin AI', 'G95299070'],
  ['S311799', 'KFC卡网', 'G44611111'],
  ['S366907', 'QX店铺', 'G79957618'],
  ['S500101', 'gmd', 'G62011389'],
  ['S104052', '一梦AI货源', 'G15302520'],
  ['S424005', '冷热lab', 'G48647801'],
  ['S605033', '北橘号铺', 'G37854191'],
  ['S358780', '千羽ai批发', 'G22076118'],
  ['S552918', '华润ai', 'G36253221'],
  ['S677698', '大个儿', 'G96216428'],
  ['S620172', '奥特曼直营', 'G50346588'],
  ['S802470', '奥特曼直销', 'G59316673'],
  ['S551641', '星穹铁路', 'G14120763'],
  ['S158155', '格洛克Ai', 'G59334544'],
  ['S343514', '派大星', 'G28696469'],
  ['S301156', '浅梦杂货铺', 'G76621552'],
  ['S231625', '皮特小铺', 'G11162208'],
  ['S428748', '萃选ai', 'G88462961'],
  ['S301515', '蜡笔小新', 'G57094210'],
  // Additional seeds from the original platform's public /source directory,
  // validated through retail goods/detail and shop/detail, not wholesale price.
  ['S686505', '安安 对接：ANANHT', 'G33156626', 'https://www.16688.com.cn/source'],
  ['S542868', '一苇的ai小铺', 'G63667678', 'https://www.16688.com.cn/source'],
  ['S995876', '鹰鹰小铺', 'G13677689', 'https://www.16688.com.cn/source'],
  ['S763680', '小高老板娘的店', 'G78548110', 'https://www.16688.com.cn/source'],
  ['S513295', '源头AI - Bot | 对接：team', 'G95118424', 'https://www.16688.com.cn/source'],
  ['S888822', '带鱼ai', 'G69292311', 'https://www.16688.com.cn/source'],
  ['S361816', 'AI充值', 'G70554833', 'https://www.16688.com.cn/source'],
].map(([shopNo, name, seed, discoveryUrl]) => Object.freeze({
  id: `16688-${shopNo.toLowerCase()}`, kind: 'platform16688', name, shopNo,
  origin: 'https://www.16688.com.cn', currency: 'CNY',
  seedUrl: `https://16688.com.cn/goods/${seed}`,
  ...(discoveryUrl ? { discoveryUrl } : {}),
})));

function sourceFor(target) {
  if (isAuthorizedMerchantTarget(target) && target.origin === 'https://www.16688.com.cn' && /^S\d{1,20}$/.test(target.shopNo)) return target;
  const source = PLATFORM16688_SHOPS.find(s => s.id === target?.id && s.shopNo === target?.shopNo);
  if (!source || target.origin !== source.origin) throw new Error('16688 未登记店铺');
  return source;
}

function timestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error('16688 capturedAt 无效');
  return value;
}

export function parse16688Goods(payload, target, capturedAt = new Date().toISOString()) {
  const source = sourceFor(target);
  timestamp(capturedAt);
  if (Number(payload?.code) !== 1 || !Array.isArray(payload?.data?.list)) {
    throw new Error(`16688 目录失败: ${String(payload?.msg ?? '缺少 data.list').slice(0,120)}`);
  }
  // The public shop frontend retrieves one unpaginated list. Never publish an
  // oversized or explicitly incomplete response as a complete snapshot.
  const list = payload.data.list;
  if (list.length > 1000 || (payload.data.total != null && Number(payload.data.total) > list.length)) {
    throw new Error('16688 目录超限或不完整');
  }
  const seen = new Set();
  return list.flatMap(item => {
    if (!/^G\d+$/.test(item?.goods_no ?? '') || seen.has(item.goods_no)) return [];
    const title = String(item.name ?? '').replace(/\s+/g, ' ').trim();
    const price = item.price === '' || item.price == null ? NaN : Number(item.price);
    if (!title || !Number.isFinite(price) || price <= 0) return [];
    const description = String(item.description ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (directOfferExclusionReason({ title: description }) === 'no_warranty') return [];
    if (item.shop_no && item.shop_no !== source.shopNo) throw new Error('16688 店铺身份不匹配');
    seen.add(item.goods_no);
    const rawCount = item.stock_available_quantity;
    const number = rawCount == null || rawCount === '' ? NaN : Number(rawCount);
    const count = Number.isSafeInteger(number) && number >= 0 ? number : null;
    const state = String(item.stock_available_status ?? '').toLowerCase();
    // Explicit sold-out takes precedence even when upstream quantities conflict.
    // The public purchase panel accepts manual (2) and service (3) fulfillment
    // with the -1 sentinel (GoodsPurchasePanel.205a5586.js, checked 2026-10-09).
    // This means orderable without counted cards, not an infinite inventory.
    // Keep unknown modes/negative values closed and preserve a null quantity.
    const manualAvailable = [2, 3].includes(Number(item.delivery_method)) && number === -1 && state === '';
    const status = state === 'out' || count === 0 ? 'out_of_stock'
      : state === 'low' ? 'low_stock'
      : count > 0 || ['normal', 'high'].includes(state) || manualAvailable ? 'in_stock' : 'unknown';
    const multi=['skus','variants','options'].some(key=>item[key]!=null&&(!Array.isArray(item[key])||item[key].length>0));
    const evidence=deliveryEvidence({ productTitle:title, category:item.category?.name ?? item.category_name, description:item.description, descriptionScope:multi?'product_multi':'product' });
    return [{
      offerId: `${source.id}:${item.goods_no}`, sourceId: source.id,
      sourceName: '16688', storeName: String(target.name || source.name), title, category:evidence.category,
      price, listedPrice: price, feeAmount: null, priceBasis: 'listed', currency: 'CNY',
      status, stockCount: status === 'out_of_stock' ? 0 : count,
      url: `${source.origin}/goods/${item.goods_no}`, capturedAt, expiresAt: null,
      extra: { shopNo: source.shopNo, shopUrl: `${source.origin}/shop/${source.shopNo}`,
        deliveryEvidence:evidence },
    }];
  });
}

function moneyCents(value) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000 ? cents : null;
}

function checkoutUnknown(row, reasonCode, attemptedAt = row.extra.checkoutQuote?.attemptedAt) {
  row.extra.checkoutQuote = {
    version: 1, status: 'unknown', source: '16688', currency: 'CNY', quantity: 1,
    paymentMethod: 'alipay', shopNo: row.extra.shopNo,
    goodsNo: row.offerId.split(':').at(-1), listedPrice: row.price, reasonCode,
    ...(attemptedAt ? { attemptedAt } : {}),
  };
}

function parseCheckoutQuote(payload, row, channel, capturedAt, pricingUrl) {
  const value = payload?.data;
  if (Number(payload?.code) !== 1 || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const goodsNo = row.offerId.split(':').at(-1);
  if (Number(value.quantity) !== 1 || (value.shop_no != null && value.shop_no !== row.extra.shopNo)
    || (value.goods_no != null && value.goods_no !== goodsNo)
    || (value.channel_id != null && String(value.channel_id) !== String(channel.id))
    || (value.currency != null && value.currency !== 'CNY') || String(value.coupon_code ?? '') !== '') return null;
  const unit = moneyCents(value.unit_price), goods = moneyCents(value.goods_amount);
  const promotion = moneyCents(value.promotion_discount), coupon = moneyCents(value.coupon_discount);
  const discounted = moneyCents(value.goods_total_amount), total = moneyCents(value.total_amount);
  if ([unit, goods, promotion, coupon, discounted, total].some(number => number == null)
    || unit !== moneyCents(row.price) || goods !== unit || total <= 0
    || goods - promotion - coupon !== discounted || total < discounted) return null;
  // fee is upstream's unrounded processing fee (e.g. 3.1441). It can be
  // merchant-paid; only the amount actually added to total is charged to buyers.
  if (!['string', 'number'].includes(typeof value.fee) || !/^\d+(?:\.\d{1,8})?$/.test(String(value.fee))) return null;
  const rawFeeCents = Math.round(Number(value.fee) * 100), buyerFee = total - discounted;
  if (!Number.isSafeInteger(rawFeeCents) || rawFeeCents > 100_000_000 || (buyerFee !== 0 && buyerFee !== rawFeeCents)) return null;
  return {
    version: 1, status: 'verified', source: '16688', currency: 'CNY', quantity: 1,
    paymentMethod: 'alipay', paymentChannelId: String(channel.id),
    paymentLabel: String(channel.show_name || channel.paytype?.name || '支付宝').replace(/<[^>]*>/g, '').trim().slice(0, 80),
    shopNo: row.extra.shopNo, goodsNo, listedPrice: row.price, goodsAmount: goods / 100,
    discountAmount: (promotion + coupon) / 100, feeAmount: buyerFee / 100,
    totalAmount: total / 100, capturedAt, pricingUrl,
  };
}

async function enrich16688Checkout(rows, goods, source, options) {
  const byId = new Map(goods.map(item => [item.goods_no, item]));
  const stamp = () => new Date(typeof options.now === 'function' ? options.now() : options.now ?? Date.now()).toISOString();
  const now = Date.parse(stamp());
  const previous = new Map((Array.isArray(options.previousOffers) ? options.previousOffers.slice(0, 2000) : []).map(row => [row.offerId, row]));
  const history = new Map();
  const candidates = [];
  for (const row of rows) {
    const item = byId.get(row.offerId.split(':').at(-1));
    const rawMinimum = item?.limit_quantity;
    const minimum = rawMinimum == null || rawMinimum === '' ? 1 : Number(rawMinimum);
    const variants = ['skus', 'variants', 'options'].some(key => item?.[key] != null && (!Array.isArray(item[key]) || item[key].length > 0));
    const reason = !['in_stock', 'low_stock'].includes(row.status) ? 'not_orderable'
      : !Number.isSafeInteger(minimum) || minimum < 0 || minimum > 1 ? 'quantity_restricted'
      : variants ? 'variant_required'
      : !classifyDirectOffer(row) || directOfferExclusionReason(row) ? 'unclassified' : 'not_queried';
    const prior = previous.get(row.offerId), old = prior?.extra?.checkoutQuote;
    const matches = prior?.sourceId === row.sourceId && prior?.url === row.url && prior?.currency === row.currency
      && prior?.price === row.price && old?.version === 1 && old?.source === '16688'
      && old?.shopNo === source.shopNo && old?.goodsNo === item?.goods_no && old?.listedPrice === row.price
      && old?.quantity === 1 && old?.paymentMethod === 'alipay';
    const attempted = matches ? Date.parse(old.status === 'verified' ? old.capturedAt : old.attemptedAt) : NaN;
    const attemptedAt = Number.isFinite(attempted) && attempted <= now + 300_000 ? new Date(attempted).toISOString() : undefined;
    history.set(row.offerId, { attempted: attemptedAt ? attempted : 0, quote: matches ? checkoutQuote(prior, { now }) : null });
    checkoutUnknown(row, reason, attemptedAt);
    if (reason === 'not_queried') candidates.push(row);
  }
  if (!candidates.length) return rows;
  // The prior catalog cache is also the cursor: never-attempted goods first,
  // then the oldest actual attempt. A bounded scan must not starve the tail.
  candidates.sort((a, b) => history.get(a.offerId).attempted - history.get(b.offerId).attempted);

  const bounded = (value, fallback, maximum) => Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.min(Math.floor(Number(value)), maximum) : fallback;
  const maxRequests = bounded(options.checkoutMaxRequests, 32, 64);
  const budgetMs = bounded(options.checkoutBudgetMs, 30_000, 60_000);
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + budgetMs);
  const requestDelayMs = Math.max(500, Number(options.requestDelayMs) || 0);
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let requests = 0;
  let blocked = false;
  let channel;
  const markUnread = (row, reason) => {
    const prior = reason === 'budget_exceeded' ? history.get(row.offerId)?.quote : null;
    if (prior && (!channel || prior.paymentChannelId === String(channel.id))) row.extra.checkoutQuote = { ...prior }; // Preserve capturedAt; catalog refresh is not a new fee observation.
    else checkoutUnknown(row, reason);
  };
  const markPending = reason => { for (const row of candidates) if (row.extra.checkoutQuote.reasonCode === 'not_queried') markUnread(row, reason); };
  const read = async (endpoint, body, onAttempt) => {
    if (requests >= maxRequests || Date.now() + requestDelayMs >= deadline) throw Object.assign(new Error('checkout budget'), { code: 'CHECKOUT_BUDGET' });
    await sleep(requestDelayMs);
    const remaining = deadline - Date.now();
    if (remaining < 1) throw Object.assign(new Error('checkout budget'), { code: 'CHECKOUT_BUDGET' });
    requests++;
    onAttempt?.();
    return safeFetchJson(`${source.origin}${endpoint}`, {
      allowedOrigins: [source.origin], allowedMethods: ['POST'], method: 'POST', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      fetchImpl: options.checkoutFetchImpl ?? options.fetchImpl,
      timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 8_000, 8_000, remaining)),
      maxBytes: 64 * 1024, maxRedirects: 0,
    });
  };
  const handleFailure = async error => {
    if (isAccessDeniedError(error) || error?.code === 'ROBOTS_DISALLOWED') {
      blocked = true;
      try { await options.onCheckoutAccessDenied?.(error); } catch { /* Optional diagnostics must not discard a valid catalog. */ }
      return 'access_denied';
    }
    return error?.code === 'CHECKOUT_BUDGET' ? 'budget_exceeded' : 'quote_failed';
  };
  try {
    const payload = await read('/shopApi/payment/list', { shop_no: source.shopNo });
    const list = payload?.data?.list;
    if (Number(payload?.code) !== 1 || !Array.isArray(list) || list.length > 50) {
      markPending('payment_unverified'); return rows;
    }
    // One common anonymous payment method, not each merchant's cheapest channel.
    channel = list.find(item => item?.paytype?.code === 'alipay' && /^[1-9]\d{0,9}$/.test(String(item.id)));
    if (!channel) { markPending('payment_unavailable'); return rows; }
  } catch (error) {
    markPending(await handleFailure(error)); return rows;
  }
  const pricingUrl = `${source.origin}/shopApi/payment/quotePrice`;
  for (const row of candidates) {
    let attemptedAt;
    try {
      const payload = await read('/shopApi/payment/quotePrice', {
        shop_no: source.shopNo, goods_no: row.extra.checkoutQuote.goodsNo,
        quantity: 1, channel_id: channel.id, coupon_code: '',
      }, () => { attemptedAt = stamp(); });
      const capturedAt = stamp();
      const quote = parseCheckoutQuote(payload, row, channel, capturedAt, pricingUrl);
      if (quote) row.extra.checkoutQuote = quote;
      else checkoutUnknown(row, 'invalid_quote', attemptedAt);
    } catch (error) {
      const reason = await handleFailure(error);
      if (attemptedAt) checkoutUnknown(row, reason, attemptedAt);
      else markUnread(row, reason);
      if (blocked || reason === 'budget_exceeded') { markPending(reason); break; }
    }
  }
  return rows;
}

export async function collect16688(target, options = {}) {
  const source = sourceFor(target);
  const payload = await safeFetchJson(`${source.origin}/shopApi/goods/list`, {
    allowedOrigins: [source.origin], allowedMethods: ['POST'], method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_no: source.shopNo, goods_category_no: '', keywords: '', sort: 'default' }),
    fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? 15000,
    maxBytes: options.maxBytes ?? 4 * 1024 * 1024, maxRedirects: 0,
  });
  const capturedAt=options.capturedAt??new Date().toISOString();
  const initial=parse16688Goods(payload,target,capturedAt);
  // Fetch the same shop-scoped category map as the public storefront only when
  // a product omits its brand and the list provides a category ID, not its name.
  const needsCategory=payload?.data?.list?.some(item=>/^C\d+$/.test(item.goods_category_no||'')
    && !item.category?.name && !item.category_name && !classifyDirectOffer({title:item.name}));
  if(needsCategory) {
    const categories=await safeFetchJson(`${source.origin}/shopApi/goodsCategory/list`,{
      allowedOrigins:[source.origin],allowedMethods:['POST'],method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({shop_no:source.shopNo}),fetchImpl:options.fetchImpl,timeoutMs:options.timeoutMs??15000,
      maxBytes:128*1024,maxRedirects:0,
    });
    if(Number(categories?.code)!==1||!Array.isArray(categories.data)||categories.data.length>200)throw new Error('16688 商品分类目录无效');
    const names=new Map();
    for(const row of categories.data) {
      if(!/^C\d+$/.test(row?.goods_category_no||'')||typeof row.name!=='string'||!row.name.trim()||row.name.length>500
        ||names.has(row.goods_category_no)||(row.shop_no&&row.shop_no!==source.shopNo))throw new Error('16688 商品分类身份不匹配');
      names.set(row.goods_category_no,row.name);
    }
    payload.data.list=payload.data.list.map(item=>({...item,category_name:item.category?.name||item.category_name||names.get(item.goods_category_no)||''}));
  }
  const rows = needsCategory ? parse16688Goods(payload, target, capturedAt) : initial;
  return options.checkoutQuotes === false ? rows : enrich16688Checkout(rows, payload.data.list, source, options);
}
