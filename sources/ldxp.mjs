// 第二数据源：RelayWatch · 链动小铺(LDXP) 卡网商品 —— 关键词定向盯价
// 端点: https://relaywatch.online/api/ldxp/goods?q=<关键词>&page_size=100
// 许可: relaywatch 项目 MIT；本适配器只做低频、关键词定向的轻量查询，
//       不做全量镜像/整库爬取（该站 summary 显示约 4.6 万商品，全爬不在此列）。
// 数据形态：单条商品 = { goods_name, price(CNY), stock, status(online/out_of_stock),
//           shop_name, shop_url, item_url, category, updated_at, captured_at }
// 本适配器把「每个配置关键词」映射为一个 product，其 offers = 命中的商品按价格升序。

import { claimSourceAttempt } from "../lib/source-timing.mjs";

const BASE = "https://relaywatch.online";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const sourceId = "ldxp-goods";
export const sourceLabel = "RelayWatch·链动小铺(LDXP) 卡网商品价";

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
  const keywords = Array.isArray(cfg.keywords) && cfg.keywords.length ? cfg.keywords : [];
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
    const sres = await fetch(`${BASE}/api/summary`, { headers: { "User-Agent": UA } });
    if (!sres.ok) throw new Error(`summary HTTP ${sres.status}`);
    generation = (await sres.json()).generated_at;
  } catch (err) {
    ctx.log?.(`[ldxp-goods] 获取 summary 失败(${err.message})，用当前时间作为代次标记。`);
    generation = new Date().toISOString();
  }

  const products = [];
  let maxCaptured = ""; // 数据新鲜度锚点：这批商品里最新的 captured_at
  for (const kw of keywords) {
    const url = `${BASE}/api/ldxp/goods?q=${encodeURIComponent(kw)}&page_size=100`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      ctx.log?.(`[ldxp-goods] “${kw}” 查询失败 HTTP ${res.status}`);
      continue;
    }
    const body = await res.json();
    const items = Array.isArray(body.items) ? body.items : [];
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
    });
    ctx.log?.(`[ldxp-goods] “${kw}”: 命中 ${offers.length}（有货 ${inStock.length}），最低 ${cheapest?.price ?? "-"}`);
  }

  // snapshotId：源侧数据代次 + 商品新鲜度锚点 + 关键词集合指纹
  // （captured_at 纳入指纹：即使 relaywatch 的代次号未变，只要商品数据更新就会生成新快照）
  const kwFingerprint = fnv1a(keywords.join("|") + "|" + maxCaptured);
  const genPart = generation.replace(/[:.]/g, "").slice(0, 15);
  const snapshotId = `${genPart}-${fnv1a(maxCaptured || "none").slice(0, 6)}${kwFingerprint.slice(0, 6)}`;

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
      products,
    },
  };
}
