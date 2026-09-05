import { safeFetchJson } from "../../lib/safe-fetch.mjs";

const CATALOG_PATH = "/user/api/index/commodity";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;

/**
 * Parse one public Kami catalogue page into the direct-shop raw-offer shape.
 */
export function parseKamiPage(payload, target, capturedAt = new Date().toISOString()) {
  const source = normalizedTarget(target);
  const timestamp = normalizedCapturedAt(capturedAt);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
    throw new Error("Kami 响应格式无效：缺少 data 数组");
  }

  return payload.data
    .map((item) => kamiOffer(item, source, timestamp))
    .filter(Boolean);
}

/**
 * Collect all bounded public pages from a Kami storefront.
 */
export async function collectKami(target, options = {}) {
  const source = normalizedTarget(target);
  const capturedAt = normalizedCapturedAt(options.capturedAt ?? new Date().toISOString());
  const pageSize = boundedInteger(options.pageSize ?? target?.pageSize, DEFAULT_PAGE_SIZE, 1, 100, "pageSize");
  const maxPages = boundedInteger(options.maxPages ?? target?.maxPages, DEFAULT_MAX_PAGES, 1, 20, "maxPages");
  const requestDelayMs = boundedInteger(options.requestDelayMs ?? target?.requestDelayMs, 0, 0, 60_000, "requestDelayMs");
  const endpoint = new URL(target?.endpoint ?? CATALOG_PATH, `${source.origin}/`);
  const offers = [];
  const seen = new Set();
  const seenRawIds = new Set();
  let consecutiveEmptyPages = 0;
  let reportedTotal = null;

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1) await delay(requestDelayMs);
    const url = new URL(endpoint);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("page", String(page));
    const payload = await safeFetchJson(url.href, fetchOptions(source.origin, options));
    const pageOffers = parseKamiPage(payload, source, capturedAt);
    let newRawIds = 0;
    for (const item of payload.data) {
      const rawId = identifier(item?.id ?? item?.commodity_id ?? item?.goods_id);
      if (!rawId || seenRawIds.has(rawId)) continue;
      seenRawIds.add(rawId);
      newRawIds += 1;
    }
    for (const offer of pageOffers) {
      if (seen.has(offer.offerId)) continue;
      seen.add(offer.offerId);
      offers.push(offer);
    }

    const rawCount = payload.data.length;
    const total = nonNegativeInteger(payload.total);
    if (total !== null) reportedTotal = total;
    consecutiveEmptyPages = rawCount === 0 ? consecutiveEmptyPages + 1 : 0;

    // 部分 Kami 站点会忽略请求的 limit 上限，例如 limit=100 仍只返回
    // 96 条，同时 total 显示还有后续页。有 total 时因此不能用
    // rawCount < pageSize 判断末页，而是以已见原始 ID 数、重复页和连续空页收敛。
    if (rawCount > 0 && newRawIds === 0) break;
    if (reportedTotal !== null) {
      if (seenRawIds.size >= reportedTotal || consecutiveEmptyPages >= 2) break;
    } else if (rawCount < pageSize) {
      break;
    }
    if (page === maxPages) throw new Error("Kami 目录超过分页上限，本轮不发布截断目录");
  }

  return offers;
}

function kamiOffer(item, source, capturedAt) {
  if (!item || typeof item !== "object") return null;
  if (isHidden(item.hide) || isExplicitlyInactive(item.status)) return null;

  const id = identifier(item.id ?? item.commodity_id ?? item.goods_id);
  const title = cleanText(item.name ?? item.title);
  const price = positiveNumber(item.user_price) ?? positiveNumber(item.price);
  if (!id || !title || price === null) return null;

  const inventory = inventoryState(item.stock ?? item.stock_count, item.stock_state);
  const category = cleanText(item.category?.name ?? item.category_name ?? item.category);
  return {
    offerId: `${source.id}:${id}`,
    sourceId: source.id,
    sourceName: source.name,
    storeName: source.name,
    title,
    category,
    price,
    listedPrice: positiveNumber(item.price) ?? price,
    feeAmount: null,
    priceBasis: "listed",
    currency: source.currency,
    status: inventory.status,
    stockCount: inventory.stockCount,
    url: new URL(`/item/${encodeURIComponent(id)}`, source.origin).href,
    capturedAt,
    expiresAt: null,
    deliveryMode: Number(item.delivery_way) === 0 ? "auto" : Number(item.delivery_way) === 1 ? "manual" : null,
  };
}

function fetchOptions(origin, options) {
  return {
    allowedOrigins: [origin],
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
    headers: { Accept: "application/json" },
  };
}

function normalizedTarget(target) {
  const id = cleanText(target?.id);
  const name = cleanText(target?.name) || id;
  if (!id) throw new Error("Kami 来源缺少 id");
  const origin = normalizedOrigin(target?.origin ?? target?.baseUrl);
  return { ...target, id, name, origin, currency: cleanText(target?.currency) || "CNY" };
}

function normalizedOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("Kami 来源 origin 无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Kami 来源 origin 必须是无凭据 HTTPS 地址");
  return url.origin;
}

function normalizedCapturedAt(value) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) throw new Error("capturedAt 无效");
  return text;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function identifier(value) {
  const text = cleanText(value);
  return text && text.length <= 200 ? text : null;
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function inventoryState(stockValue, stateValue) {
  const count = nonNegativeInteger(typeof stockValue === "string" ? stockValue.replace(/,/g, "") : stockValue);
  if (count !== null) return { stockCount: count, status: count === 0 ? "out_of_stock" : "in_stock" };
  const labels = [stockValue, stateValue]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean);
  const text = labels.join(" ");
  if (/low[_ -]?stock|即将售罄|库存紧张|库存较少/.test(text)) return { stockCount: null, status: "low_stock" };
  if (/out[_ -]?of[_ -]?stock|已售罄|售罄|缺货|无货/.test(text)) return { stockCount: 0, status: "out_of_stock" };
  if (labels.some((label) => ["一般", "充足", "非常多", "库存充足", "库存正常"].includes(label))) {
    return { stockCount: null, status: "in_stock" };
  }
  if (/in[_ -]?stock|online|有货/.test(text)) return { stockCount: null, status: "in_stock" };
  return { stockCount: null, status: "unknown" };
}

function isHidden(value) {
  return value === true || value === 1 || value === "1" || String(value ?? "").toLowerCase() === "true";
}

function isExplicitlyInactive(value) {
  if (value === null || value === undefined || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  return !["1", "true", "active", "online", "enabled"].includes(normalized);
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
