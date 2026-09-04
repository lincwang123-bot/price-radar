import { safeFetchJson } from "../../lib/safe-fetch.mjs";

const PRODUCTS_PATH = "/api/shop/products";

/** Parse IkunLove's public product response. */
export function parseIkunLove(payload, target, capturedAt = new Date().toISOString()) {
  const source = normalizedTarget(target);
  const timestamp = normalizedCapturedAt(capturedAt);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data?.products)) {
    throw new Error("IkunLove 响应格式无效：缺少 data.products 数组");
  }
  if (payload.success === false) throw new Error("IkunLove 响应标记为失败");

  return payload.data.products
    .map((product) => productOffer(product, source, timestamp))
    .filter(Boolean);
}

/** Collect IkunLove's one-shot public JSON catalogue. */
export async function collectIkunLove(target, options = {}) {
  const source = normalizedTarget(target);
  const capturedAt = normalizedCapturedAt(options.capturedAt ?? new Date().toISOString());
  const endpoint = new URL(target?.endpoint ?? PRODUCTS_PATH, `${source.origin}/`);
  await requestDelay(options.requestDelayMs ?? target?.requestDelayMs);
  const payload = await safeFetchJson(endpoint.href, {
    allowedOrigins: [source.origin],
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
    headers: { Accept: "application/json" },
  });
  return parseIkunLove(payload, source, capturedAt);
}

function productOffer(product, source, capturedAt) {
  if (!product || typeof product !== "object" || product.isDeleted === true || product.isActive === false) return null;
  const id = identifier(product.id ?? product.slug);
  const title = cleanText(product.title ?? product.name);
  const cents = positiveNumber(product.priceCents ?? product.price_cents);
  if (!id || !title || cents === null) return null;

  const inventory = inventoryState(product.stockCount ?? product.stock_count);
  const guide = product.purchaseGuideUrl || product.consolePath || product.tutorialPath || source.origin;
  return {
    offerId: `${source.id}:${id}`,
    sourceId: source.id,
    sourceName: source.name,
    storeName: source.name,
    title,
    category: cleanText(product.category),
    price: cents / 100,
    listedPrice: cents / 100,
    feeAmount: null,
    priceBasis: "listed",
    currency: source.currency,
    status: inventory.status,
    stockCount: inventory.stockCount,
    url: publicUrl(guide, source.origin),
    capturedAt,
    expiresAt: null,
    deliveryMode: cleanText(product.deliveryMode) || null,
  };
}

function normalizedTarget(target) {
  const id = cleanText(target?.id);
  const name = cleanText(target?.name) || id;
  if (!id) throw new Error("IkunLove 来源缺少 id");
  const origin = normalizedOrigin(target?.origin ?? target?.baseUrl);
  return { ...target, id, name, origin, currency: cleanText(target?.currency) || "CNY" };
}

function normalizedOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("IkunLove 来源 origin 无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("IkunLove 来源 origin 必须是无凭据 HTTPS 地址");
  return url.origin;
}

function publicUrl(value, origin) {
  try {
    const url = new URL(String(value), `${origin}/`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : `${origin}/`;
  } catch {
    return `${origin}/`;
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

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function identifier(value) {
  const text = cleanText(value);
  return text && text.length <= 200 ? text : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function requestDelay(value) {
  if (value === null || value === undefined || value === "") return Promise.resolve();
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 60_000) {
    throw new Error("requestDelayMs 必须为 0-60000 的整数");
  }
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
