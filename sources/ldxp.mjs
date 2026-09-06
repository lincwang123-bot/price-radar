// 第二数据源：RelayWatch · 链动小铺(LDXP) 卡网商品 —— 关键词定向盯价
// 端点契约: bnlbnf/ai-cardnav server.py ldxp_goods (page/page_size/stock/sort)
// 项目代码为 MIT 不代表线上数据库许可；本适配器只做低频、关键词定向的轻量查询，
//       不做全量镜像/整库爬取（该站 summary 显示约 4.6 万商品，全爬不在此列）。
// 数据形态：单条商品 = { goods_name, price(CNY), stock, status(online/out_of_stock),
//           shop_name, shop_url, item_url, category, updated_at, captured_at }
// 本适配器把「每个配置关键词」映射为一个 product，其 offers = 命中的商品按价格升序。

import { claimSourceAttempt } from "../lib/source-timing.mjs";
import { safeFetchJson, isAccessDeniedError } from "../lib/safe-fetch.mjs";
import { metaSet } from "../lib/db.mjs";

const BASE = "https://relaywatch.online";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const sourceId = "ldxp-goods";
export const sourceLabel = "RelayWatch·链动小铺(LDXP) 卡网商品价";
export const recommendedKeywords = Object.freeze([
  "gpt plus", "gpt pro", "claude pro", "claude max", "gemini pro", "gemini ultra",
  "邮箱", "cursor", "perplexity", "接码", "codex", "grok",
]);

function limit(value, fallback, min, max, name) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`ldxp ${name} 必须在 ${min}–${max} 之间`);
  return n;
}

/** Bounded keyword samples, never a full database mirror. */
export async function queryKeyword(kw, options = {}, budget = { remaining: 24, requests: 0 }) {
  const pageSize = limit(options.page_size, 100, 1, 100, "page_size");
  const maxPages = limit(options.max_pages_per_keyword, 2, 1, 3, "max_pages_per_keyword");
  const delayMs = limit(options.request_delay_ms, 1000, 1000, 60000, "request_delay_ms");
  const items = [], seen = new Set();
  let total = null, pagesFetched = 0, reason = "request_budget";
  for (let page = 1; page <= maxPages && budget.remaining > 0; page += 1) {
    if (budget.requests > 0) await (options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))))(delayMs);
    const url = new URL(`${BASE}/api/ldxp/goods`);
    url.search = new URLSearchParams({ q: kw, page: String(page), page_size: String(pageSize), stock: "in", sort: "price_asc" }).toString();
    budget.remaining -= 1;
    budget.requests += 1;
    const body = await safeFetchJson(url.href, { allowedOrigins: [BASE], headers: { "User-Agent": UA }, fetchImpl: options.fetchImpl });
    if (!Array.isArray(body.items) || !Number.isSafeInteger(body.total) || body.total < 0 || body.page !== page || body.page_size !== pageSize) {
      throw new Error("ldxp 分页响应契约无效");
    }
    pagesFetched += 1;
    total = body.total;
    let added = 0;
    for (const item of body.items) {
      const key = item.item_url || item.item_key || item.id || item.goods_id;
      if (!key || seen.has(String(key))) continue;
      seen.add(String(key));
      items.push(item);
      added += 1;
    }
    if (items.length >= total) { reason = null; break; }
    if (!added) { reason = "repeated_or_empty_page"; break; }
    if (body.items.length < pageSize) { reason = "inconsistent_total"; break; }
    reason = page === maxPages ? "page_limit" : "request_budget";
  }
  return { items, coverage: { keyword: kw, total, fetched: items.length, pagesFetched, truncated: reason !== null, reason } };
}

function slugify(kw) {
  return kw.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "kw";
}

// 简单 FNV-1a 哈希（避免快照 id 里长中文指纹截断碰撞）
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * @param {object} ctx { db, config, dataDir, log }
 */
export async function pull(ctx) {
  const cfg = ctx.config?.sources?.[sourceId] ?? {};
  const keywords = Array.isArray(cfg.keywords) ? [...new Set(cfg.keywords.map(kw => String(kw).trim()).filter(Boolean))] : [];
  if (keywords.length > 16) throw new Error("ldxp 关键词上限为16，禁止整库镜像");
  const budget = { remaining: limit(cfg.max_requests, 24, 1, 24, "max_requests"), requests: 0 };
  if (!keywords.length) {
    ctx.log?.("[ldxp-goods] 未配置 keywords，跳过（config.sources['ldxp-goods'].keywords）。");
    return { source: sourceId, skipped: true, snapshotId: null };
  }

  // 礼貌节流：同一源短时间内不重复查询（relaywatch 商品数据不会秒级变化）
  const minIntervalMin = cfg.min_interval_minutes ?? 15;
  const timing = ctx.db
    ? claimSourceAttempt(ctx.db, sourceId, minIntervalMin)
    : { allowed: true };
  if (!timing.allowed) {
    ctx.log?.(`[ldxp-goods] 距上次抓取仅 ${timing.elapsedMinutes.toFixed(1)}min（< ${minIntervalMin}min），跳过本轮。`);
    return { source: sourceId, skipped: true, snapshotId: null };
  }

  // 源侧数据代次时间戳：summary.generated_at 变化代表新一批采集数据
  let generation;
  try {
    generation = (await safeFetchJson(`${BASE}/api/summary`, {allowedOrigins:[BASE],headers:{"User-Agent":UA},fetchImpl:ctx.fetchImpl})).generated_at;
  } catch (err) {
    if (isAccessDeniedError(err)) throw err;
    ctx.log?.(`[ldxp-goods] 获取 summary 失败(${err.message})，用当前时间作为代次标记。`);
    generation = new Date().toISOString();
  }

  const products = [];
  const coverage = [];
  await (ctx.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))))(limit(cfg.request_delay_ms, 1000, 1000, 60000, "request_delay_ms"));
  let maxCaptured = ""; // 数据新鲜度锚点：这批商品里最新的 captured_at
  for (const kw of keywords) {
    const result = await queryKeyword(kw, { ...cfg, fetchImpl: ctx.fetchImpl, sleep: ctx.sleep }, budget);
    const { items } = result;
    coverage.push(result.coverage);
    for (const it of items) {
      if (it.captured_at && it.captured_at > maxCaptured) maxCaptured = it.captured_at;
    }
    // 价格升序；无价/异常行放最后
    const offers = items
      .map((it) => ({
        offerId: String(it.id ?? it.item_key ?? it.goods_id),
        sourceId: it.source ?? null,
        sourceName: it.shop_name ?? null,
        storeName: it.shop_name ?? null,
        title: it.goods_name ?? null,
        price: typeof it.price === "number" ? it.price : it.price_raw != null ? Number(it.price_raw) : null,
        currency: "CNY",
        status: it.status ?? null,
        stockCount: it.stock != null ? Number(it.stock) : null,
        url: it.item_url ?? null,
        capturedAt: it.captured_at ?? null,
        expiresAt: null,
      }))
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    const inStock = offers.filter(
      (o) => o.status === "online" && !(o.stockCount === 0)
    );
    const cheapest = (inStock.length ? inStock : offers).find((o) => o.price != null);
    products.push({
      productId: slugify(kw),
      name: `LDXP 搜索「${kw}」`,
      platform: "链动小铺(LDXP)",
      productType: "卡网商品",
      spec: null,
      lowestPrice: cheapest?.price ?? null,
      currency: "CNY",
      offerCount: offers.length,
      inStockCount: inStock.length,
      offers,
      coverage: result.coverage,
    });
    ctx.log?.(`[ldxp-goods] “${kw}”: 收录 ${offers.length}/${result.coverage.total ?? "未知"}（有货 ${inStock.length}），最低 ${cheapest?.price ?? "-"}，${result.coverage.truncated ? `有限样本:${result.coverage.reason}` : "该查询完整"}`);
  }

  // snapshotId：源侧数据代次 + 商品新鲜度锚点 + 关键词集合指纹
  // （captured_at 纳入指纹：即使 relaywatch 的代次号未变，只要商品数据更新就会生成新快照）
  const scope = { keywords, pageSize: cfg.page_size ?? 100, maxPages: cfg.max_pages_per_keyword ?? 2, maxRequests: cfg.max_requests ?? 24, stock: "in", sort: "price_asc" };
  const kwFingerprint = fnv1a(JSON.stringify({ scope, maxCaptured, coverage, version: 2 }));
  generation = typeof generation === "string" && generation ? generation : new Date().toISOString();
  const genPart = generation.replace(/[:.]/g, "").slice(0, 15);
  const snapshotId = `${genPart}-${fnv1a(maxCaptured || "none").slice(0, 6)}${kwFingerprint.slice(0, 6)}`;
  const coverageSummary = {
    mode: "bounded_keyword_sample", checkedAt: new Date().toISOString(), snapshotId, ...scope,
    requests: budget.requests, pages: coverage.reduce((sum, row) => sum + row.pagesFetched, 0),
    // Query totals overlap; matchedTotal is deliberately not a distinct SKU count.
    matchedTotal: coverage.reduce((sum, row) => sum + (row.total ?? 0), 0),
    matchedTotalBasis: "sum_of_overlapping_query_totals",
    fetchedUnique: new Set(products.flatMap(p => p.offers.map(o => o.url || o.offerId))).size,
    truncated: coverage.some(row => row.truncated),
    stopReason: [...new Set(coverage.map(row => row.reason).filter(Boolean))], queries: coverage,
  };
  if (ctx.db) metaSet(ctx.db, `coverage:${sourceId}`, JSON.stringify(coverageSummary));

  return {
    source: sourceId,
    snapshotId,
    snapshot: {
      source: sourceId,
      snapshotId,
      fetchedAt: new Date().toISOString(),
      generatedAt: generation,
      publishedAt: null,
      stale: false,
      coverage: coverageSummary,
      products,
    },
  };
}
