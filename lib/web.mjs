// 零依赖 Node http + 服务端渲染，公开页面只写入独立的投稿数据库。
// 保持既有路由，并提供 /submit 与 /api/submissions。

import http from "node:http";
import { createAdmin } from "./admin.mjs";
import { seoRoute, seoProduct, decorateSeo } from "./seo.mjs";
import { SHOP_SOURCES, publicOfferAllowed } from "./public-offers.mjs";
import { marketEntries, selectedQuote, quoteOrder, listingState, publicSpec, publicProductName, MARKET_CSS } from "./market-view.mjs";
import { CHANNELS, normalizeChannel, offerChannel, filterChannel } from "./channels.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";

import { classifyDirectOffer, directOfferExclusionReason } from "../collectors/direct/catalog.mjs";
import { createSubmission, purgeExpiredClientHashes, SubmissionError } from "./submissions.mjs";

// 人工展示映射，只用于浏览，不能视作 SKU 等价断言。
const FAMILIES = [
  { family: "ChatGPT Go", platform: "ChatGPT", priceai: "chatgpt-go", direct: "chatgpt-go", official: "chatgpt-go", ldxp: null },
  { family: "ChatGPT Plus（试用/成品）", platform: "ChatGPT", priceai: "chatgpt-plus", direct: "chatgpt-plus", official: null, ldxp: null },
  { family: "ChatGPT Plus（正价代充）", platform: "ChatGPT", priceai: "chatgpt-plus-recharge", direct: "chatgpt-plus-recharge", official: "chatgpt-plus", ldxp: "chatgpt-plus-代充" },
  { family: "ChatGPT Pro 5x", platform: "ChatGPT", priceai: "chatgpt-pro-5x", direct: "chatgpt-pro-5x", official: "chatgpt-pro-5x", ldxp: null },
  { family: "ChatGPT Pro 20x", platform: "ChatGPT", priceai: "chatgpt-pro-20x", direct: "chatgpt-pro-20x", official: "chatgpt-pro-20x", ldxp: null },
  { family: "ChatGPT Team/Business", platform: "ChatGPT", priceai: "chatgpt-team-business", direct: "chatgpt-team-business", official: null, ldxp: null },
  { family: "Claude Pro", platform: "Claude", priceai: "claude-pro-month", direct: "claude-pro-month", official: "claude-pro", ldxp: "claude-pro-代充" },
  { family: "Claude Max 5x", platform: "Claude", priceai: "claude-max-5x", direct: "claude-max-5x", official: "claude-max-5x", ldxp: null },
  { family: "Claude Max 20x", platform: "Claude", priceai: "claude-max-20x", direct: "claude-max-20x", official: "claude-max-20x", ldxp: null },
  { family: "Gemini Plus", platform: "Gemini", priceai: "gemini-pro-recharge", direct: "gemini-pro-recharge", official: "gemini-ai-plus", ldxp: null },
  { family: "Gemini Ultra", platform: "Gemini", priceai: "gemini-ultra", direct: "gemini-ultra", official: "gemini-ai-ultra", ldxp: null },
  { family: "Grok Super", platform: "Grok", priceai: "super-grok", direct: "super-grok", official: "grok-supergrok", ldxp: null },
  { family: "Grok Super Heavy", platform: "Grok", priceai: "super-grok-heavy", direct: "super-grok-heavy", official: "grok-supergrok-heavy", ldxp: null },
  { family: "X Premium", platform: "X", priceai: "x-twitter-premium", direct: "x-twitter-premium", official: "x-premium", ldxp: null },
];

const FAMILY_FILTERS = [
  { key: "all", label: "全部", platform: null },
  { key: "chatgpt", label: "ChatGPT", platform: "ChatGPT" },
  { key: "claude", label: "Claude", platform: "Claude" },
  { key: "gemini", label: "Gemini", platform: "Gemini" },
  { key: "grok", label: "Grok", platform: "Grok" },
  { key: "x", label: "X", platform: "X" },
  { key: "cursor", label: "Cursor", platform: "Cursor" },
  { key: "perplexity", label: "Perplexity", platform: "Perplexity" },
  { key: "notion", label: "Notion AI", platform: "Notion AI" },
  { key: "manus", label: "Manus", platform: "Manus" },
  { key: "microsoft", label: "Microsoft", platform: "Microsoft" },
  { key: "relay", label: "API / CDK", platform: null },
  { key: "verify", label: "接码", platform: null },
  { key: "mail", label: "邮箱", platform: null },
  { key: "other", label: "其他", platform: null },
];

// 首页首屏只展示平台级概览；具体 SKU 仍在下方的可展开明细中展示。
// 这些映射基于 FAMILIES 的人工浏览映射，避免通过名称猜测商品归属。
const OVERVIEW_FAMILIES = [
  { platform: "ChatGPT", family: "ChatGPT Plus（正价代充）", provider: "OpenAI", plan: "Plus", billing: "—" },
  { platform: "Claude", family: "Claude Pro", provider: "Anthropic", plan: "Pro", billing: "—" },
  { platform: "Gemini", family: "Gemini Plus", provider: "Google", plan: "Plus", billing: "—" },
  { platform: "Grok", family: "Grok Super", provider: "xAI", plan: "Super", billing: "—" },
  { platform: "X", family: "X Premium", provider: "X Corp.", plan: "Premium", billing: "—" },
];

const SOURCE_LABEL = {
  priceai: "PriceAI 卡网",
  "ldxp-goods": "LDXP 货源",
  "cardnav-official": "CardNav 官方区价",
  "goaihop-relay": "GoAIHop 中转套餐",
  "direct-shops": "原始店铺直采",
};

const SOURCE_SHORT = {
  priceai: "PriceAI",
  "ldxp-goods": "LDXP",
  "cardnav-official": "CardNav",
  "goaihop-relay": "GoAIHop",
  "direct-shops": "原店直采",
};

const ALERT_TYPE = {
  min_below: ["跌破阈值", "drop"],
  drop_pct: ["价格下跌", "drop"],
  cheapest_changed: ["最低价换店", "change"],
  offer_gone: ["最低价消失", "gone"],
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? esc(url.href) : "";
  } catch {
    return "";
  }
}

function cloudflareWebAnalytics() {
  const token = String(process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN ?? "").trim();
  // Cloudflare 的 site token 会出现在浏览器页面中，因此这里只接受它的公开标识格式，
  // 不把账户 API Token 或任何私密凭据传给前端。
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) return "";
  const beacon = esc(JSON.stringify({ token }));
  return `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${beacon}'></script>`;
}

function sourceClass(source) {
  return ({
    "cardnav-official": "official",
    priceai: "priceai",
    "ldxp-goods": "ldxp",
    "goaihop-relay": "goaihop",
    "direct-shops": "direct",
  })[source] ?? "neutral";
}

function platformTone(platform) {
  return ({
    ChatGPT: "chatgpt",
    Claude: "claude",
    Gemini: "gemini",
    Grok: "grok",
    X: "x",
    Cursor: "cursor",
    Perplexity: "perplexity",
    "Notion AI": "notion",
    Manus: "manus",
    Microsoft: "microsoft",
    "AI 中转 API": "relay",
    "API/CDK": "relay",
    "接码": "verify",
    "邮箱": "mail",
  })[platform] ?? "other";
}

function productHref(source, id) {
  return "/product?source=" + encodeURIComponent(source ?? "") + "&amp;id=" + encodeURIComponent(id ?? "");
}

function productPageHref(source, id, page = 1) {
  const base = productHref(source, id);
  return page > 1 ? base + "&amp;page=" + page + "#offers" : base + "#offers";
}

function requestedPage(value) {
  const raw = String(value ?? "");
  if (!/^[1-9]\d*$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : 1;
}

export function fmtPrice(value, currency = "CNY") {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const prefix = currency === "CNY" ? "¥" : esc(currency) + " ";
  return prefix + (Number.isInteger(number) ? number : number.toFixed(2));
}

export function fmtTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function latestProducts(db, source, channel = "all") {
  const latest = db.prepare(
    "SELECT snapshot_id, fetched_at, stale FROM snapshots WHERE source = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1"
  ).get(source);
  if (!latest) return null;
  let products = db.prepare(
    `SELECT p.*, COUNT(o.offer_id) AS visible_offer_count
     FROM products p
     LEFT JOIN offers o
       ON o.source = p.source AND o.snapshot_id = p.snapshot_id AND o.product_id = p.product_id
     WHERE p.source = ? AND p.snapshot_id = ?
     GROUP BY p.source, p.snapshot_id, p.product_id`
  ).all(source, latest.snapshot_id);
  if(channel!=="all"||SHOP_SOURCES.has(source))products=products.flatMap(p=>{const offers=filterChannel(offersOf(db,source,latest.snapshot_id,p.product_id),channel).filter(o=>o.price!=null&&o.price!==''&&Number.isFinite(Number(o.price))&&(SHOP_SOURCES.has(source)?Number(o.price)>0:Number(o.price)>=0));if(!offers.length&&channel!=="all")return[];const available=offers.filter(o=>['in_stock','available','online','low_stock'].includes(o.status)&&o.stock_count!==0),selected=SHOP_SOURCES.has(source)?selectedQuote(offers):offers[0];return[{...p,selected_offer:selected,public_sample_only:source==='priceai',lowest_price:selected?Number(selected.price):null,offer_count:offers.length,visible_offer_count:offers.length,in_stock_count:available.length}];});
  return { source, snapshotId: latest.snapshot_id, fetchedAt: latest.fetched_at, stale: Boolean(latest.stale), products, channel };
}

function cheapestOffer(db, source, snapshotId, productId) {
  return offersOf(db,source,snapshotId,productId)[0];
}

function offersOf(db, source, snapshotId, productId) {
  return db.prepare(
    "SELECT * FROM offers WHERE source = ? AND snapshot_id = ? AND product_id = ? ORDER BY (status = 'out_of_stock') ASC, price ASC"
  ).all(source, snapshotId, productId).filter(o=>publicOfferAllowed(source,o)).sort(quoteOrder);
}

function priceSeriesRows(db, source, productId) {
  if (source === "direct-shops") return directShopPriceSeriesRows(db, productId);
  if (SHOP_SOURCES.has(source)) return channelSeries(db,source,productId,"all");
  return db.prepare(
    "SELECT s.fetched_at, p.lowest_price FROM products p JOIN snapshots s ON s.source = p.source AND s.snapshot_id = p.snapshot_id WHERE p.source = ? AND p.product_id = ? AND p.lowest_price IS NOT NULL ORDER BY s.fetched_at ASC"
  ).all(source, productId);
}

function directShopPriceSeriesRows(db, productId) {
  // 旧快照可能是在发布过滤规则上线前生成的，其 products.lowest_price 会被
  // 售罄或无质保低价污染。直接从最近快照的报价明细重算公开最低价，既保留
  // 可信历史，又不会让已经被剔除的报价继续出现在走势图中。
  const rows = db.prepare(
    `WITH recent_snapshots AS (
       SELECT rowid AS snapshot_rowid, snapshot_id, fetched_at
       FROM snapshots
       WHERE source = 'direct-shops'
       ORDER BY fetched_at DESC, rowid DESC
       LIMIT 120
     )
     SELECT s.snapshot_rowid, s.snapshot_id, s.fetched_at,
            o.offer_id, o.title, o.price, o.status, o.stock_count
     FROM recent_snapshots s
     JOIN offers o
       ON o.source = 'direct-shops' AND o.snapshot_id = s.snapshot_id
     WHERE o.product_id = ?
     ORDER BY s.fetched_at ASC, s.snapshot_rowid ASC, o.price ASC`
  ).all(productId);
  const points = new Map();
  for (const row of rows) {
    if (directOfferExclusionReason({ ...row, stockCount: row.stock_count })) continue;
    const currentCategory = classifyDirectOffer(row);
    if (currentCategory && currentCategory.id !== productId) continue;
    if (!["in_stock", "available", "online", "low_stock"].includes(String(row.status ?? "").toLowerCase())) continue;
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const current = points.get(row.snapshot_id);
    if (!current || price < current.lowest_price) {
      points.set(row.snapshot_id, { fetched_at: row.fetched_at, lowest_price: price });
    }
  }
  return [...points.values()];
}

function recentAlerts(db, limit = 30) {
  return db.prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT ?").all(limit).reverse();
}

function alertCount(db) {
  return db.prepare("SELECT COUNT(*) c FROM alerts").get().c;
}

function sourceBadge(source, short = false) {
  const label = short ? (SOURCE_SHORT[source] ?? source) : (SOURCE_LABEL[source] ?? source);
  return `<span class="source-badge ${sourceClass(source)}">${esc(label)}</span>`;
}

function visibleOfferCount(product) {
  const visible = Number(product?.visible_offer_count);
  if (Number.isFinite(visible)) return Math.max(0, visible);
  const reported = Number(product?.offer_count);
  return Number.isFinite(reported) ? Math.max(0, reported) : 0;
}

function hasUnpublishedOfferDetails(product) {
  if(product?.public_sample_only)return true;
  const reported = Number(product?.offer_count);
  const visible = Number(product?.visible_offer_count);
  return Number.isFinite(reported) && Number.isFinite(visible) && reported > visible;
}

function quoteCountLabel(product) {
  const count = visibleOfferCount(product);
  return hasUnpublishedOfferDetails(product) ? `公开明细 ${count} 条` : `报价 ${count} 条`;
}

function stockSummary(product) {
  const inStock = Number(product?.in_stock_count ?? 0);
  const offers = visibleOfferCount(product);
  if (hasUnpublishedOfferDetails(product)) {
    return `<span class="stock neutral"><i></i>公开明细 ${offers} 条</span>`;
  }
  if (inStock > 0) return `<span class="stock available"><i></i>有货 ${inStock} / ${offers}</span>`;
  if (offers > 0) return `<span class="stock out"><i></i>暂无现货 / ${offers}</span>`;
  return `<span class="stock neutral"><i></i>暂无报价</span>`;
}

function statusMark(value) {
  const raw = String(value ?? "").trim();
  let label = raw || "—";
  let tone = "neutral";
  if (raw === "official") { label = "官方"; tone = "official"; }
  else if (raw === "out_of_stock" || raw.startsWith("out")) { label = "无货"; tone = "out"; }
  else if (raw === "online" || raw === "in_stock" || raw === "available") { label = "有货"; tone = "available"; }
  else if (raw === "low_stock" || raw === "在售" || raw === "库存紧张") { label = raw === "low_stock" ? "库存紧张" : raw; tone = "available"; }
  else if (raw === "unknown") { label = "待确认"; }
  const title = raw ? " title=\"" + esc(raw) + "\"" : "";
  return `<span class="status ${tone}"${title}><i></i>${esc(label)}</span>`;
}

function extraOf(offer) {
  if (!offer?.extra) return null;
  try {
    const parsed = JSON.parse(offer.extra);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function metricLine(offer) {
  const channel=offerChannel(offer);
  const channelText=`<span class="dim">${esc(offer.source==="cardnav-official"?"官方渠道":offer.source==="goaihop-relay"?"服务商":channel.label)}</span>`;
  const extra = extraOf(offer);
  if (!extra) return channelText;
  const parts = [];
  if (extra.availability7d != null) parts.push("可用 " + extra.availability7d + "%");
  if (extra.totalLatencyP50Ms != null) parts.push("P50 " + extra.totalLatencyP50Ms + "ms");
  if (extra.sampleCount != null) parts.push("样本 " + extra.sampleCount);
  if (extra.testedModelCount != null) parts.push("测 " + extra.testedModelCount + " 模型");
  if (extra.sponsored) parts.push("赞助");
  return channelText + (parts.length ? `<div class="metric">${esc(parts.join(" · "))}</div>` : "");
}

function icon(name, cls = "") {
  const svg = (paths) => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  if (name === "overview") return svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>');
  if (name === "bell") return svg('<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>');
  if (name === "database") return svg('<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>');
  if (name === "shield") return svg('<path d="M12 3 19 6v5c0 4.6-2.8 7.8-7 10-4.2-2.2-7-5.4-7-10V6l7-3Z"/><path d="m9.4 12 1.8 1.8 3.6-4"/>');
  if (name === "close") return svg('<path d="m6 6 12 12M18 6 6 18"/>');
  if (name === "chevron") return svg('<path d="m9 18 6-6-6-6"/>');
  if (name === "external") return svg('<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>');
  if (name === "github") return `<svg class="icon ${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`;
  if (name === "back") return svg('<path d="m15 18-6-6 6-6"/><path d="M9 12h11"/>');
  if (name === "clock") return svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>');
  if (name === "message") return svg('<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M8 9h8M8 13h5"/>');
  if (name === "handshake") return svg('<path d="m8.5 12.5 2 2a2 2 0 0 0 2.8 0l4.8-4.8"/><path d="m3 11 4-4 3 1 2-1 5 5"/><path d="m6 15 2 2M9 17l1 1a2 2 0 0 0 2.8 0l.7-.7M18 7l3 3-3 5M6 7 3 10l3 5"/>');
  if (name === "check") return svg('<path d="m5 12 4 4L19 6"/>');
  if (name === "send") return svg('<path d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z"/><path d="M9.8 13.2 21 3"/>');
  return "";
}

function radarMark() {
  return `<svg class="radar" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="17" r="12" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="17" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="17" r="2.3" fill="currentColor"/><path d="M16 2.5v6.7M13.5 5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

function platformMark(platform, cls = "") {
  const className = `platform-mark ${cls}`.trim();
  const svg = (paths, extra = "") => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"${extra}>${paths}</svg>`;
  if (platform === "all") return svg('<rect x="4" y="4" width="5" height="5" rx="1"/><rect x="15" y="4" width="5" height="5" rx="1"/><rect x="4" y="15" width="5" height="5" rx="1"/><rect x="15" y="15" width="5" height="5" rx="1"/>');
  if (platform === "ChatGPT") return svg('<path d="M12 3.4a4.2 4.2 0 0 1 6.7 4.9 4.2 4.2 0 0 1 .4 7.2 4.2 4.2 0 0 1-5.8 5.8 4.2 4.2 0 0 1-7.2-.5A4.2 4.2 0 0 1 5.5 14a4.2 4.2 0 0 1 .5-7.2A4.2 4.2 0 0 1 12 3.4Z"/><path d="m9.2 7 5.6 3.2v6.4M6.5 13.2l5.5 3.2 5.5-3.2M9.1 19v-6.3l5.5-3.2"/>');
  if (platform === "Claude") return `<span class="${className} platform-wordmark" aria-hidden="true">AI</span>`;
  if (platform === "Gemini") return svg('<path d="M12 3.2c.8 5.4 3.4 8 8.8 8.8-5.4.8-8 3.4-8.8 8.8-.8-5.4-3.4-8-8.8-8.8 5.4-.8 8-3.4 8.8-8.8Z"/>');
  if (platform === "Grok") return svg('<path d="M6 5.2 18 18.8M16.6 5.2 8.4 18.8M13.6 4.4h5v5"/>');
  if (platform === "X") return svg('<path d="M5 4 18.6 20M19 4 5.4 20"/>');
  return svg('<circle cx="12" cy="12" r="7"/>');
}

function updatedMeta(list) {
  if (!list) return `<span class="updated dim">尚未采集</span>`;
  const freshness = list.stale ? "部分来源沿用缓存 · " : "";
  return `<span class="updated${list.stale ? " dim" : ""}">${icon("clock")}${freshness}更新于 ${esc(fmtTime(list.fetchedAt))}</span>`;
}

function sparkline(rows, currency = "CNY", width = 680, height = 176) {
  const points = rows.filter((row) => row.lowest_price != null);
  if (points.length < 2) return null;
  const padX = 4;
  const top = 10;
  const bottom = 10;
  const values = points.map((row) => Number(row.lowest_price));
  let min = Math.min(...values);
  let max = Math.max(...values);
  const rawRange = max - min;
  const padding = rawRange === 0 ? Math.max(Math.abs(max) * 0.01, 0.01) : rawRange * 0.08;
  min -= padding;
  max += padding;
  const plotBottom = height - bottom;
  const plotWidth = width - padX * 2;
  const timestamps = points.map((row) => Date.parse(row.fetched_at));
  const startTime = timestamps[0];
  const endTime = timestamps[timestamps.length - 1];
  const useTimeScale = timestamps.every(Number.isFinite) && endTime > startTime;
  const x = (index) => useTimeScale
    ? padX + ((timestamps[index] - startTime) / (endTime - startTime)) * plotWidth
    : padX + (index / (points.length - 1)) * plotWidth;
  const y = (value) => plotBottom - ((value - min) / (max - min)) * (plotBottom - top);
  const line = points.map((row, index) => x(index).toFixed(1) + "," + y(Number(row.lowest_price)).toFixed(1)).join(" ");
  const area = padX + "," + plotBottom + " " + line + " " + (width - padX) + "," + plotBottom;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = max - (max - min) * ratio;
    const chartY = y(value);
    return { value, chartY };
  });
  const grid = yTicks.map(({ chartY }) => {
    const gridY = chartY.toFixed(1);
    return `<line x1="${padX}" x2="${width - padX}" y1="${gridY}" y2="${gridY}"/>`;
  }).join("");
  const yLabels = yTicks.map(({ value, chartY }) => {
    const topPercent = (chartY / height * 100).toFixed(2);
    return `<span style="top:${topPercent}%">${fmtPrice(value, currency)}</span>`;
  }).join("");
  const xAxisTicks = useTimeScale
    ? [startTime, Math.round((startTime + endTime) / 2), endTime].map((time) => ({
      chartX: padX + ((time - startTime) / (endTime - startTime)) * plotWidth,
      label: fmtTime(time),
    }))
    : [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])].map((index) => ({
      chartX: x(index),
      label: fmtTime(points[index].fetched_at),
    }));
  const xTicks = xAxisTicks.map(({ chartX }) => {
    return `<line x1="${chartX.toFixed(1)}" x2="${chartX.toFixed(1)}" y1="${plotBottom}" y2="${plotBottom + 4}"/>`;
  }).join("");
  const xLabels = xAxisTicks.map(({ chartX, label }, labelIndex) => {
    const position = labelIndex === 0 ? "start" : labelIndex === xAxisTicks.length - 1 ? "end" : "middle";
    const leftPercent = ((chartX / width) * 100).toFixed(2);
    return `<span class="chart-x-label chart-x-label-${position}" style="left:${leftPercent}%">${esc(label)}</span>`;
  }).join("");
  const first = points[0];
  const last = points[points.length - 1];
  const summary = `最低价走势：从 ${fmtTime(first.fetched_at)} 的 ${fmtPrice(first.lowest_price, currency)} 到 ${fmtTime(last.fetched_at)} 的 ${fmtPrice(last.lowest_price, currency)}。横轴为采集时间，纵轴为最低价。`;
  return `<div class="chart-layout" role="img" aria-label="${esc(summary)}">
    <div class="chart-y-axis" aria-hidden="true">${yLabels}</div>
    <div class="chart-plot">
      <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs><linearGradient id="price-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#1463d9" stop-opacity=".20"/><stop offset="100%" stop-color="#1463d9" stop-opacity=".01"/></linearGradient></defs>
        <g class="chart-grid">${grid}</g>
        <line class="chart-axis-line" x1="${padX}" x2="${padX}" y1="${top}" y2="${plotBottom}"/><line class="chart-axis-line" x1="${padX}" x2="${width - padX}" y1="${plotBottom}" y2="${plotBottom}"/>
        <g class="chart-axis-tick">${xTicks}</g>
        <polygon points="${area}" fill="url(#price-area)"/>
        <polyline points="${line}" fill="none" stroke="#1463d9" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(points.length - 1)}" cy="${y(Number(last.lowest_price))}" r="5.5" fill="#fff" stroke="#1463d9" stroke-width="3"/>
      </svg>
      <div class="chart-x-axis" aria-hidden="true">${xLabels}</div>
    </div>
  </div>`;
}

function sourcePulse(lists = []) {
  const pulse = lists.map((list) => {
    const label = SOURCE_SHORT[list?.source] ?? list?.source ?? "数据源";
    const time = list ? fmtTime(list.fetchedAt) : "尚未采集";
    return `<span><i class="dot ${sourceClass(list?.source)}"></i>${esc(label)} · ${esc(time)}</span>`;
  }).join("");
  return pulse ? `<div class="source-pulse" aria-label="各数据源最新更新时间">${pulse}</div>` : "";
}

function pageIntro(title, description, lists = []) {
  const intro = description ? "<p>" + esc(description) + "</p>" : "";
  return `<section class="intro"><div><h1>${esc(title)}</h1>${intro}</div>${sourcePulse(lists)}</section>`;
}

function layout(title, body, active = "", options = {}) {
  body += '<p class="note"><a href="/sources">数据说明</a> · <a href="/privacy">隐私与访问统计说明</a></p>';
  const channel=normalizeChannel(options.channel);
  if(channel!=="all")body=body.replace(/href="(\/product\?[^\"]*)"/g,(_,href)=>{const [base,fragment]=href.split("#");return `href="${base}&amp;channel=${channel}${fragment?'#'+fragment:''}"`;});
  const nav = (href, key, label) => {
    const current = active === key ? ' aria-current="page"' : "";
    const selected = active === key ? " active" : "";
    return `<a href="${href}" class="nav-link${selected}"${current}>${label}</a>`;
  };
  const categoryFilters = FAMILY_FILTERS.filter(({ key }) => key === "all" || options.availableFamilies?.has(key));
  const categoryRail = active === "home" ? `<nav class="product-nav" aria-label="产品分类"><div class="product-nav-inner">${categoryFilters.map(({ key, label, platform }) => `<button class="product-filter${key === "all" ? " active" : ""}" type="button" data-family-filter="${key}" aria-controls="comparison" aria-pressed="${key === "all"}"><span class="product-filter-mark mark-${key}" aria-hidden="true">${platformMark(platform ?? "all")}</span><span>${label}</span></button>`).join("")}</div></nav>` : "";
  const analyticsScript = cloudflareWebAnalytics();
  const categoryScript = active === "home" ? `<script>
    (() => {
      const comparison = document.getElementById("comparison");
      const buttons = Array.from(document.querySelectorAll("[data-family-filter]"));
      const groups = Array.from(document.querySelectorAll("[data-family]"));
      const catalogSections = Array.from(document.querySelectorAll("[data-catalog-section]"));
      const fullComparison = document.querySelector("[data-comparison-details]");
      const overviewSummary = document.querySelector("[data-overview-summary]");
      const title = comparison?.querySelector("h1");
      const description = comparison?.querySelector(".overview-head .note");
      const originalTitle = title?.textContent;
      const originalDescription = description?.textContent;
      if (!comparison || !buttons.length || !groups.length) return;
      const setFamily = (family) => {
        if (!buttons.some((button) => button.dataset.familyFilter === family)) family = "all";
        const familyInput=document.querySelector('[data-channel-family]');if(familyInput)familyInput.value=family;
        buttons.forEach((button) => {
          const selected = button.dataset.familyFilter === family;
          button.classList.toggle("active", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
        groups.forEach((group) => {
          const visible = family === "all" || group.dataset.family === family;
          group.hidden = !visible;
          if (visible && family !== "all" && group.tagName === "DETAILS") group.open = true;
        });
        catalogSections.forEach((section) => {
          const catalogGroups = Array.from(section.querySelectorAll("[data-catalog-group]"));
          const visibleCount = catalogGroups
            .filter((group) => !group.hidden)
            .reduce((total, group) => total + Number(group.dataset.productCount || 0), 0);
          section.hidden = family !== "all" && visibleCount === 0;
          const count = section.querySelector("[data-catalog-count]");
          if (count) count.textContent = visibleCount + " 个产品";
        });
        const hasComparison = family === "all" || ["chatgpt", "claude", "gemini", "grok", "x"].includes(family);
        if (overviewSummary) overviewSummary.hidden = !hasComparison;
        if (fullComparison) {
          fullComparison.hidden = !hasComparison;
          fullComparison.open = hasComparison && family !== "all";
        }
        const selected = buttons.find((button) => button.dataset.familyFilter === family);
        if (title) title.textContent = family==='all' ? originalTitle : selected.lastElementChild.textContent + " 报价";
        if (description) description.textContent = originalDescription;
        const empty=document.querySelector('[data-market-empty]');if(empty)empty.hidden=catalogSections.some(section=>!section.hidden);
      };
      buttons.forEach((button) => button.addEventListener("click", () => {
        const family = button.dataset.familyFilter || "all";
        const url = new URL(location.href);
        if (family === "all") url.searchParams.delete("family");
        else url.searchParams.set("family", family);
        if (url.href !== location.href) history.pushState(null, "", url);
        setFamily(family);
        comparison.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }));
      const restoreFamily = () => {
        setFamily(new URL(location.href).searchParams.get("family") || "all");
        const selected = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
        if (selected) selected.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
      };
      window.addEventListener("popstate", restoreFamily);
      restoreFamily();
    })();
  </script>` : "";
  const storeRiskModal = `<div class="store-risk-modal" id="store-risk-modal" hidden>
    <div class="store-risk-backdrop" data-store-risk-cancel></div>
    <section class="store-risk-dialog" role="dialog" aria-modal="true" aria-labelledby="store-risk-title" aria-describedby="store-risk-description" tabindex="-1">
      <div class="store-risk-top"><span class="store-risk-kicker">${icon("shield")}第三方链接提示</span><button class="store-risk-close" type="button" data-store-risk-cancel aria-label="关闭提示">${icon("close")}</button></div>
      <h2 id="store-risk-title">即将离开本站</h2>
      <p class="store-risk-description" id="store-risk-description">你将前往第三方店铺或商品页面：<strong data-store-risk-destination>第三方页面</strong></p>
      <ul class="store-risk-list"><li>本站仅汇总公开数据，不参与交易、履约或售后。</li><li>价格、库存、服务内容及售后政策，请以第三方页面和结算信息为准。</li><li>请警惕私下转账；如遇异常，请停止交易并核实商家信息。</li></ul>
      <label class="store-risk-skip"><input type="checkbox" data-store-risk-skip/><span><b>今日不再提示</b><small>仅保存在本设备，明天将再次提醒</small></span></label>
      <div class="store-risk-actions"><button class="store-risk-button secondary" type="button" data-store-risk-cancel>取消</button><button class="store-risk-button primary" type="button" data-store-risk-confirm>继续前往 ${icon("external")}</button></div>
    </section>
  </div>`;
  const storeRiskScript = `<script>
    (() => {
      const modal = document.getElementById("store-risk-modal");
      if (!modal) return;
      const dialog = modal.querySelector("[role=dialog]");
      const destination = modal.querySelector("[data-store-risk-destination]");
      const skip = modal.querySelector("[data-store-risk-skip]");
      const cancel = modal.querySelector("button.store-risk-button.secondary");
      const confirm = modal.querySelector("[data-store-risk-confirm]");
      const storageKey = "price-radar-store-risk-skip-date";
      let pendingLink = null;
      let previousFocus = null;
      const today = () => {
        const now = new Date();
        return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      };
      const shouldSkip = () => {
        try { return localStorage.getItem(storageKey) === today(); } catch { return false; }
      };
      const saveSkip = () => {
        try { localStorage.setItem(storageKey, today()); } catch { /* 存储被禁用时只在本次操作中继续。 */ }
      };
      const focusables = () => Array.from(dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("hidden"));
      const close = (restoreFocus = true) => {
        if (modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove("store-risk-open");
        const focusTarget = previousFocus;
        pendingLink = null;
        previousFocus = null;
        if (restoreFocus && focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
      };
      const open = (link) => {
        pendingLink = link;
        previousFocus = document.activeElement;
        skip.checked = false;
        try {
          destination.textContent = new URL(link.href).hostname.replace(/^www\\./, "") || "第三方页面";
        } catch {
          destination.textContent = "第三方页面";
        }
        modal.hidden = false;
        document.body.classList.add("store-risk-open");
        requestAnimationFrame(() => cancel.focus());
      };
      const interceptStoreLink = (event) => {
        if (event.defaultPrevented || !(event.target instanceof Element)) return;
        const link = event.target.closest("a[data-store-risk]");
        if (!link || shouldSkip()) return;
        event.preventDefault();
        open(link);
      };
      document.addEventListener("click", (event) => {
        if (event.button !== 0) return;
        interceptStoreLink(event);
      });
      document.addEventListener("auxclick", (event) => {
        if (event.button !== 1) return;
        interceptStoreLink(event);
      });
      modal.addEventListener("click", (event) => {
        if (event.target.closest("[data-store-risk-cancel]")) close();
      });
      document.addEventListener("keydown", (event) => {
        if (modal.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const items = focusables();
        if (!items.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      });
      confirm.addEventListener("click", () => {
        const link = pendingLink;
        if (!link) return close();
        if (skip.checked) saveSkip();
        const href = link.href;
        const target = link.getAttribute("target") || "_blank";
        close(false);
        window.open(href, target, "noopener,noreferrer");
      });
    })();
  </script>`;
  const headExtra = options.csrfToken ? `<meta name="csrf-token" content="${esc(options.csrfToken)}"/>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="theme-color" content="#ffffff"/>
  ${headExtra}
  <title>${esc(title)} · AI 订阅价格雷达</title>
  <style>
    :root{--ink:#071827;--canvas:#eef3f8;--surface:#fff;--soft:#f7faff;--text:#15233a;--muted:#68778d;--faint:#98a6b8;--line:#dfe7f1;--line-strong:#cbd8e7;--blue:#1463d9;--blue-deep:#0d4fac;--blue-soft:#eaf2ff;--green:#087a55;--amber:#a15c00;--red:#b42318;--shadow:0 14px 34px rgb(18 42 70 / 8%);--radius:14px;--font:ui-sans-serif,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    *{box-sizing:border-box}html{background:var(--canvas)}body{min-width:320px;margin:0;background:var(--canvas);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.5;text-rendering:optimizeLegibility}a{color:var(--blue);text-decoration:none}a:hover{color:var(--blue-deep)}a:focus-visible{outline:3px solid rgb(20 99 217 / 35%);outline-offset:2px;border-radius:5px}
    .wrap{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:30px 0 32px}.site-footer{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:18px 0 30px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.7}.footer-inner{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.footer-disclaimer{max-width:760px;margin:0}.footer-contact{display:flex;flex:0 0 auto;align-items:center;gap:8px 12px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--soft);white-space:nowrap}.footer-contact-label{color:var(--text);font-size:11px;font-weight:700}.footer-contact-links{display:flex;align-items:center;gap:7px}.footer-contact-link{display:inline-flex;align-items:center;gap:4px;color:var(--blue-deep);font-family:var(--mono);font-size:11px;font-weight:650}.footer-contact-link:hover{text-decoration:underline;text-underline-offset:3px}.footer-contact-link b{color:var(--text);font-family:var(--font);font-size:12px}.intro{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:4px 0 22px}.intro h1{margin:0;font-size:clamp(26px,3.2vw,34px);line-height:1.18;letter-spacing:-.03em}.intro p{margin:8px 0 0;color:var(--muted);font-size:14px}.source-pulse{display:flex;max-width:560px;flex-wrap:wrap;justify-content:flex-end;gap:7px 14px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.source-pulse span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.dot{width:7px;height:7px;border-radius:50%;background:var(--faint)}.dot.official{background:#1463d9}.dot.priceai{background:#7c3aed}.dot.ldxp{background:#0f8f6f}.dot.goaihop{background:#d97706}.dot.direct{background:#0b7d68}
    .comparison,.surface,.alerts,.sources{overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.comparison,.product-hero{box-shadow:var(--shadow)}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line)}.comparison>.head{padding:20px 22px 15px}.head h2{margin:0;color:var(--text);font-size:17px;line-height:1.3;letter-spacing:-.015em}.note{margin:4px 0 0;color:var(--muted);font-size:12px}.updated{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}.updated .icon{width:14px;height:14px}.dim{color:var(--muted)}.icon{width:17px;height:17px;flex:0 0 auto;vertical-align:-.2em}
    .table-scroll{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}table{width:100%;border-collapse:collapse}th,td{padding:14px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--muted);background:var(--soft);font-size:12px;font-weight:680;letter-spacing:.01em;white-space:nowrap}td{font-size:13px}tbody tr:last-child td{border-bottom:0}tbody tr{transition:background-color 150ms ease}tbody tr:hover{background:#f8fbff}.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
    .comparison-table{min-width:1080px;table-layout:fixed}.comparison-table th:first-child,.comparison-table td:first-child{width:22%}.comparison-table th:not(:first-child),.comparison-table td:not(:first-child){width:19.5%}.comparison-table th>span{display:block;color:var(--faint);font-size:11px;font-weight:500;line-height:1.45}.product-name{display:flex;flex-direction:column;gap:3px}.product-name strong{font-size:14px}.product-name span{color:var(--muted);font-size:12px}.price-stack{display:flex;min-height:49px;flex-direction:column;align-items:flex-end;gap:4px}.price-stack.empty{justify-content:center;color:var(--faint);font-family:var(--mono);font-size:18px}.price-link{color:var(--text);font-family:var(--mono);font-size:20px;font-weight:760;letter-spacing:-.045em;font-variant-numeric:tabular-nums;white-space:nowrap}.price-link:hover{color:var(--blue);text-decoration:none}.price-stack.priceai .price-link{color:var(--blue-deep)}.price-stack.direct .price-link,.price-stack.ldxp .price-link{color:var(--green)}.price-context{max-width:100%;overflow:hidden;color:var(--muted);font-size:11px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}
    .stock,.status{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:650;line-height:1.25;white-space:nowrap}.stock i,.status i{width:6px;height:6px;border-radius:50%;background:currentColor}.available{color:var(--green)}.out{color:var(--red)}.neutral{color:var(--muted)}.official{color:var(--blue)}
    .catalogs{display:grid;gap:18px;margin-top:20px}.source-badge{display:inline-flex;align-items:center;min-height:22px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:730;line-height:1;letter-spacing:.01em;white-space:nowrap}.source-badge.official{color:#0757bd;background:#e9f2ff}.source-badge.priceai{color:#6331b7;background:#f1ebff}.source-badge.direct{color:#087a55;background:#e6f7f2}.source-badge.ldxp{color:#087a55;background:#e9f8f0}.source-badge.goaihop{color:#a15c00;background:#fff4e4}.source-badge.neutral{color:var(--muted);background:#eff3f7}.catalog-table{min-width:700px}.catalog-table th:first-child{width:112px}.catalog-name{display:flex;min-width:180px;flex-direction:column;gap:3px}.catalog-name strong{font-size:13px;line-height:1.35}.catalog-name span{color:var(--muted);font-size:11px;line-height:1.35}.money{color:var(--text);font-family:var(--mono);font-size:16px;font-weight:760;letter-spacing:-.035em;font-variant-numeric:tabular-nums}.row-link{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:7px;color:var(--blue)}.row-link:hover{background:var(--blue-soft)}.row-link .icon{width:18px;height:18px}
    .alerts{margin-top:20px}.alerts .head{border-bottom:0}.alerts-list{padding:0 20px 8px}.alert{display:grid;grid-template-columns:3px minmax(0,1fr) auto;align-items:stretch;gap:14px;padding:13px 0;border-top:1px solid var(--line)}.alert:first-child{border-top:0}.alert-rail{border-radius:99px;background:var(--line-strong)}.alert.drop .alert-rail{background:var(--green)}.alert.change .alert-rail{background:var(--blue)}.alert.gone .alert-rail{background:var(--amber)}.alert-copy{min-width:0}.alert-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}.alert-type{color:var(--muted);font-size:11px;font-weight:700}.alert-type.drop{color:var(--green)}.alert-type.change{color:var(--blue)}.alert-type.gone{color:var(--amber)}.alert-product{color:var(--text);font-size:13px;font-weight:680}.alert-message{margin-top:3px;overflow-wrap:anywhere;color:var(--muted);font-size:12px}.alert-time{align-self:start;color:var(--muted);font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.empty{padding:24px 20px;color:var(--muted);font-size:13px;text-align:center}
    .breadcrumb{display:inline-flex;align-items:center;gap:5px;margin:0 0 16px;font-size:13px;font-weight:650}.breadcrumb .icon{width:16px;height:16px}.product-hero{display:grid;overflow:hidden;grid-template-columns:minmax(250px,.86fr) minmax(390px,1.14fr);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.summary{padding:28px}.summary h1{margin:10px 0 0;overflow-wrap:anywhere;font-size:clamp(25px,3vw,34px);line-height:1.17;letter-spacing:-.035em}.product-meta{display:flex;flex-wrap:wrap;gap:7px 10px;margin-top:11px;color:var(--muted);font-size:12px}.price-label{margin-top:34px;color:var(--muted);font-size:12px;font-weight:650}.price-display{margin-top:4px;color:var(--blue-deep);font-family:var(--mono);font-size:clamp(38px,4.2vw,52px);font-weight:780;letter-spacing:-.075em;line-height:1;font-variant-numeric:tabular-nums}.summary-bottom{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-top:16px}.chart-panel{min-width:0;padding:25px 28px 19px;border-left:1px solid var(--line);background:var(--soft)}.chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.chart-head h2{margin:0;font-size:17px}.chart-head span{color:var(--muted);font-size:12px;white-space:nowrap}.chart-wrap{min-height:216px;margin-top:16px}.chart-layout{--chart-height:184px;display:grid;grid-template-columns:62px minmax(0,1fr);column-gap:8px;min-width:0}.chart-y-axis{position:relative;height:var(--chart-height);border-right:1px solid #dce6f2}.chart-y-axis span{position:absolute;right:8px;transform:translateY(-50%);color:#718097;font-family:var(--mono);font-size:10px;font-variant-numeric:tabular-nums;line-height:1;white-space:nowrap}.chart-plot{min-width:0}.chart{display:block;width:100%;height:var(--chart-height);overflow:visible}.chart-grid line{stroke:#dce6f2;stroke-width:1;stroke-dasharray:3 5}.chart-axis-line,.chart-axis-tick line{stroke:#cbd8e7;stroke-width:1}.chart-x-axis{position:relative;height:20px;margin-top:7px;color:#718097;font-family:var(--mono);font-size:10px;font-variant-numeric:tabular-nums;line-height:1;white-space:nowrap}.chart-x-label{position:absolute;top:0}.chart-x-label-start{transform:none}.chart-x-label-middle{transform:translateX(-50%)}.chart-x-label-end{transform:translateX(-100%);text-align:right}.detail{margin-top:20px}.offer-table{min-width:760px}.offer-title{display:flex;min-width:220px;flex-direction:column;gap:4px}.offer-title strong{color:var(--text);font-size:13px;line-height:1.35}.offer-title span{overflow-wrap:anywhere;color:var(--muted);font-size:11px;line-height:1.35}.metric{margin-top:4px;color:var(--amber);font-size:11px}
    .sources{overflow:hidden}.source-list{padding:0 20px}.source-row{display:grid;grid-template-columns:minmax(180px,1.2fr) repeat(3,minmax(80px,.55fr)) minmax(128px,.85fr);align-items:center;gap:18px;padding:17px 0;border-top:1px solid var(--line)}.source-row:first-child{border-top:0}.source-name{display:flex;min-width:0;align-items:center;gap:9px}.source-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-stat{display:flex;flex-direction:column;gap:2px}.source-stat strong{color:var(--text);font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums}.source-stat span{color:var(--muted);font-size:11px}.source-time{color:var(--muted);font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .desktop{display:block}.mobile{display:none}.mobile-stack{display:grid;gap:10px;padding:12px}.family-card,.catalog-card,.offer-card{border:1px solid var(--line);border-radius:11px;background:var(--surface)}.family-card{overflow:hidden}.family-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:14px 14px 11px;background:var(--soft)}.family-head strong{font-size:14px}.family-head span{color:var(--muted);font-size:11px;white-space:nowrap}.family-line{display:grid;grid-template-columns:minmax(88px,.8fr) 1fr;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--line)}.family-label{color:var(--muted);font-size:11px}.family-value{display:flex;min-width:0;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}.family-value.empty{color:var(--faint);font-family:var(--mono);font-size:17px}.family-value .price-link{font-size:18px}.catalog-card,.offer-card{padding:14px}.catalog-card+.catalog-card,.offer-card+.offer-card{margin-top:8px}.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.card-price{color:var(--text);font-family:var(--mono);font-size:22px;font-weight:780;letter-spacing:-.06em;line-height:1.05;font-variant-numeric:tabular-nums}.card-name{margin-top:9px;overflow-wrap:anywhere;color:var(--text);font-size:13px;font-weight:680;line-height:1.4}.card-meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:6px;color:var(--muted);font-size:11px}.card-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}.external{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:650;white-space:nowrap}.external .icon{width:16px;height:16px}
    @media(max-width:760px){.wrap{width:calc(100% - 24px);padding-top:21px;padding-bottom:22px}.site-footer{width:calc(100% - 24px);padding:15px 0 24px;font-size:10px;line-height:1.65}.footer-inner{display:grid;gap:12px}.footer-contact{width:max-content;max-width:100%;flex-wrap:wrap;white-space:normal}.footer-disclaimer{max-width:none}.intro{display:block;padding-bottom:17px}.intro h1{font-size:27px}.intro p{font-size:13px}.source-pulse{max-width:none;justify-content:flex-start;margin-top:13px}.comparison,.surface,.alerts,.sources,.product-hero{border-radius:12px}.head,.comparison>.head{padding:16px 15px}.comparison>.head{display:block}.comparison>.head .note{margin-top:5px}.head h2{font-size:16px}.updated{max-width:120px;margin-top:0;text-align:right;white-space:normal}.summary-bottom .updated{max-width:none;white-space:nowrap}.desktop{display:none!important}.mobile{display:block}.catalogs{gap:14px;margin-top:15px}.alerts{margin-top:15px}.alerts-list{padding:0 15px 7px}.alert{grid-template-columns:3px minmax(0,1fr);gap:11px}.alert-time{grid-column:2;margin-top:-4px;font-size:10px}.product-hero{display:block}.summary{padding:20px 17px 22px}.summary h1{font-size:27px}.price-label{margin-top:26px}.price-display{font-size:46px}.chart-panel{padding:19px 17px 14px;border-top:1px solid var(--line);border-left:0}.chart-wrap{min-height:198px;margin-top:12px}.chart-layout{--chart-height:164px;grid-template-columns:55px minmax(0,1fr);column-gap:6px}.chart-y-axis span{right:6px;font-size:10px}.chart-x-axis{height:18px;margin-top:6px;font-size:10px}.chart-x-label-middle{display:none}.detail{margin-top:15px}.source-list{padding:0 15px}.source-row{grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:14px 0}.source-name{grid-column:1 / -1}.source-stat{display:grid;grid-template-columns:auto auto;align-items:baseline;gap:7px}.source-stat strong{font-size:13px}.source-stat span{font-size:10px}.source-time{grid-column:1 / -1;font-size:10px}}@media(max-width:370px){.source-pulse{gap:6px 10px}}@media(prefers-reduced-motion:no-preference){.row-link,.price-link,.nav-link,tbody tr{transition:color 150ms ease,background-color 150ms ease}}
    .comparison-table .table-group-row th{width:auto!important}.table-group-row:hover{background:transparent}.table-group-row th{padding:10px 16px;background:#f5f8fc;color:var(--text);text-align:left}.table-group-row th>*{vertical-align:middle}.group-mark{display:inline-block;width:3px;height:18px;margin-right:9px;border-radius:99px;background:var(--blue);vertical-align:-4px}.group-title{font-size:13px;font-weight:760}.group-count{margin-left:8px;color:var(--muted);font-size:11px;font-weight:600}.tone-chatgpt .group-mark{background:#087a55}.tone-claude .group-mark{background:#b06b11}.tone-gemini .group-mark{background:#1463d9}.tone-grok .group-mark{background:#7c3aed}.tone-x .group-mark{background:#334155}.tone-microsoft .group-mark{background:#1d7fd4}.tone-relay .group-mark{background:#d97706}.tone-verify .group-mark{background:#0f766e}.tone-mail .group-mark{background:#64748b}.tone-other .group-mark{background:var(--faint)}.family-groups,.catalog-groups{display:grid;gap:14px;padding:14px}.family-group,.catalog-group{display:block;scroll-margin-top:80px}.group-summary{display:flex;min-height:48px;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;border:1px solid var(--line);border-radius:11px;background:var(--soft);cursor:pointer;list-style:none}.group-summary::-webkit-details-marker{display:none}.group-summary:focus-visible{outline:3px solid rgb(20 99 217 / 35%);outline-offset:2px}.group-summary-copy{display:flex;min-width:0;align-items:baseline;gap:0}.group-summary strong{font-size:14px}.group-summary .group-mark{flex:0 0 auto;margin-right:9px}.group-summary .group-count{white-space:nowrap}.group-chevron{display:inline-flex;flex:0 0 auto;color:var(--blue);transition:transform 150ms ease}.group-chevron .icon{width:18px;height:18px}.family-group[open] .group-summary,.catalog-group[open] .group-summary{border-bottom-color:var(--line-strong);border-radius:11px 11px 0 0}.family-group[open] .group-chevron,.catalog-group[open] .group-chevron{transform:rotate(90deg)}.family-group-body,.catalog-group-body{overflow:hidden;border:1px solid var(--line);border-top:0;border-radius:0 0 11px 11px;background:var(--surface)}.family-group-body .family-card{border:0;border-radius:0}.family-group-body .family-card+.family-card{border-top:1px solid var(--line)}.family-group-body .family-head{padding:13px 14px 10px;background:#fff}.catalog-group-body .catalog-card{border:0;border-radius:0;padding:13px 14px}.catalog-group-body .catalog-card+.catalog-card{margin-top:0;border-top:1px solid var(--line)}.catalog-table th:first-child{width:auto}
    @media(max-width:760px){.family-groups,.catalog-groups{gap:11px;padding:12px}.group-summary{min-height:46px;padding:9px 12px}.group-summary strong{font-size:13px}.group-summary .group-count{font-size:10px}.family-group-body .family-head{padding:13px 13px 9px}.family-group-body .family-line{padding:9px 13px}.catalog-group-body .catalog-card{padding:13px}.catalog-group-body .catalog-card .card-name{margin-top:8px}.catalog-group-body .catalog-card .card-bottom{margin-top:10px;padding-top:9px}}@media(max-width:370px){.group-summary-copy{gap:0}.group-summary .group-mark{margin-right:7px}.group-summary .group-count{margin-left:6px}}
    .comparison-table .table-group-row th>.group-mark{display:inline-block;color:inherit}.comparison-table .table-group-row th>.group-title{display:inline;color:var(--text);font-size:13px;font-weight:760;line-height:1.3}.comparison-table .table-group-row th>.group-count{display:inline;color:var(--muted);font-size:11px;font-weight:600;line-height:1.3}
    .app-header{position:sticky;top:0;z-index:20;overflow:hidden;background:linear-gradient(112deg,#06172b 0%,#09284d 52%,#07192f 100%);box-shadow:0 8px 24px rgb(7 24 39 / 20%)}.app-header:before{position:absolute;inset:0;opacity:.5;background:linear-gradient(90deg,rgb(115 178 255 / 8%) 1px,transparent 1px),linear-gradient(rgb(115 178 255 / 6%) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(90deg,#000,transparent 78%);content:""}.app-header:after{position:absolute;top:-150px;right:-75px;width:420px;height:320px;border-radius:50%;background:radial-gradient(circle,rgb(68 148 255 / 22%),transparent 67%);content:""}.header-inner{position:relative;width:min(1240px,calc(100% - 32px));min-height:0;margin:0 auto;display:block}.header-main{display:flex;min-height:68px;align-items:center;justify-content:space-between;gap:24px}.brand{gap:11px;color:#fff;font-size:18px;font-weight:760;letter-spacing:-.015em}.brand-copy{display:grid;gap:1px;min-width:0}.brand-kicker{color:#a9c8ef;font-family:var(--mono);font-size:9px;font-weight:650;letter-spacing:.12em;line-height:1.2;text-transform:uppercase}.brand-text{line-height:1.2}.radar{width:30px;height:30px;color:#69adff;filter:drop-shadow(0 0 10px rgb(76 155 255 / 35%))}.header-tools{display:flex;align-items:center;gap:10px}.header-status{display:inline-flex;min-height:30px;align-items:center;gap:7px;padding:5px 9px;border:1px solid rgb(170 210 255 / 18%);border-radius:999px;background:rgb(1 13 29 / 22%);color:#d9e9fb;font-size:11px;font-weight:620;white-space:nowrap}.header-status i{width:6px;height:6px;border-radius:50%;background:#69adff;box-shadow:0 0 0 3px rgb(105 173 255 / 13%)}.header-status b{padding-left:7px;border-left:1px solid rgb(190 220 255 / 18%);color:#fff;font-family:var(--mono);font-size:10px;font-weight:700}.header-rule{display:inline-flex;min-height:30px;align-items:center;gap:6px;padding:5px 9px;border:1px solid rgb(170 210 255 / 14%);border-radius:8px;color:#c9ddf5;font-size:11px;font-weight:640;white-space:nowrap}.header-rule .icon{width:15px;height:15px}.header-rule:hover{border-color:rgb(170 210 255 / 32%);background:rgb(255 255 255 / 7%);color:#fff}.app-nav{display:flex;min-height:47px;align-self:auto;align-items:stretch;gap:2px;border-top:1px solid rgb(182 216 255 / 15%)}.nav-link{display:inline-flex;min-width:104px;align-items:center;justify-content:center;gap:8px;padding:0 14px;color:#b9cde4;font-size:13px;font-weight:650;transition:color 150ms ease,background-color 150ms ease}.nav-link-icon{display:inline-flex;align-items:center;color:#8fb8e9}.nav-link-icon .icon{width:16px;height:16px}.nav-link:hover{color:#fff;background:rgb(255 255 255 / 7%)}.nav-link:hover .nav-link-icon{color:#b9dcff}.nav-link.active{color:#fff;background:linear-gradient(180deg,rgb(91 160 255 / 13%),rgb(91 160 255 / 3%))}.nav-link.active .nav-link-icon{color:#70b1ff}.nav-link.active:after{right:14px;bottom:0;left:14px;height:3px;background:#5ba6ff;box-shadow:0 -1px 12px rgb(91 166 255 / 38%)}
    @media(max-width:760px){.header-inner{width:calc(100% - 24px)}.header-main{min-height:64px;gap:10px}.brand{gap:8px;font-size:16px}.radar{width:26px;height:26px}.brand-kicker{font-size:8px;letter-spacing:.09em}.header-tools{gap:0}.header-status{min-height:28px;gap:6px;padding:5px 8px;font-size:10px}.header-status b{display:none}.header-rule{display:none}.app-nav{min-height:46px;justify-content:space-between}.nav-link{min-width:0;flex:1;gap:6px;padding:0 4px;font-size:12px}.nav-link-icon .icon{width:15px;height:15px}.nav-link.active:after{right:10px;left:10px}.family-group,.catalog-group{scroll-margin-top:124px}}@media(max-width:370px){.brand-kicker{display:none}.nav-link{gap:4px;font-size:11px}.nav-link.active:after{right:6px;left:6px}}
    /* 居中主导航：品牌和操作区使用等宽网格，避免把页面页签推向左侧。 */
    .app-header{position:sticky;top:0;z-index:20;overflow:visible;background:#fff;border-bottom:1px solid #e5eaed;box-shadow:0 1px 9px rgb(26 39 48 / 4%)}.app-header:before,.app-header:after{display:none;content:none}.header-inner{position:static;width:min(1240px,calc(100% - 32px));margin:0 auto}.header-main{display:grid;min-height:76px;grid-template-columns:minmax(220px,1fr) auto minmax(220px,1fr);align-items:center;gap:20px}.brand{display:inline-flex;justify-self:start;align-items:center;gap:10px;color:#1e2a30;font-size:18px;font-weight:760;letter-spacing:-.025em;white-space:nowrap}.brand-copy{display:block}.brand-kicker{display:none}.brand-text{line-height:1.2}.radar{width:30px;height:30px;color:#18725d;filter:none}.app-nav{display:inline-flex;justify-self:center;min-height:auto;align-items:center;gap:3px;padding:4px;border:1px solid #e0e6e9;border-radius:999px;background:#eef2f3;white-space:nowrap}.nav-link{position:relative;display:inline-flex;min-width:0;min-height:38px;align-items:center;justify-content:center;padding:0 17px;border-radius:999px;color:#617078;font-size:13px;font-weight:690;white-space:nowrap;transition:color 150ms ease,background-color 150ms ease,box-shadow 150ms ease}.nav-link:hover{color:#253238;background:#e3e9eb}.nav-link.active{color:#fff;background:#29353a;box-shadow:0 1px 2px rgb(24 35 39 / 17%)}.nav-link.active:after{display:none}.nav-link-icon{display:none}.header-tools{display:flex;justify-self:end;align-items:center;gap:0}.header-status,.header-rule{display:none}.header-contact{display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:1px solid #dce4e7;border-radius:9px;color:#43545c;font-size:12px;font-weight:690;white-space:nowrap;transition:color 150ms ease,background-color 150ms ease,border-color 150ms ease}.header-contact .icon{width:15px;height:15px}.header-contact:hover{border-color:#b8c7cd;background:#f5f8f8;color:#213238}.product-nav{border-top:1px solid #edf0f2;border-bottom:1px solid #e7ecee;background:#fbfcfc}.product-nav-inner{width:min(1240px,calc(100% - 32px));min-height:58px;margin:0 auto;display:flex;align-items:center;gap:7px;overflow-x:auto;scrollbar-width:none}.product-nav-inner::-webkit-scrollbar{display:none}.product-filter{display:inline-flex;min-height:34px;flex:0 0 auto;align-items:center;justify-content:center;padding:0 14px;border:0;border-radius:999px;background:transparent;color:#5b6970;font:inherit;font-size:13px;font-weight:670;cursor:pointer;transition:color 150ms ease,background-color 150ms ease}.product-filter:hover{background:#eef2f3;color:#26353b}.product-filter.active{background:#e1e9eb;color:#26353b;font-weight:760}.product-filter:focus-visible{outline:3px solid rgb(24 114 93 / 25%);outline-offset:2px}.comparison{scroll-margin-top:146px}.comparison>.head{align-items:center}.comparison-title{margin:0;color:var(--text);font-size:20px;line-height:1.3;letter-spacing:-.02em}.comparison .source-pulse{max-width:520px}.comparison [data-family][hidden]{display:none!important}
    @media(max-width:760px){.header-inner{width:calc(100% - 24px)}.header-main{min-height:0;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px 0 9px}.brand{gap:8px;font-size:15px}.radar{width:25px;height:25px}.header-contact{min-height:30px;padding:0 9px;font-size:11px}.app-nav{grid-column:1 / -1;grid-row:2;justify-self:center;gap:2px;padding:3px}.nav-link{min-height:34px;padding:0 16px;font-size:12px}.product-nav{display:none}.comparison{scroll-margin-top:116px}.family-group,.catalog-group{scroll-margin-top:116px}}@media(max-width:370px){.brand{font-size:14px}.header-contact{padding:0 7px;font-size:10px}.nav-link{padding:0 13px}}
    /* 参考图定稿：白底双层导航 + 平台概览表。此处覆盖旧版深色/卡片化样式。 */
    :root{--canvas:#fafbfc;--surface:#fff;--soft:#fbfcfc;--text:#1f2b33;--muted:#75818a;--faint:#98a2a9;--line:#e5e9eb;--line-strong:#dce2e5;--blue:#253238;--blue-deep:#1f2b33;--blue-soft:#eef2f4;--shadow:none;--radius:10px;--font:Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
    html,body{background:var(--canvas)}body{color:var(--text);font-size:13px}
    .wrap{width:min(1200px,calc(100% - 56px));padding:27px 0 40px}.site-footer{width:min(1200px,calc(100% - 56px));border-top:0;padding:22px 0 32px}
    .app-header{position:sticky;top:0;z-index:20;overflow:visible;background:#fff;border-bottom:1px solid #e7ebed;box-shadow:none}.app-header:before,.app-header:after{display:none}.header-inner{width:calc(100% - 48px);max-width:none}.header-main{min-height:68px;grid-template-columns:minmax(220px,1fr) auto minmax(220px,1fr);gap:20px}.brand{gap:10px;color:#202b32;font-size:17px;font-weight:720;letter-spacing:-.025em}.radar{width:30px;height:30px;color:#202b32}.app-nav{gap:0;padding:3px;border:1px solid #e4e8ea;border-radius:999px;background:#fff}.nav-link{min-width:80px;min-height:32px;padding:0 14px;color:#5f6b73;font-size:12px;font-weight:650}.nav-link:hover{background:#f1f4f5;color:#263238}.nav-link.active{background:#253238;box-shadow:0 1px 2px rgb(24 35 39 / 14%);color:#fff}.header-contact{min-height:33px;padding:0 12px;border-color:#dde3e6;border-radius:6px;color:#59666e;font-size:12px;font-weight:650}.header-contact:hover{border-color:#c7d0d4;background:#fafcfc;color:#263238}
    .product-nav{border-top:0;border-bottom:1px solid #e7ebed;background:#fff}.product-nav-inner{width:calc(100% - 48px);min-height:68px;justify-content:center;gap:48px;overflow:visible}.product-filter{min-height:31px;align-items:center;gap:8px;padding:0 10px;color:#34424a;font-size:12px;font-weight:600}.product-filter:hover{background:#f3f6f7;color:#202b32}.product-filter.active{background:#eef2f4;color:#202b32;font-weight:700}.product-filter-mark{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center}.platform-mark{display:block;width:18px;height:18px}.platform-wordmark{display:inline-grid;width:18px;height:18px;place-items:center;font-family:Arial,sans-serif;font-size:14px;font-weight:800;letter-spacing:-.1em}.mark-chatgpt{color:#4c9b88}.mark-claude{color:#b56d47}.mark-gemini{color:#4776e7}.mark-grok,.mark-x,.mark-all{color:#202b32}
    .reference-overview{overflow:visible;border:0;border-radius:0;background:transparent;box-shadow:none;scroll-margin-top:138px}.overview-head{padding:0 0 18px}.comparison-title{color:#1f2c34;font-size:20px;font-weight:720;letter-spacing:-.025em}.overview-head .note{margin-top:5px;color:#78858e;font-size:11px;line-height:1.55}.overview-table-shell{overflow:hidden;border:1px solid #e4e8ea;border-radius:10px;background:#fff}.overview-table{min-width:900px;table-layout:fixed}.overview-table .col-product{width:18%}.overview-table .col-provider{width:13%}.overview-table .col-plan{width:14.3%}.overview-table .col-billing{width:12.3%}.overview-table .col-price{width:8.3%}.overview-table .col-currency{width:11.1%}.overview-table .col-note{width:8.5%}.overview-table .col-updated{width:9.8%}.overview-table .col-action{width:4.4%}.overview-table th,.overview-table td{height:51px;padding:0 18px;border-bottom:1px solid #e8ecee;color:#39474f;font-size:12px;font-weight:500;white-space:nowrap}.overview-table th{height:45px;background:#fbfcfc;color:#64717a;font-size:11px;font-weight:650;letter-spacing:0}.overview-table tbody tr:last-child td{border-bottom:0}.overview-table tbody tr:hover{background:#fcfdfd}.overview-product{display:flex;align-items:center;gap:13px;min-width:0;color:#27343b;font-weight:600}.overview-platform-mark{display:inline-flex;width:20px;height:20px;flex:0 0 20px;align-items:center;justify-content:center}.overview-platform-mark .platform-mark{width:20px;height:20px}.overview-platform-mark .platform-wordmark{width:20px;height:20px;font-size:16px}.overview-price{color:#2b3940!important;font-family:var(--mono);font-variant-numeric:tabular-nums}.overview-time{color:#6d7981;font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums}.overview-action{padding:0!important;text-align:center}.overview-row-link{display:inline-flex;width:38px;height:38px;align-items:center;justify-content:center;color:#849097}.overview-row-link .icon{width:17px;height:17px}.overview-row-link:hover{color:#243239;background:#f1f4f5}.overview-row-link.disabled{color:#c3cbcf}.overview-hint{margin:17px 3px 0;color:#839099;font-size:10px;line-height:1.55}.all-plans{margin-top:28px;overflow:hidden;border:1px solid #e4e8ea;border-radius:10px;background:#fff}.all-plans>summary{display:flex;min-height:46px;align-items:center;gap:8px;padding:0 16px;list-style:none;color:#33424a;font-size:13px;font-weight:680;cursor:pointer}.all-plans>summary::-webkit-details-marker{display:none}.all-plans>summary span{color:#849098;font-size:11px;font-weight:500}.all-plans>summary .icon{width:17px;height:17px;margin-left:auto;color:#68757d;transition:transform 150ms ease}.all-plans[open]>summary{border-bottom:1px solid #e8ecee}.all-plans[open]>summary .icon{transform:rotate(90deg)}.all-plans-body{background:#fff}.reference-overview [data-family][hidden]{display:none!important}
    .all-plans:not([open]){display:none}.reference-overview + .catalogs{margin-top:48px}.overview-mobile{display:grid;gap:9px}.overview-mobile-card{border:1px solid #e4e8ea;border-radius:10px;background:#fff}.overview-mobile-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px 10px}.overview-mobile-action{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;color:#6e7b82}.overview-mobile-action .icon{width:17px;height:17px}.overview-mobile-action.disabled{color:#c3cbcf}.overview-mobile-meta{display:flex;flex-wrap:wrap;gap:6px 13px;padding:0 14px 10px;color:#65737b;font-size:11px}.overview-mobile-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 14px;border-top:1px solid #e8ecee;color:#839099;font-size:10px}.overview-mobile-bottom time{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
    @media(max-width:760px){.wrap{width:calc(100% - 24px);padding:20px 0 28px}.site-footer{width:calc(100% - 24px)}.header-inner{width:calc(100% - 24px)}.header-main{min-height:0;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px 0 9px}.brand{font-size:15px}.radar{width:25px;height:25px}.header-contact{min-height:30px;padding:0 9px;font-size:11px}.app-nav{grid-column:1 / -1;grid-row:2;justify-self:center}.nav-link{min-width:0;min-height:32px;padding:0 16px}.product-nav{display:block}.product-nav-inner{width:100%;min-height:51px;justify-content:flex-start;gap:15px;padding:0 12px;overflow-x:auto}.product-filter{gap:6px;padding:0 8px}.product-filter-mark,.platform-mark{width:16px;height:16px}.platform-wordmark{width:16px;height:16px;font-size:13px}.reference-overview{scroll-margin-top:150px}.overview-head{padding-bottom:15px}.comparison-title{font-size:19px}.overview-head .note{font-size:10px}.overview-hint{margin:13px 1px 0;font-size:10px}.all-plans{margin-top:20px}.all-plans>summary{min-height:44px;padding:0 13px}.overview-mobile-card{border-radius:9px}.overview-mobile-top{padding:12px 13px 9px}.overview-mobile-meta{padding:0 13px 9px}.overview-mobile-bottom{padding:8px 13px}.family-group,.catalog-group{scroll-margin-top:150px}}@media(max-width:370px){.brand{font-size:14px}.nav-link{padding:0 13px}.product-nav-inner{gap:10px}.product-filter{padding:0 7px}}
    /* 窄桌面/平板：九列表改为摘要卡片，避免横向裁切数据。 */
    @media(max-width:860px){.reference-overview>.desktop,.all-plans .desktop{display:none!important}.reference-overview>.mobile,.all-plans .mobile{display:block}}
    /* 让表格内的报价入口既容易点，也一眼能看出会进入本站报价详情。 */
    .overview-table .col-product{width:17.5%}.overview-table .col-provider{width:12.5%}.overview-table .col-plan{width:13.4%}.overview-table .col-billing{width:11.8%}.overview-table .col-price{width:8.2%}.overview-table .col-currency{width:10.4%}.overview-table .col-note{width:7.4%}.overview-table .col-updated{width:9.5%}.overview-table .col-action{width:9.3%}.quote-action{display:inline-flex;width:auto;min-width:76px;min-height:34px;align-items:center;justify-content:center;gap:3px;padding:0 10px;border:1px solid #d7e0e3;border-radius:7px;background:#fff;color:#34454d;font-size:11px;font-weight:700;line-height:1;white-space:nowrap;transition:color 150ms ease,background-color 150ms ease,border-color 150ms ease}.quote-action .icon{width:14px;height:14px}.quote-action:hover{border-color:#aebfc5;background:#f2f6f6;color:#1f343b;text-decoration:none}.quote-action.disabled{border-color:#e4e9eb;background:#fafbfb;color:#9aa5aa;cursor:default}.overview-row-link{height:34px}.overview-mobile-action{min-height:30px;padding:0 8px}.catalog-table .catalog-action-heading,.catalog-table .catalog-action-cell{width:100px;padding-right:12px;padding-left:12px;text-align:center}.catalog-table .catalog-action-heading{color:#64717a}.catalog-action{min-width:76px}
    @media(max-width:760px){.overview-mobile-action{min-width:72px;font-size:10px}.overview-mobile-action .icon{width:13px;height:13px}}
    /* 二级报价页：连续排名 + 服务端分页，避免超长报价表难以浏览。 */
    #offers{scroll-margin-top:126px}.offer-table .offer-rank-heading,.offer-table .offer-rank{width:68px;padding-right:10px;padding-left:10px;text-align:center}.offer-rank-index{display:inline-flex;min-width:32px;min-height:23px;align-items:center;justify-content:center;padding:0 5px;border:1px solid #dce4e7;border-radius:999px;background:#f6f8f8;color:#52616a;font-family:var(--mono);font-size:10px;font-weight:720;font-variant-numeric:tabular-nums;line-height:1}.offer-card-price{display:flex;min-width:0;align-items:flex-start;gap:9px}.offer-card-price>div{min-width:0}.offer-card-price .offer-rank-index{flex:0 0 auto;margin-top:1px}.offer-source-note{display:flex;align-items:flex-start;gap:8px;margin:13px 20px 0;padding:10px 12px;border:1px solid #dce8e4;border-radius:8px;background:#f7fbf9;color:#53636a;font-size:11px;line-height:1.65}.offer-source-note strong{flex:0 0 auto;color:#18725d;font-weight:760}.offer-pagination{display:flex;justify-content:center;padding:16px 20px 18px;border-top:1px solid var(--line)}.offer-pagination-links{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}.offer-page{display:inline-flex;min-width:34px;min-height:34px;align-items:center;justify-content:center;padding:0 8px;border:1px solid #dce3e6;border-radius:7px;background:#fff;color:#4b5b63;font-family:var(--mono);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;transition:color 150ms ease,background-color 150ms ease,border-color 150ms ease}.offer-page:hover{border-color:#9eadb3;background:#f2f6f6;color:#223239;text-decoration:none}.offer-page.current{border-color:#29353a;background:#29353a;color:#fff;box-shadow:0 1px 2px rgb(24 35 39 / 14%)}.offer-page.is-disabled{border-color:#e8edef;background:#fafbfb;color:#a0aaaf;cursor:default}.offer-page-direction{padding-right:11px;padding-left:11px;font-family:var(--font);font-variant-numeric:normal}.offer-page-gap{display:inline-flex;min-width:14px;align-items:center;justify-content:center;color:#8b989f;font-family:var(--mono);font-size:14px;line-height:1}
    .offer-source-note span{flex:1 1 420px}.offer-source-link{display:inline-flex;flex:0 0 auto;align-items:center;gap:3px;min-height:28px;padding:0 9px;border:1px solid #c9ddd7;border-radius:7px;background:#fff;color:#126b58;font-weight:720;white-space:nowrap}.offer-source-link:hover{border-color:#8fbbae;background:#f1f8f5;color:#0a5949;text-decoration:none}.offer-source-link .icon{width:14px;height:14px}
    @media(max-width:760px){#offers{scroll-margin-top:146px}.offer-source-note{margin:12px 15px 0;padding:9px 10px;font-size:10.5px;flex-wrap:wrap}.offer-source-link{width:100%;justify-content:center}.offer-pagination{padding:13px 12px 16px}.offer-pagination-links{gap:4px}.offer-page{min-width:30px;min-height:30px;padding-right:6px;padding-left:6px;font-size:10px}.offer-page-direction{padding-right:8px;padding-left:8px}.offer-card-price{gap:8px}.offer-card-price .offer-rank-index{min-width:29px;min-height:22px;font-size:9.5px}}
    /* 右上角直接呈现站长联系方式，桌面与移动端均保留可点击入口。 */
    .header-tools{gap:10px;color:#59666e}.header-contact{min-height:33px;padding:0;border:0;border-radius:0;color:#4e5e66;font-size:12px;font-weight:650;letter-spacing:0}.header-contact + .header-contact{border-left:1px solid #dce3e6;padding-left:10px}.header-contact:hover{border-color:transparent;background:transparent;color:#202d34;text-decoration:underline;text-underline-offset:3px}.header-contact:focus-visible{outline:3px solid rgb(32 78 92 / 22%);outline-offset:3px}.header-contact-kind{margin-right:4px;color:#202d34;font-weight:800}.header-github{padding-right:0!important}.header-github .icon{width:16px;height:16px}
    @media(max-width:760px){.header-tools{gap:6px}.header-contact{min-height:30px;font-size:10.5px}.header-contact + .header-contact{padding-left:6px}.header-contact-kind{margin-right:3px}.header-github{padding-right:0!important}}@media(max-width:560px){.header-contact-handle{display:none}.header-github{padding-left:7px!important}.header-contact-kind{margin-right:0}}
    body.store-risk-open{overflow:hidden}.store-risk-modal{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:24px}.store-risk-modal[hidden]{display:none}.store-risk-backdrop{position:absolute;inset:0;background:rgb(21 33 39 / 46%);backdrop-filter:blur(4px)}.store-risk-dialog{position:relative;width:min(100%,500px);max-height:calc(100dvh - 48px);overflow:auto;padding:22px;border:1px solid #dce4e7;border-radius:16px;background:#fff;box-shadow:0 26px 70px rgb(17 30 36 / 27%);color:#26343b}.store-risk-top{display:flex;align-items:center;justify-content:space-between;gap:14px}.store-risk-kicker{display:inline-flex;align-items:center;gap:6px;color:#597078;font-size:11px;font-weight:760;letter-spacing:.04em}.store-risk-kicker .icon{width:16px;height:16px;color:#18725d}.store-risk-close{display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:#74828a;cursor:pointer}.store-risk-close:hover{background:#f0f4f5;color:#26343b}.store-risk-close .icon{width:17px;height:17px}.store-risk-dialog h2{margin:15px 0 0;color:#202d34;font-size:22px;letter-spacing:-.03em;line-height:1.2}.store-risk-description{margin:10px 0 0;color:#65737b;font-size:13px;line-height:1.65}.store-risk-description strong{display:inline-block;max-width:100%;margin-top:2px;overflow-wrap:anywhere;color:#24343b;font-family:var(--mono);font-size:12px;font-weight:700}.store-risk-list{display:grid;gap:8px;margin:17px 0 0;padding:13px 15px 13px 31px;border:1px solid #e5ecee;border-radius:10px;background:#f8faf9;color:#52626a;font-size:12px;line-height:1.55}.store-risk-list li::marker{color:#18725d}.store-risk-skip{display:flex;align-items:flex-start;gap:9px;margin-top:16px;color:#485a62;cursor:pointer}.store-risk-skip input{width:15px;height:15px;margin:3px 0 0;accent-color:#18725d}.store-risk-skip span{display:grid;gap:2px;font-size:12px;line-height:1.35}.store-risk-skip b{color:#34444b;font-weight:700}.store-risk-skip small{color:#849198;font-size:10px}.store-risk-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.store-risk-button{display:inline-flex;min-height:36px;align-items:center;justify-content:center;gap:6px;padding:0 14px;border:1px solid transparent;border-radius:8px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.store-risk-button.secondary{border-color:#dce4e7;background:#fff;color:#53636b}.store-risk-button.secondary:hover{border-color:#c7d3d7;background:#f8fafb;color:#2d3d44}.store-risk-button.primary{background:#26363d;color:#fff;box-shadow:0 1px 2px rgb(22 36 42 / 18%)}.store-risk-button.primary:hover{background:#17272e}.store-risk-button .icon{width:15px;height:15px}.store-risk-close:focus-visible,.store-risk-button:focus-visible,.store-risk-skip input:focus-visible{outline:3px solid rgb(24 114 93 / 28%);outline-offset:3px}@media(max-width:560px){.store-risk-modal{align-items:end;padding:12px}.store-risk-dialog{width:100%;max-height:calc(100dvh - 24px);padding:19px;border-radius:14px}.store-risk-dialog h2{font-size:20px}.store-risk-actions{margin-top:17px}.store-risk-button{flex:1;padding:0 10px}}
    .footer-actions{display:flex;gap:14px;margin-top:8px}.footer-actions a{color:#51636b;font-size:11px;font-weight:680}.footer-actions a:hover{color:#18725d;text-decoration:underline;text-underline-offset:3px}.data-feedback-link{display:inline-flex;min-height:34px;align-items:center;gap:6px;padding:0 11px;border:1px solid #dbe4e6;border-radius:8px;color:#4d6169;font-size:11px;font-weight:700;white-space:nowrap}.data-feedback-link:hover{border-color:#b8c9cd;background:#f5f9f8;color:#18725d}.data-feedback-link .icon{width:14px;height:14px}
    .submission-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:4px 0 22px}.submission-intro-copy{max-width:720px}.submission-kicker{display:inline-flex;align-items:center;gap:6px;margin-bottom:9px;color:#18725d;font-size:11px;font-weight:760;letter-spacing:.05em}.submission-kicker .icon{width:15px;height:15px}.submission-intro h1{margin:0;color:#1f2c33;font-size:clamp(27px,3.2vw,36px);letter-spacing:-.035em;line-height:1.16}.submission-intro p{margin:9px 0 0;color:#6d7a82;font-size:14px;line-height:1.65}.submission-review-note{display:flex;max-width:315px;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid #dce8e5;border-radius:10px;background:#f5faf8;color:#52666d;font-size:11px;line-height:1.55}.submission-review-note .icon{width:16px;height:16px;margin-top:1px;color:#18725d}
    .submission-shell{display:grid;grid-template-columns:238px minmax(0,1fr);overflow:hidden;border:1px solid #e0e6e8;border-radius:14px;background:#fff;box-shadow:0 12px 32px rgb(31 47 55 / 6%)}.submission-rail{padding:24px 18px;border-right:1px solid #e5eaec;background:#f7f9f9}.submission-rail h2{margin:0 5px 5px;color:#27353c;font-size:13px}.submission-rail>p{margin:0 5px 17px;color:#7a878e;font-size:11px;line-height:1.55}.submission-mode{display:flex;width:100%;align-items:flex-start;gap:10px;margin-top:8px;padding:12px;border:1px solid transparent;border-radius:10px;background:transparent;color:#52636b;font:inherit;text-align:left;cursor:pointer}.submission-mode:hover{background:#eef3f2;color:#25353c}.submission-mode[aria-pressed="true"]{border-color:#cfdfdb;background:#fff;color:#203039;box-shadow:0 4px 14px rgb(34 59 57 / 7%)}.submission-mode-icon{display:inline-flex;width:30px;height:30px;flex:0 0 30px;align-items:center;justify-content:center;border-radius:8px;background:#e8efee;color:#587078}.submission-mode[aria-pressed="true"] .submission-mode-icon{background:#e1f1ec;color:#18725d}.submission-mode-icon .icon{width:17px;height:17px}.submission-mode-copy{display:grid;gap:2px}.submission-mode-copy strong{font-size:12px;font-weight:750}.submission-mode-copy small{color:#849097;font-size:10px;line-height:1.45}.submission-mode:focus-visible{outline:3px solid rgb(24 114 93 / 25%);outline-offset:2px}
    .submission-panel{min-width:0;padding:27px 30px 30px}.submission-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding-bottom:21px;border-bottom:1px solid #e7ebed}.submission-panel-head h2{margin:0;color:#223038;font-size:20px;letter-spacing:-.025em}.submission-panel-head p{margin:5px 0 0;color:#748189;font-size:12px;line-height:1.6}.submission-step{display:inline-flex;min-height:25px;align-items:center;padding:0 9px;border-radius:999px;background:#eef4f2;color:#45645d;font-size:10px;font-weight:720;white-space:nowrap}.submission-form{margin-top:2px}.submission-form[aria-busy="true"]{opacity:.76}.form-section{padding:23px 0;border-bottom:1px solid #edf0f1}.form-section:last-of-type{border-bottom:0}.form-section-title{margin:0 0 13px;color:#36454c;font-size:12px;font-weight:750}.field-label{display:block;margin-bottom:7px;color:#394950;font-size:12px;font-weight:720}.field-label .optional{margin-left:5px;color:#8a969c;font-size:10px;font-weight:500}.field-help{display:block;margin-top:6px;color:#869299;font-size:10px;line-height:1.55}.form-control{display:block;width:100%;min-height:42px;padding:9px 11px;border:1px solid #d5dfe2;border-radius:9px;background:#fff;color:#29383f;font:inherit;font-size:12px;line-height:1.5;transition:border-color 150ms ease,box-shadow 150ms ease}.form-control::placeholder{color:#a0aaaf}.form-control:hover{border-color:#bccace}.form-control:focus{border-color:#6ba594;box-shadow:0 0 0 3px rgb(24 114 93 / 12%);outline:0}.form-control[aria-invalid="true"]{border-color:#c9554d}.form-textarea{min-height:126px;resize:vertical}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px}.field-wide{grid-column:1 / -1}.option-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.option-card{position:relative;display:flex;min-height:42px;align-items:center;gap:8px;padding:9px 10px;border:1px solid #dce4e6;border-radius:9px;background:#fff;color:#596970;font-size:11px;font-weight:650;cursor:pointer}.option-card:hover{border-color:#b9cbc7;background:#f8fbfa;color:#2e4148}.option-card input{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0}.option-dot{width:13px;height:13px;flex:0 0 13px;border:1.5px solid #9aa7ac;border-radius:50%;box-shadow:inset 0 0 0 3px #fff}.option-card:has(input:checked){border-color:#8eb8ac;background:#edf7f4;color:#224b40}.option-card:has(input:checked) .option-dot{border-color:#18725d;background:#18725d}.option-card:has(input:focus-visible){outline:3px solid rgb(24 114 93 / 23%);outline-offset:2px}.role-options{grid-template-columns:repeat(2,minmax(0,1fr))}.role-option{min-height:64px;align-items:flex-start}.role-option-copy{display:grid;gap:2px}.role-option-copy strong{color:#304149;font-size:12px}.role-option-copy small{color:#829096;font-size:10px;font-weight:500;line-height:1.45}.context-note{display:flex;align-items:flex-start;gap:8px;margin-top:9px;padding:9px 10px;border-radius:8px;background:#f5f8f8;color:#65767d;font-size:10px;line-height:1.5}.context-note .icon{width:14px;height:14px;margin-top:1px;color:#18725d}.consent-check{display:flex;align-items:flex-start;gap:9px;color:#52636b;font-size:11px;line-height:1.55;cursor:pointer}.consent-check input{width:15px;height:15px;flex:0 0 15px;margin:2px 0 0;accent-color:#18725d}.submission-actions{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-top:22px}.submission-privacy{max-width:580px;margin:0;color:#7e8b91;font-size:10px;line-height:1.55}.submit-button{display:inline-flex;min-width:128px;min-height:40px;align-items:center;justify-content:center;gap:7px;padding:0 16px;border:0;border-radius:9px;background:#27363c;color:#fff;font:inherit;font-size:12px;font-weight:740;cursor:pointer;box-shadow:0 2px 5px rgb(25 42 49 / 17%)}.submit-button:hover{background:#17282e}.submit-button:disabled{cursor:wait;opacity:.62}.submit-button .icon{width:15px;height:15px}.submit-button:focus-visible{outline:3px solid rgb(24 114 93 / 28%);outline-offset:3px}.submission-status{min-height:0;margin:0}.submission-status.error{margin-bottom:17px;padding:10px 12px;border:1px solid #efcfcc;border-radius:9px;background:#fff6f5;color:#943d37;font-size:11px}.submission-success{display:grid;min-height:410px;place-items:center;padding:36px;text-align:center}.submission-success[hidden]{display:none}.submission-success-mark{display:inline-flex;width:46px;height:46px;align-items:center;justify-content:center;border-radius:50%;background:#e6f5ef;color:#18725d}.submission-success-mark .icon{width:24px;height:24px}.submission-success h2{margin:17px 0 0;color:#223139;font-size:22px;letter-spacing:-.025em}.submission-success p{max-width:500px;margin:8px auto 0;color:#718087;font-size:12px;line-height:1.65}.submission-id{display:inline-block;margin-top:13px;padding:7px 10px;border:1px solid #dce5e7;border-radius:8px;background:#f7f9fa;color:#33454d;font-family:var(--mono);font-size:11px}.submission-again{display:inline-flex;min-height:36px;align-items:center;justify-content:center;margin-top:18px;padding:0 14px;border:1px solid #d5dfe2;border-radius:8px;background:#fff;color:#40535b;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.submission-again:hover{background:#f5f8f8}.submission-honeypot{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}.submission-form[hidden]{display:none}
    @media(max-width:860px){.submission-intro{display:block}.submission-review-note{max-width:none;margin-top:14px}.submission-shell{grid-template-columns:1fr}.submission-rail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:11px;border-right:0;border-bottom:1px solid #e5eaec}.submission-rail h2,.submission-rail>p{display:none}.submission-mode{margin:0}.submission-panel{padding:23px 20px 25px}.option-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.submission-intro{padding-bottom:17px}.submission-intro h1{font-size:28px}.submission-intro p{font-size:12px}.submission-shell{border-radius:12px}.submission-rail{gap:6px;padding:8px}.submission-mode{min-height:58px;padding:9px}.submission-mode-icon{width:26px;height:26px;flex-basis:26px}.submission-mode-copy small{display:none}.submission-panel{padding:20px 15px 22px}.submission-panel-head{padding-bottom:17px}.submission-panel-head h2{font-size:18px}.form-section{padding:19px 0}.form-grid,.option-grid{grid-template-columns:1fr}.role-options{grid-template-columns:1fr}.role-option{min-height:52px}.submission-actions{display:grid;gap:13px}.submit-button{width:100%;min-height:42px}.submission-success{min-height:360px;padding:28px 15px}.data-feedback-link{min-height:32px}.head .data-feedback-link{flex:0 0 auto}}
    @media(prefers-reduced-motion:no-preference){.submission-mode,.option-card,.form-control,.submit-button,.data-feedback-link{transition:color 150ms ease,background-color 150ms ease,border-color 150ms ease,box-shadow 150ms ease}}
    .product-nav-inner{gap:8px;justify-content:safe center;overflow-x:auto;overflow-y:hidden}.product-filter{min-height:42px;padding-inline:8px}.reference-overview [hidden],[data-family][hidden]{display:none!important}.reference-overview:has([data-overview-summary][hidden]) + .catalogs{margin-top:6px}@media(max-width:760px){.product-nav-inner{justify-content:flex-start;gap:10px}.product-filter{min-height:44px}}
  </style><style>${MARKET_CSS}</style>${analyticsScript}
</head>
<body>
  <header class="app-header"><div class="header-inner"><div class="header-main">
    <a class="brand" href="/" aria-label="AI 订阅价格雷达首页">${radarMark()}<span class="brand-text">AI 订阅价格雷达</span></a>
    <nav class="app-nav" aria-label="主导航">${nav("/", "home", "总览")}${nav("/alerts", "alerts", "提醒")}${nav("/submit", "submit", "提交")}</nav>
    <div class="header-tools" aria-label="站长联系方式与项目链接"><a class="header-contact" href="https://x.com/superwang" target="_blank" rel="noopener noreferrer" aria-label="在 X 联系站长 @superwang"><span class="header-contact-kind">X</span><span class="header-contact-handle">@superwang</span></a><a class="header-contact" href="https://t.me/lincwang" target="_blank" rel="noopener noreferrer" aria-label="在 Telegram 联系站长 @lincwang"><span class="header-contact-kind">TG</span><span class="header-contact-handle">@lincwang</span></a><a class="header-contact header-github" href="https://github.com/lincwang123-bot/price-radar" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看 AI 订阅价格雷达项目" title="在 GitHub 查看项目">${icon("github")}</a></div>
  </div></div>${categoryRail}</header>
  <main class="wrap">${body}</main>
  <footer class="site-footer" id="site-disclaimer"><div class="footer-inner"><div><p class="footer-disclaimer">本站仅提供公开数据的汇总展示；价格、库存、服务内容及交易结果以原站实际页面为准，本站不对第三方信息的准确性、完整性或由此产生的交易结果承担责任。</p><nav class="footer-actions" aria-label="数据反馈与合作"><a href="/submit?type=feedback">数据反馈</a><a href="/submit?type=cooperation">供需提交</a></nav></div><div class="footer-contact" aria-label="联系站长"><span class="footer-contact-label">联系站长</span><span class="footer-contact-links"><a class="footer-contact-link" href="https://x.com/superwang" target="_blank" rel="noopener noreferrer" aria-label="在 X 联系站长 @superwang"><b>X</b>@superwang</a><a class="footer-contact-link" href="https://t.me/lincwang" target="_blank" rel="noopener noreferrer" aria-label="在 Telegram 联系站长 @lincwang"><b>TG</b>@lincwang</a></span></div></div></footer>${storeRiskModal}${categoryScript}${storeRiskScript}
</body>
</html>`;
}

function priced(db, list, id) {
  if (!list || !id) return null;
  const product = list.products.find((item) => item.product_id === id);
  if (!product || product.lowest_price == null) return null;
  return { source: list.source, id, product, offer: list.channel&&list.channel!=="all"?filterChannel(offersOf(db,list.source,list.snapshotId,id),list.channel)[0]:cheapestOffer(db, list.source, list.snapshotId, id) };
}

function priceStack(item) {
  if (!item) return `<div class="price-stack empty">—</div>`;
  const context = item.offer?.store_name || item.offer?.source_name || "";
  const contextHtml = context ? '<span class="price-context">' + esc(context) + "</span>" : "";
  return `<div class="price-stack ${sourceClass(item.source)}"><a class="price-link" href="${productHref(item.source, item.id)}">${fmtPrice(item.product.lowest_price, item.product.currency)}</a>${contextHtml}${stockSummary(item.product)}</div>`;
}

function mobilePriceLine(label, item) {
  if (!item) return `<div class="family-line"><span class="family-label">${esc(label)}</span><span class="family-value empty">—</span></div>`;
  const context = item.offer?.store_name || item.offer?.source_name || "";
  const contextHtml = context ? '<span class="price-context">' + esc(context) + "</span>" : "";
  return `<div class="family-line"><span class="family-label">${esc(label)}</span><span class="family-value"><a class="price-link" href="${productHref(item.source, item.id)}">${fmtPrice(item.product.lowest_price, item.product.currency)}</a>${contextHtml}${stockSummary(item.product)}</span></div>`;
}

function overviewContent(db, priceai, direct, cardnav, ldxp) {
  const entries = OVERVIEW_FAMILIES.map((summary) => {
    const family = FAMILIES.find((candidate) => candidate.family === summary.family);
    const official = family ? priced(db, cardnav, family.official) : null;
    const channel = family ? priced(db, priceai, family.priceai) : null;
    const directOffer = family ? priced(db, direct, family.direct) : null;
    const supplier = family ? priced(db, ldxp, family.ldxp) : null;
    const linked = directOffer ?? official ?? channel ?? supplier;
    const updatedList = directOffer ? direct : (official ? cardnav : (channel ? priceai : (supplier ? ldxp : null)));
    const sourceCount = [official, channel, directOffer, supplier].filter(Boolean).length;
    return {
      ...summary,
      tone: platformTone(summary.platform),
      official,
      linked,
      sourceCount,
      updatedAt: updatedList?.fetchedAt ?? null,
    };
  });

  const desktop = entries.map((entry) => {
    const price = entry.official ? fmtPrice(entry.official.product.lowest_price, entry.official.product.currency) : "—";
    const currency = entry.official?.product.currency ? esc(entry.official.product.currency) : "—";
    const note = entry.sourceCount ? `${entry.sourceCount} 个来源` : "—";
    const action = entry.linked
      ? `<a class="quote-action overview-row-link" href="${productHref(entry.linked.source, entry.linked.id)}" aria-label="查看 ${esc(entry.platform)} 的报价详情"><span>查看报价</span>${icon("chevron")}</a>`
      : `<span class="quote-action overview-row-link disabled" aria-label="暂无可查看报价">暂无报价</span>`;
    return `<tr data-family="${entry.tone}">
      <td><div class="overview-product"><span class="overview-platform-mark mark-${entry.tone}" aria-hidden="true">${platformMark(entry.platform)}</span><span>${esc(entry.platform)}</span></div></td>
      <td>${esc(entry.provider)}</td>
      <td>${esc(entry.plan)}</td>
      <td>${esc(entry.billing)}</td>
      <td class="overview-price">${price}</td>
      <td>${currency}</td>
      <td>${esc(note)}</td>
      <td><time class="overview-time">${entry.updatedAt ? esc(fmtTime(entry.updatedAt)) : "—"}</time></td>
      <td class="overview-action">${action}</td>
    </tr>`;
  }).join("");

  const mobile = entries.map((entry) => {
    const price = entry.official ? fmtPrice(entry.official.product.lowest_price, entry.official.product.currency) : "—";
    const action = entry.linked
      ? `<a class="quote-action overview-mobile-action" href="${productHref(entry.linked.source, entry.linked.id)}" aria-label="查看 ${esc(entry.platform)} 的报价详情"><span>查看报价</span>${icon("chevron")}</a>`
      : `<span class="quote-action overview-mobile-action disabled" aria-label="暂无可查看报价">暂无报价</span>`;
    return `<article class="overview-mobile-card" data-family="${entry.tone}"><div class="overview-mobile-top"><div class="overview-product"><span class="overview-platform-mark mark-${entry.tone}" aria-hidden="true">${platformMark(entry.platform)}</span><span>${esc(entry.platform)}</span></div>${action}</div><div class="overview-mobile-meta"><span>${esc(entry.provider)}</span><span>${esc(entry.plan)}</span><span>官方区 ${price}</span></div><div class="overview-mobile-bottom"><span>${entry.sourceCount ? `${entry.sourceCount} 个来源` : "暂无来源"}</span><time>${entry.updatedAt ? esc(fmtTime(entry.updatedAt)) : "—"}</time></div></article>`;
  }).join("");

  return { desktop, mobile };
}

function familyContent(db, priceai, direct, cardnav, ldxp) {
  const items = FAMILIES.map((family) => ({
    family,
    official: priced(db, cardnav, family.official),
    channel: priced(db, priceai, family.priceai),
    direct: priced(db, direct, family.direct),
    supplier: priced(db, ldxp, family.ldxp),
  }));
  const groups = [];
  for (const item of items) {
    const platform = item.family.platform || "其他";
    let group = groups.find((candidate) => candidate.platform === platform);
    if (!group) {
      group = { platform, tone: platformTone(platform), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  const desktop = groups.map((group) => {
    const rows = group.items.map((item) => `<tr data-family="${group.tone}">
      <td><div class="product-name"><strong>${esc(item.family.family)}</strong><span>${esc(item.family.platform)}</span></div></td>
      <td class="num">${priceStack(item.official)}</td><td class="num">${priceStack(item.channel)}</td><td class="num">${priceStack(item.direct)}</td><td class="num">${priceStack(item.supplier)}</td>
    </tr>`).join("");
    return `<tr class="table-group-row tone-${group.tone}" data-family="${group.tone}"><th colspan="5" scope="rowgroup"><span class="group-mark" aria-hidden="true"></span><span class="group-title">${esc(group.platform)}</span><span class="group-count">${group.items.length} 个产品</span></th></tr>${rows}`;
  }).join("");
  const mobile = `<div class="family-groups">${groups.map((group, index) => {
    const cards = group.items.map((item) => `<article class="family-card"><div class="family-head"><strong>${esc(item.family.family)}</strong><span>${esc(item.family.platform)}</span></div>${mobilePriceLine("官方区最低", item.official)}${mobilePriceLine("PriceAI Top 5 最低", item.channel)}${mobilePriceLine("原店直采最低", item.direct)}${mobilePriceLine("LDXP 货源最低", item.supplier)}</article>`).join("");
    return `<details class="family-group tone-${group.tone}" id="family-mobile-${index + 1}" data-family="${group.tone}"${index === 0 ? " open" : ""}><summary class="group-summary"><span class="group-summary-copy"><span class="group-mark" aria-hidden="true"></span><strong>${esc(group.platform)}</strong><span class="group-count">${group.items.length} 个产品</span></span><span class="group-chevron" aria-hidden="true">${icon("chevron")}</span></summary><div class="family-group-body">${cards}</div></details>`;
  }).join("")}</div>`;
  return { desktop, mobile };
}

function sourceProductGroups(list, products) {
  if (list.source === "ldxp-goods") return [{ label: "关键词检索结果", tone: "other", items: products }];
  if (list.source === "goaihop-relay") return [{ label: "中转 API 服务商 / 套餐", tone: "relay", items: products }];
  const groups = [];
  for (const product of products) {
    const label = product.platform || "其他";
    let group = groups.find((candidate) => candidate.label === label);
    if (!group) {
      group = { label, tone: platformTone(label), items: [] };
      groups.push(group);
    }
    group.items.push(product);
  }
  const order = ["ChatGPT", "Claude", "Gemini", "Grok", "X", "Cursor", "Perplexity", "Notion AI", "Manus", "Microsoft", "API/CDK", "其他", "接码", "邮箱"];
  return groups.sort((a, b) => {
    const aIndex = order.indexOf(a.label);
    const bIndex = order.indexOf(b.label);
    const aRank = aIndex === -1 ? order.length : aIndex;
    const bRank = bIndex === -1 ? order.length : bIndex;
    return aRank - bRank || a.label.localeCompare(b.label, "zh-CN");
  });
}

function sourceProducts(list) {
  if (!list) return `<div class="empty">暂未采集到可展示数据</div>`;
  const products = [...list.products]
    .filter((product) => product.lowest_price != null && Number(product.lowest_price) > 0)
    .sort((a, b) => (a.platform ?? "").localeCompare(b.platform ?? "") || Number(a.lowest_price) - Number(b.lowest_price));
  if (!products.length) return `<div class="empty">暂未采集到可展示数据</div>`;
  const groups = sourceProductGroups(list, products);
  const desktopGroups = groups.map((group) => {
    const rows = group.items.map((product) => {
      const spec = product.spec ? " · " + esc(product.spec) : "";
      const label = esc(product.name || product.product_id);
      return `<tr><td><div class="catalog-name"><strong>${label}</strong><span>${esc(product.product_type ?? "")}${spec}</span></div></td><td class="num"><span class="money">${fmtPrice(product.lowest_price, product.currency)}</span></td><td class="num">${stockSummary(product)}</td><td class="catalog-action-cell"><a class="quote-action catalog-action" href="${productHref(list.source, product.product_id)}" aria-label="查看 ${label} 报价详情"><span>查看报价</span>${icon("chevron")}</a></td></tr>`;
    }).join("");
    return `<tbody data-family="${group.tone}" data-catalog-group data-product-count="${group.items.length}"><tr class="table-group-row tone-${group.tone}"><th colspan="4" scope="rowgroup"><span class="group-mark" aria-hidden="true"></span><span class="group-title">${esc(group.label)}</span><span class="group-count">${group.items.length} 个产品</span></th></tr>${rows}</tbody>`;
  }).join("");
  const mobileGroups = groups.map((group, index) => {
    const cards = group.items.map((product) => {
      const spec = product.spec ? "<span>" + esc(product.spec) + "</span>" : "";
      return `<article class="catalog-card"><div class="card-top"><div><div class="card-price">${fmtPrice(product.lowest_price, product.currency)}</div>${stockSummary(product)}</div></div><div class="card-name">${esc(product.name || product.product_id)}</div><div class="card-meta"><span>${esc(product.product_type ?? "未分类")}</span>${spec}</div><div class="card-bottom"><span class="dim">${quoteCountLabel(product)}</span><a class="external" href="${productHref(list.source, product.product_id)}">查看报价 ${icon("chevron")}</a></div></article>`;
    }).join("");
    return `<details class="catalog-group tone-${group.tone}" data-family="${group.tone}"${index === 0 ? " open" : ""}><summary class="group-summary"><span class="group-summary-copy"><span class="group-mark" aria-hidden="true"></span><strong>${esc(group.label)}</strong><span class="group-count">${group.items.length} 个产品</span></span><span class="group-chevron" aria-hidden="true">${icon("chevron")}</span></summary><div class="catalog-group-body">${cards}</div></details>`;
  }).join("");
  return `<div class="table-scroll desktop"><table class="catalog-table"><thead><tr><th>产品</th><th class="num">最低价</th><th class="num">有货 / 报价</th><th class="catalog-action-heading">查看报价</th></tr></thead>${desktopGroups}</table></div><div class="mobile"><div class="catalog-groups">${mobileGroups}</div></div>`;
}

function sourceSection(list) {
  const label = list ? (SOURCE_LABEL[list.source] ?? list.source) : "数据源";
  const count = list?.products.filter((product) => product.lowest_price != null && Number(product.lowest_price) > 0).length ?? 0;
  return `<section class="surface" data-catalog-section><div class="head"><div style="display:flex;align-items:center;gap:9px;min-width:0">${sourceBadge(list?.source ?? "neutral")}<div><h2>${esc(label)}</h2><p class="note" data-catalog-count>${count} 个产品 · 当前快照</p></div></div>${updatedMeta(list)}</div>${sourceProducts(list)}</section>`;
}

function alertList(rows) {
  if (!rows.length) return `<div class="empty">暂无提醒</div>`;
  const markup = rows.map((alert) => {
    const [label, tone] = ALERT_TYPE[alert.kind ?? alert.rule_id] ?? [alert.kind ?? alert.rule_id ?? "提醒", ""];
    const product = esc(alert.product_name || alert.product_id || "未命名产品");
    const productHtml = alert.source && alert.product_id
      ? '<a class="alert-product" href="' + productHref(alert.source, alert.product_id) + '">' + product + "</a>"
      : '<span class="alert-product">' + product + "</span>";
    const badge = "";
    return `<article class="alert ${tone}"><span class="alert-rail" aria-hidden="true"></span><div class="alert-copy"><div class="alert-top"><span class="alert-type ${tone}">${esc(label)}</span>${productHtml}${badge}</div><div class="alert-message">${esc(alert.message ?? "")}</div></div><time class="alert-time">${esc(fmtTime(alert.ts))}</time></article>`;
  }).join("");
  return `<div class="alerts-list">${markup}</div>`;
}

function marketCatalog(entries,title,{business=false}={}) {
  if(!entries.length)return "";
  const groups=new Map();for(const e of entries){const platform=e.list.source==="ldxp-goods"?"关键词产品":e.list.source==="goaihop-relay"?"API 服务":e.product.platform||"其他";if(!groups.has(platform))groups.set(platform,[]);groups.get(platform).push(e);}
  const action=e=>'<a class="quote-action catalog-action" href="'+productHref(e.list.source,e.product.product_id)+'" aria-label="查看 '+esc(publicProductName(e.product))+' 报价详情">查看报价 '+icon("chevron")+'</a>'+((e.alternatives||[]).length?'<details class="more-quotes"><summary>更多报价</summary>'+e.alternatives.map(a=>'<a href="'+productHref(a.list.source,a.product.product_id)+'">'+esc(publicProductName(a.product))+' · '+fmtPrice(a.offer.price,a.product.currency)+' · '+esc(a.offer.store_name||"店铺")+'</a>').join("")+'</details>':"");
  const display=e=>({name:publicProductName(e.product),spec:[e.product.product_type,publicSpec(e.product.spec),e.offer?.title].filter(Boolean).join(" · "),price:e.offer?.price??e.product.lowest_price,store:e.offer?.store_name||"",state:business?(e.list.source==="cardnav-official"?"官方参考":"服务套餐"):listingState(e.offer,e.list.stale),platform:business?(e.list.source==="cardnav-official"?"官方渠道":"服务商"):(e.channel?.label||"未确认渠道"),time:e.offer?.captured_at||e.list.fetchedAt});
  const body=[...groups].map(([platform,items])=>{const tone=platform==="关键词产品"?"other":platform==="API 服务"?"relay":platformTone(platform);
    const desktop=items.map(e=>{const d=display(e);return '<tr><td><div class="catalog-name"><strong>'+esc(d.name)+'</strong><span class="market-spec" title="'+esc(d.spec)+'">'+esc(d.spec)+'</span></div></td><td class="num"><span class="money">'+fmtPrice(d.price,e.product.currency)+'</span><small class="market-store">'+esc(d.store)+'</small></td><td><span class="stock '+(["在售","库存紧张"].includes(d.state)?"available":"neutral")+'">'+esc(d.state)+'</span><small class="market-time">更新于 '+esc(fmtTime(d.time))+'</small></td><td>'+esc(d.platform)+'</td><td>'+action(e)+'</td></tr>';}).join("");
    const mobile=items.map(e=>{const d=display(e);return '<article class="catalog-card"><div class="card-name">'+esc(d.name)+'</div><div class="market-spec" title="'+esc(d.spec)+'">'+esc(d.spec)+'</div><div class="market-card-price"><div><small>参考起价</small><div class="card-price">'+fmtPrice(d.price,e.product.currency)+'</div><small>'+esc(d.store)+'</small></div><div class="market-card-status"><span class="stock '+(["在售","库存紧张"].includes(d.state)?"available":"neutral")+'">'+esc(d.state)+'</span><span>'+esc(d.platform)+'</span></div></div><div class="card-bottom"><span class="dim">更新于 '+esc(fmtTime(d.time))+'</span>'+action(e)+'</div></article>';}).join("");
    return '<div data-family="'+tone+'" data-catalog-group data-product-count="'+items.length+'"><div class="market-group-title"><strong>'+esc(platform)+'</strong><span>'+items.length+' 个产品</span></div><div class="table-scroll desktop"><table class="catalog-table market-table"><thead><tr><th>产品 / 规格</th><th class="num">参考起价</th><th>在售状态 / 时间</th><th>交易平台</th><th>报价</th></tr></thead><tbody>'+desktop+'</tbody></table></div><div class="mobile"><div class="catalog-groups">'+mobile+'</div></div></div>';}).join("");
  return '<section class="surface market-section" data-catalog-section><div class="head"><h2>'+esc(title)+'</h2><p class="note" data-catalog-count>'+entries.length+' 个产品</p></div>'+body+'</section>';
}
function homePage(db, url = new URL("http://localhost")) {
  const channel=normalizeChannel(url.searchParams.get("channel"));
  const lists=["direct-shops","priceai","ldxp-goods"].map(s=>latestProducts(db,s,channel));
  const familyOrder=e=>FAMILY_FILTERS.findIndex(f=>f.key===(e.list.source==="ldxp-goods"?"other":platformTone(e.product.platform)));
  const entries=marketEntries(lists).sort((a,b)=>familyOrder(a)-familyOrder(b)||publicProductName(a.product).localeCompare(publicProductName(b.product),"zh-CN"));
  const businessLists=["cardnav-official","goaihop-relay"].map(s=>latestProducts(db,s,channel));
  const businesses=businessLists.map(list=>({list,entries:list?list.products.filter(p=>p.lowest_price!=null).map(product=>({list,product,offer:null,alternatives:[]})):[]}));
  const availableFamilies=new Set([...entries,...businesses.flatMap(b=>b.entries)].map(e=>e.list.source==="ldxp-goods"?"other":e.list.source==="goaihop-relay"?"relay":platformTone(e.product.platform)));
  return layout("AI 订阅报价", '<section id="comparison" class="market-intro"><div class="overview-head"><h1>AI 订阅报价</h1><p class="note">价格与库存以店铺结算页为准；参考起价不代表全部市场最低价。</p></div></section>'+channelForm(channel,url.searchParams.get("family")||"all")+directHealthNotice(db)+
    '<div class="catalogs">'+marketCatalog(entries,"店铺产品")+businesses.map(b=>marketCatalog(b.entries,b.list?.source==="cardnav-official"?"官方订阅参考":"API 服务套餐",{business:true})).join("")+'</div><section class="surface empty" data-market-empty'+(entries.length||businesses.some(b=>b.entries.length)?' hidden':'')+'>当前筛选下暂无匹配报价，请尝试其他品牌或交易平台。</section>'+
    '<p class="note market-footer"><a href="/alerts">查看价格提醒</a></p>',"home",{availableFamilies,channel});
}

function channelForm(channel,family,source=null,id=null){return `<form method="get" action="${source?"/product":"/"}" class="surface channel-form"><label for="channel-filter">交易平台 </label><select id="channel-filter" name="channel">${CHANNELS.map(c=>`<option value="${c.id}"${c.id===channel?" selected":""}>${c.label}</option>`).join("")}</select><input type="hidden" name="family" data-channel-family value="${esc(family)}">${source?`<input type="hidden" name="source" value="${esc(source)}"><input type="hidden" name="id" value="${esc(id)}">`:""}<button type="submit">筛选</button><p class="note">按交易平台筛选；库存与价格以店铺页面为准。</p></form>`;}

function channelSeries(db,source,id,channel){
 const rows=db.prepare(`WITH recent AS (SELECT snapshot_id,fetched_at FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 120) SELECT o.*,s.fetched_at FROM recent s JOIN offers o ON o.snapshot_id=s.snapshot_id AND o.source=? WHERE o.product_id=? ORDER BY s.fetched_at ASC`).all(source,source,id);
 const points=new Map();for(const o of filterChannel(rows,channel)){if(o.stock_count===0||!["in_stock","available","online","low_stock"].includes(o.status))continue;if(!publicOfferAllowed(source,o))continue;const price=Number(o.price);if(!(price>0))continue;const old=points.get(o.snapshot_id);if(!old||price<old.lowest_price)points.set(o.snapshot_id,{fetched_at:o.fetched_at,lowest_price:price});}return [...points.values()];
}

function directHealthNotice(db) {
  let health;try{health=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='health:direct-targets'").get()?.value||"null");}catch{return "";}
  const affected=health?.targets?.filter(t=>["stale","unavailable"].includes(t.status))||[];
  if(!affected.length)return "";
  return `<section class="surface" role="status"><strong>部分店铺暂未核验成功</strong><ul>${affected.map(t=>`<li>${esc(t.name)}：${t.status==="unavailable"?"无有效缓存，暂不参与当前报价（不代表售罄）":"暂用缓存"}；上次成功 ${t.lastSuccess?esc(fmtTime(t.lastSuccess)):"无"}</li>`).join("")}</ul></section>`;
}

function paginationNumbers(currentPage, pageCount) {
  const pages = new Set([1, pageCount]);
  for (let page = Math.max(1, currentPage - 2); page <= Math.min(pageCount, currentPage + 2); page++) {
    pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function offerPagination({ source, id, page, pageCount }) {
  if (pageCount <= 1) return "";
  const previous = page > 1
    ? `<a class="offer-page offer-page-direction" href="${productPageHref(source, id, page - 1)}">上一页</a>`
    : '<span class="offer-page offer-page-direction is-disabled" aria-disabled="true">上一页</span>';
  const next = page < pageCount
    ? `<a class="offer-page offer-page-direction" href="${productPageHref(source, id, page + 1)}">下一页</a>`
    : '<span class="offer-page offer-page-direction is-disabled" aria-disabled="true">下一页</span>';
  let previousNumber = 0;
  const numbers = paginationNumbers(page, pageCount).map((number) => {
    const gap = number - previousNumber > 1 ? '<span class="offer-page-gap" aria-hidden="true">…</span>' : "";
    previousNumber = number;
    const item = number === page
      ? `<span class="offer-page offer-page-number current" aria-current="page">${number}</span>`
      : `<a class="offer-page offer-page-number" href="${productPageHref(source, id, number)}" aria-label="第 ${number} 页">${number}</a>`;
    return gap + item;
  }).join("");
  return `<nav class="offer-pagination" aria-label="报价分页"><div class="offer-pagination-links">${previous}${numbers}${next}</div></nav>`;
}

function offerContent(offers, { source, id, page, stale=false }) {
  const state=o=>source==='cardnav-official'?'官方参考':source==='goaihop-relay'?(!stale&&o.status==='online'?'服务在线':'服务状态待确认'):listingState(o,stale);
  const perPage = 10;
  const total = offers.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const start = (currentPage - 1) * perPage;
  const shown = offers.slice(start, start + perPage);
  const end = start + shown.length;
  const desktopRows = shown.map((offer, index) => {
    const rank = start + index + 1;
    const url = safeUrl(offer.url);
    const link = url ? '<a class="row-link" data-store-risk href="' + url + '" target="_blank" rel="noopener noreferrer" aria-label="在原站打开报价">' + icon("external") + "</a>" : "";
    return `<tr><td class="num offer-rank"><span class="offer-rank-index">#${rank}</span></td><td class="num"><span class="money">${fmtPrice(offer.price, offer.currency)}</span></td><td>${statusMark(state(offer))}</td><td><div class="offer-title"><strong>${esc(offer.store_name || "店铺信息待确认")}</strong><span>${esc(offer.title ?? "")}</span>${metricLine(offer)}</div></td><td class="dim">${esc(offer.captured_at ? fmtTime(offer.captured_at) : "—")}</td><td class="num">${link}</td></tr>`;
  }).join("");
  const mobileCards = shown.map((offer, index) => {
    const rank = start + index + 1;
    const url = safeUrl(offer.url);
    const iconLink = url ? '<a class="row-link" data-store-risk href="' + url + '" target="_blank" rel="noopener noreferrer" aria-label="在原站打开报价">' + icon("external") + "</a>" : "";
    const bottomLink = url ? '<a class="external" data-store-risk href="' + url + '" target="_blank" rel="noopener noreferrer">原站 ' + icon("external") + "</a>" : "";
    const title = offer.title ? '<div class="card-meta"><span>' + esc(offer.title) + "</span></div>" : "";
    return `<article class="offer-card"><div class="card-top"><div class="offer-card-price"><span class="offer-rank-index" aria-label="第 ${rank} 名">#${rank}</span><div><div class="card-price">${fmtPrice(offer.price, offer.currency)}</div>${statusMark(state(offer))}</div></div>${iconLink}</div><div class="card-name">${esc(offer.store_name || "店铺信息待确认")}</div>${title}${metricLine(offer)}<div class="card-bottom"><span class="dim">报价时间 ${esc(offer.captured_at ? fmtTime(offer.captured_at) : "—")}</span>${bottomLink}</div></article>`;
  }).join("");
  return {
    total,
    page: currentPage,
    pageCount,
    start,
    end,
    shown: shown.length,
    desktopRows,
    mobileCards,
    pagination: offerPagination({ source, id, page: currentPage, pageCount }),
  };
}

function productPage(db, url) {
  const channel=normalizeChannel(url.searchParams.get("channel"));
  const source = url.searchParams.get("source") || "priceai";
  const id = url.searchParams.get("id");
  if (!id) return layout("缺少参数", `${pageIntro("缺少产品参数", "请选择一个产品后再查看报价")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  const snapshot = latestProducts(db, source,channel);
  if (!snapshot) return layout("暂无数据", `${pageIntro("暂未采集到数据", "该数据源当前没有可展示的快照")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  let product = snapshot.products.find((item) => item.product_id === id);
  if(!product&&channel!=="all"){const original=latestProducts(db,source)?.products.find(item=>item.product_id===id);if(original)product={...original,selected_offer:null,lowest_price:null,offer_count:0,visible_offer_count:0,in_stock_count:0};}
  if (!product) return layout("未找到产品", `${pageIntro("未找到该产品", "当前快照中没有匹配的产品记录")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);

  const offers = filterChannel(offersOf(db, source, snapshot.snapshotId, id),channel);
  const page = requestedPage(url.searchParams.get("page"));
  const series = channel==="all"?priceSeriesRows(db, source, id).slice(-120):channelSeries(db,source,id,channel);
  const chart = sparkline(series, product.currency);
  const chartHtml = chart ?? '<div class="empty">快照不足，暂无走势</div>';
  const related = recentAlerts(db, 999).filter((alert) => alert.product_id === id || alert.product_id === product.product_id);
  const rendered = offerContent(offers, { source, id, page,stale:snapshot.stale });
  const spec = [publicSpec(product.spec),product.selected_offer?.title].filter(Boolean).map(s=>"<span>"+esc(s)+"</span>").join("");
  const range = rendered.shown ? `${rendered.start + 1}–${rendered.end}` : "0";
  const directSnapshot = source === "priceai" ? latestProducts(db, "direct-shops") : null;
  const directMatch = directSnapshot?.products.find((item) => item.product_id === id);
  const directCta = directMatch
    ? `<a class="offer-source-link" href="${productHref("direct-shops", id)}">查看更多店铺报价 ${icon("chevron")}</a>`
    : "";
  const sourceLimitNotice = source === "priceai" && offers.length > 0 && hasUnpublishedOfferDetails(product)
    ? `<div class="offer-source-note" role="note"><strong>报价范围</strong><span>仅展示本站已收录报价，并非全部市场报价；当前 ${offers.length} 条已过滤样本不代表市场可用总量。</span>${directCta}</div>`
    : "";
  const offersHtml = offers.length
    ? '<div class="table-scroll desktop"><table class="offer-table"><thead><tr><th class="num offer-rank-heading">排名</th><th class="num">价格</th><th>状态</th><th>店铺 / 标题</th><th>抓取时间</th><th aria-label="原站"></th></tr></thead><tbody>' + rendered.desktopRows + '</tbody></table></div><div class="mobile"><div class="mobile-stack">' + rendered.mobileCards + "</div></div>"
    : '<div class="empty">暂无报价</div>';
  const feedbackHref = "/submit?type=feedback&amp;source=" + encodeURIComponent(source) + "&amp;product=" + encodeURIComponent(id);
  return layout(publicProductName(product) + " · 报价", `
    <a class="breadcrumb" href="/?family=${source === "ldxp-goods" ? "other" : source === "goaihop-relay" ? "relay" : platformTone(product.platform)}${channel!=="all"?'&amp;channel='+channel:''}">${icon("back")}返回产品分类</a>
    ${channelForm(channel,url.searchParams.get("family")||platformTone(product.platform),source,id)}${source==="direct-shops"?directHealthNotice(db):""}
    <section class="product-hero"><div class="summary"><h1>${esc(publicProductName(product))}</h1><div class="product-meta"><span>${esc(product.platform ?? "未分类")}</span><span>${esc(product.product_type ?? "未分类")}</span>${spec}</div><div class="price-label">${source==='cardnav-official'?'官方参考价':'参考起价'}</div><div class="price-display">${fmtPrice(product.lowest_price, product.currency)}</div><div class="summary-bottom">${SHOP_SOURCES.has(source)?statusMark(listingState(product.selected_offer,snapshot.stale)):statusMark(source==='cardnav-official'?'官方参考':'服务套餐')}${updatedMeta(snapshot)}</div><p class="note">价格、规格与库存以结算页面为准。</p></div>
      <div class="chart-panel"><div class="chart-head"><h2>最低价走势</h2><span>最近 ${series.length} 个快照</span></div><div class="chart-wrap">${chartHtml}</div></div>
    </section>
    <section class="surface detail" id="offers"><div class="head"><div><h2>报价排行</h2><p class="note">共 ${rendered.total} 条公开报价 · 第 ${rendered.page} / ${rendered.pageCount} 页 · 展示第 ${range} 名 · 在售优先、价格升序</p></div><a class="data-feedback-link" href="${feedbackHref}">${icon("message")}反馈这页数据</a></div>${sourceLimitNotice}${offersHtml}${rendered.pagination}</section>
    <section class="alerts"><div class="head"><div><h2>相关提醒</h2><p class="note">与该产品相关的盯盘事件</p></div></div>${alertList(related)}</section>
  `, "", {channel});
}

function submissionPage(url, csrfToken) {
  const mode = url.searchParams.get("type") === "cooperation" ? "cooperation" : "feedback";
  const role = url.searchParams.get("role") === "demand" ? "demand" : "supply";
  const cooperationCopy = {
    supply: {
      title: "提交供给信息",
      description: "说明可提供的产品、供给规模与保障范围，便于核验和沟通。",
      subjectLabel: "供给标题",
      subjectPlaceholder: "例如：Claude Pro 月度稳定供给",
      productLabel: "供给产品",
      scaleLabel: "供给规模",
      assuranceLabel: "提供的保障",
      settlementLabel: "支持的结算方式",
      linkLabel: "公开证明或介绍链接",
      linkPlaceholder: "https:// 开头的店铺、产品或企业介绍页",
      linkHelp: "可补充公开产品与交付介绍，供站长人工核验。",
      detailsLabel: "供给说明",
      detailsPlaceholder: "请写明具体产品、交付方式、可供数量、报价口径、测试方式和保障范围。不要提交账号密码、卡密或 API Key。",
      submitLabel: "提交供给信息",
    },
    demand: {
      title: "提交采购需求",
      description: "说明需要采购的产品、数量、预算与交付要求，便于沟通需求。",
      subjectLabel: "采购需求标题",
      subjectPlaceholder: "例如：每月采购 50 个 Claude Pro 订阅名额",
      productLabel: "采购产品",
      scaleLabel: "采购规模",
      assuranceLabel: "期望保障",
      settlementLabel: "期望结算方式",
      linkLabel: "采购需求或企业介绍链接",
      linkPlaceholder: "https:// 开头的需求文档或企业介绍页",
      linkHelp: "可补充采购清单或企业介绍，便于沟通需求。",
      detailsLabel: "采购需求说明",
      detailsPlaceholder: "请写明所需产品与规格、采购数量、使用周期、预算范围、期望交付时间，以及测试和售后要求。不要提交账号密码、卡密或 API Key。",
      submitLabel: "提交采购需求",
    },
  };
  const roleCopy = cooperationCopy[role];
  const source = String(url.searchParams.get("source") || "").slice(0, 80);
  const product = String(url.searchParams.get("product") || "").slice(0, 120);
  const contextUrl = source && product
    ? "/product?source=" + encodeURIComponent(source) + "&id=" + encodeURIComponent(product)
    : "";
  const feedbackHidden = mode === "feedback" ? "" : " hidden";
  const cooperationHidden = mode === "cooperation" ? "" : " hidden";
  const feedbackDisabled = mode === "feedback" ? "" : " disabled";
  const cooperationDisabled = mode === "cooperation" ? "" : " disabled";
  const topicOption = (value, label) => `<label class="option-card"><input type="radio" name="topic" value="${value}"${value === "price_wrong" ? " checked" : ""}${feedbackDisabled}/><span class="option-dot" aria-hidden="true"></span><span>${label}</span></label>`;
  const roleOption = (value, title, detail) => `<label class="option-card role-option"><input type="radio" name="topic" value="${value}"${value === role ? " checked" : ""}${cooperationDisabled}/><span class="option-dot" aria-hidden="true"></span><span class="role-option-copy"><strong>${title}</strong><small>${detail}</small></span></label>`;

  const body = `
    <section class="submission-intro">
      <div class="submission-intro-copy"><span class="submission-kicker">${icon("message")}共同维护可信数据</span><h1>提交与合作</h1><p>纠正公开数据，或提交可核验的供需信息。先选择类型，再补充必要事实，不需要从头写一大段说明。</p></div>
      <div class="submission-review-note">${icon("shield")}<span>所有内容先由站长人工审核，不会自动公开，也不会自动联系第三方。</span></div>
    </section>
    <section class="submission-shell">
      <aside class="submission-rail" aria-label="选择提交类型">
        <h2>你要提交什么</h2><p>两条流程分别保存，方便后续核查和处理。</p>
        <button class="submission-mode" type="button" data-submission-mode="feedback" aria-pressed="${mode === "feedback"}"><span class="submission-mode-icon">${icon("message")}</span><span class="submission-mode-copy"><strong>纠正公开数据</strong><small>价格、库存、分类、链接或页面问题</small></span></button>
        <button class="submission-mode" type="button" data-submission-mode="cooperation" aria-pressed="${mode === "cooperation"}"><span class="submission-mode-icon">${icon("handshake")}</span><span class="submission-mode-copy"><strong>供需合作</strong><small>源头供给或稳定批量采购需求</small></span></button>
      </aside>
      <div class="submission-panel">
        <div class="submission-panel-head"><div><h2 data-submission-title>${mode === "feedback" ? "反馈一处问题" : roleCopy.title}</h2><p data-submission-description>${mode === "feedback" ? "选好问题类型后，告诉我们是哪项数据需要复核。" : roleCopy.description}</p></div><span class="submission-step">人工审核</span></div>
        <form class="submission-form" id="submission-form" novalidate>
          <input type="hidden" name="kind" value="${mode}"/>
          <div class="submission-honeypot" aria-hidden="true"><label>网站<input type="text" name="website" tabindex="-1" autocomplete="off"/></label></div>
          <p class="submission-status" id="submission-status" role="status" aria-live="polite"></p>

          <div data-kind-panel="feedback"${feedbackHidden}>
            <section class="form-section"><h3 class="form-section-title">问题类型</h3><div class="option-grid">
              ${topicOption("price_wrong", "价格有误")}${topicOption("sold_out", "库存状态不对")}${topicOption("warranty_wrong", "质保描述不对")}${topicOption("category_wrong", "产品分类不对")}${topicOption("dead_link", "原站链接失效")}${topicOption("missing_item", "缺少一条数据")}${topicOption("page_problem", "页面使用问题")}${topicOption("suggestion", "功能建议")}${topicOption("other", "其他情况")}
            </div></section>
            <section class="form-section"><div class="form-grid">
              <label><span class="field-label">相关产品或页面<span class="optional">选填</span></span><input class="form-control" name="subject" maxlength="120" value="${esc(product)}" placeholder="例如：ChatGPT Pro 20x"${feedbackDisabled}/></label>
              <label><span class="field-label">页面或原站链接<span class="optional">选填</span></span><input class="form-control" name="contextUrl" maxlength="500" value="${esc(contextUrl)}" placeholder="粘贴需要复核的页面链接"${feedbackDisabled}/></label>
              <label class="field-wide"><span class="field-label">补充说明<span class="optional">选填</span></span><textarea class="form-control form-textarea" name="details" maxlength="1500" placeholder="可以写清楚：哪里不对、你看到的正确情况、何时发现。已有产品和链接时可简短填写。"${feedbackDisabled}></textarea><span class="field-help">相关产品、链接和补充说明至少填写一项。</span></label>
              <label class="field-wide"><span class="field-label">联系方式<span class="optional">选填</span></span><input class="form-control" name="contact" maxlength="128" placeholder="例如：X @username、TG @username 或邮箱"${feedbackDisabled}/><span class="field-help">仅用于必要的核实，不会公开展示。</span></label>
            </div></section>
          </div>

          <div data-kind-panel="cooperation"${cooperationHidden}>
            <section class="form-section"><h3 class="form-section-title">你的合作方向</h3><div class="option-grid role-options">
              ${roleOption("supply", "我是供给方", "有可核验的源头渠道、稳定库存或交付能力")}
              ${roleOption("demand", "我是采购方", "有持续或批量需求，希望匹配稳定供给")}
            </div></section>
            <section class="form-section"><div class="form-grid">
              <label class="field-wide"><span class="field-label" data-cooperation-copy="subjectLabel">${roleCopy.subjectLabel}</span><input class="form-control" name="subject" minlength="4" maxlength="120" required data-cooperation-placeholder="subjectPlaceholder" placeholder="${roleCopy.subjectPlaceholder}"${cooperationDisabled}/></label>
              <label><span class="field-label" data-cooperation-copy="productLabel">${roleCopy.productLabel}</span><select class="form-control" name="productArea" required${cooperationDisabled}><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="grok_x">Grok / X</option><option value="api_relay">API / 中转</option><option value="mail_verify">邮箱 / 接码</option><option value="other">其他</option></select></label>
              <label><span class="field-label" data-cooperation-copy="scaleLabel">${roleCopy.scaleLabel}</span><select class="form-control" name="scale" required${cooperationDisabled}><option value="trial">先小额测试</option><option value="small">稳定小批量</option><option value="monthly">月度批量</option><option value="large">大额长期</option><option value="negotiable">待沟通</option></select></label>
              <label><span class="field-label" data-cooperation-copy="assuranceLabel">${roleCopy.assuranceLabel}</span><select class="form-control" name="assurance" required${cooperationDisabled}><option value="full_warranty">明确质保</option><option value="subscription_cover">掉订阅保障</option><option value="activation_only">仅保证激活可用</option><option value="conditional">有条件保障</option><option value="none">无质保</option><option value="negotiable">可协商</option></select></label>
              <label><span class="field-label" data-cooperation-copy="settlementLabel">${roleCopy.settlementLabel}</span><select class="form-control" name="settlement" required${cooperationDisabled}><option value="cny">人民币</option><option value="usdt">USDT</option><option value="both">人民币或 USDT</option><option value="negotiable">可协商</option></select></label>
              <label class="field-wide"><span class="field-label"><span data-cooperation-copy="linkLabel">${roleCopy.linkLabel}</span><span class="optional">选填</span></span><input class="form-control" type="url" name="contextUrl" maxlength="500" data-cooperation-placeholder="linkPlaceholder" placeholder="${roleCopy.linkPlaceholder}"${cooperationDisabled}/><span class="field-help" data-cooperation-copy="linkHelp">${roleCopy.linkHelp}</span></label>
              <label class="field-wide"><span class="field-label" data-cooperation-copy="detailsLabel">${roleCopy.detailsLabel}</span><textarea class="form-control form-textarea" name="details" minlength="10" maxlength="1500" required data-cooperation-placeholder="detailsPlaceholder" placeholder="${roleCopy.detailsPlaceholder}"${cooperationDisabled}></textarea></label>
              <label class="field-wide"><span class="field-label">联系方式</span><input class="form-control" name="contact" minlength="3" maxlength="128" required placeholder="X @username、TG @username 或工作邮箱"${cooperationDisabled}/></label>
              <label class="consent-check field-wide"><input type="checkbox" name="consent" required${cooperationDisabled}/><span>我确认有权提交以上信息，内容不含密码、卡密、API Key、私钥或其他敏感凭据。</span></label>
            </div></section>
          </div>

          <div class="submission-actions"><p class="submission-privacy">为防止滥用，本站会使用带密钥的短期限流标识，不保存原始 IP 或浏览器标识。联系方式只用于核实和后续沟通。</p><button class="submit-button" type="submit"><span data-submit-label>${mode === "feedback" ? "提交审核" : roleCopy.submitLabel}</span>${icon("send")}</button></div>
        </form>
        <div class="submission-success" id="submission-success" hidden><div><span class="submission-success-mark">${icon("check")}</span><h2 tabindex="-1">已收到你的提交</h2><p>我们会先核查事实，再决定修正数据或联系沟通。请保存下面的提交编号。</p><code class="submission-id" data-submission-id></code><br/><button class="submission-again" type="button">继续提交</button></div></div>
      </div>
    </section>
    <script>
      (() => {
        const form = document.getElementById("submission-form");
        const status = document.getElementById("submission-status");
        const success = document.getElementById("submission-success");
        const idOutput = success.querySelector("[data-submission-id]");
        const modeInput = form.elements.kind;
        const modeButtons = Array.from(document.querySelectorAll("[data-submission-mode]"));
        const panels = Array.from(document.querySelectorAll("[data-kind-panel]"));
        const title = document.querySelector("[data-submission-title]");
        const description = document.querySelector("[data-submission-description]");
        const submitButton = form.querySelector("button[type=submit]");
        const submitLabel = form.querySelector("[data-submit-label]");
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
        const cooperationCopy = ${JSON.stringify(cooperationCopy)};
        const cooperationPanel = form.querySelector('[data-kind-panel="cooperation"]');
        let currentMode = modeInput.value;

        const updateRoleCopy = () => {
          const role = cooperationPanel.querySelector('input[name="topic"]:checked')?.value || "supply";
          const copy = cooperationCopy[role];
          cooperationPanel.querySelectorAll("[data-cooperation-copy]").forEach((element) => {
            element.textContent = copy[element.dataset.cooperationCopy];
          });
          cooperationPanel.querySelectorAll("[data-cooperation-placeholder]").forEach((control) => {
            control.placeholder = copy[control.dataset.cooperationPlaceholder];
          });
          const isFeedback = currentMode === "feedback";
          title.textContent = isFeedback ? "反馈一处问题" : copy.title;
          description.textContent = isFeedback ? "选好问题类型后，告诉我们是哪项数据需要复核。" : copy.description;
          if (!submitButton.disabled) submitLabel.textContent = isFeedback ? "提交审核" : copy.submitLabel;
        };
        cooperationPanel.querySelectorAll('input[name="topic"]').forEach((radio) => {
          radio.addEventListener("change", updateRoleCopy);
        });

        const setMode = (nextMode) => {
          currentMode = nextMode === "cooperation" ? "cooperation" : "feedback";
          modeInput.value = currentMode;
          modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.submissionMode === currentMode)));
          panels.forEach((panel) => {
            const active = panel.dataset.kindPanel === currentMode;
            panel.hidden = !active;
            panel.querySelectorAll("input,select,textarea").forEach((control) => { control.disabled = !active; });
          });
          updateRoleCopy();
          status.textContent = "";
          status.className = "submission-status";
        };

        modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.submissionMode)));
        setMode(currentMode);

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          status.textContent = "";
          status.className = "submission-status";
          if (!form.checkValidity()) {
            form.reportValidity();
            return;
          }
          const data = Object.fromEntries(new FormData(form));
          const payload = {
            kind: currentMode,
            topic: data.topic,
            subject: data.subject || "",
            details: data.details || "",
            contextUrl: data.contextUrl || "",
            contact: data.contact || "",
            website: data.website || "",
          };
          if (currentMode === "cooperation") {
            payload.metadata = {
              productArea: data.productArea,
              scale: data.scale,
              assurance: data.assurance,
              settlement: data.settlement,
            };
            payload.consent = data.consent === "on";
          }
          form.setAttribute("aria-busy", "true");
          submitButton.disabled = true;
          submitLabel.textContent = "正在提交";
          try {
            const response = await fetch("/api/submissions", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
              body: JSON.stringify(payload),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "提交失败，请稍后再试");
            idOutput.textContent = result.id;
            form.hidden = true;
            success.hidden = false;
            success.querySelector("h2").focus?.();
          } catch (error) {
            status.textContent = error.message || "提交失败，请稍后再试";
            status.className = "submission-status error";
            status.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
          } finally {
            form.removeAttribute("aria-busy");
            submitButton.disabled = false;
            updateRoleCopy();
          }
        });

        success.querySelector(".submission-again").addEventListener("click", () => {
          success.hidden = true;
          form.hidden = false;
          form.reset();
          setMode(currentMode);
          form.scrollIntoView({ block: "start" });
        });
      })();
    </script>`;
  return layout("提交与合作", body, "submit", { csrfToken });
}

function alertsPage(db) {
  const count = alertCount(db);
  return layout("盯盘提醒", `${pageIntro("盯盘提醒", "共 " + count + " 条记录")}<section class="alerts" style="margin-top:0">${alertList(recentAlerts(db, 100))}</section>`, "alerts");
}

function sourcesPage(db) {
  const rows = db.prepare(
    "SELECT source, COUNT(*) snapshots, MAX(fetched_at) last_fetched, SUM(product_count) products, SUM(offer_count) offers FROM snapshots GROUP BY source ORDER BY source"
  ).all();
  const content = rows.length ? rows.map((row) => `<article class="source-row"><div class="source-name">${sourceBadge(row.source)}<strong>${esc(SOURCE_LABEL[row.source] ?? row.source)}</strong></div><div class="source-stat"><strong>${Number(row.snapshots)}</strong><span>快照</span></div><div class="source-stat"><strong>${Number(row.products)}</strong><span>产品记录</span></div><div class="source-stat"><strong>${Number(row.offers)}</strong><span>报价记录</span></div><time class="source-time">更新 ${esc(fmtTime(row.last_fetched))}</time></article>`).join("") : '<div class="empty">暂未采集到可展示数据</div>';
  const list = rows.length ? '<div class="source-list">' + content + "</div>" : content;
  return layout("数据源", `${pageIntro("数据源", "快照、产品与报价记录按来源汇总")}<section class="sources">${list}</section>`, "sources");
}

const MAX_SUBMISSION_BODY = 16 * 1024;

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function jsonResponse(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseCookies(header) {
  const cookies = {};
  for (const pair of String(header || "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
  }
  return cookies;
}

function safeTokenEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length >= 24 && timingSafeEqual(a, b);
}

function sameOrigin(req) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (!origin) return false;
  const configured = String(process.env.PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
  if (configured) return origin === configured;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function csrfCookie(req, token) {
  const configured = String(process.env.PUBLIC_ORIGIN || "").trim();
  const forwardedHttps = req.headers["x-forwarded-proto"] === "https" || /"scheme"\s*:\s*"https"/.test(String(req.headers["cf-visitor"] || ""));
  const secure = configured.startsWith("https://") || forwardedHttps;
  return `airadar_csrf=${encodeURIComponent(token)}; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

async function readSubmissionJson(req) {
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new SubmissionError(415, "提交格式不受支持");
  const declared = Number(req.headers["content-length"] || 0);
  const tooLargeError = () => {
    const error = new SubmissionError(413, "提交内容过长");
    error.closeRequest = true;
    return error;
  };
  if (Number.isFinite(declared) && declared > MAX_SUBMISSION_BODY) throw tooLargeError();
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      total += chunk.length;
      if (total > MAX_SUBMISSION_BODY) {
        req.pause();
        return fail(tooLargeError());
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new SubmissionError(400, "提交内容不是有效的 JSON"));
      }
    };
    const onError = (error) => fail(error);
    const onAborted = () => fail(new SubmissionError(400, "提交连接已中断"));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function clientAddress(req) {
  const remote = String(req.socket.remoteAddress || "unknown");
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (loopback) {
    const cloudflare = String(req.headers["cf-connecting-ip"] || "").trim();
    if (cloudflare && cloudflare.length <= 64) return cloudflare;
  }
  return remote;
}

async function handleSubmissionRequest(req, res, submissionsDb) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonResponse(res, 405, { ok: false, error: "仅支持 POST 提交" });
  }
  if (!submissionsDb) return jsonResponse(res, 503, { ok: false, error: "提交服务暂时不可用" });
  if (!sameOrigin(req) || String(req.headers["sec-fetch-site"] || "") === "cross-site") {
    return jsonResponse(res, 403, { ok: false, error: "无法验证提交来源" });
  }
  const csrfHeader = String(req.headers["x-csrf-token"] || "");
  const csrfStored = parseCookies(req.headers.cookie).airadar_csrf;
  if (!safeTokenEqual(csrfHeader, csrfStored)) {
    return jsonResponse(res, 403, { ok: false, error: "页面验证已失效，请刷新后重试" });
  }
  try {
    const payload = await readSubmissionJson(req);
    const result = createSubmission(submissionsDb, payload, { clientAddress: clientAddress(req) });
    return jsonResponse(res, 201, { ok: true, id: result.id });
  } catch (error) {
    if (error instanceof SubmissionError) {
      if (error.closeRequest) {
        res.setHeader("Connection", "close");
        res.once("finish", () => req.destroy());
      }
      return jsonResponse(res, error.status, { ok: false, error: error.message });
    }
    throw error;
  }
}

async function routeRequest(req, res, { db, submissionsDb, admin }) {
  setSecurityHeaders(res);
  const url = new URL(req.url, "http://localhost");
  if (seoRoute(req,res,url,db)) return;
  if (await admin(req, res, url)) return;
  if (url.pathname === "/api/submissions") return handleSubmissionRequest(req, res, submissionsDb);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return jsonResponse(res, 405, { ok: false, error: "该页面不接受此请求方法" });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  let html;
  if (url.pathname === "/" || url.pathname === "/index.html") html = homePage(db,url);
  else if (url.pathname === "/product") {if(!seoProduct(db,url))res.statusCode=404;html = productPage(db, url);}
  else if (url.pathname === "/alerts") html = alertsPage(db);
  else if (url.pathname === "/sources") html = sourcesPage(db);
  else if (url.pathname === "/privacy") html = layout("隐私说明",`${pageIntro("隐私与访问统计","更新于2026年9月5日")}<section class="surface" style="padding:24px"><h2>第一方访问统计</h2><p>本站为了解使用情况，统计成功的公开页面访问量及访客估算。我们在服务器内短暂使用当前Cloudflare Tunnel提供的网络地址和浏览器粗分类生成HMAC去标识摘要；不保存原始IP、完整浏览器标识、完整URL、查询参数或表单信息，也不使用追踪Cookie。去标识并不等于完全匿名。</p><p>在线去重摘要保留31天，按日汇总长期保留；每日备份最多14份，历史摘要在备份轮换完成前可能继续保留。统计只在受保护站长后台可见。共享网络可能合并计数，换网络或浏览器可能重复计数，已知机器人过滤不能保证完全准确。</p><p>后台、API、投稿页、健康检查、预取、错误响应与带管理员会话的请求不参与统计。访客估算不能等同实际人数，服务器访问量不能等同精准真人PV。</p><h2>主动投稿</h2><p>反馈和供需投稿中主动填写的信息仅供站长处理；联系方式、正文及内部处理记录不公开。请勿提交密码、API Key等敏感凭据。如需查询或删除自己主动提交的信息，请通过页脚联系方式联系站长并提供投稿编号。</p></section>`);
  else if (url.pathname === "/submit") {
    const storedToken = parseCookies(req.headers.cookie).airadar_csrf;
    const csrfToken = /^[A-Za-z0-9_-]{32}$/.test(String(storedToken || ""))
      ? storedToken
      : randomBytes(24).toString("base64url");
    res.setHeader("Set-Cookie", csrfCookie(req, csrfToken));
    html = submissionPage(url, csrfToken);
  } else if (url.pathname === "/favicon.ico") {
    res.statusCode = 204;
    return res.end();
  } else {
    res.statusCode = 404;
    html = layout("404", `${pageIntro("页面不存在", "请从总览重新选择内容")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  }
  if(res.statusCode>=400)res.setHeader("X-Robots-Tag","noindex, nofollow");
  html=decorateSeo(html,url,db,res.statusCode);
  if (req.method === "HEAD") return res.end();
  res.end(html);
}

export function createApp({ db, submissionsDb = null, analytics = null, adminOptions = {} }) {
  const admin = createAdmin({ db, submissionsDb, analytics, backupDir: process.env.SUBMISSIONS_BACKUP_DIR, ...adminOptions });
  const server = http.createServer((req, res) => {
    if(analytics)res.once("finish",()=>setImmediate(()=>{try{analytics.record(req,res.statusCode);}catch{/* Non-critical metrics must not affect requests. */}}));
    routeRequest(req, res, { db, submissionsDb, admin }).catch((error) => {
      // Admin exceptions must never include a private submission value in logs.
      if (String(req.url || "").startsWith("/admin")) console.error("[admin] internal request failure");
      else console.error("[web] 500:", error.stack || error.message);
      if (res.headersSent || res.destroyed || req.destroyed) return res.end();
      setSecurityHeaders(res);
      res.statusCode = 500;
      if (String(req.url || "").startsWith("/api/")) {
        jsonResponse(res, 500, { ok: false, error: "服务暂时出错，请稍后再试" });
      } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(layout("服务错误", `${pageIntro("服务暂时出错", "请稍后再试")}`));
      }
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  if (submissionsDb) {
    const hashCleanupTimer = setInterval(() => {
      try {
        purgeExpiredClientHashes(submissionsDb);
      } catch (error) {
        console.error("[submissions] 限流摘要定时清理失败:", error.message);
      }
    }, 60 * 60 * 1000);
    hashCleanupTimer.unref();
    server.once("close", () => clearInterval(hashCleanupTimer));
  }
  return server;
}

export function startWeb({ db, submissionsDb = null, analytics = null, host = "127.0.0.1", port = 8090 }) {
  const app = createApp({ db, submissionsDb, analytics });
  return new Promise((resolve) => {
    app.listen(port, host, () => {
      console.log("[web] http://" + host + ":" + port + "/ （公开页面与投稿接口，Ctrl+C 退出）");
      resolve(app);
    });
  });
}
