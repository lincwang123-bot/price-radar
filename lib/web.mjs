import {runtimeSponsorAsset} from './sponsor-runtime-config.mjs';
import {isGemini,GEMINI_DELIVERIES,geminiQuoteGroupHtml} from './gemini-eligibility.mjs';
import {productInsights} from './product-insights.mjs';
import {merchantFeeNoticeHtml,checkoutPriceDetailsHtml,checkoutCohortHeading} from './quote-fee-notice.mjs';
import {compareCheckoutPrices} from './checkout-price.mjs';
import {brandBuyingGuide} from './brand-buying-guides.mjs';
import {officialBaseline,baselineHtml,officialWebsiteLink} from './official-baselines.mjs';
import {PRICE_PRODUCTS,priceProduct,priceHref,priceRoute,legacyPriceRedirect,hasPriceFilters,compactPriceParams} from './price-routes.mjs';
import {englishResponse} from './english-public.mjs';
import {decorateChineseLanguage} from './public-locales.mjs';
import {englishReviewBrowsing} from './public-translation.mjs';
import {PURCHASE_STATES} from './purchase-conditions.mjs';
import {normalizeMerchantSubmission,resolveMerchantShopUrl} from './merchant-shop-url.mjs';
import { brandMark as platformMark, brandAssetRoute } from "./brand-icons.mjs";
import { WEB_CSS } from "./web-styles.mjs";
import { createMerchantApplication, approvedMerchantBadges, syncApprovedMerchantManifest, MerchantApplicationError } from './merchant-onboarding.mjs';
import { startMerchantWorkflow } from './merchant-workflow.mjs';
import { merchantSubmissionContent } from './merchant-ui.mjs';
import { merchantBadgeForOffer, MERCHANT_BADGE_CSS } from './merchant-badges.mjs';
import { buildProductDirectory, directoryQuotes, DIRECTORY_DELIVERIES } from "./product-directory.mjs";
import {createPublicDirectoryCache} from './public-directory-cache.mjs';
import {createHomeResponseCache,homeResponseRevision} from './home-response-cache.mjs';
import {createContentResponseCache} from './content-response-cache.mjs';
import {createPublicPageCache} from './public-page-cache.mjs';
import {createScrapeGuard,visitorCookieScript} from './scrape-guard.mjs';
import {createQuoteHistoryService} from './quote-history-service.mjs';
import {createPublicTraffic} from './public-traffic.mjs';
import {createCloudflareTraffic} from './cloudflare-traffic.mjs';
import {publicTrafficHtml,PUBLIC_TRAFFIC_CSS} from './public-traffic-ui.mjs';
import {publicAsset,servePublicAsset} from './public-assets.mjs';
import {tapeoutRoute} from './tapeout-app.mjs';
import { normalizeRechargeMethod } from './recharge-method.mjs';
import { DIRECTORY_CSS } from "./directory-styles.mjs";
import {contentForPath,contentPage,productBuyingNote} from './guides.mjs';
import {GUIDE_CSS} from './guide-styles.mjs';
import {adsenseConfig,adsenseRoute,decorateAdSense} from './adsense.mjs';
import {aboutContent,contactContent} from './publisher-info.mjs';
import {officialPriceContent,OFFICIAL_CSS} from './official-price-ui.mjs';
import {createRetention} from './retention.mjs';
import {createShopReviews} from './shop-reviews.mjs';
import {createShopReviewHttp} from './shop-review-http.mjs';
import {createShopReviewReplies} from './shop-review-replies.mjs';
import {shopReviewsContent} from './shop-review-ui.mjs';
import {retentionAssets,retentionDialogs,followingContent,followButton,productReference,weeklyContent,weeklyReportContent,weeklyTeaser,unsubscribeContent} from './retention-ui.mjs';
import {weeklyWeeksWithData} from './weekly-report.mjs';
import {accountAssets,accountContent,loginContent} from './account-ui.mjs';
import {safeAccountReturn} from './account-auth.mjs';
import {profileContact} from './account-profile.mjs';
import {directoryQuoteIdentity} from './product-directory.mjs';
import { offerDelivery } from './offer-spec.mjs';
// 零依赖 Node http + 服务端渲染，公开页面只写入独立的投稿数据库。
// 保持既有路由，并提供 /submit 与 /api/submissions。

import http from "node:http";
import {readFileSync} from 'node:fs';
import {createMerchantX,buildShopCatalog,shopDescriptorForOffer} from './merchant-x.mjs';
import {searchShops,normalizeShopQuery} from './shop-search.mjs';
import {shopSearchForm,shopSearchContent} from './shop-search-ui.mjs';
import {MERCHANT_X_CSS,merchantXBadge,merchantStoreLinks,merchantReviewHref,reviewCountBadge,retainedQuoteNotice,shopContent,claimContent} from './merchant-x-ui.mjs';
const merchantXScript=readFileSync(new URL('../assets/merchant-x.js',import.meta.url),'utf8');
import {sponsorPagePath} from './sponsor-tracking.mjs';
import {handleSponsorContact} from './sponsor-contact.mjs';
import {outboundHref,handleOutbound,quoteSponsorOffer,websiteSponsorOffer} from "./outbound.mjs";
import {applicationContent,claimLink,sponsoredContent} from "./commerce-ui.mjs";
import {SPONSOR_CSS,sponsorAdvertiseContent,sponsorBlock,sponsorInvite} from "./sponsor-ui.mjs";
import {sponsorEntries,sponsorItems,migrateSponsorScopes} from "./sponsor-service.mjs";
const sponsorScript=readFileSync(new URL("../assets/sponsors.js",import.meta.url),"utf8");
const sponsorArt=new Map(['amber','blue','violet','green'].map(theme=>['/assets/sponsor-'+theme+'.webp',readFileSync(new URL('../assets/sponsor-'+theme+'.webp',import.meta.url))]));
import {merchantKeyForOffer,quoteSourceLabel,quoteTimeInfo} from './offer-provenance.mjs';
import { projectProduct, productQuoteGroups, quoteAvailable } from "./quote-policy.mjs";
import { isPartialSnapshot, productLevelPoint, retentionFlags } from "./offer-history-read.mjs";
import { createAdmin } from "./admin.mjs";
import { canonicalHostRedirect, seoRoute, seoProduct, decorateSeo } from "./seo.mjs";
import { SHOP_SOURCES, publicOfferAllowed } from "./public-offers.mjs";
import { retiredCatalogItem, retiredCatalogSource } from './catalog-policy.mjs';
import { marketEntries, selectedQuote, quoteOrder, listingState, publicSpec, publicProductName, MARKET_CSS, HOME_PRICE_CSS } from "./market-view.mjs";
import { CHANNELS, normalizeChannel, offerChannel, filterChannel, FRAMEWORKS, normalizeFramework, filterFramework } from "./channels.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";

import { classifyDirectOffer, directOfferExclusionReason } from "../collectors/direct/catalog.mjs";
import { createSubmission, purgeExpiredClientHashes, SubmissionError, isSubmissionBusy } from "./submissions.mjs";
const siteStyle=publicAsset(WEB_CSS+MERCHANT_BADGE_CSS+MERCHANT_X_CSS+SPONSOR_CSS+MARKET_CSS+DIRECTORY_CSS+HOME_PRICE_CSS+GUIDE_CSS+PUBLIC_TRAFFIC_CSS,'text/css; charset=utf-8');
const directoryScript=publicAsset(readFileSync(new URL('../assets/directory.js',import.meta.url),'utf8'),'text/javascript; charset=utf-8');
const publicTrafficScript=publicAsset(readFileSync(new URL('../assets/public-traffic.js',import.meta.url),'utf8'),'text/javascript; charset=utf-8');
const quoteHistoryScript=publicAsset(readFileSync(new URL('../assets/quote-history.js',import.meta.url),'utf8'),'text/javascript; charset=utf-8');

// 人工展示映射，只用于浏览，不能视作 SKU 等价断言。
const FAMILIES = [
  { family: "ChatGPT Go", platform: "ChatGPT", direct: "chatgpt-go", official: "chatgpt-go", ldxp: null },
  { family: "ChatGPT Plus（试用/成品）", platform: "ChatGPT", direct: "chatgpt-plus", official: null, ldxp: null },
  { family: "ChatGPT Plus（正价代充）", platform: "ChatGPT", direct: "chatgpt-plus-recharge", official: "chatgpt-plus", ldxp: "chatgpt-plus-代充" },
  { family: priceProduct("chatgpt-pro-5x").name, platform: "ChatGPT", direct: "chatgpt-pro-5x", official: "chatgpt-pro-5x", ldxp: null },
  { family: priceProduct("chatgpt-pro-20x").name, platform: "ChatGPT", direct: "chatgpt-pro-20x", official: "chatgpt-pro-20x", ldxp: null },
  { family: "ChatGPT Team/Business", platform: "ChatGPT", direct: "chatgpt-team-business", official: null, ldxp: null },
  { family: "Claude Pro", platform: "Claude", direct: "claude-pro-month", official: "claude-pro", ldxp: "claude-pro-代充" },
  { family: "Claude Max（原 Max 5x）", platform: "Claude", direct: "claude-max-5x", official: "claude-max-5x", ldxp: null },
  { family: "Claude Ultra（原 Max 20x）", platform: "Claude", direct: "claude-max-20x", official: "claude-max-20x", ldxp: null },
  { family: "Gemini Plus", platform: "Gemini", direct: "gemini-pro-recharge", official: "gemini-ai-plus", ldxp: null },
  { family: "Gemini Ultra", platform: "Gemini", direct: "gemini-ultra", official: "gemini-ai-ultra", ldxp: null },
  { family: "Grok Super", platform: "Grok", direct: "super-grok", official: "grok-supergrok", ldxp: null },
  { family: "Grok Super Heavy", platform: "Grok", direct: "super-grok-heavy", official: "grok-supergrok-heavy", ldxp: null },
  { family: "X Premium", platform: "X", direct: "x-twitter-premium", official: "x-premium", ldxp: null },
];

const FAMILY_FILTERS = [
  { key: "chatgpt", label: "ChatGPT", platform: "ChatGPT" },
  { key: "claude", label: "Claude", platform: "Claude" },
  { key: "gemini", label: "Gemini", platform: "Gemini" },
  { key: "grok", label: "Grok", platform: "Grok" },
  { key: "x", label: "X", platform: "X" },
  { key: "x-subscription", label: "X 融合订阅", platform: "X 融合订阅" },
  { key: "mail", label: "邮箱", platform: null },
  { key: "muse", label: "Muse", platform: "Muse", secondary: true },
  { key: "suno", label: "Suno", platform: "Suno", secondary: true },
  { key: "cursor", label: "Cursor", platform: "Cursor", secondary: true },
  { key: "perplexity", label: "Perplexity", platform: "Perplexity", secondary: true },
  { key: "notion", label: "Notion AI", platform: "Notion AI", secondary: true },
  { key: "manus", label: "Manus", platform: "Manus", secondary: true },
  { key: "microsoft", label: "Microsoft", platform: "Microsoft", secondary: true },
  { key: "other", label: "其他", platform: null, secondary: true },
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

  "ldxp-goods": "LDXP 货源",
  "cardnav-official": "官方订阅参考",
  "direct-shops": "原始店铺直采",
};

const SOURCE_SHORT = {

  "ldxp-goods": "LDXP",
  "cardnav-official": "订阅参考",
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

    "ldxp-goods": "ldxp",
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
    "X 融合订阅": "x-subscription",
    Cursor: "cursor",
    Perplexity: "perplexity",
    "Notion AI": "notion",
    Manus: "manus",
    Microsoft: "microsoft",
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
  const prefix = currency === "CNY" ? "¥" : currency ? esc(currency) + " " : "币种待确认 ";
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

function latestProducts(db, source, channel = "all", framework = "all", options = {}) {
  const latest = db.prepare(
    "SELECT snapshot_id, fetched_at, stale FROM snapshots WHERE source = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1"
  ).get(source);
  if (!latest) return null;
  let products = db.prepare(
    `SELECT p.*, COUNT(o.offer_id) AS visible_offer_count
     FROM products p
     LEFT JOIN offers o
       ON o.source = p.source AND o.snapshot_id = p.snapshot_id AND o.product_id = p.product_id
     WHERE p.source = ? AND p.snapshot_id = ? ${options.productId?'AND p.product_id = ?':''}
     GROUP BY p.source, p.snapshot_id, p.product_id`
  ).all(source, latest.snapshot_id,...(options.productId?[options.productId]:[])).filter(p=>!retiredCatalogItem(p));
  if (SHOP_SOURCES.has(source)) products=products.flatMap(p=>{
    const offers=filterFramework(filterChannel(offersOf(db,source,latest.snapshot_id,p.product_id),channel),framework);
    if(!offers.length&&(channel!=="all"||framework!=="all"))return [];
    const projected=projectProduct(db,source,latest,p,{...options,offers,publicOnly:true});
    return [{...projected,visible_offer_count:projected.offers.length}];
  });
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
  return db.prepare("SELECT * FROM alerts ORDER BY ts DESC, id DESC LIMIT ?").all(limit);
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
  const time=quoteTimeInfo(offer);
  const channelText=`<span class="dim">${esc(offer.source==="cardnav-official"?"官方渠道":channel.label)}</span><span class="quote-time" title="${esc(time.absolute||'')}">${esc(time.relative)}${time.staleLabel?' · '+esc(time.staleLabel):''}</span>`;
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
  if (name === "warning") return svg('<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/>');
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


function updatedMeta(list) {
  if (!list) return `<span class="updated dim">尚未采集</span>`;
  const freshness = list.stale ? "部分报价待核验 · " : "";
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
  body += '<p class="note"><a href="/sources">数据说明</a> · <a href="/privacy">隐私与访问统计说明</a> · <a href="/advertise">广告合作</a></p>';
  const channel=normalizeChannel(options.channel);
  if(options.filters)body=body.replace(/href="(\/product\?[^\"]*)"/g,(_,href)=>{
    const target=new URL(href.replaceAll('&amp;','&'),'http://localhost');
    for(const key of ['family','channel','q','purpose','framework','spec'])if(options.filters[key]&&options.filters[key]!=='all'&&!target.searchParams.has(key))target.searchParams.set(key,options.filters[key]);
    return 'href="'+esc(target.pathname+target.search+target.hash)+'"';
  });
  const nav = (href, key, label) => {
    const current = active === key ? ' aria-current="page"' : "";
    const selected = active === key ? " active" : "";
    return `<a href="${href}" class="nav-link${selected}"${current}>${label}</a>`;
  };
  const categoryFilters = FAMILY_FILTERS;
  const categoryLink = ({key,label,platform})=>{
    const params=new URLSearchParams({family:key});
    const selected=key===(options.filters?.family||'all');
    return '<a href="/?'+esc(params.toString())+'" class="product-filter'+(selected?' active':'')+'" data-family-filter="'+key+'" aria-current="'+(selected?'page':'false')+'"><span class="product-filter-mark mark-'+key+'" aria-hidden="true">'+platformMark(platform||key)+'</span><span>'+label+'</span></a>';
  };
  const secondaryActive=categoryFilters.some(f=>f.secondary&&f.key===options.filters?.family);
  const categoryRail = '<nav class="product-nav" aria-label="产品分类"><div class="product-nav-inner">'+categoryFilters.filter(f=>!f.secondary).map(categoryLink).join('')+'<details class="category-more'+(secondaryActive?' active':'')+'"><summary>更多</summary><div class="category-more-menu">'+categoryFilters.filter(f=>f.secondary).map(categoryLink).join('')+'</div></details></div></nav>';
  const analyticsScript = options.privateAccount ? '' : cloudflareWebAnalytics();
  const categoryScript = '';
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
          destination.textContent = new URL(link.dataset.outboundTarget || link.href).hostname.replace(/^www\\./, "") || "第三方页面";
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
        if (!link) return;
        if (shouldSkip()) {const target=new URL(link.href);if(target.pathname==='/go'){target.searchParams.set('ack','1');link.href=target.href;}return;}
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
        const targetUrl=new URL(link.href);if(targetUrl.pathname==='/go')targetUrl.searchParams.set('ack','1');
        const href = targetUrl.href;
        const target = link.getAttribute("target") || "_blank";
        close(false);
        window.open(href, target, "noopener,noreferrer");
      });
    })();
  </script>`;
  const friendLinks = options.showFriendLinks ? '<nav class="footer-actions" aria-label="友情链接"><span>友情链接：</span><a href="https://www.ztsite.com/" target="_blank" rel="noopener noreferrer">ZT折腾簿</a></nav>' : "";
  const headExtra = options.csrfToken ? `<meta name="csrf-token" content="${esc(options.csrfToken)}"/>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="theme-color" content="#ffffff"/>
  ${headExtra}${retentionAssets}${accountAssets}
  <title>${esc(title)} · AI 订阅价格雷达</title>
  <link rel="icon" type="image/png" sizes="512x512" href="/assets/brands/airadar.png"><link rel="stylesheet" href="/assets/site.css?v=${siteStyle.hash}">${active==='official'?'<style>'+OFFICIAL_CSS+'</style>':''}${analyticsScript}
</head>
<body>
  <header class="app-header"><div class="header-inner"><div class="header-main">
    <a class="brand" href="/" aria-label="AI 订阅价格雷达首页">${radarMark()}<span class="brand-text">AI 订阅价格雷达</span></a>
    <nav class="app-nav" aria-label="主导航">${nav("/", "home", "总览")}${nav("/official-prices", "official", "官方地区价")}${nav("/following", "following", "我的 AI 订阅")}${nav("/weekly", "weekly", "行情周报")}${nav("/guides", "guides", "订阅指南")}${nav("/alerts", "alerts", "价格提醒")}${nav("/submit", "submit", "反馈与合作")}${nav("/submit-shop", "merchant", "商家入驻").replace('class="nav-link', 'class="nav-link nav-merchant-cta')}<a class="nav-link" data-reader-nav href="/login">登录 / 注册</a></nav>
    <div class="header-tools" aria-label="站长联系方式与项目链接"><a class="header-contact" href="https://x.com/superwang" target="_blank" rel="noopener noreferrer" aria-label="在 X 联系站长 @superwang"><span class="header-contact-kind">X</span><span class="header-contact-handle">@superwang</span></a><a class="header-contact" href="https://t.me/lincwang" target="_blank" rel="noopener noreferrer" aria-label="在 Telegram 联系站长 @lincwang"><span class="header-contact-kind">TG</span><span class="header-contact-handle">@lincwang</span></a><a class="header-contact header-github" href="https://github.com/lincwang123-bot/price-radar" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看 AI 订阅价格雷达项目" title="在 GitHub 查看项目">${icon("github")}</a></div>
  </div></div><div class="community-strip" role="region" aria-label="用户交流群"><a class="community-strip-link" href="https://t.me/+CP4mPaateJliZGI0" target="_blank" rel="noopener noreferrer">现已开放网站交流群 · 点击加入 →</a></div>${categoryRail}</header>
  <main class="wrap">${body}</main>
  <footer class="site-footer" id="site-disclaimer"><div class="footer-inner"><div><p class="footer-disclaimer">本站仅提供公开数据的汇总展示；价格、库存、服务内容及交易结果以原站实际页面为准，本站不对第三方信息的准确性、完整性或由此产生的交易结果承担责任。品牌标识仅用于产品识别，不代表官方合作。</p><nav class="footer-actions" aria-label="数据反馈与合作"><a href="/weekly">行情周报</a><a href="/about">关于本站</a><a href="/contact">联系</a><a href="https://t.me/+CP4mPaateJliZGI0" target="_blank" rel="noopener noreferrer">加入交流群</a><a href="/privacy">隐私说明</a><a href="/help">帮助中心</a><a href="/guides">订阅指南</a><a href="/tapeout/">AI费用助手</a><a href="/submit-shop">提交店铺</a><a href="/claim-shop?new=1">店主认领 X</a><a href="/submit?type=feedback">数据反馈</a><a href="/submit?type=cooperation">供需提交</a></nav>${friendLinks}</div><div class="footer-contact" aria-label="联系站长"><span class="footer-contact-label">联系站长</span><span class="footer-contact-links"><a class="footer-contact-link" href="mailto:hello@airadar.vip" aria-label="发送邮件至 hello@airadar.vip"><b>邮箱</b>hello@airadar.vip</a><a class="footer-contact-link" href="https://x.com/superwang" target="_blank" rel="noopener noreferrer" aria-label="在 X 联系站长 @superwang"><b>X</b>@superwang</a><a class="footer-contact-link" href="https://t.me/lincwang" target="_blank" rel="noopener noreferrer" aria-label="在 Telegram 联系站长 @lincwang"><b>TG</b>@lincwang</a></span></div></div></footer>${storeRiskModal}${categoryScript}${storeRiskScript}
${retentionDialogs()}${visitorCookieScript()}</body>
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

function overviewContent(db, direct, cardnav, ldxp) {
  const entries = OVERVIEW_FAMILIES.map((summary) => {
    const family = FAMILIES.find((candidate) => candidate.family === summary.family);
    const official = family ? priced(db, cardnav, family.official) : null;
    const directOffer = family ? priced(db, direct, family.direct) : null;
    const supplier = family ? priced(db, ldxp, family.ldxp) : null;
    const linked = directOffer ?? official ?? supplier;
    const updatedList = directOffer ? direct : (official ? cardnav : (supplier ? ldxp : null));
    const sourceCount = [official, directOffer, supplier].filter(Boolean).length;
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

function familyContent(db, direct, cardnav, ldxp) {
  const items = FAMILIES.map((family) => ({
    family,
    official: priced(db, cardnav, family.official),
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
      <td class="num">${priceStack(item.official)}</td><td class="num">${priceStack(item.direct)}</td><td class="num">${priceStack(item.supplier)}</td>
    </tr>`).join("");
    return `<tr class="table-group-row tone-${group.tone}" data-family="${group.tone}"><th colspan="5" scope="rowgroup"><span class="group-mark" aria-hidden="true"></span><span class="group-title">${esc(group.platform)}</span><span class="group-count">${group.items.length} 个产品</span></th></tr>${rows}`;
  }).join("");
  const mobile = `<div class="family-groups">${groups.map((group, index) => {
    const cards = group.items.map((item) => `<article class="family-card"><div class="family-head"><strong>${esc(item.family.family)}</strong><span>${esc(item.family.platform)}</span></div>${mobilePriceLine("官方区最低", item.official)}${mobilePriceLine("原店直采最低", item.direct)}${mobilePriceLine("LDXP 货源最低", item.supplier)}</article>`).join("");
    return `<details class="family-group tone-${group.tone}" id="family-mobile-${index + 1}" data-family="${group.tone}"${index === 0 ? " open" : ""}><summary class="group-summary"><span class="group-summary-copy"><span class="group-mark" aria-hidden="true"></span><strong>${esc(group.platform)}</strong><span class="group-count">${group.items.length} 个产品</span></span><span class="group-chevron" aria-hidden="true">${icon("chevron")}</span></summary><div class="family-group-body">${cards}</div></details>`;
  }).join("")}</div>`;
  return { desktop, mobile };
}

function sourceProductGroups(list, products) {
  if (list.source === "ldxp-goods") return [{ label: "关键词检索结果", tone: "other", items: products }];
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
  const order = ["ChatGPT", "Claude", "Gemini", "Grok", "X", "Muse", "Cursor", "Perplexity", "Notion AI", "Manus", "Microsoft", "其他", "邮箱"];
  return groups.sort((a, b) => {
    const aIndex = order.indexOf(a.label);
    const bIndex = order.indexOf(b.label);
    const aRank = aIndex === -1 ? order.length : aIndex;
    const bRank = bIndex === -1 ? order.length : bIndex;
    return aRank - bRank || a.label.localeCompare(b.label, "zh-CN");
  });
}

function sourceProducts(list) {
  if (!list) return `<div class="empty">暂未收录可展示数据</div>`;
  const products = [...list.products]
    .filter((product) => product.lowest_price != null && Number(product.lowest_price) > 0)
    .sort((a, b) => (a.platform ?? "").localeCompare(b.platform ?? "") || Number(a.lowest_price) - Number(b.lowest_price));
  if (!products.length) return `<div class="empty">暂未收录可展示数据</div>`;
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
  return `<section class="surface" data-catalog-section><div class="head"><div style="display:flex;align-items:center;gap:9px;min-width:0">${sourceBadge(list?.source ?? "neutral")}<div><h2>${esc(label)}</h2><p class="note" data-catalog-count>${count} 个产品 · 当前记录</p></div></div>${updatedMeta(list)}</div>${sourceProducts(list)}</section>`;
}

function alertList(rows) {
  rows=rows.filter(row=>!retiredCatalogItem(row));
  if (!rows.length) return `<div class="empty">暂无提醒</div>`;
  const markup = rows.map((alert) => {
    const [label, tone] = ALERT_TYPE[alert.kind ?? alert.rule_id] ?? [alert.kind ?? alert.rule_id ?? "提醒", ""];
    const product = esc(alert.product_name || alert.product_id || "未命名产品");
    const productHtml = alert.source && alert.product_id
      ? '<a class="alert-product" href="' + productHref(alert.source, alert.product_id) + (alert.group_id?'&amp;spec='+encodeURIComponent(alert.group_id):'') + '">' + product + "</a>"
      : '<span class="alert-product">' + product + "</span>";
    const badge = "";
    return `<article class="alert ${tone}"><span class="alert-rail" aria-hidden="true"></span><div class="alert-copy"><div class="alert-top"><span class="alert-type ${tone}">${esc(label)}</span>${productHtml}${badge}</div><div class="alert-message">${esc(alert.message ?? "")}</div></div><time class="alert-time">${esc(fmtTime(alert.ts))}</time></article>`;
  }).join("");
  return `<div class="alerts-list">${markup}</div>`;
}

function marketCatalog(entries,title,{business=false}={}) {
  if(!entries.length)return "";
  const groups=new Map();for(const e of entries){const platform=e.list.source==="ldxp-goods"?"关键词产品":e.product.platform||"其他";if(!groups.has(platform))groups.set(platform,[]);groups.get(platform).push(e);}
  const action=e=>'<a class="quote-action catalog-action" href="'+productHref(e.list.source,e.product.product_id)+(e.product.comparison_key?'&amp;spec='+encodeURIComponent(e.product.comparison_key):'')+'" aria-label="查看 '+esc(publicProductName(e.product))+' 报价详情">查看报价 '+icon("chevron")+'</a>'+((e.alternatives||[]).length?'<details class="more-quotes"><summary>更多报价</summary>'+e.alternatives.map(a=>'<a href="'+productHref(a.list.source,a.product.product_id)+'">'+esc(publicProductName(a.product))+' · '+fmtPrice(a.offer.price,a.product.currency)+' · '+esc(a.offer.store_name||"店铺")+'</a>').join("")+'</details>':"");
  const display=e=>({name:publicProductName(e.product),spec:e.product.comparison_label||publicSpec(e.product.spec)||e.product.product_type||"规格待确认",price:e.product.lowest_price,store:e.offer?.store_name||"",provenance:quoteSourceLabel(e.offer||{source:e.list.source}),freshness:quoteTimeInfo(e.offer||{captured_at:e.list.fetchedAt}).relative,state:business?(e.list.source==="cardnav-official"?"官方参考":"服务套餐"):listingState(e.offer,e.list.stale),platform:business?(e.list.source==="cardnav-official"?"官方渠道":"服务商"):(e.channel?.label||"未确认渠道"),time:quoteTimeInfo(e.offer||{captured_at:e.list.fetchedAt}).absolute||e.list.fetchedAt});
  const body=[...groups].map(([platform,items])=>{const tone=platform==="关键词产品"?"other":platformTone(platform);
    const desktop=items.map(e=>{const d=display(e);return '<tr><td><div class="catalog-name"><strong>'+esc(d.name)+'</strong><span class="market-spec" title="'+esc(d.spec)+'">'+esc(d.spec)+'</span></div></td><td class="num"><span class="money">'+fmtPrice(d.price,e.product.currency)+'</span><small class="market-store">'+esc(d.store)+'</small><small class="quote-provenance">'+esc(d.provenance)+'</small></td><td><span class="stock '+(["在售","库存紧张"].includes(d.state)?"available":"neutral")+'">'+esc(d.state)+'</span><small class="market-time">'+esc(d.freshness)+' · '+esc(fmtTime(d.time))+'</small></td><td>'+esc(d.platform)+'</td><td>'+action(e)+'</td></tr>';}).join("");
    const mobile=items.map(e=>{const d=display(e);return '<article class="catalog-card"><div class="card-name">'+esc(d.name)+'</div><div class="market-spec" title="'+esc(d.spec)+'">'+esc(d.spec)+'</div><div class="market-card-price"><div><small>参考起价</small><div class="card-price">'+fmtPrice(d.price,e.product.currency)+'</div><small>'+esc(d.store)+'</small><small class="quote-provenance">'+esc(d.provenance)+'</small></div><div class="market-card-status"><span class="stock '+(["在售","库存紧张"].includes(d.state)?"available":"neutral")+'">'+esc(d.state)+'</span><span>'+esc(d.platform)+'</span></div></div><div class="card-bottom"><span class="dim">'+esc(d.freshness)+' · '+esc(fmtTime(d.time))+'</span>'+action(e)+'</div></article>';}).join("");
    return '<div data-family="'+tone+'" data-catalog-group data-product-count="'+items.length+'"><div class="market-group-title"><strong>'+esc(platform)+'</strong><span>'+items.length+' 个产品</span></div><div class="table-scroll desktop"><table class="catalog-table market-table"><thead><tr><th>产品 / 规格</th><th class="num">参考起价</th><th>在售状态 / 时间</th><th>交易平台</th><th>报价</th></tr></thead><tbody>'+desktop+'</tbody></table></div><div class="mobile"><div class="catalog-groups">'+mobile+'</div></div></div>';}).join("");
  return '<section class="surface market-section" data-catalog-section><div class="head"><h2>'+esc(title)+'</h2><p class="note" data-catalog-count>'+entries.length+' 个产品</p></div>'+body+'</section>';
}
const PURPOSES=[['all','全部用途'],['recharge','订阅代充'],['account','成品账号'],['shared','共享 / 合租'],['code','兑换码 / 卡密'],['other','其他 / 待确认']];
function filtersOf(url){const requested=url.searchParams.get('family');const family=['verify','otp'].includes(requested)?'mail':requested;return {family:FAMILY_FILTERS.some(f=>f.key===family)?family:'all',channel:normalizeChannel(url.searchParams.get('channel')),framework:normalizeFramework(url.searchParams.get('framework')),q:String(url.searchParams.get('q')||'').trim().slice(0,100),purpose:PURPOSES.some(([id])=>id===url.searchParams.get('purpose'))?url.searchParams.get('purpose'):'all'};}
function purposeOf(product){const text=[product.name,product.product_type,product.selected_offer?.title].join(' ');if(/共享|合租|拼车/.test(text))return 'shared';if(/代充|直充|直冲/.test(text))return 'recharge';if(/成品|账号/.test(text))return 'account';if(/卡密|兑换|CDK/i.test(text))return 'code';return 'other';}
function directoryHref(state, changes={}) {
  let params=new URLSearchParams();
  for(const [key,value] of Object.entries({...state,...changes})) if(['family','product','sort','channel','spec','currency','page','delivery','recharge','purchase','pricing','pricing_type','eligibility'].includes(key)&&value!=null&&value!=='')params.set(key,String(value));
  params=compactPriceParams(params);
  const product=priceProduct(params.get('product'));
  if(product&&product.family===params.get('family')){params.delete('family');params.delete('product');return product.path+(params.size?'?'+esc(params.toString()):'');}
  return '/?'+esc(params.toString());
}
function directoryCount(result,referenceCount,{compact=false}={}) {
  const natural=result.total-referenceCount;
  if(!natural)return referenceCount?referenceCount+' 条参考报价':'暂无有效报价';
  return (result.unresolvedQuoteCount?'':result.shopCount+' 家店 · ')+natural+(compact?' 条报价':' 条店铺报价')+(referenceCount?' · '+referenceCount+' 条参考报价':'');
}
function directoryMinimumHtml(result) {
  // directoryQuotes has already enforced current quote health, inventory,
  // warranty exclusions and valid merchant links. Its ascending order keeps
  // currencies separate (CNY first); never compare amounts across currencies.
  // Match the linked detail's default price order. An incomplete specification
  // needs a warning, not a silently higher homepage price. This observed
  // starting price is separate from same-spec minima and alert eligibility.
  const entry=result.entries.find(entry=>!entry.reference&&!entry.offer.quote_stale);
  if(!entry)return '<span class="directory-minimum-empty">条件待确认 · 查看报价</span>';
  const {offer,product}=entry;
  const unconfirmed=offer.comparison_eligible===false||offer.comparison_known===false;
  const fullSpec=entry.gemini?[entry.gemini.review?.plan||product.name||'套餐待核验',subscriptionTermLabel(offer.purchase_conditions?.subscriptionTerm),entry.gemini.delivery.label,entry.gemini.eligibility.label].join(' · '):offer.comparison_label||product.comparison_label||publicSpec(product.spec)||'规格待确认';
  // Include the edition/eligibility segment (e.g. 教育优惠), especially when
  // the quote is not comparable with a regular subscription.
  const shortSpec=fullSpec.split(' · ').slice(0,3).join(' · ');
  const moreCurrencies=result.entries.some(e=>!e.reference&&!e.offer.quote_stale&&(e.offer.currency||e.product.currency)!==(offer.currency||product.currency));
  return '<div class="directory-minimum"><span class="directory-minimum-price" data-directory-minimum>'+fmtPrice(offer.price,offer.currency||product.currency)+' <small>起</small></span>'+checkoutPriceDetailsHtml(offer,{compact:true})+'<span class="directory-minimum-spec" title="'+esc(fullSpec)+'">'+esc(shortSpec)+'</span>'+(unconfirmed?'<span class="note">'+(offer.checkout_status==='verified'?'购买条件待确认':'商家标价 · 条件待确认')+'</span>':'')+(moreCurrencies?'<span class="note">另有其他币种</span>':'')+'</div>';
}
function directoryDeliveryLinks(product, family, quotes) {
  const render = group => {
    const result=directoryQuotes(product,{delivery:group.kind,pricing_type:'regular',baseResult:quotes});
    const price=['recharge','account','shared','seat'].includes(group.kind)?directoryMinimumHtml(result):'<span class="directory-delivery-count">'+group.count+' 条报价 · 查看</span>';
    const slot=['recharge','account'].includes(group.kind)?' data-delivery-slot="'+group.kind+'"':'';
    return '<a class="directory-delivery-card" data-delivery-link="'+group.kind+'"'+slot+' href="'+directoryHref({family,product:product.key,delivery:group.kind})+'"><span class="directory-delivery-label">'+esc(group.label)+'</span>'+price+'<span class="directory-delivery-cta">查看店铺 ›</span></a>';
  };
  const primary=(isGemini(product)?GEMINI_DELIVERIES.filter(g=>['recharge','account'].includes(g.kind)).map(g=>[g.kind,g.label]):[['recharge','代充'],['account','成品号']]).map(([kind,label])=>{
    const group=quotes.deliveries.find(group=>group.kind===kind);
    return group?render(group):'<div class="directory-delivery-card directory-delivery-placeholder" data-delivery-slot="'+kind+'"><span class="directory-delivery-label">'+label+'</span><span class="directory-minimum-empty">暂无报价</span></div>';
  });
  const other=quotes.deliveries.filter(group=>!['recharge','account'].includes(group.kind));
  return '<div class="directory-delivery-links">'+primary.join('')+(other.length?'<details class="directory-delivery-more"><summary>其他交付 · '+other.reduce((n,g)=>n+g.count,0)+' 条</summary><div>'+other.map(render).join('')+'</div></details>':'')+'</div>';
}

function subscriptionTermLabel(term) {
  if(term==='ambiguous')return '待确认';
  if(term==='unknown'||term==null||term==='')return '未注明';
  const period=/^([1-9]\d*)([md])$/.exec(term);
  return period?period[1]+(period[2]==='m'?' 个月':' 天'):'待确认';
}
function directoryQuoteRow(entry, merchantBadges = [], xProfiles = [], reviewCounts = new Map()) {
  const {list,product,offer,channel,reference}=entry;
  const target=safeUrl(offer.url),href=target&&list.source!=='cardnav-official'&&(offer.quote_retained?target:quoteAvailable(list.source,offer)&&outboundHref(offer,{source:list.source,product_id:product.product_id}));
  const fullSpec=offer.comparison_known===false?offer.comparison_label||'规格待确认':offer.comparison_label||product.comparison_label||publicSpec(product.spec)||'规格待确认';
  const deliveryWords=['代充','成品账号','成品号','共享','共享或合租','席位','卡密','卡密（用途待确认）','交付未注明','交付待确认'];
  const spec=entry.gemini&&!reference?[entry.gemini.review?.plan||product.name||'套餐待核验',subscriptionTermLabel(offer.purchase_conditions?.subscriptionTerm)].join(' · '):entry.showDelivery&&!reference?fullSpec.split(' · ').filter(part=>!deliveryWords.includes(part)).join(' · ')||'规格待确认':fullSpec;
  const label=reference?'官方参考':channel?.label||'未确认渠道';
  const history=productHref(list.source,product.product_id)+(!reference&&offer.comparison_key?'&amp;spec='+encodeURIComponent(offer.comparison_key):'');
  const reviewHref=!reference&&merchantReviewHref({...offer,source:list.source});
  const reviewShop=reviewHref&&shopDescriptorForOffer({...offer,source:list.source});
  const conditions=offer.purchase_conditions;
  const conditionHtml=conditions?'<div class="quote-conditions" data-quote-quality="'+conditions.quality+'"><strong>'+({A:'规格明确',B:'有限制条件',C:'信息待确认'}[conditions.quality])+'</strong><span>'+esc(({new:'新开订阅',renewal:'续费订阅',both:'新开续费均可',unknown:entry.delivery?.kind==='recharge'?'新开 / 续费未注明':'按商品标注交付'}[conditions.accountState]))+'</span>'+(conditions.reasons.length?'<p>'+esc(conditions.reasons.join('；'))+'</p>':'')+'<details><summary>购买条件与来源</summary><p>订阅期限：'+esc(subscriptionTermLabel(conditions.subscriptionTerm))+'；兑换有效期：'+esc(conditions.redemptionWindow||'未注明')+'；商家质保：'+esc(conditions.warrantyWindow||'未注明')+'。</p>'+(conditions.restrictions.length?'<p>'+esc(conditions.restrictions.join('；'))+'</p>':'')+'<p>'+esc(quoteSourceLabel(offer))+' · 根据公开商品声明整理，非平台商品真实性验证。'+(conditions.quality==='C'?'不参与同规格最低价。':'')+'</p></details></div>':'';
  const reviewAction=reviewHref?'<a class="directory-review-button" href="'+esc(reviewHref)+'" title="查看或撰写该店铺的评价">'+icon('message')+'<span>查看评价</span>'+reviewCountBadge(reviewCounts.get(reviewShop.id))+'</a>':'';
  return '<article class="directory-quote" data-delivery="'+esc(entry.delivery?.conflict?'unknown':entry.delivery?.kind||'unknown')+'" data-in-stock="'+String(!reference&&quoteAvailable(list.source,offer))+'" data-directory-quote data-price="'+esc(offer.price)+'" data-currency="'+esc(offer.currency||product.currency)+'"><div class="directory-quote-main"><h2>'+esc(offer.store_name|| (reference?label:'店铺信息待确认'))+(!reference?merchantBadgeForOffer({...offer,source:list.source},merchantBadges)+merchantXBadge({...offer,source:list.source},xProfiles):'')+'</h2>'+(!reference?merchantStoreLinks({...offer,source:list.source},{showShop:false}):'')+'<p class="directory-quote-spec">'+(entry.showDelivery&&!reference?'<strong class="quote-delivery">'+esc(entry.delivery.label+(entry.delivery.conflict?'（描述有冲突）':''))+'</strong> · ':'')+esc(spec)+'</p>'+(offer.title&&offer.title!==spec?'<p class="directory-quote-title">'+esc(offer.title)+'</p>':'')+(entry.gemini&&!reference?'<div class="gemini-classification"><p>订阅资格：'+esc(entry.gemini.eligibility.label)+' · 交付核验：'+esc(entry.gemini.delivery.status==='confirmed'?'已核验':'待核验')+' · 资格核验：'+esc(entry.gemini.eligibility.status==='confirmed'?'已核验':'待核验')+'</p><details><summary>分类核验依据</summary>'+[entry.gemini.delivery,entry.gemini.eligibility].map(d=>'<p>'+esc(d.label)+'：'+esc(d.basis||'缺少明确依据，待人工核验')+(d.verifiedAt?' · '+esc(d.verifiedAt):'')+'</p>').join('')+'</details></div>':'')+conditionHtml+retainedQuoteNotice(offer)+'<p class="directory-quote-meta">'+esc(label)+' · '+esc(reference?'参考报价':listingState(offer,list.stale))+' · 报价时间 '+esc(fmtTime(quoteTimeInfo(offer).absolute))+'</p></div><div class="directory-quote-buy"><span class="money">'+fmtPrice(offer.price,offer.currency||product.currency)+'</span>'+(!reference?checkoutPriceDetailsHtml(offer):'')+(reference?(officialWebsiteLink(product.product_id,{className:'offer-shop-button'})+'<span class="note">仅作价格参考</span>'):href?'<a class="offer-shop-button" data-store-risk data-outbound-target="'+target+'" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+(reference?'查看原站':'前往店铺')+' '+icon('external')+'</a>':'<span class="note">'+(reference?'仅作价格参考':'暂无店铺链接')+'</span>')+reviewAction+'<a class="directory-history" href="'+history+'">价格记录</a></div></article>';
}
function directoryQuotePage(category,selected,url,{db,analytics,req,res,merchantBadges=[],xProfiles=[],reviews,locale='zh'}={}) {
  const initial=directoryQuotes(selected,{channel:normalizeChannel(url.searchParams.get('channel')),currency:url.searchParams.get('currency')||'',pricing_type:'all'});
  const requestedDelivery=url.searchParams.get('delivery');
  const specDelivery=initial.entries.find(entry=>!entry.reference&&entry.offer.comparison_key===url.searchParams.get('spec'))?.delivery.kind;
  const activeDelivery=selected.deliveryEnabled ? ((isGemini(selected)?GEMINI_DELIVERIES:DIRECTORY_DELIVERIES).some(group=>group.kind===requestedDelivery)?requestedDelivery:specDelivery||'all') : '';
  const requestedPricingType=url.searchParams.get('pricing_type'); const activePricingType=['promo','all','regular'].includes(requestedPricingType)?requestedPricingType:'regular';
  const state={...(isGemini(selected)?{eligibility:initial.eligibilities.some(group=>group.kind===url.searchParams.get('eligibility'))?url.searchParams.get('eligibility'):'all'}:{}),family:category.key,product:selected.key,pricing:url.searchParams.get('pricing')==='checkout'?'checkout':'listed',pricing_type:activePricingType,delivery:activeDelivery,purchase:url.searchParams.get('purchase')||'all',recharge:activeDelivery==='recharge'?normalizeRechargeMethod(url.searchParams.get('recharge')):'',sort:['desc','price_desc'].includes(url.searchParams.get('sort'))?'price_desc':url.searchParams.get('sort')==='comprehensive'?'comprehensive':'price_asc',channel:normalizeChannel(url.searchParams.get('channel')),spec:url.searchParams.get('spec')||'',currency:url.searchParams.get('currency')||''};
  const href=(changes={},anchor='quote-filters')=>directoryHref(state,changes)+'#'+anchor;
  const result=directoryQuotes(selected,{...state,merchantBadges,xProfiles,baseResult:initial}),shops=result.entries.filter(entry=>!entry.reference),references=result.entries.filter(entry=>entry.reference);
  const displayRows=isGemini(selected)?result.displayRows.filter(row=>!row.entry.reference):shops.map(entry=>({entry,members:[entry]}));
  const pageSize=10,pageCount=Math.max(1,Math.ceil(displayRows.length/pageSize)),page=Math.min(requestedPage(url.searchParams.get('page')),pageCount);
  const shownRows=displayRows.slice((page-1)*pageSize,page*pageSize),shown=shownRows.flatMap(row=>row.members);
  const reviewCounts=reviews?.publicCounts(shown.map(entry=>shopDescriptorForOffer({...entry.offer,source:entry.list.source})?.id))||new Map();
  const choice=(key,value,label)=>'<a class="spec-choice"'+(key==='delivery'?' data-delivery-choice="'+value+'"':'')+' aria-current="'+(state[key]===value)+'" href="'+href({[key]:value,...(['delivery','purchase','eligibility'].includes(key)?{spec:'',page:'',...(key==='delivery'?{purchase:'all',recharge:''}:{})}:{})})+'">'+esc(label)+'</a>';
  const deliveryControls=selected.deliveryEnabled&&initial.deliveries.length?'<nav class="spec-selector delivery-selector" aria-label="交付方式"><span class="spec-selector-label">'+(isGemini(selected)?'交付方式':'购买方式')+'</span>'+choice('delivery','all','还不确定')+initial.deliveries.map(group=>'<a class="spec-choice" data-delivery-choice="'+group.kind+'" aria-current="'+(state.delivery===group.kind)+'" href="'+href({delivery:group.kind,recharge:'',purchase:'all',spec:'',page:''})+'">'+esc((isGemini(selected)?group.label:({recharge:'给自己的账号充值',account:'买一个新账号',shared:'共享账号',code:'卡密 / 兑换'}[group.kind]))||group.label)+' · '+group.count+'</a>').join('')+'</nav>':'';
  // Keep the buying choice short. Full SKU conditions stay on quote rows;
  // missing evidence must not silently become an "other" classification.
  const rechargeControls=!isGemini(selected)&&selected.deliveryEnabled&&['all','recharge'].includes(activeDelivery)&&initial.deliveries.some(group=>group.kind==='recharge')?'<section class="recharge-filter" aria-label="充值类型"><span class="spec-selector-label">充值类型</span><nav class="recharge-options" aria-label="充值渠道">'+[['all','全部'],['ios','iOS'],['other','其他地区']].map(([kind,label])=>'<a class="spec-choice" data-recharge-choice="'+kind+'" aria-current="'+((state.recharge||'all')===kind)+'" href="'+href({delivery:kind==='all'?activeDelivery:'recharge',recharge:kind,spec:'',page:''})+'">'+label+'</a>').join('')+'</nav>'+(state.recharge==='unknown'?'<p class="note">当前为旧链接中的待确认报价，点击「全部」可取消筛选。</p>':'')+'</section>':'';
  const sortLabel=state.sort==='comprehensive'?'条件明确优先':state.sort==='price_desc'?'价格从高到低':'价格从低到高';
  const pricingTypeControls='<nav class="spec-selector pricing-type-selector" aria-label="价格类型"><span class="spec-selector-label">价格类型</span>'+result.pricingTypes.map(group=>'<a class="spec-choice" data-pricing-type-choice="'+group.kind+'" aria-current="'+(state.pricing_type===group.kind)+'" href="'+href({pricing_type:group.kind==='regular'?'':group.kind,page:''})+'">'+esc(group.label)+' · '+group.count+'</a>').join('')+'</nav>'+(state.pricing_type==='regular'?'<p class="note" data-pricing-type-note>默认仅展示正价与未标明优惠的报价；半价、资格号、试用等请切换到「优惠 / 半价」。</p>':state.pricing_type==='promo'?'<p class="note" data-pricing-type-note>仅展示标题写明半价、资格号、试用、特价等优惠的报价。</p>':'');
  const pricingControls='<nav class="quote-sort-options quote-pricing-options" aria-label="比较价格">'+[['listed','按标价（全部）'],['checkout','按含手续费价（仅已确认）']].map(([value,label])=>'<a class="quote-sort-choice" data-pricing-choice="'+value+'" aria-current="'+(state.pricing===value)+'" href="'+href({pricing:value==='checkout'?value:'',page:''},'quote-results')+'">'+label+'</a>').join('')+'</nav>';
  const pricingNote=state.pricing==='checkout'?'<p class="note" data-pricing-note><span>手续费未确认，未参与含手续费价比较：</span><strong data-checkout-excluded>'+result.checkoutExcludedCount+'</strong> · <a href="'+href({pricing:'',page:''},'quote-results')+'">切回全部标价</a></p>':'<p class="note" data-pricing-note><span>默认比较全部商品标价，不因是否查到手续费改变先后。</span> <span>已确认手续费：</span><strong data-checkout-available>'+result.checkoutAvailableCount+'</strong></p>';
  const sortControls='<div class="quote-sort"><nav class="quote-sort-options" aria-label="报价排序">'+[['price_asc','价格从低到高'],['price_desc','价格从高到低'],['comprehensive','条件明确优先']].map(([value,label])=>'<a class="quote-sort-choice" data-sort-choice="'+value+'" aria-current="'+(state.sort===value)+'" href="'+href({sort:value,page:''},'quote-results')+'">'+esc(label)+'</a>').join('')+'</nav></div>';
  const comparisonNote='<details class="directory-comparison-note"><summary>比较说明</summary><p class="quote-sort-note">'+(state.sort==='comprehensive'?'先展示购买条件较完整的报价，同类按价格从低到高；X 关联、收录和推广不改变自然排名。':'按当前筛选条件，'+sortLabel+'。条件待确认的报价仍展示，请先核对适用条件；不同期限的总价不可直接比较。')+'</p><p>默认按商品标价比较全部报价；选择含手续费价时，仅比较有手续费数据的报价。不同支付方式的手续费可能不同，请查看手续费明细。</p>'+(rechargeControls?'<p class="recharge-note">按商家标注区分充值方式，不代表设备使用限制。未注明的报价请在「全部」中查看。</p>':'')+'</details>';
  const purchaseControls=activeDelivery==='recharge'?'<nav class="spec-selector" aria-label="账号购买状态"><span class="spec-selector-label">新开 / 续费（可选）</span>'+PURCHASE_STATES.map(item=>choice('purchase',item.key,item.label)).join('')+'</nav>':'';
  const comparable=shops.filter(e=>!e.offer.quote_stale&&e.offer.comparison_known&&e.offer.comparison_eligible!==false);
  const lowest=state.spec&&comparable.length?[...comparable].sort((a,b)=>compareCheckoutPrices(a.offer,b.offer))[0]:null;
  const decision=lowest?'<aside class="buying-result" data-comparable-summary><strong>当前同规格已记录起价 '+fmtPrice(lowest.offer.price,lowest.offer.currency||lowest.product.currency)+'</strong>'+checkoutPriceDetailsHtml(lowest.offer,{compact:true})+'<p>'+esc(lowest.offer.comparison_label)+' · '+comparable.length+' 条报价；不代表平台验证商家履约。</p><a href="/following?'+esc(new URLSearchParams({product:selected.key,spec:state.spec}))+'">保存此规格与到期提醒 →</a></aside>':'';
  const activeSpec=state.spec?'<p class="note">当前按已保存的规格筛选。<a href="'+href({spec:'',page:''})+'">取消规格筛选</a></p>':'';
  const eligibilityControls=isGemini(selected)?'<nav class="spec-selector" aria-label="订阅资格"><span class="spec-selector-label">订阅资格</span>'+choice('eligibility','all','全部')+result.eligibilities.map(group=>choice('eligibility',group.kind,group.label+' · '+group.count)).join('')+'</nav><p class="note">两维独立核验；缺少依据或信息冲突时为待核验。<a href="/submit?type=feedback&amp;product='+encodeURIComponent(selected.key)+'">分类纠错 / 误折叠反馈</a></p>':'';
  const controls='<section id="quote-filters" class="directory-filter-panel" aria-label="报价筛选" tabindex="-1">'+deliveryControls+eligibilityControls+rechargeControls+pricingTypeControls+activeSpec+decision+pricingControls+pricingNote+sortControls+'<div class="directory-filter-details"><details class="detail-filters"'+(state.purchase!=='all'||state.channel!=='all'||state.currency?' open':'')+'><summary>更多筛选</summary><div class="quote-controls">'+purchaseControls+'<div class="spec-selector" aria-label="交易平台">'+CHANNELS.map(channel=>choice('channel',channel.id,channel.label)).join('')+'</div><div class="spec-selector" aria-label="币种筛选">'+choice('currency','','全部币种')+result.currencies.map(currency=>choice('currency',currency,currency)).join('')+'</div></div></details>'+comparisonNote+'</div></section>';
  if(res)res.growthContext={productKey:selected.key,kind:'product_view',specSelected:!!lowest};

  let lastCurrency;
  // Gemini paginates display groups; all member quotes remain in the expanded SSR.
  const rows=(shops.length?merchantFeeNoticeHtml():'')+shownRows.map(row=>{const entry=row.entry;const currency=entry.offer.currency||entry.product.currency;const heading=currency!==lastCurrency?checkoutCohortHeading(currency,entry.offer):'';lastCurrency=currency;return heading+geminiQuoteGroupHtml(row,member=>{organicQuoteImpression(member.offer,{source:member.list.source,product_id:member.product.product_id},{req,res,analytics});return directoryQuoteRow(member,merchantBadges,xProfiles,reviewCounts);});}).join('');
  const emptyQuotes=state.pricing==='checkout'?'<p class="directory-empty">当前筛选暂无已确认手续费的报价。 <a href="'+href({pricing:'',page:''},'quote-results')+'">切回全部标价</a></p>':state.pricing_type==='regular'?'<p class="directory-empty">当前暂无正价报价。 <a href="'+href({pricing_type:'promo',page:''},'quote-results')+'">查看优惠 / 半价</a> · <a href="'+href({pricing_type:'all',page:''},'quote-results')+'">查看全部</a></p>':state.pricing_type==='promo'?'<p class="directory-empty">当前暂无优惠 / 半价报价。 <a href="'+href({pricing_type:'',page:''},'quote-results')+'">查看正价</a> · <a href="'+href({pricing_type:'all',page:''},'quote-results')+'">查看全部</a></p>':'<p class="directory-empty">暂无可用报价，请调整筛选或稍后再来。</p>';
  const pagination=pageCount>1?'<nav class="offer-pagination" aria-label="报价分页"><div class="offer-pagination-links">'+(page>1?'<a class="offer-page" href="'+href({page:page-1},'quote-results')+'">上一页</a>':'')+paginationNumbers(page,pageCount).map(number=>number===page?'<span class="offer-page current" aria-current="page">'+number+'</span>':'<a class="offer-page" href="'+href({page:number},'quote-results')+'" aria-label="第 '+number+' 页">'+number+'</a>').join('')+(page<pageCount?'<a class="offer-page" href="'+href({page:page+1},'quote-results')+'">下一页</a>':'')+'</div></nav>':'';
  const entries=sponsorEntries([{...category,products:[selected]}]);
  // Match the category page: the live card sits after the title and before the quote list.
  // With no campaign, omit that slot; the cooperation invite stays after the quotes.
  const sponsorCard=pageSponsors(entries,{db,analytics,req,res},'sponsored_product',selected.key,{invite:false});
  const sponsorFooter=sponsorCard?'':pageSponsors(entries,{db,analytics,req,res},'sponsored_product',selected.key);
  const unavailable=(selected.references||[]).filter(entry=>!(selected.quoteEntries||selected.entries).some(quote=>quote.list.source===entry.list.source&&quote.product.product_id===entry.product.product_id)).map(entry=>'<p class="note"><a href="'+productHref(entry.list.source,entry.product.product_id)+'">查看 '+esc(entry.product.name||selected.name)+' 的报价记录</a></p>').join('');
  return '<div class="directory-page-nav"><a class="breadcrumb" href="/catalog">'+icon('back')+'返回产品目录'+'</a><details class="directory-shop-search"><summary>找店铺</summary>'+shopSearchForm()+'</details></div><div class="directory-intro"><h1>'+platformMark(category.key)+esc(selected.name)+'</h1><div class="directory-primary-actions"><a class="directory-jump" href="#quote-results">查看报价 ↓</a></div><p>不同周期、交付方式的总价不可直接比较；价格与库存以店铺结算页为准。</p>'+(result.currencies.length>1?'<p>不同币种分别排序，不做汇率换算。</p>':'')+'</div>'+sponsorCard+baselineHtml(officialBaseline(selected.key),{compact:true})+productBuyingNote(selected.key)+(category.key==='x-subscription'?xSubscriptionNotice():'')+controls+productInsights(selected,result.entries,{href:changes=>href(changes,'quote-results').replaceAll('&amp;','&'),locale})+'<section id="quote-results" aria-label="店铺报价" tabindex="-1"><div class="directory-result-summary"><p>'+directoryCount(result,references.length)+(shops.length?' · '+sortLabel:'')+'</p><a href="#quote-filters">调整筛选 ↑</a></div>'+(!shops.length&&references.length&&state.pricing!=='checkout'?'':'<div class="directory-quotes">'+(rows||emptyQuotes)+'</div><p class="note">第 '+page+' / '+pageCount+' 页 · 本页 '+shown.length+' 条店铺报价（每页最多 '+pageSize+(isGemini(selected)?' 个展示组':' 条')+'）</p>'+pagination)+'</section>'+sponsorFooter+(references.length?'<section class="directory-references"><h2>参考报价</h2><p class="note">以下为官方订阅参考，不计入店铺报价。</p>'+references.map(entry=>directoryQuoteRow(entry)).join('')+'</section>':'')+unavailable;
}
function xSubscriptionNotice() {
  return '<aside class="directory-risk-note" role="note" data-x-subscription-notice>'+icon('warning')+'<div><p><strong>The X Subscription · 新版融合套餐</strong></p><p>整合 Grok、Cursor 与 X 权益。Plus 不含 Grok Bot；Premium、Super、Ultra 包含。旧版 X Premium、SuperGrok、Cursor 套餐仍单独展示。</p><p>Cursor 第三方模型另行计费。官方未授权第三方转售；第三方报价不代表官方授权，请优先通过官网购买。</p></div></aside>';
}
function directoryRiskNotice(family = 'all') {
  const chatgpt = ['all','chatgpt'].includes(family)
    ? '<p class="chatgpt-price-notice"><strong>ChatGPT 低价引流提醒</strong>部分 Pro 200（商家常写 20x）低价仅限特定账号或续费条件。警惕添加微信、Telegram 等私聊后，被要求补差价或改买高价套餐。付款前确认可充条件、最终总价、订阅时长和退款规则；临时加价时请先暂停交易，并<a href="/submit?type=feedback">反馈问题报价</a>。</p>'
    : '';
  return '<aside class="directory-risk-note" role="note" aria-label="交易风险提醒">'+icon('warning')+'<div>'+chatgpt+'<p><strong>交易风险提醒</strong>本站仅提供信息导航，不参与交易或售后；收录不代表交易安全保证。下单前核实商品规格与售后条款，警惕低价诱导和私下转账。</p></div></aside>';
}
const loadDirectory=createPublicDirectoryCache((db,now)=>{
  let validUntil=Infinity;
  const options={now,checkoutPricing:true,onValidUntil:at=>{validUntil=Math.min(validUntil,at);}};
  const lists=["direct-shops","ldxp-goods","cardnav-official"].map(source=>{
    const list=latestProducts(db,source,'all','all',options);
    if(!list||SHOP_SOURCES.has(source))return list;
    return {...list,products:list.products.map(product=>projectProduct(db,source,{snapshot_id:list.snapshotId,fetched_at:list.fetchedAt,stale:list.stale},product,options))};
  });
  return {value:buildProductDirectory(lists,{includeOfficialReferences:true}),validUntil};
});
function recordPageImpressions(req,res,analytics,campaigns){
  if(req?.method!=='GET'||!res||!campaigns.length)return;
  if(!res.pageImpressions){
    res.pageImpressions=[];
    res.once('finish',()=>{if(res.statusCode===200&&!res.scrapeGuardAction)for(const campaign of res.pageImpressions)try{campaign.organic?analytics.outbound.recordOrganicImpression(req,campaign):analytics.outbound.recordImpression(req,campaign,new Date(),sponsorPagePath(req.url,campaign));}catch{}});
  }
  res.pageImpressions.push(...campaigns);
}
// Capture only accounting identifiers, once per rendered quote (desktop and
// mobile markup represent the same impression). Cache hits replay this list.
function organicQuoteImpression(offer,{source,product_id},{req,res,analytics}){
  if(process.env.AIRADAR_ORGANIC_IMPRESSIONS==='off'||source==='cardnav-official'||offer.quote_retained||!quoteAvailable(source,offer)||!safeUrl(offer.url)||!outboundHref(offer,{source,product_id}))return;
  const row={organic:true,source,product_id,offer_id:offer.offer_id||offer.offerId,merchant_id:merchantKeyForOffer({...offer,source,product_id})};
  if(!row.merchant_id)return;
  res?.homeCacheImpressions?.push(row);
  recordPageImpressions(req,res,analytics,[row]);
}
function pageSponsors(entries,context,placement,pageKey,{invite=true}={}){
  let items=[];try{items=sponsorItems(entries,context.analytics,{placement,pageKey,db:context.db,requestPath:context.req?.url||''});}catch{return '';}
  const campaigns=items.map(item=>item.campaign);
  context.res?.homeCacheImpressions?.push(...campaigns);
  recordPageImpressions(context.req,context.res,context.analytics,campaigns);
  if(!items.length)return invite?sponsorInvite(placement.replace('sponsored_','')):'';
  return sponsorBlock(items,{placement});
}
function hasScheduledProductSponsor(analytics,pageKey){
  try{return !!analytics?.outbound?.activeCampaigns().some(c=>c.placement==='sponsored_product'&&c.page_key===pageKey&&(websiteSponsorOffer(c)||quoteSponsorOffer(c)));}catch{return false;}
}
function homePage(db, url = new URL("http://localhost"),context={}) {
  context={...context,db};
  const filters=filtersOf(url.pathname==='/catalog'?new URL('/catalog',url):url);
  const directory=loadDirectory(db);
  const shopQuery=url.pathname==='/catalog'?'':normalizeShopQuery(url.searchParams.get('shop_q'));
  if(shopQuery){
    const result=searchShops(buildShopCatalog(directory,context.shopCatalogOptions).values(),shopQuery,{page:url.searchParams.get('page')});
    const reviewCounts=context.reviews?.publicCounts(result.shops.map(shop=>shop.id))||new Map();
    return layout('搜索店铺','<section class="directory">'+shopSearchForm(result.q)+shopSearchContent(result,{...context,reviewCounts})+'</section>','home',{filters:{family:'all'}});
  }
  const category=directory.find(item=>item.key===filters.family);
  const intended=priceProduct(url.searchParams.get('product'));
  const selected=category?.products.find(item=>item.key===url.searchParams.get('product'))||
    (intended&&category&&intended.family===category.key&&hasScheduledProductSponsor(context.analytics,intended.key)?{key:intended.key,name:intended.name,entries:[],quoteEntries:[],references:[],deliveryEnabled:true}:null);
  // Reuse public summaries within this render. Anonymous homepage HTML has a
  // separate short cache invalidated by public, private and campaign revisions.
  const summaries=new Map();
  const summary=product=>{if(!summaries.has(product))summaries.set(product,directoryQuotes(product,{pricing_type:'regular'}));return summaries.get(product);};
  const categoryRow=item=>'<section class="directory-category" data-category="'+esc(item.key)+'"><h2 class="directory-category-title">'+platformMark(item.key)+esc(item.label)+'</h2><div class="directory-list">'+item.products.map(product=>{const quotes=summary(product),references=quotes.entries.filter(entry=>entry.reference).length;return '<article class="directory-row" data-directory-product="'+esc(product.key)+'"><div class="directory-product-summary"><h3>'+platformMark(item.key)+'<a class="directory-product-title" href="'+directoryHref({family:item.key,product:product.key})+'">'+esc(product.name)+'</a></h3><p class="directory-count">'+directoryCount(quotes,references,{compact:true})+'</p></div><div class="directory-row-action">'+(product.deliveryEnabled&&quotes.deliveries.length?directoryDeliveryLinks(product,item.key,quotes):(product.key.startsWith('x-subscription-')&&product.officialReference&&!quotes.total?'<div class="directory-minimum"><span class="directory-minimum-price">'+esc(product.officialReference.currency+' '+product.officialReference.amount+' / 月')+'</span><span class="directory-count">官方月付参考 · 不含税费</span></div>':directoryMinimumHtml(quotes))+'<a class="directory-action" href="'+directoryHref({family:item.key,product:product.key})+'">'+((quotes.total===references&&references)||product.officialReference&&!quotes.total?'查看参考':quotes.total?'查看店铺':'查看记录')+' '+icon('chevron')+'</a>')+'</div></article>';}).join('')+(item.products.length?'':'<p class="directory-empty">暂无可用报价，请稍后再来。</p>')+'</div></section>';
  let title='AI 订阅选购与续费雷达',content;
  if(!category){
    const available=directory.map(c=>({...c,products:c.products.filter(p=>summary(p).entries.some(e=>!e.reference))})).filter(c=>c.products.length);
    if(url.pathname==='/catalog'){
      title='全部 AI 产品目录';
      const empty=directory.map(c=>({...c,products:c.products.filter(p=>!summary(p).entries.some(e=>!e.reference))})).filter(c=>c.products.length);
      content='<header class="directory-intro"><a href="/">← 返回选购首页</a><h1>全部 AI 产品目录</h1><p>先展示有店铺报价的产品。参考报价与暂无报价的产品在下方单独查看。</p></header>'+available.map(categoryRow).join('')+(empty.length?'<details class="directory-more"><summary>仅有参考或暂无店铺报价的产品</summary>'+empty.map(categoryRow).join('')+'</details>':'');
    }else{
      const focus=new Set(PRICE_PRODUCTS.map(p=>p.key));
      const featured=available.map(c=>({...c,products:c.products.filter(p=>focus.has(p.key))})).filter(c=>c.products.length);
      content='<header class="growth-hero"><p class="growth-eyebrow">AIradar · AI 订阅选购与续费雷达</p><h1>找到真正适合你的<br>AI 订阅报价。</h1><p>比较 ChatGPT、Claude、Gemini 等公开报价，先看清购买条件，再决定去哪买。</p><a class="growth-cta" href="#choose-product">开始比价 ↓</a><a class="growth-secondary" href="/official-prices">查官方价格 →</a></header><nav class="growth-paths" aria-label="选择使用需求"><a href="#choose-product"><strong>准备买订阅</strong><span>选产品，再确认购买条件</span></a><a href="/official-prices"><strong>核对官方价格</strong><span>看官网月付与地区参考</span></a><a href="/following"><strong>管理我的续费</strong><span>记录订阅与到期时间</span></a></nav>'+pageSponsors(sponsorEntries(directory),context,'sponsored_home','home')+'<h2 id="choose-product" class="growth-catalog-title" tabindex="-1">热门产品当前报价</h2>'+(featured.length?featured.map(categoryRow).join(''):'<p class="directory-empty">暂无可用店铺报价。你仍可查看官方价格与完整产品记录。</p>')+(context.retention?weeklyTeaser(context.retention):'')+'<section class="growth-method"><h2>看懂报价，再决定去哪买</h2><p>给自己的账号充值、买新账号和共享账号，交付内容不同。本站提供公开信息，购买前回原店核对期限、账号条件与售后。</p><a href="/guides/chatgpt-plus-delivery">Plus 充值与交付</a> · <a href="/guides/chatgpt-pro-5x-vs-20x">Pro 档位与续费</a> · <a href="/guides/claude-pro-buying">Claude Pro 选购</a> · <a href="/guides/read-price-changes">怎样读价格变化</a> · <a href="/help/data-and-ranking">数据与排序方法</a></section><a class="growth-catalog-link" href="/catalog">更多产品与历史记录 →</a>';
    }
  }else if(selected){
    title=selected.name+' · 店铺报价';
    content=directoryQuotePage(category,selected,url,context);
    if(context.retention){
      content=content.replace('<div class="directory-primary-actions">','<div class="directory-primary-actions">'+followButton(selected.key,url.searchParams.get('spec')||''));
      content+=productReference(context.retention,selected.key,{comparisonKey:url.searchParams.get('spec')||''});
    }
  }else{
    title=category.label+' · 产品';
    content='<a class="breadcrumb" href="/">'+icon('back')+'返回全部产品</a><div class="directory-intro"><h1>'+platformMark(category.key)+esc(category.label)+'</h1><p>点击产品，查看各家店铺报价。</p></div>'+pageSponsors(sponsorEntries([category]),context,'sponsored_category',category.key)+ (category.key==='x-subscription'?xSubscriptionNotice():directoryRiskNotice(category.key))+categoryRow(category);
  }
  if(!selected&&(category?[category]:directory).some(c=>c.products.some(p=>summary(p).entries.some(e=>!e.reference))))content=content.replace('<section class="directory-category"',merchantFeeNoticeHtml()+'<section class="directory-category"');
  if(!category&&url.pathname!=='/catalog')content=content.replace('</header>','</header>'+publicTrafficHtml(context.traffic?.get(),context.locale));
  if(!category&&url.pathname==='/catalog')content+=pageSponsors(sponsorEntries(directory),context,'sponsored_home','home');
  if(category&&!selected)content+=brandBuyingGuide(category.key);
  const identity=category?' data-directory-family="'+esc(category.key)+'" data-directory-label="'+esc(category.label)+'"'+(selected?' data-directory-product="'+esc(selected.key)+'" data-directory-product-name="'+esc(selected.name)+'"':''):'';
  const trafficAnimation=content.includes('data-traffic-flip')?'<script src="/assets/public-traffic.js?v='+publicTrafficScript.hash+'" defer></script>':'';
  return layout(title,'<section class="directory"'+identity+'>'+(selected?'':shopSearchForm())+content+'</section>'+(selected?'<script src="/assets/directory.js?v='+directoryScript.hash+'" defer></script>':'')+trafficAnimation,'home',{filters:{family:filters.family},showFriendLinks:!category});
}
function channelForm(channel,family,source=null,id=null,filters={}){
 const hidden=(filters.spec?'<input type="hidden" name="spec" value="'+esc(filters.spec)+'">':'')+(source?'<input type="hidden" name="source" value="'+esc(source)+'"><input type="hidden" name="id" value="'+esc(id)+'">':'');
 return '<form method="get" action="'+(source?'/product':'/')+'" class="surface channel-form"><div class="filter-platforms"><span class="channel-label">交易平台</span><div class="channel-options" role="group" aria-label="交易平台">'+CHANNELS.map(c=>'<button class="channel-pill'+(c.id===channel?' selected':'')+'" type="submit" name="channel" value="'+c.id+'" aria-pressed="'+(c.id===channel)+'">'+c.label+'</button>').join('')+'</div></div><input type="hidden" name="family" data-channel-family value="'+esc(family)+'">'+hidden+'<div class="filter-controls"><label>关键词 <input type="search" name="q" maxlength="100" value="'+esc(filters.q||'')+'" placeholder="产品、规格或店铺"></label><input class="filter-toggle" type="checkbox" id="filter-more" aria-label="更多筛选"'+((filters.purpose&&filters.purpose!=='all')||(filters.framework&&filters.framework!=='all')?' checked':'')+'><label class="filter-toggle-label" for="filter-more">更多筛选 <span aria-hidden="true">⌄</span></label><div class="filter-advanced"><label>产品用途 <select name="purpose">'+PURPOSES.map(([key,label])=>'<option value="'+key+'"'+(key===(filters.purpose||'all')?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label>独立站框架 <select name="framework">'+FRAMEWORKS.map(f=>'<option value="'+f.id+'"'+(f.id===(filters.framework||'all')?' selected':'')+'>'+f.label+'</option>').join('')+'</select></label><p class="note filter-framework-note">框架仅按已核验的独立站识别。</p></div><button class="channel-pill" type="submit" name="channel" value="'+channel+'">筛选</button></div></form>';
}

function channelSeries(db,source,id,channel){
 const rows=db.prepare(`WITH recent AS (SELECT snapshot_id,fetched_at FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 120) SELECT o.*,s.fetched_at FROM recent s JOIN offers o ON o.snapshot_id=s.snapshot_id AND o.source=? WHERE o.product_id=? ORDER BY s.fetched_at ASC`).all(source,source,id);
 const points=new Map();for(const o of filterChannel(rows,channel)){if(o.stock_count===0||!["in_stock","available","online","low_stock"].includes(o.status))continue;if(!publicOfferAllowed(source,o))continue;const price=Number(o.price);if(!(price>0))continue;const old=points.get(o.snapshot_id);if(!old||price<old.lowest_price)points.set(o.snapshot_id,{fetched_at:o.fetched_at,lowest_price:price});}return [...points.values()];
}

function directHealthNotice(db) {
  let health;try{health=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='health:direct-targets'").get()?.value||"null");}catch{return "";}
  const affected=health?.targets?.filter(t=>["stale","unavailable"].includes(t.status))||[];
  if(!affected.length)return "";
  return `<section class="surface" role="status"><strong>部分店铺暂未核验成功</strong><ul>${affected.map(t=>`<li>${esc(t.name)}：${t.status==="unavailable"?"无有效报价记录，暂不参与当前报价（不代表售罄）":"保留上次记录，待核验"}；上次成功 ${t.lastSuccess?esc(fmtTime(t.lastSuccess)):"无"}</li>`).join("")}</ul></section>`;
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

function offerContent(offers, { source, id, page, stale=false, merchantBadges=[], xProfiles=[], reviews, req, res, analytics }) {
  const state=o=>source==='cardnav-official'?'官方参考':listingState(o,stale);
  const actionLabel=SHOP_SOURCES.has(source)?"前往店铺":"查看原站";
  const shopLink=(url,offer)=>url&&outboundHref(offer,{source,product_id:id})?'<a class="offer-shop-button" data-store-risk data-outbound-target="'+url+'" href="'+esc(outboundHref(offer,{source,product_id:id}))+'" target="_blank" rel="noopener noreferrer">'+actionLabel+' '+icon("external")+'</a>':"";
  const perPage = 10;
  const total = offers.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const start = (currentPage - 1) * perPage;
  const shown = offers.slice(start, start + perPage);
  const reviewCounts=reviews?.publicCounts(shown.map(offer=>shopDescriptorForOffer({...offer,source})?.id))||new Map();
  for(const offer of shown)organicQuoteImpression(offer,{source,product_id:id},{req,res,analytics});
  const end = start + shown.length;
  let desktopCohort,mobileCohort;
  const desktopRows = shown.map((offer, index) => {
    const rank = start + index + 1;
    const url = safeUrl(offer.url);
    const link = shopLink(url,offer);
    const cohort=offer.currency;
    const heading=SHOP_SOURCES.has(source)&&cohort!==desktopCohort?'<tr><td colspan="6">'+checkoutCohortHeading(offer.currency,offer,{tag:'div'})+'</td></tr>':'';desktopCohort=cohort;
    return heading+`<tr><td class="num offer-rank"><span class="offer-rank-index">#${rank}</span></td><td class="num"><span class="money">${fmtPrice(offer.price, offer.currency)}</span>${SHOP_SOURCES.has(source)?checkoutPriceDetailsHtml(offer):''}</td><td>${statusMark(state(offer))}</td><td><div class="offer-title"><strong>${esc(offer.store_name || "店铺信息待确认")}${merchantBadgeForOffer({...offer,source},merchantBadges)}${merchantXBadge({...offer,source},xProfiles)}</strong><span>${esc(offer.title ?? "")}</span>${metricLine(offer)}${merchantStoreLinks({...offer,source},{reviewCounts})||claimLink(offer)}</div></td><td class="dim">${esc(quoteTimeInfo(offer).absolute ? fmtTime(quoteTimeInfo(offer).absolute) : "—")}</td><td class="num offer-action">${link}</td></tr>`;
  }).join("");
  const mobileCards = shown.map((offer, index) => {
    const rank = start + index + 1;
    const url = safeUrl(offer.url);

    const bottomLink = shopLink(url,offer);
    const cohort=offer.currency;
    const heading=SHOP_SOURCES.has(source)&&cohort!==mobileCohort?checkoutCohortHeading(offer.currency,offer):'';mobileCohort=cohort;
    const title = offer.title ? '<div class="card-meta"><span>' + esc(offer.title) + "</span></div>" : "";
    return heading+`<article class="offer-card"><div class="card-top"><div class="offer-card-price"><span class="offer-rank-index" aria-label="第 ${rank} 名">#${rank}</span><div><div class="card-price">${fmtPrice(offer.price, offer.currency)}</div>${SHOP_SOURCES.has(source)?checkoutPriceDetailsHtml(offer):''}${statusMark(state(offer))}</div></div></div><div class="card-name">${esc(offer.store_name || "店铺信息待确认")}${merchantBadgeForOffer({...offer,source},merchantBadges)}${merchantXBadge({...offer,source},xProfiles)}</div>${title}${metricLine(offer)}${merchantStoreLinks({...offer,source},{reviewCounts})||claimLink(offer)}<div class="card-bottom"><span class="dim">报价时间 ${esc(quoteTimeInfo(offer).absolute ? fmtTime(quoteTimeInfo(offer).absolute) : "—")}</span>${bottomLink}</div></article>`;
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

function historyChart(history,currency) {
  if(history.status==='pending')return '<div class="empty">历史走势正在生成，请稍候…</div>';
  if(history.status!=='ready')return '<div class="empty">历史走势暂时不可用，请稍后重试。当前报价仍可正常查看。</div>';
  return sparkline(history.rows,currency)??'<div class="empty">记录不足，暂无走势</div>';
}

async function quoteHistoryRoute(req,res,url,db,quoteHistory,guard) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('X-Accel-Expires','0');
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return jsonResponse(res,405,{error:'不支持此方法'});}
  if(guard&&!guard.quoteAllowed(url))return jsonResponse(res,404,{error:'产品不存在'});
  const source=url.searchParams.get('source')||'direct-shops',id=url.searchParams.get('id')||'',spec=url.searchParams.get('spec')||'';
  if(!SHOP_SOURCES.has(source)||!id||id.length>256||spec.length>4096)return jsonResponse(res,404,{error:'产品不存在'});
  const product=seoProduct(db,url);
  if(!product)return jsonResponse(res,404,{error:'产品不存在'});
  if(req.method==='HEAD'){res.statusCode=200;return res.end();}
  const {channel,framework}=filtersOf(url);
  const history=await quoteHistory.get({source,productId:id,comparisonKey:spec||undefined,channel,framework,limit:120},{waitMs:100});
  if(history.status!=='ready')res.setHeader('Retry-After','2');
  return jsonResponse(res,history.status==='ready'?200:history.status==='pending'?202:503,{
    status:history.status,html:historyChart(history,history.rows.find(row=>row.lowest_price!=null&&row.currency)?.currency??product.currency),
    count:history.rows.length,
  });
}

async function productPage(db, url, {analytics,req,res,merchantBadges=[],xProfiles=[],retention,reviews,quoteHistory,quoteToken}={}) {
  const filters={...filtersOf(url),spec:url.searchParams.get('spec')||''};
  const {channel,framework}=filters;
  const source = url.searchParams.get("source") || "direct-shops";
  const id = url.searchParams.get("id");
  if(source==='cardnav-official'){
    const content=officialPriceContent(db,url);
    if(content)return layout('官方地区价',content,'official');
  }
  if (!id) return layout("缺少参数", `${pageIntro("缺少产品参数", "请选择一个产品后再查看报价")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  const snapshot = retiredCatalogSource(source) ? null : latestProducts(db, source,channel,framework,{checkoutPricing:true,productId:id});
  if (!snapshot) return layout("暂无数据", `${pageIntro("暂未收录数据", "当前没有可展示的报价记录")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  let product = snapshot.products.find((item) => item.product_id === id);
  if(!product&&(channel!=="all"||framework!=="all")){const original=latestProducts(db,source,'all','all',{checkoutPricing:true,productId:id})?.products.find(item=>item.product_id===id);if(original)product={...original,offers:[],selected_offer:null,lowest_price:null,offer_count:0,visible_offer_count:0,in_stock_count:0};}
  if (!product) return layout("未找到产品", `${pageIntro("未找到该产品", "当前记录中没有匹配的产品记录")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);

  const groups=productQuoteGroups(product);
  // A default must be a currently available, known specification. Never merge periods.
  if(!filters.spec&&groups.length>1){
    const defaults=groups.filter(group=>group.comparable&&group.lowest_price!=null&&!group.stale);
    const monthly=defaults.find(group=>/^(?:1m|30d):/.test(group.comparison_key||''));
    filters.spec=(monthly||defaults[0])?.comparison_key||'';
  }
  if(filters.spec)product=groups.find(p=>p.comparison_key===filters.spec)||{...product,offers:[],selected_offer:null,lowest_price:null,offer_count:0,in_stock_count:0,comparable:false};
  const specSelector=groups.length>1?'<nav class="spec-selector" aria-label="选择规格"><span class="spec-selector-label">规格</span>'+groups.map(group=>{
    const params=new URLSearchParams({source,id,...filters,spec:group.comparison_key});
    return '<a class="spec-choice" aria-current="'+(group.comparison_key===filters.spec)+'" href="/product?'+esc(params.toString())+'">'+esc(group.comparison_label||'规格待确认')+'</a>';
  }).join('')+'</nav>':'';
  const offers = product.offers || filterFramework(filterChannel(offersOf(db, source, snapshot.snapshotId, id),channel),framework);
  const page = requestedPage(url.searchParams.get("page"));
  const historyOptions={source,productId:id,channel,framework,comparisonKey:filters.spec||undefined,limit:120};
  const history=req?.method==='HEAD'?{status:'pending',rows:[]}:SHOP_SOURCES.has(source)?await quoteHistory.get(historyOptions,{waitMs:250}):{status:'ready',rows:priceSeriesRows(db,source,id).slice(-120)};
  const series=history.rows;
  const chartHtml=historyChart(history,product.currency);
  const historyToken=quoteToken?.({source,id,spec:filters.spec||'',channel,framework})||'';
  const historyUrl='/api/quote-history?'+new URLSearchParams({source,id,channel,framework,...(filters.spec?{spec:filters.spec}:{}),...(historyToken?{t:historyToken}:{})});
  const historyPending=history.status==='pending';
  const historyFlags=retentionFlags(db);
  const related = recentAlerts(db,999).filter(alert=>{
    if(alert.source!==source||alert.product_id!==id)return false;
    if(alert.group_id)return product.comparable!==false?alert.group_id===product.comparison_key:!filters.spec&&product.offers?.some(o=>o.comparison_known&&o.comparison_key===alert.group_id);
    if(product.comparable===false)return false;
    const at=db.prepare('SELECT * FROM snapshots WHERE source=? AND fetched_at<=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source,alert.ts);
    if(!at)return false;
    const prior=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=? AND product_id=?').get(source,at.snapshot_id,id);
    if(!prior)return false;
    // 重复明细被收掉之后，快照里已经没有完整报价。用写入时保存的投影点核对规格，避免把提醒滤掉。
    if(historyFlags.dedupe&&isPartialSnapshot(db,source,at.snapshot_id)){
      const point=productLevelPoint(db,source,at.snapshot_id,id);
      return !!point?.comparable&&point.comparison_key===product.comparison_key;
    }
    const historical=projectProduct(db,source,at,prior,{historical:true});
    return historical.comparable&&historical.comparison_key===product.comparison_key;
  }).slice(0,30);
  const rendered = offerContent(offers, { source, id, page,stale:snapshot.stale,merchantBadges,xProfiles,reviews,req,res,analytics });
  const spec = [product.comparison_label,publicSpec(product.spec),product.selected_offer?.title].filter(Boolean).map(s=>"<span>"+esc(s)+"</span>").join("");
  const range = rendered.shown ? `${rendered.start + 1}–${rendered.end}` : "0";
  const offersHtml = offers.length
    ? '<div class="table-scroll desktop"><table class="offer-table"><thead><tr><th class="num offer-rank-heading">排名</th><th class="num">价格</th><th>状态</th><th>店铺 / 标题</th><th>更新时间</th><th class="offer-action-heading">操作</th></tr></thead><tbody>' + rendered.desktopRows + '</tbody></table></div><div class="mobile"><div class="mobile-stack">' + rendered.mobileCards + "</div></div>"
    : '<div class="empty">暂无报价</div>';
  let campaigns=[];try{campaigns=analytics?.outbound?.campaignsFor({source,productId:id},new Date())||[];}catch{/* Ads must not prevent natural quote access. */}
  const sponsored=sponsoredContent(offers.filter(o=>quoteAvailable(source,o)),campaigns,{product:{source,product_id:id,snapshot_id:snapshot.snapshotId},viewToken:campaign=>analytics?.outbound?.viewToken(campaign,new Date(),sponsorPagePath(req?.url||'',campaign))||'',recordImpression:campaign=>{res?.homeCacheImpressions?.push(campaign);if(req?.method==='GET')res?.once('finish',()=>{if(res.statusCode===200&&!res.scrapeGuardAction)try{analytics?.outbound?.recordImpression(req,campaign,new Date(),sponsorPagePath(req.url,campaign));}catch{/* Non-critical metrics. */}})}});
  const feedbackHref = "/submit?type=feedback&amp;source=" + encodeURIComponent(source) + "&amp;product=" + encodeURIComponent(id);
  const identity=directoryQuoteIdentity({source},product,product.selected_offer||{});
  const retentionKey=identity?.key;
  return layout(publicProductName(product) + " · 报价", `
    <a class="breadcrumb" href="/?${esc(new URLSearchParams({...filters,family:filters.family==='all'?platformTone(product.platform):filters.family}).toString())}">${icon("back")}返回产品分类</a>
    ${specSelector}<details class="detail-filters"><summary>筛选店铺报价</summary>${channelForm(channel,filters.family==='all'?platformTone(product.platform):filters.family,source,id,filters)}</details>
    <section class="product-hero"><div class="summary"><h1>${platformMark(product.platform)}${esc(publicProductName(product))}</h1><div class="product-meta"><span>${esc(product.platform ?? "未分类")}</span><span>${esc(product.product_type ?? "未分类")}</span>${spec}</div><div class="price-label">${source==='cardnav-official'?'官方参考价':'参考起价'}</div><div class="price-display">${fmtPrice(product.lowest_price, product.currency)}</div>${SHOP_SOURCES.has(source)&&product.selected_offer?checkoutPriceDetailsHtml(product.selected_offer):''}<div class="summary-bottom">${SHOP_SOURCES.has(source)?statusMark(listingState(product.selected_offer,snapshot.stale)):statusMark(source==='cardnav-official'?'官方参考':'服务套餐')}${updatedMeta(snapshot)}</div><p class="note">${product.comparable===false?'规格不一致或周期信息不足，不展示统一起价；请逐条核对。':''}价格、规格与库存以结算页面为准。</p></div>
      <div class="chart-panel"${historyPending?' data-quote-history="'+esc(historyUrl)+'"':''}><div class="chart-head"><h2>商品标价走势</h2><span data-history-caption>${history.status==='ready'?'最近 '+series.length+' 次记录 · 不含结算手续费':'不含结算手续费'}</span></div><div class="chart-wrap" data-history-chart aria-live="polite">${chartHtml}</div></div>
    </section>
    ${SHOP_SOURCES.has(source)?merchantFeeNoticeHtml():''}
    ${productBuyingNote(retentionKey)}
    ${retentionKey?followButton(retentionKey,product.comparable?product.comparison_key:''):''}
    <section class="surface detail" id="offers"><div class="head"><div><h2>报价排行</h2><p class="note">共 ${rendered.total} 条公开报价 · 第 ${rendered.page} / ${rendered.pageCount} 页 · 展示第 ${range} 名 · 在售优先，同币种按商品标价升序</p></div><a class="data-feedback-link" href="${feedbackHref}">${icon("message")}反馈这页数据</a></div>${offersHtml}${rendered.pagination}</section>${sponsored}
    ${retention&&retentionKey?productReference(retention,retentionKey,{comparisonKey:product.comparable?product.comparison_key:''}):''}
    <section class="alerts"><div class="head"><div><h2>相关提醒</h2><p class="note">仅显示来源和可比规格可核对的历史记录，保留当时价格。完整记录见价格提醒页</p></div></div>${alertList(related)}</section>
    ${historyPending?'<script src="/assets/quote-history.js?v='+quoteHistoryScript.hash+'" defer></script>':''}
  `, "", {filters});
}

function submissionPage(url, csrfToken) {
  if(["sponsor_apply","merchant_claim"].includes(url.searchParams.get("topic")))return layout(url.searchParams.get("topic")==="merchant_claim"?"申请认领店铺":"申请成为 Sponsor",applicationContent(url,csrfToken),"submit",{csrfToken});
  const mode = url.searchParams.get("type") === "cooperation" ? "cooperation" : "feedback";
  const role = url.searchParams.get("role") === "demand" ? "demand" : "supply";
  const cooperationCopy = {
    supply: {
      title: "提交供给信息",
      description: "适合有稳定、批量供货能力的供应方。请说明产品、可供数量与保障范围。",
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
      description: "适合有长期、批量采购需求的采购方。请说明产品、数量、预算与交付要求。",
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
      <div class="submission-intro-copy"><span class="submission-kicker">${icon("message")}共同维护可信数据</span><h1>反馈与合作</h1><p>纠正公开数据，或提交可核验的供需信息。先选择类型，再补充必要事实，不需要从头写一大段说明。</p><p><a class="offer-shop-button" href="/submit-shop">我是店主 · 提交店铺</a></p></div>
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
        <noscript><p class="submission-status">提交需要启用 JavaScript。请启用后刷新页面；填写的信息不会通过网址发送。</p></noscript><form method="post" action="/api/submissions" class="submission-form" id="submission-form" novalidate>
          <input type="hidden" name="kind" value="${mode}"/>
          <div class="submission-honeypot" aria-hidden="true"><label>网站<input type="text" name="website" tabindex="-1" autocomplete="off"/></label></div>
          <p class="submission-status" id="submission-status" role="status" aria-live="polite"></p>

          <div data-kind-panel="feedback"${feedbackHidden}>
            <section class="form-section"><h3 class="form-section-title">问题类型</h3><div class="option-grid">
              ${topicOption("price_wrong", "价格有误")}${topicOption("sold_out", "库存状态不对")}${topicOption("warranty_wrong", "质保描述不对")}${topicOption("category_wrong", "产品分类不对")}${topicOption("dead_link", "原站链接失效")}${topicOption("missing_item", "缺少一条数据")}${topicOption("page_problem", "页面使用问题")}${topicOption("suggestion", "功能建议")}${topicOption("other", "其他情况")}
            </div></section>
            <section class="form-section"><div class="form-grid">
              <label><span class="field-label">相关产品或页面<span class="optional">选填</span></span><input class="form-control" name="subject" maxlength="120" value="${esc(product)}" placeholder="例如：ChatGPT Pro 200"${feedbackDisabled}/></label>
              <label><span class="field-label">页面或原站链接<span class="optional">选填</span></span><input class="form-control" name="contextUrl" maxlength="500" value="${esc(contextUrl)}" placeholder="粘贴需要复核的页面链接"${feedbackDisabled}/></label>
              <label class="field-wide"><span class="field-label">补充说明<span class="optional">选填</span></span><textarea class="form-control form-textarea" name="details" maxlength="1500" placeholder="可以写清楚：哪里不对、你看到的正确情况、何时发现。已有产品和链接时可简短填写。"${feedbackDisabled}></textarea><span class="field-help">相关产品、链接和补充说明至少填写一项。</span></label>
              <label class="field-wide"><span class="field-label">联系方式<span class="optional">选填</span></span><input class="form-control" name="contact" maxlength="128" placeholder="例如：X @username、TG @username 或邮箱"${feedbackDisabled}/><span class="field-help">仅用于必要的核实，不会公开展示。</span></label>
            </div></section>
          </div>

          <div data-kind-panel="cooperation"${cooperationHidden}>
            <aside class="cooperation-guidance" aria-label="供需合作填写提示">
              <strong>这里填写稳定、批量供需合作</strong>
              <p>有稳定、批量供货能力，或有长期、批量采购需求，请填写下方表单。</p>
              <p>想让店铺和商品报价展示在本站？请从「申请店铺」入口提交，不要填在这里。</p>
              <a class="offer-shop-button" href="/submit-shop">申请店铺 ${icon("chevron")}</a>
            </aside>
            <section class="form-section"><h3 class="form-section-title">你的合作方向</h3><div class="option-grid role-options">
              ${roleOption("supply", "我是供给方", "有稳定、批量供货能力，可说明渠道与交付保障")}
              ${roleOption("demand", "我是采购方", "有持续或批量需求，希望匹配稳定供给")}
            </div></section>
            <section class="form-section"><div class="form-grid">
              <label class="field-wide"><span class="field-label" data-cooperation-copy="subjectLabel">${roleCopy.subjectLabel}</span><input class="form-control" name="subject" minlength="4" maxlength="120" required data-cooperation-placeholder="subjectPlaceholder" placeholder="${roleCopy.subjectPlaceholder}"${cooperationDisabled}/></label>
              <label><span class="field-label" data-cooperation-copy="productLabel">${roleCopy.productLabel}</span><select class="form-control" name="productArea" required${cooperationDisabled}><option value="" selected disabled>请选择</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="grok_x">Grok / X</option><option value="muse">Muse</option><option value="mail_verify">邮箱</option><option value="other">其他</option></select></label>
              <label><span class="field-label" data-cooperation-copy="scaleLabel">${roleCopy.scaleLabel}</span><select class="form-control" name="scale" required${cooperationDisabled}><option value="" selected disabled>请选择</option><option value="trial">先小额测试</option><option value="small">稳定小批量</option><option value="monthly">月度批量</option><option value="large">大额长期</option><option value="negotiable">待沟通</option></select></label>
              <label><span class="field-label" data-cooperation-copy="assuranceLabel">${roleCopy.assuranceLabel}</span><select class="form-control" name="assurance" required${cooperationDisabled}><option value="" selected disabled>请选择</option><option value="full_warranty">明确质保</option><option value="subscription_cover">掉订阅保障</option><option value="activation_only">仅保证激活可用</option><option value="conditional">有条件保障</option><option value="none">无质保</option><option value="negotiable">可协商</option></select></label>
              <label><span class="field-label" data-cooperation-copy="settlementLabel">${roleCopy.settlementLabel}</span><select class="form-control" name="settlement" required${cooperationDisabled}><option value="" selected disabled>请选择</option><option value="cny">人民币</option><option value="usdt">USDT</option><option value="both">人民币或 USDT</option><option value="negotiable">可协商</option></select></label>
              <label class="field-wide"><span class="field-label"><span data-cooperation-copy="linkLabel">${roleCopy.linkLabel}</span><span class="optional">选填</span></span><input class="form-control" type="url" name="contextUrl" maxlength="500" data-cooperation-placeholder="linkPlaceholder" placeholder="${roleCopy.linkPlaceholder}"${cooperationDisabled}/><span class="field-help" data-cooperation-copy="linkHelp">${roleCopy.linkHelp}</span></label>
              <label class="field-wide"><span class="field-label" data-cooperation-copy="detailsLabel">${roleCopy.detailsLabel}</span><textarea class="form-control form-textarea" name="details" minlength="10" maxlength="1500" required data-cooperation-placeholder="detailsPlaceholder" placeholder="${roleCopy.detailsPlaceholder}"${cooperationDisabled}></textarea></label>
              <label class="field-wide"><span class="field-label">联系方式</span><input class="form-control" name="contact" minlength="3" maxlength="128" required placeholder="X @username、TG @username 或工作邮箱"${cooperationDisabled}/></label>
              <label class="consent-check field-wide"><input type="checkbox" name="consent" required${cooperationDisabled}/><span>我确认有权提交以上信息，内容不含密码、卡密、API Key、私钥或其他敏感凭据。</span></label>
            </div></section>
          </div>

          <label class="field-wide"><span class="field-label">通知邮箱<span class="optional">选填</span></span><input class="form-control" type="email" name="email" maxlength="254" autocomplete="email" placeholder="用于接收提交回执与处理结果"/><span class="field-help">仅用于本次提交的进度通知，不公开、不发送营销邮件。不填写则无法接收邮件通知。</span></label>
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
            // Both panels share one form/radio name. The hidden panel's default
            // must not leave the active panel without a selected topic.
            if (active && !panel.querySelector('input[name="topic"]:checked')) {
              const firstTopic = panel.querySelector('input[name="topic"]');
              if (firstTopic) firstTopic.checked = true;
            }
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
            email: data.email || "",
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
  return layout("反馈与合作", body, "submit", { csrfToken });
}

function alertsPage(db, url) {
  // Reading the count first also refreshes an older read-only connection's
  // schema after the collector adds alert-group columns online.
  const visible = alertCount(db) ? db.prepare('SELECT * FROM alerts ORDER BY ts DESC,id DESC').all().filter(row=>!retiredCatalogItem(row)) : [];
  const count = visible.length;
  const pageCount=Math.max(1,Math.ceil(count/30)),page=Math.min(requestedPage(url.searchParams.get('page')),pageCount);
  const rows=visible.slice((page-1)*30,page*30);
  const pagination='<nav class="offer-pagination" aria-label="提醒翻页">'+(page>1?'<a class="offer-page" href="/alerts?page='+(page-1)+'">上一页</a>':'')+'<span>第 '+page+' / '+pageCount+' 页</span>'+(page<pageCount?'<a class="offer-page" href="/alerts?page='+(page+1)+'">下一页</a>':'')+'</nav>';
  return layout("价格提醒", `${pageIntro("价格提醒", "按时间从新到旧排列；历史提醒保留当时价格，不代表当前报价。")}<section class="alerts" style="margin-top:0">${alertList(rows)}${pagination}</section>`, "alerts");
}

function sourcesPage(db) {
  return layout("数据说明", pageIntro("数据说明", "了解报价范围、更新时间与比较方法") + '<section class="surface" style="padding:24px"><h2 id="definition">可引用定义</h2><p><strong>本站「数据来源」指：对已接入店铺公开商品页／目录的周期性只读采集，以及少量第三方公开汇总；记录的是采集当时可见的挂牌信息，不是成交价、库存承诺或官方实时确认。</strong></p><h2>报价从哪里来</h2><p>本站读取原始店铺的公开商品目录，部分条目由第三方公开汇总补充。页面展示可核验的店铺和交易平台；并非全部报价都由本站直接读取。官方订阅参考与 API 套餐也可能来自第三方汇总，不代表官方实时确认。</p><p>更新口径：已批准店铺按调度周期刷新；新店需通过公开可读性预检后才会进入采集。页面时间戳表示本站读到该条公开信息的时间，不等于商家恰好在该时刻改价。</p><p><a href="/help/data-and-ranking">查看排序、店铺标记与报价时间的详细说明</a> · <a href="/help/compare-prices">比价操作教程</a> · <a href="/about#definition">关于本站定义</a></p><h2>怎样比较</h2><p>请同时核对产品档位、周期、币种、地区、交付方式、使用人数与保障条件。规格不一致或信息不足的报价不能直接比较；参考起价不是全部市场最低价。</p><h2>价格与库存</h2><p>每条报价标明最近更新时间。未能更新或超过有效时间的记录会标为待核验；缺少有效信息不等于售罄。历史价格和提醒反映记录当时的状态，不是现在的购买承诺。</p><h2>购买前核验</h2><p>最终价格、单位、周期与库存以店铺结算页面为准。请自行核实商家身份、退款及质保条款。本站不售卖账号，不提供交易担保，也不验证账号长期可用性。</p><p>发现错误可通过<a href="/submit">反馈与合作</a>提交复核。</p></section>', "sources");
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

async function handleSubmissionRequest(req, res, submissionsDb, create = createSubmission, {fullResult=false,successStatus=201}={}) {
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
    const result = await create(submissionsDb, payload, { clientAddress: clientAddress(req) });
    return jsonResponse(res, successStatus, fullResult ? {ok:true,...result} : { ok: true, id: result.id });
  } catch (error) {
    if (isSubmissionBusy(error)) {
      res.setHeader('Retry-After','3');
      return jsonResponse(res,503,{ok:false,error:'提交服务繁忙，请稍后重试'});
    }
    if (error instanceof SubmissionError || error instanceof MerchantApplicationError) {
      if (error.closeRequest) {
        res.setHeader("Connection", "close");
        res.once("finish", () => req.destroy());
      }
      return jsonResponse(res, error.status, { ok: false, error: error.message });
    }
    throw error;
  }
}

function clientGone(req){return !!(req.airadarAbandoned||req.aborted);}
const edgeHitPaths=new Set(['/','/index.html','/catalog','/about','/contact','/product','/alerts','/sources','/privacy','/weekly','/shop','/official-prices','/en','/en/','/en/catalog','/en/about','/en/sources','/en/official-prices']);
function edgeHitUrl(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const path=typeof payload.p==='string'?payload.p:'';
  const search=typeof payload.s==='string'?payload.s:'';
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||path.length>200)return null;
  let url;
  try{url=new URL(path+(search.startsWith('?')?search.slice(0,800):''),'https://airadar.vip');}catch{return null;}
  if(url.pathname!==path)return null;
  const price=/^\/(?:en\/)?prices\/[a-z0-9-]+$/.test(url.pathname);
  const guide=url.pathname.startsWith('/guides/')||url.pathname.startsWith('/help/')||/^\/weekly\/\d{4}-W\d{2}$/.test(url.pathname);
  if(!price&&!guide&&!edgeHitPaths.has(url.pathname))return null;
  const next=new URL(url.pathname,'https://airadar.vip');
  for(const key of ['family','product','source','id','page','utm_source','utm_medium','utm_campaign']){
    const values=url.searchParams.getAll(key);
    if(values.length===1&&values[0]&&values[0].length<=200)next.searchParams.set(key,values[0]);
  }
  return next;
}
// Match the actual rendered surface; /catalog deliberately ignores filters.
// Do not use sponsorPagePath alone here: it normalizes an already-selected campaign.
function campaignsForSurface(campaigns,url){
  const path=url.pathname==='/en'?'/':url.pathname.replace(/^\/en(?=\/)/,'');
  const price=priceRoute(new URL(path+url.search,'https://airadar.vip'));
  if(price)return campaigns.filter(campaign=>campaign.placement==='sponsored_product'&&campaign.page_key===price.key);
  if(path==='/product'){const source=url.searchParams.get('source')||'',id=url.searchParams.get('id')||'';return campaigns.filter(campaign=>campaign.placement==='sponsored_product'&&campaign.source===source&&campaign.product_id===id);}
  if(path==='/catalog')return campaigns.filter(campaign=>campaign.placement==='sponsored_home');
  if(path==='/'||path==='/index.html'){
    if(normalizeShopQuery(url.searchParams.get('shop_q')))return [];
    const family=filtersOf(url).family,requested=url.searchParams.get('product');
    if(requested){const product=priceProduct(requested);return product?.family===family?campaigns.filter(campaign=>campaign.placement==='sponsored_product'&&campaign.page_key===product.key):[];}
    if(family!=='all')return campaigns.filter(campaign=>campaign.placement==='sponsored_category'&&campaign.page_key===family);
    return campaigns.filter(campaign=>campaign.placement==='sponsored_home');
  }
  return [];
}
function edgeCampaigns(analytics,url){
  let campaigns=[];try{campaigns=analytics?.outbound?.activeCampaigns?.()||[];}catch{return [];}
  return campaignsForSurface(campaigns,url);
}
function respectSponsorScheduleAtEdge(req,res,url,analytics){
  if(!['GET','HEAD'].includes(req.method))return;
  const path=url.pathname==='/en'?'/':url.pathname.replace(/^\/en(?=\/)/,'');
  if(!['/','/index.html','/catalog','/product'].includes(path)&&!priceRoute(new URL(path,'https://airadar.vip')))return;
  const now=Date.now();let campaigns=[];
  try{campaigns=analytics?.outbound?.listCampaigns?.()||[];}catch{return;}
  const scheduled=campaigns.filter(c=>c.status==='approved'&&c.reviewed_at&&[c.start_at,c.end_at].some(at=>{const delta=Date.parse(at)-now;return delta>=0&&delta<=30000;}));
  if(!campaignsForSurface(scheduled,url).length)return;
  // Only a boundary within the edge TTL needs a bypass. Stable campaigns
  // can share anonymous HTML; origin campaign revisions still invalidate it.
  const end=res.end;
  res.end=function(...args){if(!res.headersSent)res.setHeader('X-Accel-Expires','0');return end.apply(this,args);};
}
async function readEdgeBody(req){
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(type&&type!=='application/json'&&type!=='text/plain')return null;
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>2048)return null;chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'null');}catch{return null;}
}
async function publicHitRoute(req,res,analytics,guard,engaged=false){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Accel-Expires','0');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  if(req.method!=='POST'){res.setHeader('Allow','POST');res.statusCode=405;return res.end();}
  const site=req.headers['sec-fetch-site'];
  if(site==='cross-site'||site==='cross-origin'){res.statusCode=403;return res.end();}
  const origin=req.headers.origin,host=req.headers.host;
  if(origin&&origin!=='https://airadar.vip'&&origin!=='https://www.airadar.vip'&&origin!=='http://'+host&&origin!=='https://'+host){res.statusCode=403;return res.end();}
  if(guard?.beaconLimited?.(req)){res.statusCode=429;res.setHeader('Retry-After','30');return res.end();}
  if(engaged&&analytics?.engagedMode==='off'){res.statusCode=204;return res.end();}
  const target=edgeHitUrl(await readEdgeBody(req));
  if(!target){res.statusCode=400;return res.end();}
  const synthetic={method:'GET',url:target.pathname+target.search,headers:{...req.headers,'sec-fetch-dest':'document'},socket:req.socket};
  const product=priceRoute(target)||priceProduct(target.searchParams.get('product'));
  const context=product?.key?{kind:'product_view',productKey:product.key,specSelected:false}:null;
  res.statusCode=204;
  res.end();
  setImmediate(()=>{
    if(engaged){try{analytics?.recordEngaged(synthetic);}catch{}return;}
    try{analytics?.record(synthetic,200,undefined,context);}catch{}
    for(const campaign of edgeCampaigns(analytics,target))try{analytics?.outbound?.recordImpression(synthetic,campaign,new Date(),sponsorPagePath(synthetic.url,campaign));}catch{}
  });
}
async function routeRequest(req, res, { db, submissionsDb, admin, analytics, traffic, retention, reviews, replies, reviewHttp, xClaims, merchantUrlResolver, adsense, homeCache, contentCache, pageCache, scrapeGuard, quoteHistory }) {
  setSecurityHeaders(res);
  const url = new URL(req.url, "http://localhost");
  if(canonicalHostRedirect(req,res,url))return;
  if(tapeoutRoute(req,res,url))return;
  if(url.pathname==='/api/public-engaged')return publicHitRoute(req,res,analytics,scrapeGuard,true);
  if(url.pathname==='/api/public-hit')return publicHitRoute(req,res,analytics,scrapeGuard);
  if(scrapeGuard&&await scrapeGuard.handle(req,res,url))return;
  if(clientGone(req))return;
  respectSponsorScheduleAtEdge(req,res,url,analytics);
  if(contentCache.handle(req,res))return;
  if(process.env.AIRADAR_PUBLIC_HTML_CACHE==='off')res.setHeader('X-Accel-Expires','0');
  else {
    if(homeCache.handle(req,res))return;
    if(pageCache?.handle(req,res))return;
  }
  if(url.pathname==='/api/quote-history')return quoteHistoryRoute(req,res,url,db,quoteHistory,scrapeGuard);
  if(url.pathname==='/assets/quote-history.js'){servePublicAsset(req,res,url,quoteHistoryScript);return;}
  if(url.pathname==='/favicon.ico'){
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    res.writeHead(301,{Location:'/assets/brands/airadar.png'});res.end();return;
  }
  const cleanPrice=priceRoute(url);
  if(cleanPrice&&['GET','HEAD'].includes(req.method)){
    const compact=compactPriceParams(url.searchParams),target=cleanPrice.path+(compact.size?'?'+compact:'');
    if(url.pathname.endsWith('/')||compact.toString()!==url.searchParams.toString()){res.writeHead(301,{Location:target});res.end();return;}
    const available=loadDirectory(db).some(c=>c.key===cleanPrice.family&&c.products.some(p=>p.key===cleanPrice.key));
    if(available||hasScheduledProductSponsor(analytics,cleanPrice.key)){url.pathname='/';url.searchParams.set('family',cleanPrice.family);url.searchParams.set('product',cleanPrice.key);}
  }
  if(url.pathname==='/'&&['GET','HEAD'].includes(req.method)&&!cleanPrice){const redirect=legacyPriceRedirect(url,loadDirectory(db));if(redirect){res.writeHead(301,{Location:redirect});res.end();return;}}
  if(url.pathname==='/assets/site.css'){servePublicAsset(req,res,url,siteStyle);return;}
  if(url.pathname==='/assets/directory.js'){servePublicAsset(req,res,url,directoryScript);return;}
  if(url.pathname==='/assets/public-traffic.js'){servePublicAsset(req,res,url,publicTrafficScript);return;}
  if (url.pathname==='/' && (retiredCatalogItem({key:url.searchParams.get('product')}) || ['verify','otp','relay','api'].includes(url.searchParams.get('family')) || retiredCatalogSource(url.searchParams.get('source')) || url.searchParams.get('purpose')==='api')) {
    res.statusCode=410;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.end(layout('商品已下架','<section class="surface"><h1>该业务已下架</h1><p>相关商品不再展示。</p><a href="/">返回首页</a></section>'));return;
  }
  const runtimeAsset=runtimeSponsorAsset(url.pathname);
  if(runtimeAsset){
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return jsonResponse(res,405,{error:'Method not allowed'});}
    res.setHeader('Content-Type',runtimeAsset.type);res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('Content-Length',runtimeAsset.body.length);res.end(req.method==='HEAD'?undefined:runtimeAsset.body);return;
  }
  if(sponsorArt.has(url.pathname)){
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return jsonResponse(res,405,{error:'不支持此方法'});}
    const data=sponsorArt.get(url.pathname);res.setHeader('Content-Type','image/webp');res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('Content-Length',data.length);res.end(req.method==='HEAD'?undefined:data);return;
  }
  if(url.pathname==='/assets/merchant-x.js'){
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return jsonResponse(res,405,{error:'不支持此方法'});}
    res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(req.method==='HEAD'?'':merchantXScript);return;
  }
  if (brandAssetRoute(req,res,url)) return;
  if (seoRoute(req,res,url,db,()=>loadDirectory(db),()=>weeklyWeeksWithData(retention.store?.db,retention.now()))) return;
  if(url.pathname==='/en'||url.pathname.startsWith('/en/')){
    res.setHeader('Content-Language','en');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD','X-Robots-Tag':'noindex, nofollow'});res.end('Method not allowed');return;}
    const page=englishResponse(url,{directory:()=>loadDirectory(db),render:source=>{
      let html,status=200;
      const context={locale:'en',analytics,traffic,req,res,retention,reviews,xProfiles:xClaims.profiles(),merchantBadges:submissionsDb?approvedMerchantBadges(submissionsDb):[],shopCatalogOptions:publicShopCatalogOptions(db,submissionsDb)};
      if(source&&(source.pathname==='/'||source.pathname==='/catalog')){
        const requested=source.searchParams.get('product');
        if(requested&&!loadDirectory(db).some(c=>c.key===source.searchParams.get('family')&&c.products.some(p=>p.key===requested)))status=404;
        else html=homePage(db,source,context);
      }else if(source?.pathname==='/official-prices'||source?.pathname.startsWith('/official-prices/')){const content=officialPriceContent(db,source);if(content)html=layout('AI 官方订阅地区价格',content,'official');else status=404;}
      else if(source?.pathname==='/product'){
        const content=seoProduct(db,source)&&officialPriceContent(db,source);
        if(content)html=layout('官方地区价',content,'official');else status=404;
      }else if(source?.pathname==='/shop'){
        const shop=/^[a-f0-9]{24}$/.test(source.searchParams.get('id')||'')?xClaims.shop(source.searchParams.get('id')):null;
        if(shop)html=layout(shop.name+' · 店铺报价与评价',shopContent(shop,xClaims.profiles(),englishReviewBrowsing(shopReviewsContent(shop,reviews.publicList(shop.id,{page:source.searchParams.get('review_page')}),replies),shop.id),context.merchantBadges));
        else status=404;
      }else if(source?.pathname==='/about')html=layout('关于本站',aboutContent());
      else if(source?.pathname==='/contact')html=layout('联系我们',contactContent());
      else if(source?.pathname==='/sources')html=sourcesPage(db);
      else status=404;
      if(status!==200)html=layout('页面不存在','<h1>页面不存在</h1><p><a href="/">返回首页</a></p>');
      return {status,html:decorateSeo(html,source||url,db,status)};
    }});
    if(page.location){res.writeHead(page.status,{Location:page.location});res.end();return;}
    res.statusCode=page.status;res.setHeader('Content-Type','text/html; charset=utf-8');
    if(page.noindex)res.setHeader('X-Robots-Tag','noindex, follow');
    res.end(req.method==='HEAD'?'':page.html);return;
  }
  if (adsenseRoute(req,res,url,adsense)) return;
  if(await retention.route(req,res,url))return;
  if(await reviewHttp(req,res,url))return;
  if(url.pathname==='/api/sponsor-view'){
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'){res.setHeader('Allow','POST');return jsonResponse(res,405,{ok:false});}
    if(!sameOrigin(req)||req.headers['sec-fetch-site']==='cross-site')return jsonResponse(res,403,{ok:false});
    try{const payload=await readSubmissionJson(req);if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['id','token'].includes(k)))return jsonResponse(res,400,{ok:false});analytics?.outbound?.recordVisible(req,payload.id,payload.token);return jsonResponse(res,200,{ok:true});}
    catch(error){return jsonResponse(res,error.status||400,{ok:false});}
  }
  if(handleSponsorContact(req,res,url,{analytics}))return;
  if(handleOutbound(req,res,url,{db,analytics}))return;
  if (await admin(req, res, url)) return;
  if (url.pathname === "/api/submissions") return handleSubmissionRequest(req, res, submissionsDb);
  if (url.pathname === '/api/merchant-applications') return handleSubmissionRequest(req,res,submissionsDb,async(_db,payload,options)=>{
    const applicant=()=>{
      const account=retention.account(req);
      if(!account)throw new MerchantApplicationError(401,'提交店铺前请先注册并登录');
      const profile=retention.profile(account.id);
      if(!profile)throw new MerchantApplicationError(422,'请先在“我的账号”补齐手机号和微信、TG、QQ 中的一项联系方式');
      if(retention.phoneVerificationRequired&&!/^\+861[3-9]\d{9}$/.test(profile.phone))throw new MerchantApplicationError(422,'商家入驻暂仅支持中国大陆 +86 手机号短信验证');
      if(retention.phoneVerificationRequired&&!profile.phoneVerified)throw new MerchantApplicationError(422,'提交店铺前请先完成手机号短信验证');
      return {accountId:account.id,email:account.email,phone:profile.phone,contact:profileContact(profile)};
    };
    const owner=applicant();
    const normalized=await normalizeMerchantSubmission(payload,{applicant:owner,resolveShopUrl:merchantUrlResolver,requestKey:owner.accountId});
    // Resolution is asynchronous; recheck the session/profile before saving.
    const current=applicant();
    if(current.accountId!==owner.accountId)throw new MerchantApplicationError(401,'登录状态已变化，请刷新后重新提交');
    return createMerchantApplication(_db,normalized,{...options,applicant:current,phoneVerificationRequired:retention.phoneVerificationRequired});
  });
  if(url.pathname.startsWith('/api/shop-claims/')){
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    const action=url.pathname.slice('/api/shop-claims/'.length);
    if(!['start','submit','status'].includes(action))return jsonResponse(res,404,{error:'接口不存在'});
    return handleSubmissionRequest(req,res,submissionsDb,(_db,input,options)=>xClaims[action](input,options),{fullResult:true,successStatus:action==='start'?201:200});
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return jsonResponse(res, 405, { ok: false, error: "该页面不接受此请求方法" });
  }
  if (url.pathname === '/submit' && url.searchParams.get('topic') === 'merchant_claim') {
    const params = new URLSearchParams({shop:url.searchParams.get('shop')?.slice(0,100)||''});
    // Older links often contain product URLs; ask for the shop homepage anew.
    res.writeHead(303, {Location:'/submit-shop?'+params});
    return res.end();
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const reader=retention.account(req);
  let html;
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/catalog") {
    if(clientGone(req))return;
    if(normalizeShopQuery(url.searchParams.get('shop_q')))res.setHeader('X-Robots-Tag','noindex, follow');
    const requestedProduct=url.searchParams.get('product'),requestedFamily=url.searchParams.get('family');
    const scheduledProduct=priceProduct(requestedProduct)?.family===requestedFamily&&hasScheduledProductSponsor(analytics,requestedProduct);
    if(url.pathname!=='/catalog'&&requestedProduct&&!scheduledProduct&&!normalizeShopQuery(url.searchParams.get('shop_q'))&&!loadDirectory(db).some(c=>c.key===requestedFamily&&c.products.some(p=>p.key===requestedProduct))){res.statusCode=404;html=layout('产品不存在','<main><h1>产品不存在</h1><p><a href="/">重新选择订阅产品</a></p></main>');}
    else html = homePage(db,url,{analytics,traffic,req,res,retention,reviews,xProfiles:xClaims.profiles(),merchantBadges:submissionsDb?approvedMerchantBadges(submissionsDb):[],shopCatalogOptions:publicShopCatalogOptions(db,submissionsDb)});
  }
  else if (url.pathname === "/product") {if(clientGone(req))return;if(!seoProduct(db,url))res.statusCode=404;html = await productPage(db, url,{analytics,req,res,retention,reviews,quoteHistory,quoteToken:params=>scrapeGuard?.quoteToken(params)||'',xProfiles:xClaims.profiles(),merchantBadges:submissionsDb?approvedMerchantBadges(submissionsDb):[]});if(clientGone(req)||res.writableEnded)return;}
  else if(url.pathname==='/official-prices'||/^\/official-prices\/[a-z0-9-]+$/.test(url.pathname)){const content=officialPriceContent(db,url);if(content)html=layout('AI 官方订阅地区价格',content,'official');else{res.statusCode=404;html=layout('未收录','<p>本期未收录</p>');}}
  else if(url.pathname==='/shop'){
    const shop=/^[a-f0-9]{24}$/.test(url.searchParams.get('id')||'')?xClaims.shop(url.searchParams.get('id')):null;
    if(!shop)res.statusCode=404;
    html=layout(shop?shop.name+' · 店铺报价与评价':'店铺暂未收录',shop?shopContent(shop,xClaims.profiles(),shopReviewsContent(shop,reviews.publicList(shop.id,{page:url.searchParams.get('review_page')}),replies),submissionsDb?approvedMerchantBadges(submissionsDb):[]):'<h1>店铺暂未收录</h1><p><a href="/submit-shop">提交店铺申请</a></p>');
  }
  else if(url.pathname==='/following')html=layout('我的关注',followingContent(),'following');
  else if(url.pathname==='/about')html=layout('关于本站',aboutContent());
  else if(url.pathname==='/contact')html=layout('联系我们',contactContent());
  else if(contentForPath(url.pathname))html=layout(contentForPath(url.pathname).title,contentPage(url.pathname),'guides');
  else if(['/login','/register','/reset-password','/account'].includes(url.pathname)){
    res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
    if(url.pathname==='/account'&&!reader){res.writeHead(303,{Location:'/login?next=%2Faccount'});return res.end();}
    if(reader&&(url.pathname==='/login'||url.pathname==='/register'&&url.searchParams.get('method')!=='password')){res.writeHead(303,{Location:url.searchParams.get('role')==='merchant'?'/submit-shop':safeAccountReturn(url.searchParams.get('next'))});return res.end();}
    const mode=url.pathname==='/reset-password'?'reset':url.pathname==='/register'&&url.searchParams.get('method')==='password'?'password-register':url.pathname.slice(1);
    const nonce=randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
    html=layout(mode==='account'?'我的账号':mode==='login'?'登录':mode==='reset'?'重置密码':'注册',mode==='account'?accountContent(reader,retention.hasPassword(reader.id),retention.profile(reader.id),safeAccountReturn(url.searchParams.get('next')),{googleLinked:retention.googleLinked(reader.id),merchantContext:url.searchParams.get('role')==='merchant',phoneVerificationRequired:retention.phoneVerificationRequired}):loginContent(mode,url,{googleConfigured:retention.googleConfigured,phoneVerificationRequired:retention.phoneVerificationRequired}),'',{privateAccount:true}).replace(/<script\b/g,`<script nonce="${nonce}"`);
  }
  else if(url.pathname==='/weekly'&&(url.searchParams.has('date')||url.searchParams.has('group'))){const content=weeklyContent(retention,url);if(!content)res.statusCode=404;html=layout('行情周报',content||'<h1>该日期的行情暂不可查看</h1>','weekly');}
  else if(url.pathname==='/weekly'){res.writeHead(301,{Location:'/weekly/'+retention.currentWeek()});return res.end();}
  else if(/^\/weekly\/\d{4}-W\d{2}$/.test(url.pathname)){const report=retention.weeklyReport(url.pathname.slice('/weekly/'.length));if(!report)res.statusCode=404;html=layout('订阅行情周报',report?weeklyReportContent(report):'<h1>这一周还没有可查看的行情</h1><p><a href="/weekly">查看最新周报</a></p>','weekly');}
  else if(url.pathname==='/unsubscribe'){res.setHeader('Referrer-Policy','no-referrer');html=layout('退订提醒',unsubscribeContent((url.searchParams.get('token')||'').slice(0,160)));}
  else if (url.pathname === "/alerts") html = alertsPage(db,url);
  else if (url.pathname === "/advertise") html=layout("广告合作",sponsorAdvertiseContent(url),"advertise");
  else if (url.pathname === "/sources") html = sourcesPage(db);
  else if (url.pathname === "/privacy") html = layout("隐私说明",`${pageIntro("隐私与访问统计","更新于2026年11月2日")}<section class="surface" style="padding:24px"><h2>第一方访问统计</h2><p>本站为了解使用情况，统计成功的公开页面访问量及访客估算。我们在服务器内短暂使用当前Cloudflare Tunnel提供的网络地址和浏览器粗分类生成HMAC去标识摘要；不保存原始IP、完整浏览器标识、完整URL、查询参数或表单信息，不使用跨站追踪 Cookie。去标识并不等于完全匿名。公开页面会由浏览器写入一个第一方 Cookie（airadar_hv），只表示这个浏览器能执行脚本，值不入库、不跨站。网关短缓存直接返回页面时，浏览器会再发一次不含报价内容的访问回执，按本节同样的去标识规则补记浏览量和广告输出；回执失败不影响打开页面。</p><p>在线去重摘要保留31天，按日汇总长期保留；服务器每日备份最多14份。用于灾难恢复的加密异机历史副本长期保留，仅站长可恢复，不用于延长访问追踪。历史摘要可能继续存在于这些加密历史副本中。首页公开站点级浏览量和访客估算汇总及其统计时间；去重摘要、明细和其余后台统计不公开。公开汇总不包含个人身份、来源页面或浏览轨迹，不代表广告曝光或成交。共享网络可能合并计数，换网络或浏览器可能重复计数，已知机器人过滤不能保证完全准确。</p><p>后台、API、投稿页、健康检查、预取、错误响应与带管理员会话的请求不参与统计。访客估算不能等同实际人数，服务器访问量不能等同精准真人PV。</p><h2>购买路径统计</h2><p>我们按固定产品标识记录产品浏览、明确规格、自然出站、保存关注、设置到期、分享操作及关注页回访。来源只保存搜索、社交、AI 来源、其他引荐、站内、直接或未知等类别，不保存来源网址或搜索词。明细按网络地址与浏览器粗分类的 HMAC 摘要去重并保留31天，按日汇总长期保留。各阶段用于判断路径使用情况，不代表严格先后完成的转化或成交；缺失来源不能确认为直接访问，分享操作也不代表发布成功。</p><h2>指南阅读统计</h2><p>订阅指南和帮助中心计入公开页面访问。为判断文章是否帮助读者继续比价，我们记录固定文章标识的每日阅读请求，以及携带该本站文章来源的后续报价页请求。仅保存按日汇总，不保存来源网址、查询参数或跨页面浏览轨迹，不添加追踪 Cookie。来源缺失可能漏计，刷新可能重复；这些请求不代表关注、购买或成交。统计前的历史不补造，汇总长期保留。</p><h2>商家跳转与直接赞助统计</h2><p>前往商家时通过本站跳转记录出站点击，直接赞助位的广告输出与可见展示单独统计。此处统计不包含 Google AdSense 广告。输出仅指服务端已输出含广告页面的请求，不代表屏幕可见曝光或真实人数；可见展示由浏览器检测广告至少 50% 面积在前台页面中持续进入屏幕 1 秒后上报活动编号和短期校验令牌。两项均按网络地址与浏览器粗分类的每日去标识摘要去重，是估算而非自然人数。用于去重的每日 HMAC 摘要明细保留31天，按日汇总长期保留；不保存原始 IP、User-Agent、来源页面 referrer 或完整查询参数，不添加追踪 Cookie。记录不代表购买或成交。</p><h2>自选关注与提醒</h2><p>游客关注、到期日期和上次查看价格保存在当前浏览器。主动确认邮箱后，关注条件与到期日期保存到私有数据库，用于跨设备同步及你自行选择的提醒。验证码在10分钟内有效；确认身份后使用30天有效的HttpOnly会话Cookie，页面验证Cookie有效1天。这些Cookie用于功能与安全，不用于跨站追踪。</p><p>仅向确认邮箱发送自选行情或续费提醒，每个邮箱每天最多一封汇总；验证码独立限流。可以暂停单项、退订全部邮件，或在我的关注中删除线上账号数据。发件服务处理必要的地址和邮件内容。关注行为的去标识明细保留31天，按日汇总长期保留；通知记录保留90天，邮件状态保留31天，验证码限流记录24小时后清除。删除后的资料仍可能存在于既有灾难恢复备份中，按备份策略保留，不用于继续发送提醒。</p><p>已知用户回访以主动使用关注功能的去标识记录估算，游客和邮箱账号分别计数。邮件链接中的退订签名只允许停止该邮箱提醒，不允许读取关注内容。</p><h2>用户评价、购买凭证与商家回复</h2><p>新评价须上传本人购买记录供后台人工审核。购买截图仅作者和管理员可查看，不公开、不提供给商家；请先遮挡完整订单号、姓名、手机号、支付账号、密码、卡密及无关聊天信息。在线购买截图在上传满90天后清除，保留旧图编辑不延长其保存期限；核验时间与必要的审核记录保留。核对凭证不保证每项评价自述属实，历史未提交凭证的评价明确标注。</p><p>评价配图需另行选择，只有评价通过审核后公开；公开配图随评价保留，未公开配图在最后更新超过90天后定期清除。已核验店主可提交解释性回复，回复先审核后公开，不因此获得买家凭证，也不能删除用户评价。注销账号会撤下本人的评价和商家回复并清除正文、历史正文、在线配图与购买截图；必要审核元数据保留。清除不即时改写已有灾难恢复备份，备份按原策略保留。用于评价及回复防刷的网络摘要最多保留48小时；已被他人下载的公开图片无法追回。</p><h2>店主 X 认领</h2><p>已收录店铺的经营者可自愿提交 X 账号并同意公开关联。认领码用于核对 X 账号控制，站方另行核对店铺归属，审核通过后才展示账号链接；联系邮箱、核验说明和内部备注不公开，不会从旧投稿的私人联系方式自动提取 X 账号。X 关联只说明公开身份关联，不影响自然报价排序，也不代表信誉认证。</p><p>专属进度链接包含保存在浏览器中的随机查询凭据，请勿公开分享。草稿码有效7天，过期草稿会在后续申请时清除；限流摘要48小时后在后续申请时清除。已提交认领和审核记录供关联维护与争议处理使用；如需更正或删除资料，请联系站长并提供认领编号。撤销关联后停止公开展示，既有灾难恢复备份按原策略保留。分享到 X 需由本人在 X 页面确认，本站不会代发帖子。</p><h2>主动投稿</h2><p>店铺申请会记录提交账号及当时的邮箱、手机号和联系账号。删除账号不会自动删除已提交的店铺申请；如需更正或删除申请资料，请联系站长并提供申请编号。</p><p>反馈、供需与店铺申请中主动填写的信息仅供站长处理；联系方式、补充说明及内部审核记录不公开。${retention.phoneVerificationRequired?'商家提交新的店铺申请前须验证已保存的中国大陆手机号，普通用户无需手机号或短信验证。验证时号码会提交给阿里云短信认证服务用于发送和核验验证码。':'商家手机号短信验证已暂停，保存联系资料后即可提交申请；暂停期间不调用短信发送和核验服务，不将未验证号码标为已验证。普通用户无需手机号或短信验证。'}我们记录号码验证结果和时间，换号后须重新验证；验证码不写入日志、统计或浏览器存储，临时核验记录最多保留7天。防刷预算仅保存带密钥摘要，独立保留24小时，删除账号不重置短信限额。手机号验证不等于实名、店铺归属或交易信用核验。填写有效通知邮箱后，我们会通过发件服务发送提交回执、站方回复与处理结果；发件服务会处理必要的收件地址和邮件内容，不发送营销邮件。内部备注不会进入通知。店铺申请通过后，店铺名称、公开网址与收录状态标识可在相关报价中展示。收录不代表商家信用、商品质量或交易安全保证。申请限流使用去标识摘要并在48小时后清除，不保存原始IP。请勿提交密码、API Key等敏感凭据。如需查询或删除自己主动提交的信息，请通过页脚联系方式联系站长并提供投稿编号。</p></section>`);
  else if (url.pathname === "/submit" || url.pathname === '/submit-shop' || url.pathname === '/claim-shop') {
    if(url.pathname==='/submit-shop'){
      res.setHeader('Referrer-Policy','no-referrer');
      const next=encodeURIComponent(safeAccountReturn(url.pathname+url.search));
      const profile=reader?retention.profile(reader.id):null;
      const destination=!reader?'/login':!profile||(retention.phoneVerificationRequired&&(!profile.phoneVerified||!/^\+861[3-9]\d{9}$/.test(profile.phone)))?'/account':null;
      if(destination){res.writeHead(303,{Location:destination+'?next='+next});return res.end();}
    }
    const storedToken = parseCookies(req.headers.cookie).airadar_csrf;
    const csrfToken = /^[A-Za-z0-9_-]{32}$/.test(String(storedToken || ""))
      ? storedToken
      : randomBytes(24).toString("base64url");
    res.setHeader("Set-Cookie", csrfCookie(req, csrfToken));
    let claimShops=[];
    if(url.pathname==='/claim-shop'){
      res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
      claimShops=[...xClaims.catalog().values()];
      const selected=url.searchParams.get('shop')||'',stored=/^[a-f0-9]{24}$/.test(selected)&&xClaims.shop(selected);
      if(stored&&!claimShops.some(shop=>shop.id===selected))claimShops.unshift(stored);
    }
    html = url.pathname === '/claim-shop' ? layout('店主认领 X',claimContent(csrfToken,claimShops,url.searchParams.get('shop')||''),'submit',{csrfToken}) : url.pathname === '/submit-shop'
      ? layout('提交店铺', merchantSubmissionContent(csrfToken, {shopName:url.searchParams.get('shop')?.slice(0,100)||'',shopUrl:url.searchParams.get('url')?.slice(0,500)||'',account:{email:reader.email,...retention.profile(reader.id)},phoneVerificationRequired:retention.phoneVerificationRequired}), 'merchant', {csrfToken,privateAccount:true})
      : submissionPage(url, csrfToken);

  } else {
    res.statusCode = 404;
    html = layout("404", `${pageIntro("页面不存在", "请从总览重新选择内容")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  }
  if(res.statusCode>=400)res.setHeader("X-Robots-Tag","noindex, nofollow");
  if(url.pathname==='/privacy')html=html.replace('<h2>自选关注与提醒</h2>','<h2>用户账号与商家资料</h2><p>普通用户只需验证邮箱即可注册和登录，无需填写手机号、微信、TG 或 QQ。申请店铺审核时才要求补齐商家联系资料；'+(retention.phoneVerificationRequired?'商家提交新的店铺申请前须在商家专用流程完成中国大陆手机号短信验证。':'商家手机号短信验证已暂停，保存联系资料后即可提交申请。')+'普通用户注册和登录不涉及手机号或短信验证。联系资料保存在私有数据库，仅供本人和站方使用，不在公开页面展示。注册不代表店铺已收录，也没有管理员权限。</p><p>邮箱验证码10分钟有效，最多尝试5次，只能使用一次；注册登录与密码重置的验证码用途相互隔离。原有密码登录保留，用户可自愿设置密码。密码只保存带随机盐的 scrypt 哈希。重置密码会退出所有已有会话，可用新密码或邮箱验证码重新登录；原有关注和退订设置保留。</p><p>使用 Google 登录时，本站仅申请 openid 和 email 权限，保存经验证的邮箱及 Google 身份标识用于登录和防止重复账号，不读取邮箱内容，不保存 Google 密码、访问令牌或刷新令牌。授权过程使用10分钟有效、一次性的防伪状态、浏览器绑定与PKCE。Google 登录会转到 Google 页面，由其按自身隐私政策处理。你可以选择邮箱验证码，不必使用 Google 登录。</p><p>登录尝试以带密钥的邮箱和网络摘要限流，不保存原始IP或密码。验证码请求限流记录24小时清理，密码尝试约15分钟后清理，过期Google授权状态在后续清理周期删除。注册不订阅行情或营销邮件。登录和账号页面不加载第三方统计脚本。可以在我的关注中删除线上账号、商家联系资料、Google身份关联、密码哈希、关注与会话；既有灾难恢复备份仍按原策略保留。</p><h2>自选关注与提醒</h2>');
  if(url.pathname==='/privacy')html=html.replace('<h2>购买路径统计</h2>','<h2>Cloudflare 公开访问汇总</h2><p>配置 Cloudflare 数据源时，首页仅展示 Cloudflare 对本站的站点级唯一访问者汇总，以及统计区间和同步时间。这是基于 IP 的去重估算，可能包含机器人或自动化流量，不等同实际人数、广告曝光或成交，也不与上述第一方统计混算。服务端每5分钟读取汇总并保留最后一次有效结果，页面请求不直接调用 Cloudflare。专用只读令牌仅保存在服务器私有配置中；前端和公开缓存不包含令牌、访客地址或访问明细。本功能不新增浏览器追踪脚本或 Cookie。</p><h2>购买路径统计</h2>');
  if(reader)html=html.replace('<a class="nav-link" data-reader-nav href="/login">登录 / 注册</a>','<a class="nav-link" data-reader-nav href="/account">我的账号</a>');
  if(html.includes('data-sponsor-id=')||url.pathname==='/advertise')html=html.replace('</body>','<script>'+sponsorScript+'</script></body>');
  html=decorateSeo(html,url,db,res.statusCode);
  html=decorateChineseLanguage(html,url,res.statusCode);
  html=decorateAdSense(html,url,res.statusCode,adsense);
  if(clientGone(req)||res.writableEnded)return;
  if (req.method === "HEAD") return res.end();
  res.end(html);
}

function publicShopCatalogOptions(db,submissionsDb){
  let health=[];
  try{const value=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='health:merchant-onboarding'").get()?.value||'{}');if(Array.isArray(value.targets))health=value.targets;}catch{}
  return {approvedMerchants:submissionsDb?approvedMerchantBadges(submissionsDb):[],health,
    withdrawnIdentities:submissionsDb?submissionsDb.prepare("SELECT identity FROM merchant_applications WHERE status IN ('paused','rejected')").all().map(row=>row.identity):[]};
}

export function createApp({ db, submissionsDb = null, analytics = null, adminOptions = {}, retentionOptions = {}, merchantXOptions = {}, merchantUrlResolver = resolveMerchantShopUrl, adsenseEnv = process.env, trafficEnv = process.env, trafficOptions = {}, scrapeGuardOptions = {} }) {
  const adsense=adsenseConfig(adsenseEnv);
  // Reconcile from private, durable approval records after every restart. Never
  // continue with a stale manifest if reconciliation fails.
  if (submissionsDb) syncApprovedMerchantManifest(submissionsDb, adminOptions.merchantBridgeDir);
  migrateSponsorScopes(db,analytics);
  let reviews,replies;
  const retention=createRetention({db,submissionsDb,...retentionOptions,onDeleteAccount:account=>{reviews?.eraseAccount(account);replies?.eraseAccount(account);retentionOptions.onDeleteAccount?.(account);}});
  const xClaims=createMerchantX({privateDb:submissionsDb,readDirectory:()=>loadDirectory(db),readCatalogOptions:()=>publicShopCatalogOptions(db,submissionsDb),...merchantXOptions});
  reviews=createShopReviews({db:submissionsDb,digest:retention.store?.digest,shopById:id=>xClaims.shop(id),now:retentionOptions.now});
  replies=createShopReviewReplies({db:submissionsDb,digest:retention.store?.digest,shopById:id=>xClaims.shop(id),isMerchant:(account,shop)=>reviews.canReply(account,shop.id),now:retentionOptions.now});
  const reviewHttp=createShopReviewHttp({reviews,replies,retention,shopById:id=>xClaims.shop(id),env:retentionOptions.env});
  const admin = createAdmin({ db, submissionsDb, analytics, retentionStore:retention.store, reviews, replies, xClaims, backupDir: process.env.SUBMISSIONS_BACKUP_DIR, ...adminOptions });
  // Even a partial Cloudflare configuration selects this source. An unavailable
  // Cloudflare snapshot must never be replaced by unrelated first-party counts.
  const cloudflareConfigured=['CLOUDFLARE_ANALYTICS_API_TOKEN','CLOUDFLARE_ANALYTICS_ZONE_ID'].some(key=>Object.hasOwn(trafficEnv||{},key));
  const traffic=cloudflareConfigured?createCloudflareTraffic({...trafficOptions,
    token:trafficEnv.CLOUDFLARE_ANALYTICS_API_TOKEN,zoneId:trafficEnv.CLOUDFLARE_ANALYTICS_ZONE_ID,
    cachePath:trafficEnv.CLOUDFLARE_TRAFFIC_CACHE_PATH||trafficOptions.cachePath,
  }):createPublicTraffic({analytics,...trafficOptions});
  const dataRevision=homeResponseRevision(db,submissionsDb,analytics);
  const cacheRevision=()=>dataRevision()+'|'+(traffic.get()?.updatedAt||'');
  const replayImpressions=(req,res,campaigns)=>recordPageImpressions(req,res,analytics,campaigns);
  const homeCacheMs=Number(process.env.AIRADAR_HOME_CACHE_MS),pageCacheMs=Number(process.env.AIRADAR_PAGE_CACHE_MS);
  const homeCache=createHomeResponseCache({revision:cacheRevision,onImpressions:replayImpressions,...(Number.isFinite(homeCacheMs)&&homeCacheMs>=0?{maxAgeMs:homeCacheMs}:{})});
  const pageCache=createPublicPageCache({revision:cacheRevision,onImpressions:replayImpressions,...(Number.isFinite(pageCacheMs)&&pageCacheMs>=0?{maxAgeMs:pageCacheMs}:{})});
  const contentCache=createContentResponseCache();
  const scrapeGuard=createScrapeGuard(scrapeGuardOptions);
  const quoteHistory=createQuoteHistoryService({db});
  const server = http.createServer((req, res) => {
    req.on('aborted',()=>{req.airadarAbandoned=true;});
    if(analytics)res.once("finish",()=>setImmediate(()=>{try{analytics.record(req,res.statusCode,undefined,res.growthContext,res);}catch{/* Non-critical metrics must not affect requests. */}}));
    routeRequest(req, res, { db, submissionsDb, admin, analytics, traffic, retention, reviews, replies, reviewHttp, xClaims, merchantUrlResolver, adsense, homeCache, contentCache, pageCache, scrapeGuard, quoteHistory }).catch((error) => {
      // Admin exceptions must never include a private submission value in logs.
      let pathname = '';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {}
      if (/^\/(admin|api\/(?:submissions|merchant-applications|shop-reviews))/.test(pathname)) console.error("[private] internal request failure");
      else console.error("[web] 500:", error.stack || error.message);
      if (res.headersSent || res.destroyed || req.destroyed) return res.end();
      setSecurityHeaders(res);
      res.statusCode = 500;
      if (pathname.startsWith("/api/")) {
        jsonResponse(res, 500, { ok: false, error: "服务暂时出错，请稍后再试" });
      } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(layout("服务错误", `${pageIntro("服务暂时出错", "请稍后再试")}`));
      }
    });
  });
  server.once('close',()=>traffic.close());
  server.once('close',()=>scrapeGuard.close());
  server.once('close',()=>{server.quoteHistoryClosed=quoteHistory.close();});
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  if (submissionsDb) {
    const hashCleanupTimer = setInterval(() => {
      try {
        purgeExpiredClientHashes(submissionsDb);
        reviews.purge();
        replies.purge();
        submissionsDb.prepare('UPDATE merchant_applications SET client_hash=NULL WHERE client_hash IS NOT NULL AND created_at < ?').run(new Date(Date.now()-48*60*60*1000).toISOString());
      } catch (error) {
        console.error("[submissions] 限流摘要定时清理失败:", error.message);
      }
    }, 60 * 60 * 1000);
    hashCleanupTimer.unref();
    server.once("close", () => clearInterval(hashCleanupTimer));
  }
  startMerchantWorkflow(server,{submissionsDb,db,adminOptions});
  retention.start(server);
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
