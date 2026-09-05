import { safeFetchJson } from "../../lib/safe-fetch.mjs";

const PRODUCTS_PATH = "/api/v1/public/products";
const ALLOWED_ORIGINS = new Set([
  "https://morimm.com",
  "https://burstpro-ai.online",
  "https://flyai.qzz.io",
  "https://acc.otaor.com",
  "https://shop.whh985.com",
  "https://shop.aictk.shop",
  "https://ccdawang.win",
]);

// Dujiao's public endpoint is paginated. These limits are deliberately fixed:
// callers may inject fetch for tests, but cannot turn this into an unbounded crawler.
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_PRODUCTS = PAGE_SIZE * MAX_PAGES;
const MAX_SKUS_PER_PRODUCT = 100;
const MAX_OFFERS = 2_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 1;

/**
 * Parse one Dujiao public-products page into direct-shop raw offers.
 *
 * Dujiao keeps a SKU's customer-facing label in spec_values. For multi-SKU
 * products the parent title is intentionally not appended: a parent such as
 * "PLUS / PRO 5X / PRO 20X" would otherwise contaminate every SKU's product
 * classification.
 */
export function parseDujiaoProducts(payload, target, capturedAt = new Date().toISOString()) {
  const source = normalizedTarget(target);
  const timestamp = normalizedCapturedAt(capturedAt);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
    throw new Error("Dujiao 响应格式无效：缺少 data 数组");
  }
  if (payload.status_code !== undefined && ![0, 200].includes(Number(payload.status_code))) {
    throw new Error(`Dujiao 返回失败 status_code: ${payload.status_code}`);
  }
  if (payload.data.length > PAGE_SIZE) {
    throw new Error(`Dujiao 单页商品数量超过上限 ${PAGE_SIZE}`);
  }

  const offers = [];
  const seen = new Set();
  for (const product of payload.data) {
    if (!product || typeof product !== "object" || product.is_active === false || product.deleted_at) continue;

    const productId = identifier(product.id ?? product.slug);
    const productTitle = localizedText(product.title ?? product.name);
    const category = localizedText(product.category?.name ?? product.category);
    if (!productId) continue;
    if (product.skus !== undefined && !Array.isArray(product.skus)) {
      throw new Error(`Dujiao 商品 ${productId} 的 skus 不是数组`);
    }

    const skus = Array.isArray(product.skus) ? product.skus : [];
    if (skus.length > MAX_SKUS_PER_PRODUCT) {
      throw new Error(`Dujiao 商品 ${productId} 的 SKU 数量超过上限 ${MAX_SKUS_PER_PRODUCT}`);
    }

    for (const sku of skus) {
      const offer = skuOffer(sku, product, {
        source,
        capturedAt: timestamp,
        productId,
        productTitle,
        category,
        skuCount: skus.length,
      });
      if (!offer || seen.has(offer.offerId)) continue;
      seen.add(offer.offerId);
      offers.push(offer);
      if (offers.length > MAX_OFFERS) {
        throw new Error(`Dujiao 报价数量超过上限 ${MAX_OFFERS}`);
      }
    }
  }
  return offers;
}

/** Collect the bounded, public Dujiao catalogue for one verified storefront. */
export async function collectDujiao(target, options = {}) {
  const source = normalizedTarget(target);
  const capturedAt = normalizedCapturedAt(options.capturedAt ?? new Date().toISOString());
  const requestDelayMs = boundedInteger(
    options.requestDelayMs ?? target?.requestDelayMs,
    0,
    0,
    60_000,
    "requestDelayMs",
  );
  validateEndpoint(target?.endpoint, source.origin);

  const offers = [];
  const seenOffers = new Set();
  const seenProducts = new Set();
  let needsAnotherPage = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (page > 1) await delay(requestDelayMs);
    const endpoint = new URL(PRODUCTS_PATH, source.origin);
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("page_size", String(PAGE_SIZE));

    const payload = await safeFetchJson(endpoint.href, {
      // source.origin has already been checked against the immutable set above;
      // using only that origin also rejects redirects between the two stores.
      allowedOrigins: [source.origin],
      fetchImpl: options.fetchImpl,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: MAX_REDIRECTS,
      headers: { Accept: "application/json" },
    });

    const pageOffers = parseDujiaoProducts(payload, source, capturedAt);
    for (const product of payload.data) {
      const productId = identifier(product?.id ?? product?.slug);
      if (productId) seenProducts.add(productId);
    }
    if (seenProducts.size > MAX_PRODUCTS) {
      throw new Error(`Dujiao 商品数量超过上限 ${MAX_PRODUCTS}`);
    }
    for (const offer of pageOffers) {
      if (seenOffers.has(offer.offerId)) continue;
      seenOffers.add(offer.offerId);
      offers.push(offer);
      if (offers.length > MAX_OFFERS) {
        throw new Error(`Dujiao 报价数量超过上限 ${MAX_OFFERS}`);
      }
    }

    const pagination = paginationState(payload.pagination, page);
    if (pagination.total !== null && pagination.total > MAX_PRODUCTS) {
      throw new Error(`Dujiao 商品总数超过上限 ${MAX_PRODUCTS}`);
    }
    if (pagination.totalPage !== null && pagination.totalPage > MAX_PAGES) {
      throw new Error(`Dujiao 分页超过上限 ${MAX_PAGES}`);
    }

    needsAnotherPage = pagination.totalPage !== null
      ? page < pagination.totalPage
      : payload.data.length === PAGE_SIZE;
    if (!needsAnotherPage) break;
  }

  if (needsAnotherPage) throw new Error(`Dujiao 分页超过上限 ${MAX_PAGES}`);
  return offers;
}

function skuOffer(sku, product, context) {
  if (!sku || typeof sku !== "object" || sku.is_active === false || sku.deleted_at) return null;

  const skuId = identifier(sku.id ?? sku.sku_id ?? sku.sku_code);
  const rawSkuTitle = localizedText(sku.spec_values)
    || localizedText(sku.title ?? sku.name ?? sku.label ?? sku.spec)
    || nonDefaultSkuCode(sku.sku_code)
    || (context.skuCount === 1 ? context.productTitle : "");
  const skuTitle = withBrandPrefix(rawSkuTitle, context.productTitle, context.category);
  // SKU price is intentionally not inherited from the parent product. A
  // parent price is commonly just the lowest variant and can misprice others.
  const price = positiveNumber(sku.price_amount ?? sku.price);
  if (!skuId || !skuTitle || price === null) return null;

  const deliveryMode = normalizedDeliveryMode(sku.fulfillment_type ?? product.fulfillment_type);
  const inventory = skuInventory(sku, product, deliveryMode);
  const slug = identifier(product.slug) ?? context.productId;
  return {
    offerId: `${context.source.id}:${context.productId}:${skuId}`,
    sourceId: context.source.id,
    sourceName: context.source.name,
    storeName: context.source.name,
    title: skuTitle,
    category: context.category,
    price,
    listedPrice: price,
    feeAmount: null,
    priceBasis: "listed",
    currency: context.source.currency,
    status: inventory.status,
    stockCount: inventory.stockCount,
    url: new URL(`/products/${encodeURIComponent(slug)}`, context.source.origin).href,
    capturedAt: context.capturedAt,
    expiresAt: null,
    deliveryMode,
  };
}

function skuInventory(sku, product, deliveryMode) {
  const autoStock = nonNegativeInteger(sku.auto_stock_available);
  const manualStock = nonNegativeInteger(sku.manual_stock_available)
    ?? nonNegativeInteger(sku.manual_stock_total);
  const upstreamStock = nonNegativeInteger(sku.upstream_stock);
  let stockCount;
  if (deliveryMode === "manual") stockCount = manualStock;
  else if (deliveryMode === "auto") stockCount = autoStock ?? upstreamStock;
  else if (autoStock !== null && manualStock !== null) stockCount = autoStock + manualStock;
  else stockCount = autoStock ?? manualStock ?? upstreamStock;

  const state = cleanText(`${sku.stock_status ?? ""} ${sku.stock_display ?? ""} ${product.stock_status ?? ""}`).toLowerCase();
  if (sku.is_sold_out === true || product.is_sold_out === true || /out[_ -]?of[_ -]?stock|sold[_ -]?out|已售罄|售罄|缺货|无货/.test(state)) {
    return { stockCount, status: "out_of_stock" };
  }
  if (stockCount === 0) return { stockCount: 0, status: "out_of_stock" };
  if (/low[_ -]?stock|库存紧张|库存较少/.test(state)) return { stockCount, status: "low_stock" };
  if (stockCount !== null && stockCount > 0) return { stockCount, status: "in_stock" };
  if (/in[_ -]?stock|available|有货/.test(state)) return { stockCount: null, status: "in_stock" };
  return { stockCount: null, status: "unknown" };
}

function withBrandPrefix(skuTitle, productTitle, category) {
  const title = cleanText(skuTitle);
  if (!title) return "";
  const context = cleanText(`${category ?? ""} ${productTitle ?? ""}`);
  const brand = directBrand(context);
  if (!brand || hasBrand(title, brand)) return title;
  return `${brand} ${title}`;
}

function directBrand(value) {
  const text = cleanText(value);
  if (/chat\s*gpt|openai|\bgpt\b/i.test(text)) return "ChatGPT";
  if (/claude|cladue/i.test(text)) return "Claude";
  if (/gemini|google\s*ai/i.test(text)) return "Gemini";
  if (/\bgrok\b|super\s*grok/i.test(text)) return "Grok";
  if (/twitter|(?:^|\s)x\s*(?:premium|会员|蓝标)/i.test(text)) return "X";
  return "";
}

function hasBrand(value, brand) {
  const patterns = {
    ChatGPT: /chat\s*gpt|openai|\bgpt\b/i,
    Claude: /claude|cladue/i,
    Gemini: /gemini|google\s*ai/i,
    Grok: /\bgrok\b|super\s*grok/i,
    X: /twitter|(?:^|\s)x(?:\s|$)/i,
  };
  return patterns[brand]?.test(value) === true;
}

function paginationState(value, requestedPage) {
  if (value === null || value === undefined) return { total: null, totalPage: null };
  if (!value || typeof value !== "object") throw new Error("Dujiao pagination 格式无效");

  const page = nonNegativeInteger(value.page);
  const total = nonNegativeInteger(value.total);
  const totalPage = nonNegativeInteger(value.total_page ?? value.totalPage);
  if (page !== null && page !== requestedPage) {
    throw new Error(`Dujiao pagination.page 不匹配：请求 ${requestedPage}，返回 ${page}`);
  }
  return { total, totalPage };
}

function normalizedTarget(target) {
  const id = cleanText(target?.id);
  const name = cleanText(target?.name) || id;
  if (!id) throw new Error("Dujiao 来源缺少 id");
  const origin = normalizedOrigin(target?.origin ?? target?.baseUrl);
  if (!ALLOWED_ORIGINS.has(origin)) throw new Error(`Dujiao 未登记来源: ${origin}`);
  return { ...target, id, name, origin, currency: cleanText(target?.currency) || "CNY" };
}

function normalizedOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("Dujiao 来源 origin 无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Dujiao 来源 origin 必须是无凭据 HTTPS 地址");
  }
  return url.origin;
}

function validateEndpoint(value, origin) {
  if (value === null || value === undefined || value === "") return;
  let url;
  try {
    url = new URL(String(value), `${origin}/`);
  } catch {
    throw new Error("Dujiao endpoint 无效");
  }
  if (url.origin !== origin || url.pathname !== PRODUCTS_PATH || url.search || url.hash) {
    throw new Error(`Dujiao endpoint 必须固定为 ${PRODUCTS_PATH}`);
  }
}

function localizedText(value) {
  if (typeof value === "string" || typeof value === "number") return cleanText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  for (const key of ["zh-CN", "zh_CN", "zh-TW", "zh_TW", "zh", "en-US", "en_US", "en"]) {
    const text = cleanText(value[key]);
    if (text) return text;
  }
  const values = [...new Set(Object.values(value).map((item) => cleanText(item)).filter(Boolean))];
  return values.join(" / ");
}

function nonDefaultSkuCode(value) {
  const code = cleanText(value);
  return code && !/^(?:default|sku[-_]?\d+)$/i.test(code) ? code : "";
}

function normalizedDeliveryMode(value) {
  const mode = cleanText(value).toLowerCase();
  if (mode === "auto" || mode === "automatic") return "auto";
  if (mode === "manual") return "manual";
  return mode || null;
}

function normalizedCapturedAt(value) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) throw new Error("capturedAt 无效");
  return text;
}

function identifier(value) {
  const text = cleanText(value);
  return text && text.length <= 200 ? text : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function boundedInteger(value, fallback, min, max, label) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} 必须为 ${min}-${max} 的整数`);
  }
  return number;
}

function delay(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}
