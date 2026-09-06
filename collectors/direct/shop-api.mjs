import { randomBytes } from "node:crypto";

import { safeFetchJson } from "../../lib/safe-fetch.mjs";

const GOODS_LIST_PATH = "/shopApi/Shop/goodsList";
const CATEGORY_LIST_PATH = "/shopApi/Shop/categoryList";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_CATEGORIES = 20;

/** Parse one ShopApi goodsList response. */
export function parseShopApiGoods(payload, target, capturedAt = new Date().toISOString()) {
  const source = normalizedTarget(target);
  const timestamp = normalizedCapturedAt(capturedAt);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data?.list)) {
    throw new Error("ShopApi 响应格式无效：缺少 data.list 数组");
  }
  if (payload.code !== undefined && Number(payload.code) !== 1) {
    throw new Error(`ShopApi 返回失败 code: ${payload.code}`);
  }
  return payload.data.list
    .map((item) => goodsOffer(item, source, timestamp))
    .filter(Boolean);
}

/**
 * Collect the public ShopApi goods list. The endpoint is a read operation even
 * though this storefront protocol transports its query as POST JSON.
 */
export async function collectShopApi(target, options = {}) {
  const source = normalizedTarget(target, { requireToken: true });
  const capturedAt = normalizedCapturedAt(options.capturedAt ?? new Date().toISOString());
  const pageSize = boundedInteger(options.pageSize ?? target?.pageSize, DEFAULT_PAGE_SIZE, 1, 100, "pageSize");
  const maxPages = boundedInteger(
    options.maxPagesPerCategory ?? options.maxPages ?? target?.maxPagesPerCategory ?? target?.maxPages,
    DEFAULT_MAX_PAGES,
    1,
    20,
    "maxPagesPerCategory",
  );
  const maxCategories = boundedInteger(
    options.maxCategories ?? target?.maxCategories,
    DEFAULT_MAX_CATEGORIES,
    1,
    50,
    "maxCategories",
  );
  const requestDelayMs = boundedInteger(options.requestDelayMs ?? target?.requestDelayMs, 0, 0, 60_000, "requestDelayMs");
  const visitorId = cleanText(options.visitorId) || randomBytes(12).toString("hex");
  const referer = `${source.origin}/shop/${encodeURIComponent(source.token)}`;
  const offers = [];
  const seen = new Set();
  let requestCount = 0;

  const categoryPayload = await postShopApi(
    new URL(target?.categoryEndpoint ?? CATEGORY_LIST_PATH, `${source.origin}/`).href,
    {
      token: source.token,
      goods_type: "card",
      category_key: "",
    },
    source,
    options,
    { referer, visitorId },
  );
  requestCount += 1;
  const categories = selectCategories(categoryPayload, maxCategories);
  const goodsEndpoint = new URL(target?.endpoint ?? GOODS_LIST_PATH, `${source.origin}/`).href;

  for (const category of categories) {
    let received = 0;
    const pageFingerprints = new Set();
    const categoryIds = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
      if (requestCount > 0) await delay(requestDelayMs);
      requestCount += 1;
      const payload = await postShopApi(
        goodsEndpoint,
        {
          token: source.token,
          keywords: "",
          category_id: category.id,
          goods_type: "card",
          current: page,
          pageSize,
        },
        source,
        options,
        { referer, visitorId },
      );
      const pageOffers = parseShopApiGoods(payload, source, capturedAt)
        .map((offer) => offer.category || !category.name ? offer : { ...offer, category: category.name });
      for (const offer of pageOffers) {
        if (seen.has(offer.offerId)) continue;
        seen.add(offer.offerId);
        offers.push(offer);
      }

      const rawCount = payload.data.list.length;
      for (const item of payload.data.list) {
        const id = identifier(item?.goods_key ?? item?.id ?? item?.goods_id);
        if (id && categoryIds.has(id)) throw new Error('ShopApi 分页商品 ID 重复，目录完整性无法确认');
        if (id) categoryIds.add(id);
      }
      const fingerprint = JSON.stringify(payload.data.list);
      if (rawCount && pageFingerprints.has(fingerprint)) throw new Error('ShopApi 分页重复，目录完整性无法确认');
      pageFingerprints.add(fingerprint);
      received += rawCount;
      const total = nonNegativeInteger(payload.data.total);
      if (total !== null && received >= total) break;
      if (rawCount < pageSize) {
        if (total !== null && received < total) throw new Error('ShopApi 分页未完整：返回数量与 total 不一致');
        break;
      }
      if (page === maxPages) throw new Error('ShopApi 分页未完整：达到 maxPages，不能发布截断目录');
    }
  }
  return offers;
}

async function postShopApi(url, body, source, options, { referer, visitorId }) {
  return safeFetchJson(url, {
    allowedOrigins: [source.origin],
    allowedMethods: ["POST"],
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: source.origin,
      Referer: referer,
      visitorid: visitorId,
    },
    body: JSON.stringify(body),
  });
}

function selectCategories(payload, maxCategories) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
    throw new Error("ShopApi 分类响应格式无效：缺少 data 数组");
  }
  if (payload.code !== undefined && Number(payload.code) !== 1) {
    throw new Error(`ShopApi 分类返回失败 code: ${payload.code}`);
  }

  const candidates = [];
  for (const row of payload.data) {
    if (!row || typeof row !== "object") continue;
    const id = Number(row.id ?? row.category_id);
    if (!Number.isSafeInteger(id) || id < 0 || candidates.some((item) => item.id === id)) continue;
    const goodsCount = nonNegativeInteger(row.goods_count ?? row.goodsCount);
    candidates.push({ id, name: cleanText(row.name ?? row.category_name), goodsCount });
  }
  if (!candidates.length) throw new Error("ShopApi 未返回可用公开分类");

  const allCategory = candidates.find((category) =>
    category.id === 0 || /^(?:全部|全部商品|所有商品|all)$/i.test(category.name));
  if (allCategory) return [allCategory];

  const nonEmpty = candidates.filter((category) => category.goodsCount === null || category.goodsCount > 0);
  if (nonEmpty.length > maxCategories) throw new Error('ShopApi 分类未完整：达到 maxCategories');
  return nonEmpty;
}

function goodsOffer(item, source, capturedAt) {
  if (!item || typeof item !== "object" || item.is_deleted === true || item.deleted === true || item.hide === 1) return null;
  const id = identifier(item.goods_key ?? item.id ?? item.goods_id);
  const title = cleanText(item.name ?? item.goods_name ?? item.title);
  const price = positiveNumber(item.price ?? item.real_price ?? item.amount);
  if (!id || !title || price === null) return null;

  const inventory = inventoryState(item.extend?.stock_count ?? item.stock_count ?? item.stock);
  const inactive = isExplicitlyInactive(item.status);
  const status = inactive ? "out_of_stock" : inventory.status;
  const stockCount = inactive && inventory.stockCount === null ? 0 : inventory.stockCount;
  const storeName = cleanText(item.user?.nickname ?? item.shop_name) || source.name;
  return {
    offerId: `${source.id}:${id}`,
    sourceId: source.id,
    sourceName: source.name,
    storeName,
    title,
    category: cleanText(item.category?.name ?? item.category_name ?? item.category),
    price,
    listedPrice: price,
    feeAmount: null,
    priceBasis: "listed",
    currency: source.currency,
    status,
    stockCount,
    url: itemUrl(item.link, id, source.origin),
    capturedAt,
    expiresAt: null,
    deliveryMode: Number(item.extend?.send_order) === 0 ? "auto" : null,
  };
}

function normalizedTarget(target, { requireToken = false } = {}) {
  const id = cleanText(target?.id);
  const name = cleanText(target?.name) || id;
  const token = cleanText(target?.token);
  if (!id) throw new Error("ShopApi 来源缺少 id");
  if (requireToken && !token) throw new Error("ShopApi 来源缺少公开店铺 token");
  const origin = normalizedOrigin(target?.origin ?? target?.baseUrl);
  return { ...target, id, name, token, origin, currency: cleanText(target?.currency) || "CNY" };
}

function normalizedOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("ShopApi 来源 origin 无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("ShopApi 来源 origin 必须是无凭据 HTTPS 地址");
  return url.origin;
}

function itemUrl(value, id, origin) {
  try {
    const url = value ? new URL(String(value), `${origin}/`) : new URL(`/item/${encodeURIComponent(id)}`, origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid");
    return url.href;
  } catch {
    return new URL(`/item/${encodeURIComponent(id)}`, origin).href;
  }
}

function normalizedCapturedAt(value) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) throw new Error("capturedAt 无效");
  return text;
}

function inventoryState(value) {
  if (value === null || value === undefined || value === "") return { stockCount: null, status: "unknown" };
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isSafeInteger(number) || number < 0) return { stockCount: null, status: "unknown" };
  return { stockCount: number, status: number === 0 ? "out_of_stock" : "in_stock" };
}

function isExplicitlyInactive(value) {
  if (value === null || value === undefined || value === "") return false;
  return !["1", "true", "active", "online", "enabled"].includes(String(value).trim().toLowerCase());
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function identifier(value) {
  const text = cleanText(value);
  return text && text.length <= 200 ? text : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function boundedInteger(value, fallback, min, max, label) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} 必须为 ${min}-${max} 的整数`);
  return number;
}

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
