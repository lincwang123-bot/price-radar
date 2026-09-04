// 第四数据源：goaihop.com —— AI 中转 API 站套餐与可用性
// 数据: GET https://goaihop.com/api/relay-packages?offset=&limit=50（分页，共 ~73 条，全 CNY）
// 语义: 每个「中转站 provider」= product，其 offers = 该站的套餐（价格 CNY + 有效期 + 可用性指标）。
// 解析依据: price-radar/docs/goaihop-relay-packages-parsing-spec.md（子代理实测：JSON 两页拿全，
//           successRate/availability/latency 在 provider.metrics 中为 SSR/API 真实快照）。
// 合规：个人非商用低频采集（默认 6h/次）；goaihop 含赞助(sponsored)中转站，已在 extra 标注。

const API = "https://goaihop.com/api/relay-packages";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const sourceId = "goaihop-relay";
export const sourceLabel = "GoAIHop·中转 API 套餐价+可用性";

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function num(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchPage(offset, limit) {
  const url = `${API}?offset=${offset}&limit=${limit}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ offset=${offset}`);
  return res.json();
}

/**
 * @param {object} ctx { db, config, dataDir, log }
 */
export async function pull(ctx) {
  const cfg = ctx.config?.sources?.[sourceId] ?? {};

  // 节流：可用性指标约几十分钟级刷新，默认 6h 拉一次足够个人参考
  const minIntervalMin = cfg.min_interval_minutes ?? 360;
  const lastRow = ctx.db
    ? ctx.db.prepare(
        "SELECT fetched_at FROM snapshots WHERE source = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1"
      ).get(sourceId)
    : null;
  if (lastRow?.fetched_at) {
    const elapsedMin = (Date.now() - Date.parse(lastRow.fetched_at)) / 60000;
    if (elapsedMin < minIntervalMin) {
      ctx.log?.(`[${sourceId}] 距上次抓取仅 ${elapsedMin.toFixed(0)}min（< ${minIntervalMin}min），跳过本轮。`);
      return { source: sourceId, skipped: true, snapshotId: null };
    }
  }

  // 分页拿全（page_size=50，总量 ~73）
  const all = [];
  let offset = 0;
  let total = null;
  for (let guard = 0; guard < 5; guard++) {
    const body = await fetchPage(offset, 50);
    const data = body?.data ?? body;
    const items = Array.isArray(data?.items) ? data.items : [];
    all.push(...items);
    total = data?.total ?? all.length;
    if (!items.length || all.length >= total) break;
    offset += items.length;
  }
  ctx.log?.(`[${sourceId}] 拉到套餐 ${all.length} 条。`);

  // 按 provider 分组
  const byProvider = new Map();
  let maxChecked = "";
  for (const it of all) {
    const p = it.provider ?? {};
    if (!byProvider.has(p.slug)) {
      byProvider.set(p.slug, { provider: p, packages: [] });
    }
    const meta = p.metrics ?? {};
    if (meta.lastCheckedAt && meta.lastCheckedAt > maxChecked) maxChecked = meta.lastCheckedAt;
    byProvider.get(p.slug).packages.push(it);
  }

  const products = [];
  for (const [slug, { provider, packages }] of byProvider) {
    const meta = provider.metrics ?? {};
    const offers = packages
      .map((it) => {
        const validity =
          it.validityValue != null && it.validityUnit
            ? `${it.validityValue} ${it.validityUnit}`
            : null;
        return {
          offerId: String(it.id ?? `${slug}:${it.name?.zhCN ?? it.name?.zh_CN ?? it.priceAmount}`),
          sourceId: slug,
          sourceName: provider.name?.en ?? provider.name ?? slug,
          storeName: provider.name?.en ?? provider.name ?? slug,
          title: `${it.name?.["zh-CN"] ?? it.name?.en ?? "套餐"}${validity ? `（${validity}）` : ""}`,
          price: num(it.priceAmount),
          currency: it.currency ?? "CNY",
          status: it.status ?? null,
          stockCount: null,
          url: `https://goaihop.com/en/relay-packages/${encodeURIComponent(slug)}`,
          capturedAt: meta.lastCheckedAt ?? null,
          expiresAt: null,
          extra: {
            billingMode: it.billingMode ?? null,
            validity,
            purchaseLimit: it.purchaseLimit ?? null,
            providerStatus: provider.status ?? null,
            sponsored: !!provider.sponsored,
            successRate7d: meta.successRate7d ?? null,
            availability7d: meta.availability7d ?? null,
            totalLatencyP50Ms: meta.totalLatencyP50Ms ?? null,
            firstTokenLatencyP50Ms: meta.firstTokenLatencyP50Ms ?? null,
            sampleCount: meta.sampleCount ?? null,
            testedModelCount: meta.testedModelCount ?? null,
            lastCheckedAt: meta.lastCheckedAt ?? null,
          },
        };
      })
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    products.push({
      productId: `relay-${slug}`,
      name: `中转 ${provider.name?.en ?? provider.name ?? slug}`,
      platform: "AI 中转 API",
      productType: "中转站套餐",
      spec: null,
      lowestPrice: offers[0]?.price ?? null,
      currency: "CNY",
      offerCount: offers.length,
      inStockCount: offers.filter((o) => o.status === "active").length,
      offers,
    });
  }

  // snapshotId：数据内容指纹（内容不变则去重）
  const fp = fnv1a(
    all.map((it) => `${it.id}|${it.priceAmount}|${it.provider?.metrics?.lastCheckedAt ?? ""}`).join(",")
  );
  const stamp = (maxChecked || new Date().toISOString()).replace(/[:.]/g, "").slice(0, 12);
  const snapshotId = `gh-${stamp}-${fp.slice(0, 8)}`;

  return {
    source: sourceId,
    snapshotId,
    snapshot: {
      source: sourceId,
      snapshotId,
      fetchedAt: new Date().toISOString(),
      generatedAt: maxChecked || null,
      publishedAt: null,
      stale: false,
      products,
    },
  };
}
