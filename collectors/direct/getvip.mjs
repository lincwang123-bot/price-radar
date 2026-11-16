import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { safeFetchText } from "../../lib/safe-fetch.mjs";
import { isAuthorizedMerchantTarget } from "../../lib/merchant-target-capability.mjs";
import { publicHttpsUrl } from "../../lib/public-network-fetch.mjs";
import { deliveryEvidence } from "../../lib/delivery-evidence.mjs";
import { htmlFailure, readHtml } from "../../lib/public-catalog-html.mjs";
import { robotsPolicy } from "./public-html.mjs";

export const GETVIP_ORIGIN = "https://getvip.pro";
export const GETVIP_MAX_REQUESTS = 8; // robots + home + up to 6 product pages
const BOT = "AiradarBot/1.0 (+https://airadar.vip)";
const invalid = (message = "GetVIP 公开目录格式或商品身份不一致") => {
  throw htmlFailure(message);
};
const amount = (value) => {
  const text = String(value ?? "").trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text.replaceAll(",", ""));
  return n > 0 && n <= 1_000_000 ? n : null;
};
const plain = (value) => deliveryEvidence({ description: value }).description;
const titleText = (value) => deliveryEvidence({ productTitle: value }).productTitle;
const hasType = (node, type) =>
  [node?.["@type"]].flat().some(
    (v) => v === type || v === `https://schema.org/${type}` || v === `http://schema.org/${type}`,
  );
const productPath = (url) => {
  try {
    const u = publicHttpsUrl(url);
    if (u.origin !== GETVIP_ORIGIN || u.search || u.hash) return null;
    const m = /^\/product\/([a-z0-9-]{1,64})\/?$/i.exec(u.pathname);
    return m ? `/product/${m[1].toLowerCase()}` : null;
  } catch {
    return null;
  }
};

function authorizedSource(target) {
  if (
    !isAuthorizedMerchantTarget(target) ||
    target.origin !== GETVIP_ORIGIN ||
    target.shopNo ||
    target.token ||
    publicHttpsUrl(target.origin).origin !== target.origin ||
    typeof target.id !== "string" ||
    !target.id
  ) {
    throw htmlFailure("GetVIP 目标未登记或来源不匹配", "PREFLIGHT_INTERNAL_ERROR");
  }
  return target;
}

function graphNodes(doc) {
  return doc.graph || [];
}

function offerCatalogRows(doc) {
  const rows = [];
  for (const node of graphNodes(doc)) {
    if (!hasType(node, "Service")) continue;
    const catalog = node.hasOfferCatalog;
    if (!catalog || !hasType(catalog, "OfferCatalog") || !Array.isArray(catalog.itemListElement)) continue;
    if (catalog.itemListElement.length < 1 || catalog.itemListElement.length > 100) invalid();
    for (const row of catalog.itemListElement) {
      if (!row || !hasType(row, "Offer")) invalid();
      const item = row.itemOffered;
      if (!item || typeof item !== "object" || Array.isArray(item)) invalid();
      const name = titleText(item.name);
      const path = productPath(row.url);
      const price = amount(row.price);
      if (!name || name.length > 200 || !path || price == null || row.priceCurrency !== "CNY") invalid();
      rows.push({ name, path, price, url: `${GETVIP_ORIGIN}${path}` });
    }
  }
  if (!rows.length) invalid();
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.path}|${row.name}|${row.price}`;
    if (seen.has(key)) invalid();
    seen.add(key);
  }
  return rows;
}

function productOffers(doc, path) {
  const products = graphNodes(doc).filter((node) => hasType(node, "Product"));
  if (products.length !== 1) invalid();
  const product = products[0];
  const productUrl = productPath(product.url);
  if (productUrl !== path) invalid();
  const productName = titleText(product.name);
  if (!productName || productName.length > 200) invalid();
  if (!Array.isArray(product.offers) || product.offers.length < 1 || product.offers.length > 40) invalid();
  const offers = [];
  const seen = new Set();
  for (const offer of product.offers) {
    if (!offer || !hasType(offer, "Offer")) invalid();
    const name = titleText(offer.name);
    const price = amount(offer.price);
    const offerPath = productPath(offer.url || product.url);
    if (!name || name.length > 120 || price == null || offer.priceCurrency !== "CNY" || offerPath !== path) invalid();
    const key = `${name}|${price}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    const availability = offer.availability;
    const status =
      availability === "https://schema.org/InStock" || availability === "http://schema.org/InStock"
        ? "in_stock"
        : availability === "https://schema.org/OutOfStock" ||
            availability === "http://schema.org/OutOfStock" ||
            availability === "https://schema.org/SoldOut"
          ? "out_of_stock"
          : "unknown";
    offers.push({ name, price, status, availability: typeof availability === "string" ? availability : "" });
  }
  const description = plain(typeof product.description === "string" ? product.description : "");
  const category = titleText(typeof product.category === "string" ? product.category : "");
  return { productName, description, category, offers };
}

function composeTitle(productName, planName) {
  const plan = planName.trim();
  const product = productName.trim();
  if (!plan || !product) invalid();
  // Catalog rows sometimes already include the product brand prefix.
  if (plan.toLowerCase().startsWith(product.toLowerCase())) return titleText(plan);
  return titleText(`${product} ${plan}`);
}

// Reviewed 2026-10-30: getvip.pro homepage publishes Service.hasOfferCatalog
// (schema.org Offer[]) and each /product/<slug> page publishes Product.offers[].
// robots allows "/" and product pages; /api/ and /pay/ stay disallowed and unused.
export function parseGetVipCatalog({ homeHtml, productPages }, target, capturedAt = new Date().toISOString()) {
  const source = authorizedSource(target);
  if (typeof capturedAt !== "string" || !Number.isFinite(Date.parse(capturedAt))) invalid();
  if (typeof homeHtml !== "string" || !productPages || typeof productPages !== "object") invalid();
  const home = readHtml(homeHtml);
  const catalog = offerCatalogRows(home);
  const byPath = new Map();
  for (const [path, html] of Object.entries(productPages)) {
    if (!/^\/product\/[a-z0-9-]{1,64}$/.test(path) || typeof html !== "string") invalid();
    byPath.set(path, productOffers(readHtml(html), path));
  }
  const needed = [...new Set(catalog.map((row) => row.path))];
  if (needed.some((path) => !byPath.has(path))) invalid();
  const offers = [];
  for (const row of catalog) {
    const detail = byPath.get(row.path);
    const matched = detail.offers.filter((offer) => offer.price === row.price);
    // Match catalog row to product-page plan: prefer exact plan name, else unique price.
    let plan = matched.find((offer) => {
      const composed = composeTitle(detail.productName, offer.name);
      return composed === row.name || offer.name === row.name || row.name.endsWith(offer.name);
    });
    if (!plan && matched.length === 1) plan = matched[0];
    if (!plan) invalid();
    const title = composeTitle(detail.productName, plan.name);
    if (title !== row.name && !row.name.endsWith(plan.name) && title !== composeTitle(detail.productName, row.name)) {
      // Accept homepage catalog naming when it already embeds the product brand.
      if (!(row.name.includes(detail.productName) && row.price === plan.price)) invalid();
    }
    const finalTitle = row.name.includes(detail.productName) ? titleText(row.name) : title;
    const warranty = plain(
      [finalTitle, ...detail.description.split(/(?<=[。；;\n])/)]
        .filter((line) => /质保|售后|保修|不退|不换|退[款差]|人工|warrant/i.test(line))
        .join("\n"),
    );
    const evidence = deliveryEvidence({
      productTitle: finalTitle,
      category: detail.category,
      description: detail.description,
      descriptionScope: "product",
    });
    const status = plan.status;
    const offerKey = createHash("sha256").update(`${row.path}|${plan.name}|${plan.price}`).digest("hex").slice(0, 16);
    offers.push({
      offerId: `${source.id}:getvip:${offerKey}`,
      sourceId: source.id,
      sourceName: source.name || "GetVIP",
      storeName: source.name || "GetVIP",
      title: evidence.productTitle,
      category: detail.category,
      price: plan.price,
      listedPrice: plan.price,
      feeAmount: null,
      priceBasis: "listed",
      currency: "CNY",
      status,
      stockCount: status === "out_of_stock" ? 0 : null,
      url: row.url,
      capturedAt,
      expiresAt: null,
      extra: {
        catalogUrl: `${GETVIP_ORIGIN}/`,
        catalogFormat: "getvip-schema-offer-catalog",
        collectionMethod: "reviewed-jsonld-offer-catalog",
        publicProductPath: row.path,
        publicPlanName: plan.name,
        deliveryEvidence: evidence,
        publicDescription: detail.description,
        warrantyEvidence: warranty,
        priceEvidence: "首页 OfferCatalog 标价与商品页 Product.offers 同名同价一致",
        stockEvidence: plan.availability
          ? `商品页声明：${plain(plan.availability)}`
          : "未取得明确库存声明",
      },
    });
  }
  if (offers.length !== catalog.length) invalid();
  return offers;
}

export async function collectGetVip(target, options = {}) {
  authorizedSource(target);
  if (typeof options.fetchImpl !== "function") {
    throw htmlFailure("GetVIP 读取器未受限", "PREFLIGHT_INTERNAL_ERROR");
  }
  const now = options.now || Date.now;
  const deadline = Math.min(options.deadline || Infinity, now() + 30_000);
  const capturedAt = options.capturedAt || new Date(now()).toISOString();
  let policy = options.robotsPolicy;
  let lastStart = policy ? now() : -Infinity;
  let requests = policy ? 1 : 0;
  const read = async (url) => {
    if (publicHttpsUrl(url).origin !== GETVIP_ORIGIN) invalid();
    if (policy && !policy.allows(url)) throw htmlFailure("GetVIP 公开读取被 robots 禁止", "ROBOTS_DISALLOWED");
    if (++requests > GETVIP_MAX_REQUESTS) throw htmlFailure("GetVIP 公开目录请求达到上限", "COLLECTOR_LIMIT");
    const wait = Math.max(0, Math.max(1100, policy?.delay || 0) - (now() - lastStart));
    if (now() + wait >= deadline) throw new Error("GetVIP 公开目录采集超时");
    await (options.sleep || delay)(wait);
    if (now() >= deadline) throw new Error("GetVIP 公开目录采集超时");
    lastStart = now();
    return safeFetchText(url, {
      fetchImpl: options.fetchImpl,
      allowedOrigins: [GETVIP_ORIGIN],
      allowedMethods: ["GET"],
      method: "GET",
      credentials: "omit",
      maxBytes: 1024 * 1024,
      maxRedirects: 0,
      timeoutMs: Math.max(1, Math.min(8000, deadline - now())),
      headers: { "user-agent": BOT, accept: "text/html,application/ld+json,text/plain" },
    });
  };
  if (!policy) {
    try {
      policy = robotsPolicy(await read(`${GETVIP_ORIGIN}/robots.txt`));
    } catch (error) {
      if (error.status !== 404) throw error;
      policy = robotsPolicy("");
    }
  }
  const homeHtml = await read(`${GETVIP_ORIGIN}/`);
  const catalog = offerCatalogRows(readHtml(homeHtml));
  const paths = [...new Set(catalog.map((row) => row.path))];
  if (paths.length > GETVIP_MAX_REQUESTS - 2) throw htmlFailure("GetVIP 公开目录请求达到上限", "COLLECTOR_LIMIT");
  const productPages = {};
  for (const path of paths) productPages[path] = await read(`${GETVIP_ORIGIN}${path}`);
  return parseGetVipCatalog({ homeHtml, productPages }, target, capturedAt);
}
