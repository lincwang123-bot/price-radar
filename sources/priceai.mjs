import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// PriceAI 官方公开快照流适配器。
// 端点契约见 https://priceai.cc/price-radar-api.md
// 只读公开接口、无认证；遵守轮询 >= 1min、仅在 snapshot_id 变化时下载不可变快照。

const LATEST_URL = "https://data.priceai.cc/latest.json";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const sourceId = "priceai";
export const sourceLabel = "PriceAI（AI 订阅/中转 API 比价雷达）";

/** 把 priceai 原始快照对象转成规范入库快照（供 pull 与历史回填共用） */
export function rawToSnapshot(raw, fetchedAt = new Date().toISOString()) {
  const products = (raw.products ?? []).map(normalizeProduct);
  return {
    source: sourceId,
    snapshotId: raw.snapshot_id,
    fetchedAt,
    generatedAt: raw.generated_at ?? null,
    publishedAt: raw.published_at ?? null,
    stale: !!raw.stale,
    products,
  };
}

async function getJson(url, { etag } = {}) {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(url, { headers });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`);
  return {
    body: await res.json(),
    etag: res.headers.get("etag") || undefined,
    lastModified: res.headers.get("last-modified") || undefined,
    cacheControl: res.headers.get("cache-control") || undefined,
  };
}

/**
 * @param {object} ctx { db, dataDir, log }
 * @returns {{source:string, unchanged:boolean, snapshot?:object}}
 */
export async function pull(ctx) {
  const rawDir = path.join(ctx.dataDir, "raw");
  mkdirSync(rawDir, { recursive: true });
  const cacheFile = path.join(ctx.dataDir, `${sourceId}-latest.json`);
  const dataDir = ctx.dataDir;

  // 1) 指针（本地缓存 ETag，命中 304 则沿用）
  let prev = null;
  if (existsSync(cacheFile)) {
    try { prev = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { prev = null; }
  }
  const ptrRes = await getJson(LATEST_URL, { etag: prev?.etag });
  let ptr;
  if (ptrRes.notModified && prev?.body) {
    ptr = prev.body;
    ctx.log?.(`[priceai] 指针 304 未变化（ETag 命中），沿用缓存。`);
  } else {
    ptr = ptrRes.body;
    writeFileSync(cacheFile, JSON.stringify({
      etag: ptrRes.etag ?? null,
      body: ptr,
      fetched_at: new Date().toISOString(),
    }));
  }

  const snapshotId = ptr.snapshot_id;
  const rawPath = path.join(rawDir, `${sourceId}-${snapshotId}.json`);
  const rawCacheHit = existsSync(rawPath);

  // 2) 下载或复用不可变快照（同 id 不重复下载）
  let snapshot;
  if (rawCacheHit) {
    ctx.log?.(`[priceai] 快照 ${snapshotId} 命中本地 raw 缓存，未重新下载。`);
    snapshot = JSON.parse(readFileSync(rawPath, "utf8"));
  } else {
    ctx.log?.(`[priceai] 下载新快照 ${snapshotId} ...`);
    const snapRes = await fetch(ptr.snapshot_url, { headers: { "User-Agent": UA } });
    if (!snapRes.ok) throw new Error(`HTTP ${snapRes.status} @ ${ptr.snapshot_url}`);
    snapshot = await snapRes.json();
    writeFileSync(rawPath, JSON.stringify(snapshot));
    ctx.log?.(`[priceai] 快照已缓存: ${path.basename(rawPath)}。`);
  }

  return {
    source: sourceId,
    reusedCache: rawCacheHit,
    snapshotId,
    snapshot: rawToSnapshot(snapshot),
  };
}

function normalizeProduct(p) {
  const byId = new Map();
  const add = (o) => {
    if (!o?.id) return;
    if (!byId.has(o.id)) {
      byId.set(o.id, {
        offerId: o.id,
        sourceId: o.source_id ?? null,
        sourceName: o.source_name ?? null,
        storeName: o.source_store_name ?? null,
        title: o.title ?? null,
        price: typeof o.price === "number" ? o.price : null,
        currency: o.currency ?? null,
        status: o.effective_status ?? o.status ?? null,
        stockCount: o.stock_count ?? null,
        url: o.url ?? null,
        capturedAt: o.captured_at ?? null,
        expiresAt: o.expires_at ?? null,
      });
    }
  };
  if (p.lowest_offer) add(p.lowest_offer);
  for (const o of p.top_offers ?? []) add(o);

  const offers = [...byId.values()];
  const lowestPrice =
    typeof p.lowest_price === "number"
      ? p.lowest_price
      : (offers.reduce((m, o) => (o.price != null && (m == null || o.price < m) ? o.price : m), null));
  return {
    productId: p.id ?? p.slug,
    name: p.name ?? null,
    platform: p.platform ?? null,
    productType: p.product_type ?? null,
    spec: p.spec ?? null,
    lowestPrice,
    currency: p.lowest_offer?.currency ?? null,
    offerCount: p.offer_count ?? p.total ?? offers.length,
    inStockCount: p.in_stock_count ?? 0,
    offers,
  };
}
