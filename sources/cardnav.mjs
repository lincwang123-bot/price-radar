// 第三数据源：cardnav.xyz —— 官方订阅 App Store 地区比价（SSR 表格）
// 页面: https://cardnav.xyz/official-price/<slug>   zh 版，共 17 个产品页
// 用途：给「官方订阅区价」维度，与 priceai(卡网渠道)/ldxp(链动货源) 对照，看官方 vs 渠道差价。
// 合规：个人非商用整合站；低频（默认 12h/次，可在 config 调 min_interval_minutes）；
//       只取公开 SSR 价格表、不做全量镜像、页面标注来源。
// DATA_LICENSE 提示：cardnav 禁止高频爬取/镜像全量，本适配器不做这些。

import { claimSourceAttempt } from "../lib/source-timing.mjs";

const BASE = "https://cardnav.xyz";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const sourceId = "cardnav-official";
export const sourceLabel = "CardNav·官方订阅 App Store 区价";

// 17 个 zh 产品页 slug（来自 sitemap-official-price.xml，去 en/ru 重复）
export const DEFAULT_PAGES = [
  "chatgpt-go", "chatgpt-plus", "chatgpt-pro-5x", "chatgpt-pro-20x",
  "claude-pro", "claude-max-5x", "claude-max-20x",
  "gemini-ai-plus", "gemini-advanced", "gemini-ai-ultra",
  "grok-supergrok-lite", "grok-supergrok", "grok-supergrok-heavy",
  "copilot-pro", "x-basic", "x-premium", "x-premium-plus",
];

const LABELS = {
  "chatgpt-go": { name: "ChatGPT Go（官方区价）", platform: "ChatGPT", family: "ChatGPT Go" },
  "chatgpt-plus": { name: "ChatGPT Plus（官方区价）", platform: "ChatGPT", family: "ChatGPT Plus" },
  "chatgpt-pro-5x": { name: "ChatGPT Pro 5x（官方区价）", platform: "ChatGPT", family: "ChatGPT Pro 5x" },
  "chatgpt-pro-20x": { name: "ChatGPT Pro 20x（官方区价）", platform: "ChatGPT", family: "ChatGPT Pro 20x" },
  "claude-pro": { name: "Claude Pro（官方区价）", platform: "Claude", family: "Claude Pro" },
  "claude-max-5x": { name: "Claude Max 5x（官方区价）", platform: "Claude", family: "Claude Max 5x" },
  "claude-max-20x": { name: "Claude Max 20x（官方区价）", platform: "Claude", family: "Claude Max 20x" },
  "gemini-ai-plus": { name: "Gemini AI Plus（官方区价）", platform: "Gemini", family: "Gemini Plus" },
  "gemini-advanced": { name: "Gemini AI Advanced（官方区价）", platform: "Gemini", family: "Gemini Advanced" },
  "gemini-ai-ultra": { name: "Gemini AI Ultra（官方区价）", platform: "Gemini", family: "Gemini Ultra" },
  "grok-supergrok-lite": { name: "Grok SuperGrok Lite（官方区价）", platform: "Grok", family: "Grok Lite" },
  "grok-supergrok": { name: "Grok SuperGrok（官方区价）", platform: "Grok", family: "Grok" },
  "grok-supergrok-heavy": { name: "Grok SuperGrok Heavy（官方区价）", platform: "Grok", family: "Grok Heavy" },
  "copilot-pro": { name: "Copilot Pro（官方区价）", platform: "Microsoft", family: "Copilot Pro" },
  "x-basic": { name: "X Basic（官方区价）", platform: "X", family: "X Basic" },
  "x-premium": { name: "X Premium（官方区价）", platform: "X", family: "X Premium" },
  "x-premium-plus": { name: "X Premium+（官方区价）", platform: "X", family: "X Premium+" },
};

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseNumeric(s) {
  const m = String(s ?? "").replace(/[^\d.-]/g, "");
  return m ? Number(m) : null;
}

/** 解析一个 official-price 页 → { slug, name, platform, refreshedAt, rows:[{rank,region,localPrice,currency,cny}] } */
function parsePage(html, slug) {
  const meta = LABELS[slug] ?? { name: slug, platform: "其他", family: slug };
  const refresh = /最近刷新[（(]北京时间[)）]?\s*[:：]?\s*([\d-]+\s[\d:]+)/.exec(html);
  const refreshedAt = refresh ? refresh[1].trim().replace(" ", "T") : null;

  const rows = [];
  const rowRe = /<tr data-sort-sequence="(\d+)">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[2];
    const cells = {};
    const cellRe = /<td[^>]*data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g;
    let c;
    while ((c = cellRe.exec(rowHtml)) !== null) {
      cells[c[1]] = stripTags(c[2]);
    }
    if (!cells["国家/地区"] || !cells["折合人民币 (CNY)"]) continue;
    const region = cells["国家/地区"].replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "").trim();
    const localPrice = cells["本地标价"] ?? "";
    const currency = cells["币种"] ?? "";
    const cny = parseNumeric(cells["折合人民币 (CNY)"]);
    if (cny == null) continue;
    rows.push({ rank: Number(cells["序号"] ?? m[1]), region, localPrice, currency, cny });
  }
  rows.sort((a, b) => a.cny - b.cny);
  return { slug, name: meta.name, platform: meta.platform, family: meta.family, refreshedAt, rows };
}

/**
 * @param {object} ctx { db, config, dataDir, log }
 */
export async function pull(ctx) {
  const cfg = ctx.config?.sources?.[sourceId] ?? {};
  const pages = Array.isArray(cfg.pages) && cfg.pages.length ? cfg.pages : DEFAULT_PAGES;

  // 礼貌节流：官方区价刷新约每日一次，默认 12h 拉一次即可
  const minIntervalMin = cfg.min_interval_minutes ?? 720;
  const timing = ctx.db
    ? claimSourceAttempt(ctx.db, sourceId, minIntervalMin)
    : { allowed: true };
  if (!timing.allowed) {
    ctx.log?.(`[${sourceId}] 距上次抓取仅 ${timing.elapsedMinutes.toFixed(0)}min（< ${minIntervalMin}min），跳过本轮。`);
    return { source: sourceId, skipped: true, snapshotId: null };
  }

  const products = [];
  let maxRefreshed = "";
  for (const slug of pages) {
    const url = `${BASE}/official-price/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        ctx.log?.(`[${sourceId}] ${slug} HTTP ${res.status}，跳过。`);
        continue;
      }
      const html = await res.text();
      const parsed = parsePage(html, slug);
      if (!parsed.rows.length) {
        ctx.log?.(`[${sourceId}] ${slug} 未解析到价格行（页面结构可能变更），跳过。`);
        continue;
      }
      if (parsed.refreshedAt && parsed.refreshedAt > maxRefreshed) maxRefreshed = parsed.refreshedAt;

      const offers = parsed.rows.map((r) => ({
        offerId: `${slug}:${r.region.replace(/\s+/g, "")}:${r.currency}`,
        sourceName: "cardnav(官方区价)",
        storeName: `${r.region}`,
        title: `${r.region} ${r.localPrice} ${r.currency}`,
        price: r.cny, // 折合人民币
        currency: "CNY",
        status: "official",
        stockCount: null,
        url,
        capturedAt: parsed.refreshedAt ?? null,
        expiresAt: null,
      }));
      products.push({
        productId: slug,
        name: parsed.name,
        platform: parsed.platform,
        productType: "官方订阅区价",
        spec: null,
        lowestPrice: offers[0]?.price ?? null,
        currency: "CNY",
        offerCount: offers.length,
        inStockCount: offers.length,
        offers,
      });
      ctx.log?.(`[${sourceId}] ${slug}: ${offers.length} 个地区，最低折合 ¥${offers[0]?.price ?? "-"}（${offers[0]?.storeName ?? ""}）。`);
    } catch (err) {
      ctx.log?.(`[${sourceId}] ${slug} 拉取失败: ${err.message}`);
    }
  }

  if (!products.length) {
    throw new Error(`${sourceId}: 所有页面都未解析成功，中止本轮（可能页面结构变更）。`);
  }

  const slugSet = pages.join("|");
  const snapshotId = `cn-${(maxRefreshed || new Date().toISOString().slice(0, 10)).replace(/[-:T]/g, "").slice(0, 12)}-${fnv1a(slugSet).slice(0, 8)}`;
  return {
    source: sourceId,
    snapshotId,
    snapshot: {
      source: sourceId,
      snapshotId,
      fetchedAt: new Date().toISOString(),
      generatedAt: maxRefreshed || null,
      publishedAt: null,
      stale: false,
      products,
    },
  };
}
