// 只读 Web 层：零依赖 Node http + 服务端渲染。
// 保持既有路由：/、/product、/alerts、/sources。

import http from "node:http";

// 人工展示映射，只用于浏览，不能视作 SKU 等价断言。
const FAMILIES = [
  { family: "ChatGPT Go", platform: "ChatGPT", priceai: "chatgpt-go", official: "chatgpt-go", ldxp: null },
  { family: "ChatGPT Plus（试用/成品）", platform: "ChatGPT", priceai: "chatgpt-plus", official: null, ldxp: null },
  { family: "ChatGPT Plus（正价代充）", platform: "ChatGPT", priceai: "chatgpt-plus-recharge", official: "chatgpt-plus", ldxp: "chatgpt-plus-代充" },
  { family: "ChatGPT Pro 5x", platform: "ChatGPT", priceai: "chatgpt-pro-5x", official: "chatgpt-pro-5x", ldxp: null },
  { family: "ChatGPT Pro 20x", platform: "ChatGPT", priceai: "chatgpt-pro-20x", official: "chatgpt-pro-20x", ldxp: null },
  { family: "ChatGPT Team/Business", platform: "ChatGPT", priceai: "chatgpt-team-business", official: null, ldxp: null },
  { family: "Claude Pro", platform: "Claude", priceai: "claude-pro-month", official: "claude-pro", ldxp: "claude-pro-代充" },
  { family: "Claude Max 5x", platform: "Claude", priceai: "claude-max-5x", official: "claude-max-5x", ldxp: null },
  { family: "Claude Max 20x", platform: "Claude", priceai: "claude-max-20x", official: "claude-max-20x", ldxp: null },
  { family: "Gemini Plus", platform: "Gemini", priceai: "gemini-pro-recharge", official: "gemini-ai-plus", ldxp: null },
  { family: "Gemini Ultra", platform: "Gemini", priceai: "gemini-ultra", official: "gemini-ai-ultra", ldxp: null },
  { family: "Grok Super", platform: "Grok", priceai: "super-grok", official: "grok-supergrok", ldxp: null },
  { family: "Grok Super Heavy", platform: "Grok", priceai: "super-grok-heavy", official: "grok-supergrok-heavy", ldxp: null },
  { family: "X Premium", platform: "X", priceai: "x-twitter-premium", official: "x-premium", ldxp: null },
];

const FAMILY_FILTERS = [
  { key: "all", label: "全部", platform: null },
  { key: "chatgpt", label: "ChatGPT", platform: "ChatGPT" },
  { key: "claude", label: "Claude", platform: "Claude" },
  { key: "gemini", label: "Gemini", platform: "Gemini" },
  { key: "grok", label: "Grok", platform: "Grok" },
  { key: "x", label: "X", platform: "X" },
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
};

const SOURCE_SHORT = {
  priceai: "PriceAI",
  "ldxp-goods": "LDXP",
  "cardnav-official": "CardNav",
  "goaihop-relay": "GoAIHop",
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

function sourceClass(source) {
  return ({
    "cardnav-official": "official",
    priceai: "priceai",
    "ldxp-goods": "ldxp",
    "goaihop-relay": "goaihop",
  })[source] ?? "neutral";
}

function platformTone(platform) {
  return ({
    ChatGPT: "chatgpt",
    Claude: "claude",
    Gemini: "gemini",
    Grok: "grok",
    X: "x",
    Microsoft: "microsoft",
    "AI 中转 API": "relay",
    "接码": "verify",
    "邮箱": "mail",
  })[platform] ?? "other";
}

function productHref(source, id) {
  return "/product?source=" + encodeURIComponent(source ?? "") + "&amp;id=" + encodeURIComponent(id ?? "");
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

function latestProducts(db, source) {
  const latest = db.prepare(
    "SELECT snapshot_id, fetched_at FROM snapshots WHERE source = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1"
  ).get(source);
  if (!latest) return null;
  const products = db.prepare(
    "SELECT * FROM products WHERE source = ? AND snapshot_id = ?"
  ).all(source, latest.snapshot_id);
  return { source, snapshotId: latest.snapshot_id, fetchedAt: latest.fetched_at, products };
}

function cheapestOffer(db, source, snapshotId, productId) {
  return db.prepare(
    "SELECT * FROM offers WHERE source = ? AND snapshot_id = ? AND product_id = ? ORDER BY (status = 'out_of_stock') ASC, price ASC LIMIT 1"
  ).get(source, snapshotId, productId);
}

function offersOf(db, source, snapshotId, productId) {
  return db.prepare(
    "SELECT * FROM offers WHERE source = ? AND snapshot_id = ? AND product_id = ? ORDER BY (status = 'out_of_stock') ASC, price ASC"
  ).all(source, snapshotId, productId);
}

function priceSeriesRows(db, source, productId) {
  return db.prepare(
    "SELECT s.fetched_at, p.lowest_price FROM products p JOIN snapshots s ON s.source = p.source AND s.snapshot_id = p.snapshot_id WHERE p.source = ? AND p.product_id = ? AND p.lowest_price IS NOT NULL ORDER BY s.fetched_at ASC"
  ).all(source, productId);
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

function stockSummary(product) {
  const inStock = Number(product?.in_stock_count ?? 0);
  const offers = Number(product?.offer_count ?? 0);
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
  const extra = extraOf(offer);
  if (!extra) return "";
  const parts = [];
  if (extra.availability7d != null) parts.push("可用 " + extra.availability7d + "%");
  if (extra.totalLatencyP50Ms != null) parts.push("P50 " + extra.totalLatencyP50Ms + "ms");
  if (extra.sampleCount != null) parts.push("样本 " + extra.sampleCount);
  if (extra.testedModelCount != null) parts.push("测 " + extra.testedModelCount + " 模型");
  if (extra.sponsored) parts.push("赞助");
  return parts.length ? `<div class="metric">${esc(parts.join(" · "))}</div>` : "";
}

function icon(name, cls = "") {
  const svg = (paths) => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  if (name === "overview") return svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>');
  if (name === "bell") return svg('<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>');
  if (name === "database") return svg('<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>');
  if (name === "shield") return svg('<path d="M12 3 19 6v5c0 4.6-2.8 7.8-7 10-4.2-2.2-7-5.4-7-10V6l7-3Z"/><path d="m9.4 12 1.8 1.8 3.6-4"/>');
  if (name === "chevron") return svg('<path d="m9 18 6-6-6-6"/>');
  if (name === "external") return svg('<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>');
  if (name === "back") return svg('<path d="m15 18-6-6 6-6"/><path d="M9 12h11"/>');
  if (name === "clock") return svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>');
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
  return `<span class="updated">${icon("clock")}更新于 ${esc(fmtTime(list.fetchedAt))}</span>`;
}

function sparkline(rows, width = 680, height = 176) {
  const points = rows.filter((row) => row.lowest_price != null);
  if (points.length < 2) return null;
  const padX = 18;
  const top = 16;
  const bottom = 32;
  const values = points.map((row) => Number(row.lowest_price));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const x = (index) => padX + (index / (points.length - 1)) * (width - padX * 2);
  const y = (value) => height - bottom - ((value - min) / (max - min)) * (height - top - bottom);
  const line = points.map((row, index) => x(index).toFixed(1) + "," + y(Number(row.lowest_price)).toFixed(1)).join(" ");
  const area = padX + "," + (height - bottom) + " " + line + " " + (width - padX) + "," + (height - bottom);
  const grid = [0.25, 0.5, 0.75].map((ratio) => {
    const gridY = (top + (height - top - bottom) * ratio).toFixed(1);
    return `<line x1="${padX}" x2="${width - padX}" y1="${gridY}" y2="${gridY}"/>`;
  }).join("");
  const first = points[0];
  const last = points[points.length - 1];
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="最低价走势">
    <defs><linearGradient id="price-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#1463d9" stop-opacity=".20"/><stop offset="100%" stop-color="#1463d9" stop-opacity=".01"/></linearGradient></defs>
    <g class="chart-grid">${grid}</g>
    <polygon points="${area}" fill="url(#price-area)"/>
    <polyline points="${line}" fill="none" stroke="#1463d9" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(points.length - 1)}" cy="${y(Number(last.lowest_price))}" r="5.5" fill="#fff" stroke="#1463d9" stroke-width="3"/>
    <text x="${padX}" y="${height - 8}" class="chart-label">${esc(fmtTime(first.fetched_at))} · ${fmtPrice(first.lowest_price)}</text>
    <text x="${width - padX}" y="${height - 8}" text-anchor="end" class="chart-label">${esc(fmtTime(last.fetched_at))} · ${fmtPrice(last.lowest_price)}</text>
  </svg>`;
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

function layout(title, body, active = "") {
  const nav = (href, key, label) => {
    const current = active === key ? ' aria-current="page"' : "";
    const selected = active === key ? " active" : "";
    return `<a href="${href}" class="nav-link${selected}"${current}>${label}</a>`;
  };
  const categoryRail = active === "home" ? `<nav class="product-nav" aria-label="产品分类"><div class="product-nav-inner">${FAMILY_FILTERS.map(({ key, label, platform }) => `<button class="product-filter${key === "all" ? " active" : ""}" type="button" data-family-filter="${key}" aria-controls="comparison" aria-pressed="${key === "all"}"><span class="product-filter-mark mark-${key}" aria-hidden="true">${platformMark(platform ?? "all")}</span><span>${label}</span></button>`).join("")}</div></nav>` : "";
  const categoryScript = active === "home" ? `<script>
    (() => {
      const comparison = document.getElementById("comparison");
      const buttons = Array.from(document.querySelectorAll("[data-family-filter]"));
      const groups = Array.from(document.querySelectorAll("[data-family]"));
      const catalogSections = Array.from(document.querySelectorAll("[data-catalog-section]"));
      const fullComparison = document.querySelector("[data-comparison-details]");
      if (!comparison || !buttons.length || !groups.length) return;
      const setFamily = (family) => {
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
          if (count) count.textContent = visibleCount + " 个产品 · 当前快照";
        });
        if (fullComparison) fullComparison.open = family !== "all";
      };
      buttons.forEach((button) => button.addEventListener("click", () => {
        setFamily(button.dataset.familyFilter || "all");
        comparison.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }));
    })();
  </script>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="theme-color" content="#ffffff"/>
  <title>${esc(title)} · AI 订阅价格雷达</title>
  <style>
    :root{--ink:#071827;--canvas:#eef3f8;--surface:#fff;--soft:#f7faff;--text:#15233a;--muted:#68778d;--faint:#98a6b8;--line:#dfe7f1;--line-strong:#cbd8e7;--blue:#1463d9;--blue-deep:#0d4fac;--blue-soft:#eaf2ff;--green:#087a55;--amber:#a15c00;--red:#b42318;--shadow:0 14px 34px rgb(18 42 70 / 8%);--radius:14px;--font:ui-sans-serif,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    *{box-sizing:border-box}html{background:var(--canvas)}body{min-width:320px;margin:0;background:var(--canvas);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.5;text-rendering:optimizeLegibility}a{color:var(--blue);text-decoration:none}a:hover{color:var(--blue-deep)}a:focus-visible{outline:3px solid rgb(20 99 217 / 35%);outline-offset:2px;border-radius:5px}
    .wrap{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:30px 0 32px}.site-footer{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:18px 0 30px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.7}.footer-inner{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.footer-disclaimer{max-width:760px;margin:0}.footer-contact{display:flex;flex:0 0 auto;align-items:center;gap:8px 12px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--soft);white-space:nowrap}.footer-contact-label{color:var(--text);font-size:11px;font-weight:700}.footer-contact-links{display:flex;align-items:center;gap:7px}.footer-contact-link{display:inline-flex;align-items:center;gap:4px;color:var(--blue-deep);font-family:var(--mono);font-size:11px;font-weight:650}.footer-contact-link:hover{text-decoration:underline;text-underline-offset:3px}.footer-contact-link b{color:var(--text);font-family:var(--font);font-size:12px}.intro{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:4px 0 22px}.intro h1{margin:0;font-size:clamp(26px,3.2vw,34px);line-height:1.18;letter-spacing:-.03em}.intro p{margin:8px 0 0;color:var(--muted);font-size:14px}.source-pulse{display:flex;max-width:560px;flex-wrap:wrap;justify-content:flex-end;gap:7px 14px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.source-pulse span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.dot{width:7px;height:7px;border-radius:50%;background:var(--faint)}.dot.official{background:#1463d9}.dot.priceai{background:#7c3aed}.dot.ldxp{background:#0f8f6f}.dot.goaihop{background:#d97706}
    .comparison,.surface,.alerts,.sources{overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.comparison,.product-hero{box-shadow:var(--shadow)}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line)}.comparison>.head{padding:20px 22px 15px}.head h2{margin:0;color:var(--text);font-size:17px;line-height:1.3;letter-spacing:-.015em}.note{margin:4px 0 0;color:var(--muted);font-size:12px}.updated{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}.updated .icon{width:14px;height:14px}.dim{color:var(--muted)}.icon{width:17px;height:17px;flex:0 0 auto;vertical-align:-.2em}
    .table-scroll{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}table{width:100%;border-collapse:collapse}th,td{padding:14px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--muted);background:var(--soft);font-size:12px;font-weight:680;letter-spacing:.01em;white-space:nowrap}td{font-size:13px}tbody tr:last-child td{border-bottom:0}tbody tr{transition:background-color 150ms ease}tbody tr:hover{background:#f8fbff}.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
    .comparison-table{min-width:920px;table-layout:fixed}.comparison-table th:first-child,.comparison-table td:first-child{width:28%}.comparison-table th:not(:first-child),.comparison-table td:not(:first-child){width:24%}.comparison-table th>span{display:block;color:var(--faint);font-size:11px;font-weight:500;line-height:1.45}.product-name{display:flex;flex-direction:column;gap:3px}.product-name strong{font-size:14px}.product-name span{color:var(--muted);font-size:12px}.price-stack{display:flex;min-height:49px;flex-direction:column;align-items:flex-end;gap:4px}.price-stack.empty{justify-content:center;color:var(--faint);font-family:var(--mono);font-size:18px}.price-link{color:var(--text);font-family:var(--mono);font-size:20px;font-weight:760;letter-spacing:-.045em;font-variant-numeric:tabular-nums;white-space:nowrap}.price-link:hover{color:var(--blue);text-decoration:none}.price-stack.priceai .price-link{color:var(--blue-deep)}.price-stack.ldxp .price-link{color:var(--green)}.price-context{max-width:100%;overflow:hidden;color:var(--muted);font-size:11px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}
    .stock,.status{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:650;line-height:1.25;white-space:nowrap}.stock i,.status i{width:6px;height:6px;border-radius:50%;background:currentColor}.available{color:var(--green)}.out{color:var(--red)}.neutral{color:var(--muted)}.official{color:var(--blue)}
    .catalogs{display:grid;gap:18px;margin-top:20px}.source-badge{display:inline-flex;align-items:center;min-height:22px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:730;line-height:1;letter-spacing:.01em;white-space:nowrap}.source-badge.official{color:#0757bd;background:#e9f2ff}.source-badge.priceai{color:#6331b7;background:#f1ebff}.source-badge.ldxp{color:#087a55;background:#e9f8f0}.source-badge.goaihop{color:#a15c00;background:#fff4e4}.source-badge.neutral{color:var(--muted);background:#eff3f7}.catalog-table{min-width:700px}.catalog-table th:first-child{width:112px}.catalog-name{display:flex;min-width:180px;flex-direction:column;gap:3px}.catalog-name strong{font-size:13px;line-height:1.35}.catalog-name span{color:var(--muted);font-size:11px;line-height:1.35}.money{color:var(--text);font-family:var(--mono);font-size:16px;font-weight:760;letter-spacing:-.035em;font-variant-numeric:tabular-nums}.row-link{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:7px;color:var(--blue)}.row-link:hover{background:var(--blue-soft)}.row-link .icon{width:18px;height:18px}
    .alerts{margin-top:20px}.alerts .head{border-bottom:0}.alerts-list{padding:0 20px 8px}.alert{display:grid;grid-template-columns:3px minmax(0,1fr) auto;align-items:stretch;gap:14px;padding:13px 0;border-top:1px solid var(--line)}.alert:first-child{border-top:0}.alert-rail{border-radius:99px;background:var(--line-strong)}.alert.drop .alert-rail{background:var(--green)}.alert.change .alert-rail{background:var(--blue)}.alert.gone .alert-rail{background:var(--amber)}.alert-copy{min-width:0}.alert-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}.alert-type{color:var(--muted);font-size:11px;font-weight:700}.alert-type.drop{color:var(--green)}.alert-type.change{color:var(--blue)}.alert-type.gone{color:var(--amber)}.alert-product{color:var(--text);font-size:13px;font-weight:680}.alert-message{margin-top:3px;overflow-wrap:anywhere;color:var(--muted);font-size:12px}.alert-time{align-self:start;color:var(--muted);font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.empty{padding:24px 20px;color:var(--muted);font-size:13px;text-align:center}
    .breadcrumb{display:inline-flex;align-items:center;gap:5px;margin:0 0 16px;font-size:13px;font-weight:650}.breadcrumb .icon{width:16px;height:16px}.product-hero{display:grid;overflow:hidden;grid-template-columns:minmax(250px,.86fr) minmax(390px,1.14fr);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.summary{padding:28px}.summary h1{margin:10px 0 0;overflow-wrap:anywhere;font-size:clamp(25px,3vw,34px);line-height:1.17;letter-spacing:-.035em}.product-meta{display:flex;flex-wrap:wrap;gap:7px 10px;margin-top:11px;color:var(--muted);font-size:12px}.price-label{margin-top:34px;color:var(--muted);font-size:12px;font-weight:650}.price-display{margin-top:4px;color:var(--blue-deep);font-family:var(--mono);font-size:clamp(38px,4.2vw,52px);font-weight:780;letter-spacing:-.075em;line-height:1;font-variant-numeric:tabular-nums}.summary-bottom{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-top:16px}.chart-panel{min-width:0;padding:25px 28px 19px;border-left:1px solid var(--line);background:var(--soft)}.chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.chart-head h2{margin:0;font-size:17px}.chart-head span{color:var(--muted);font-size:12px;white-space:nowrap}.chart-wrap{min-height:172px;margin-top:16px}.chart{display:block;width:100%;height:auto;overflow:visible}.chart-grid line{stroke:#dce6f2;stroke-width:1;stroke-dasharray:3 5}.chart-label{fill:#7b899b;font-family:var(--font);font-size:10px}.detail{margin-top:20px}.offer-table{min-width:760px}.offer-title{display:flex;min-width:220px;flex-direction:column;gap:4px}.offer-title strong{color:var(--text);font-size:13px;line-height:1.35}.offer-title span{overflow-wrap:anywhere;color:var(--muted);font-size:11px;line-height:1.35}.metric{margin-top:4px;color:var(--amber);font-size:11px}
    .sources{overflow:hidden}.source-list{padding:0 20px}.source-row{display:grid;grid-template-columns:minmax(180px,1.2fr) repeat(3,minmax(80px,.55fr)) minmax(128px,.85fr);align-items:center;gap:18px;padding:17px 0;border-top:1px solid var(--line)}.source-row:first-child{border-top:0}.source-name{display:flex;min-width:0;align-items:center;gap:9px}.source-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-stat{display:flex;flex-direction:column;gap:2px}.source-stat strong{color:var(--text);font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums}.source-stat span{color:var(--muted);font-size:11px}.source-time{color:var(--muted);font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .desktop{display:block}.mobile{display:none}.mobile-stack{display:grid;gap:10px;padding:12px}.family-card,.catalog-card,.offer-card{border:1px solid var(--line);border-radius:11px;background:var(--surface)}.family-card{overflow:hidden}.family-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:14px 14px 11px;background:var(--soft)}.family-head strong{font-size:14px}.family-head span{color:var(--muted);font-size:11px;white-space:nowrap}.family-line{display:grid;grid-template-columns:minmax(88px,.8fr) 1fr;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--line)}.family-label{color:var(--muted);font-size:11px}.family-value{display:flex;min-width:0;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}.family-value.empty{color:var(--faint);font-family:var(--mono);font-size:17px}.family-value .price-link{font-size:18px}.catalog-card,.offer-card{padding:14px}.catalog-card+.catalog-card,.offer-card+.offer-card{margin-top:8px}.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.card-price{color:var(--text);font-family:var(--mono);font-size:22px;font-weight:780;letter-spacing:-.06em;line-height:1.05;font-variant-numeric:tabular-nums}.card-name{margin-top:9px;overflow-wrap:anywhere;color:var(--text);font-size:13px;font-weight:680;line-height:1.4}.card-meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:6px;color:var(--muted);font-size:11px}.card-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}.external{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:650;white-space:nowrap}.external .icon{width:16px;height:16px}
    @media(max-width:760px){.wrap{width:calc(100% - 24px);padding-top:21px;padding-bottom:22px}.site-footer{width:calc(100% - 24px);padding:15px 0 24px;font-size:10px;line-height:1.65}.footer-inner{display:grid;gap:12px}.footer-contact{width:max-content;max-width:100%;flex-wrap:wrap;white-space:normal}.footer-disclaimer{max-width:none}.intro{display:block;padding-bottom:17px}.intro h1{font-size:27px}.intro p{font-size:13px}.source-pulse{max-width:none;justify-content:flex-start;margin-top:13px}.comparison,.surface,.alerts,.sources,.product-hero{border-radius:12px}.head,.comparison>.head{padding:16px 15px}.comparison>.head{display:block}.comparison>.head .note{margin-top:5px}.head h2{font-size:16px}.updated{max-width:120px;margin-top:0;text-align:right;white-space:normal}.summary-bottom .updated{max-width:none;white-space:nowrap}.desktop{display:none!important}.mobile{display:block}.catalogs{gap:14px;margin-top:15px}.alerts{margin-top:15px}.alerts-list{padding:0 15px 7px}.alert{grid-template-columns:3px minmax(0,1fr);gap:11px}.alert-time{grid-column:2;margin-top:-4px;font-size:10px}.product-hero{display:block}.summary{padding:20px 17px 22px}.summary h1{font-size:27px}.price-label{margin-top:26px}.price-display{font-size:46px}.chart-panel{padding:19px 17px 14px;border-top:1px solid var(--line);border-left:0}.chart-wrap{min-height:145px;margin-top:12px}.chart-label{font-size:9px}.detail{margin-top:15px}.source-list{padding:0 15px}.source-row{grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:14px 0}.source-name{grid-column:1 / -1}.source-stat{display:grid;grid-template-columns:auto auto;align-items:baseline;gap:7px}.source-stat strong{font-size:13px}.source-stat span{font-size:10px}.source-time{grid-column:1 / -1;font-size:10px}}@media(max-width:370px){.source-pulse{gap:6px 10px}}@media(prefers-reduced-motion:no-preference){.row-link,.price-link,.nav-link,tbody tr{transition:color 150ms ease,background-color 150ms ease}}
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
    /* 右上角直接呈现站长联系方式，桌面与移动端均保留可点击入口。 */
    .header-tools{gap:10px;color:#59666e}.header-contact{min-height:33px;padding:0;border:0;border-radius:0;color:#4e5e66;font-size:12px;font-weight:650;letter-spacing:0}.header-contact + .header-contact{border-left:1px solid #dce3e6;padding-left:10px}.header-contact:hover{border-color:transparent;background:transparent;color:#202d34;text-decoration:underline;text-underline-offset:3px}.header-contact:focus-visible{outline:3px solid rgb(32 78 92 / 22%);outline-offset:3px}.header-contact-kind{margin-right:4px;color:#202d34;font-weight:800}
    @media(max-width:760px){.header-tools{gap:6px}.header-contact{min-height:30px;font-size:10.5px}.header-contact + .header-contact{padding-left:6px}.header-contact-kind{margin-right:3px}}
  </style>
</head>
<body>
  <header class="app-header"><div class="header-inner"><div class="header-main">
    <a class="brand" href="/" aria-label="AI 订阅价格雷达首页">${radarMark()}<span class="brand-text">AI 订阅价格雷达</span></a>
    <nav class="app-nav" aria-label="主导航">${nav("/", "home", "总览")}${nav("/alerts", "alerts", "提醒")}${nav("/sources", "sources", "数据源")}</nav>
    <div class="header-tools" aria-label="联系站长"><a class="header-contact" href="https://x.com/superwang" target="_blank" rel="noopener noreferrer" aria-label="在 X 联系站长 @superwang"><span class="header-contact-kind">X</span>@superwang</a><a class="header-contact" href="https://t.me/lincwang" target="_blank" rel="noopener noreferrer" aria-label="在 Telegram 联系站长 @lincwang"><span class="header-contact-kind">TG</span>@lincwang</a></div>
  </div></div>${categoryRail}</header>
  <main class="wrap">${body}</main>
  <footer class="site-footer" id="site-disclaimer"><div class="footer-inner"><p class="footer-disclaimer">本站仅提供公开数据的汇总展示；价格、库存、服务内容及交易结果以原站实际页面为准，本站不对第三方信息的准确性、完整性或由此产生的交易结果承担责任。</p><div class="footer-contact" aria-label="联系站长"><span class="footer-contact-label">联系站长</span><span class="footer-contact-links"><a class="footer-contact-link" href="https://x.com/superwang" target="_blank" rel="noopener noreferrer" aria-label="在 X 联系站长 @superwang"><b>X</b>@superwang</a><a class="footer-contact-link" href="https://t.me/lincwang" target="_blank" rel="noopener noreferrer" aria-label="在 Telegram 联系站长 @lincwang"><b>TG</b>@lincwang</a></span></div></div></footer>${categoryScript}
</body>
</html>`;
}

function priced(db, list, id) {
  if (!list || !id) return null;
  const product = list.products.find((item) => item.product_id === id);
  if (!product || product.lowest_price == null) return null;
  return { source: list.source, id, product, offer: cheapestOffer(db, list.source, list.snapshotId, id) };
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

function overviewContent(db, priceai, cardnav, ldxp) {
  const entries = OVERVIEW_FAMILIES.map((summary) => {
    const family = FAMILIES.find((candidate) => candidate.family === summary.family);
    const official = family ? priced(db, cardnav, family.official) : null;
    const channel = family ? priced(db, priceai, family.priceai) : null;
    const supplier = family ? priced(db, ldxp, family.ldxp) : null;
    const linked = official ?? channel ?? supplier;
    const updatedList = official ? cardnav : (channel ? priceai : (supplier ? ldxp : null));
    const sourceCount = [official, channel, supplier].filter(Boolean).length;
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
      ? `<a class="overview-row-link" href="${productHref(entry.linked.source, entry.linked.id)}" aria-label="查看 ${esc(entry.platform)} 的真实报价">${icon("chevron")}</a>`
      : `<span class="overview-row-link disabled" aria-hidden="true">${icon("chevron")}</span>`;
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
      ? `<a class="overview-mobile-action" href="${productHref(entry.linked.source, entry.linked.id)}" aria-label="查看 ${esc(entry.platform)} 的真实报价">${icon("chevron")}</a>`
      : `<span class="overview-mobile-action disabled" aria-hidden="true">${icon("chevron")}</span>`;
    return `<article class="overview-mobile-card" data-family="${entry.tone}"><div class="overview-mobile-top"><div class="overview-product"><span class="overview-platform-mark mark-${entry.tone}" aria-hidden="true">${platformMark(entry.platform)}</span><span>${esc(entry.platform)}</span></div>${action}</div><div class="overview-mobile-meta"><span>${esc(entry.provider)}</span><span>${esc(entry.plan)}</span><span>官方区 ${price}</span></div><div class="overview-mobile-bottom"><span>${entry.sourceCount ? `${entry.sourceCount} 个来源` : "暂无来源"}</span><time>${entry.updatedAt ? esc(fmtTime(entry.updatedAt)) : "—"}</time></div></article>`;
  }).join("");

  return { desktop, mobile };
}

function familyContent(db, priceai, cardnav, ldxp) {
  const items = FAMILIES.map((family) => ({
    family,
    official: priced(db, cardnav, family.official),
    channel: priced(db, priceai, family.priceai),
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
      <td class="num">${priceStack(item.official)}</td><td class="num">${priceStack(item.channel)}</td><td class="num">${priceStack(item.supplier)}</td>
    </tr>`).join("");
    return `<tr class="table-group-row tone-${group.tone}" data-family="${group.tone}"><th colspan="4" scope="rowgroup"><span class="group-mark" aria-hidden="true"></span><span class="group-title">${esc(group.platform)}</span><span class="group-count">${group.items.length} 个产品</span></th></tr>${rows}`;
  }).join("");
  const mobile = `<div class="family-groups">${groups.map((group, index) => {
    const cards = group.items.map((item) => `<article class="family-card"><div class="family-head"><strong>${esc(item.family.family)}</strong><span>${esc(item.family.platform)}</span></div>${mobilePriceLine("官方区最低", item.official)}${mobilePriceLine("PriceAI 渠道最低", item.channel)}${mobilePriceLine("LDXP 货源最低", item.supplier)}</article>`).join("");
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
  const order = ["ChatGPT", "Claude", "Gemini", "Grok", "X", "Microsoft", "其他", "接码", "邮箱"];
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
      return `<tr><td><div class="catalog-name"><strong>${label}</strong><span>${esc(product.product_type ?? "")}${spec}</span></div></td><td class="num"><span class="money">${fmtPrice(product.lowest_price, product.currency)}</span></td><td class="num">${stockSummary(product)}</td><td class="num"><a class="row-link" href="${productHref(list.source, product.product_id)}" aria-label="查看 ${label} 报价">${icon("chevron")}</a></td></tr>`;
    }).join("");
    return `<tbody data-family="${group.tone}" data-catalog-group data-product-count="${group.items.length}"><tr class="table-group-row tone-${group.tone}"><th colspan="4" scope="rowgroup"><span class="group-mark" aria-hidden="true"></span><span class="group-title">${esc(group.label)}</span><span class="group-count">${group.items.length} 个产品</span></th></tr>${rows}</tbody>`;
  }).join("");
  const mobileGroups = groups.map((group, index) => {
    const cards = group.items.map((product) => {
      const spec = product.spec ? "<span>" + esc(product.spec) + "</span>" : "";
      return `<article class="catalog-card"><div class="card-top"><div><div class="card-price">${fmtPrice(product.lowest_price, product.currency)}</div>${stockSummary(product)}</div></div><div class="card-name">${esc(product.name || product.product_id)}</div><div class="card-meta"><span>${esc(product.product_type ?? "未分类")}</span>${spec}</div><div class="card-bottom"><span class="dim">报价 ${Number(product.offer_count ?? 0)} 条</span><a class="external" href="${productHref(list.source, product.product_id)}">查看报价 ${icon("chevron")}</a></div></article>`;
    }).join("");
    return `<details class="catalog-group tone-${group.tone}" data-family="${group.tone}"${index === 0 ? " open" : ""}><summary class="group-summary"><span class="group-summary-copy"><span class="group-mark" aria-hidden="true"></span><strong>${esc(group.label)}</strong><span class="group-count">${group.items.length} 个产品</span></span><span class="group-chevron" aria-hidden="true">${icon("chevron")}</span></summary><div class="catalog-group-body">${cards}</div></details>`;
  }).join("");
  return `<div class="table-scroll desktop"><table class="catalog-table"><thead><tr><th>产品</th><th class="num">最低价</th><th class="num">有货 / 报价</th><th aria-label="查看详情"></th></tr></thead>${desktopGroups}</table></div><div class="mobile"><div class="catalog-groups">${mobileGroups}</div></div>`;
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
    const badge = alert.source ? sourceBadge(alert.source, true) : "";
    return `<article class="alert ${tone}"><span class="alert-rail" aria-hidden="true"></span><div class="alert-copy"><div class="alert-top"><span class="alert-type ${tone}">${esc(label)}</span>${productHtml}${badge}</div><div class="alert-message">${esc(alert.message ?? "")}</div></div><time class="alert-time">${esc(fmtTime(alert.ts))}</time></article>`;
  }).join("");
  return `<div class="alerts-list">${markup}</div>`;
}

function homePage(db) {
  const priceai = latestProducts(db, "priceai");
  const cardnav = latestProducts(db, "cardnav-official");
  const ldxp = latestProducts(db, "ldxp-goods");
  const goaihop = latestProducts(db, "goaihop-relay");
  const overview = overviewContent(db, priceai, cardnav, ldxp);
  const family = familyContent(db, priceai, cardnav, ldxp);
  return layout("总览", `
    <section class="comparison reference-overview" id="comparison"><div class="overview-head"><h1 class="comparison-title">跨源价格对照</h1><p class="note">对比各平台公开订阅方案与当前市场报价，货币与税费可能有所不同，请以结算页面为准。</p></div>
      <div class="overview-table-shell desktop"><div class="table-scroll"><table class="overview-table"><colgroup><col class="col-product"/><col class="col-provider"/><col class="col-plan"/><col class="col-billing"/><col class="col-price"/><col class="col-currency"/><col class="col-note"/><col class="col-updated"/><col class="col-action"/></colgroup><thead><tr><th>产品</th><th>提供方</th><th>订阅方案</th><th>计费周期</th><th>官方价格</th><th>货币</th><th>备注</th><th>更新时间</th><th aria-label="查看详情"></th></tr></thead><tbody>${overview.desktop}</tbody></table></div></div>
      <div class="mobile"><div class="overview-mobile">${overview.mobile}</div></div>
      <p class="overview-hint">提示：价格随地区、时间及促销活动可能变动；部分方案需满足条件或通过特定渠道订阅。</p>
      <details class="all-plans" data-comparison-details><summary>查看全部可比套餐 <span>14 个已映射产品</span>${icon("chevron")}</summary><div class="all-plans-body"><div class="table-scroll desktop"><table class="comparison-table"><thead><tr><th>产品</th><th class="num">官方区最低<span>CardNav · 人民币折算</span></th><th class="num">PriceAI 渠道最低<span>当前可见报价</span></th><th class="num">LDXP 货源最低<span>当前搜索命中</span></th></tr></thead><tbody>${family.desktop}</tbody></table></div><div class="mobile"><div class="mobile-stack">${family.mobile}</div></div></div></details>
    </section>
    <div class="catalogs">${sourceSection(priceai)}${sourceSection(cardnav)}${sourceSection(ldxp)}${sourceSection(goaihop)}</div>
    <section class="alerts"><div class="head"><div><h2>最近盯盘提醒</h2><p class="note">按发生时间展示最近 8 条</p></div><a class="external" href="/alerts">查看全部 ${icon("chevron")}</a></div>${alertList(recentAlerts(db, 8))}</section>
  `, "home");
}

function offerContent(offers) {
  const max = 80;
  const shown = offers.slice(0, max);
  const desktopRows = shown.map((offer) => {
    const url = safeUrl(offer.url);
    const link = url ? '<a class="row-link" href="' + url + '" target="_blank" rel="noopener noreferrer" aria-label="在原站打开报价">' + icon("external") + "</a>" : "";
    return `<tr><td class="num"><span class="money">${fmtPrice(offer.price, offer.currency)}</span></td><td>${statusMark(offer.status)}</td><td><div class="offer-title"><strong>${esc(offer.store_name || offer.source_name || "—")}</strong><span>${esc(offer.title ?? "")}</span>${metricLine(offer)}</div></td><td class="dim">${esc(offer.captured_at ? fmtTime(offer.captured_at) : "—")}</td><td class="num">${link}</td></tr>`;
  }).join("");
  const mobileCards = shown.map((offer) => {
    const url = safeUrl(offer.url);
    const iconLink = url ? '<a class="row-link" href="' + url + '" target="_blank" rel="noopener noreferrer" aria-label="在原站打开报价">' + icon("external") + "</a>" : "";
    const bottomLink = url ? '<a class="external" href="' + url + '" target="_blank" rel="noopener noreferrer">原站 ' + icon("external") + "</a>" : "";
    const title = offer.title ? '<div class="card-meta"><span>' + esc(offer.title) + "</span></div>" : "";
    return `<article class="offer-card"><div class="card-top"><div><div class="card-price">${fmtPrice(offer.price, offer.currency)}</div>${statusMark(offer.status)}</div>${iconLink}</div><div class="card-name">${esc(offer.store_name || offer.source_name || "—")}</div>${title}${metricLine(offer)}<div class="card-bottom"><span class="dim">抓取于 ${esc(offer.captured_at ? fmtTime(offer.captured_at) : "—")}</span>${bottomLink}</div></article>`;
  }).join("");
  return { max, shown: shown.length, desktopRows, mobileCards };
}

function productPage(db, url) {
  const source = url.searchParams.get("source") || "priceai";
  const id = url.searchParams.get("id");
  if (!id) return layout("缺少参数", `${pageIntro("缺少产品参数", "请选择一个产品后再查看报价")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  const snapshot = latestProducts(db, source);
  if (!snapshot) return layout("暂无数据", `${pageIntro("暂未采集到数据", "该数据源当前没有可展示的快照")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);
  const product = snapshot.products.find((item) => item.product_id === id);
  if (!product) return layout("未找到产品", `${pageIntro("未找到该产品", "当前快照中没有匹配的产品记录")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`);

  const offers = offersOf(db, source, snapshot.snapshotId, id);
  const series = priceSeriesRows(db, source, id).slice(-120);
  const chart = sparkline(series);
  const chartHtml = chart ?? '<div class="empty">快照不足，暂无走势</div>';
  const related = recentAlerts(db, 999).filter((alert) => alert.product_id === id || alert.product_id === product.product_id);
  const rendered = offerContent(offers);
  const spec = product.spec ? "<span>" + esc(product.spec) + "</span>" : "";
  const offersHtml = offers.length
    ? '<div class="table-scroll desktop"><table class="offer-table"><thead><tr><th class="num">价格</th><th>状态</th><th>店铺 / 标题</th><th>抓取时间</th><th aria-label="原站"></th></tr></thead><tbody>' + rendered.desktopRows + '</tbody></table></div><div class="mobile"><div class="mobile-stack">' + rendered.mobileCards + "</div></div>"
    : '<div class="empty">暂无报价</div>';
  return layout((product.name || id) + " · 报价", `
    <a class="breadcrumb" href="/">${icon("back")}返回总览</a>
    <section class="product-hero"><div class="summary">${sourceBadge(source)}<h1>${esc(product.name || id)}</h1><div class="product-meta"><span>${esc(product.platform ?? "未分类")}</span><span>${esc(product.product_type ?? "未分类")}</span>${spec}</div><div class="price-label">当前最低价</div><div class="price-display">${fmtPrice(product.lowest_price, product.currency)}</div><div class="summary-bottom">${stockSummary(product)}${updatedMeta(snapshot)}</div></div>
      <div class="chart-panel"><div class="chart-head"><h2>最低价走势</h2><span>最近 ${series.length} 个快照</span></div><div class="chart-wrap">${chartHtml}</div></div>
    </section>
    <section class="surface detail"><div class="head"><div><h2>最新报价</h2><p class="note">共 ${offers.length} 条，显示前 ${rendered.shown} 条</p></div></div>${offersHtml}</section>
    <section class="alerts"><div class="head"><div><h2>相关提醒</h2><p class="note">与该产品相关的盯盘事件</p></div></div>${alertList(related)}</section>
  `);
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

export function createApp({ db }) {
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      let html;
      if (url.pathname === "/" || url.pathname === "/index.html") html = homePage(db);
      else if (url.pathname === "/product") html = productPage(db, url);
      else if (url.pathname === "/alerts") html = alertsPage(db);
      else if (url.pathname === "/sources") html = sourcesPage(db);
      else if (url.pathname === "/favicon.ico") { res.statusCode = 204; res.end(); return; }
      else { res.statusCode = 404; html = layout("404", `${pageIntro("页面不存在", "请从总览重新选择内容")}<section class="surface"><div class="empty"><a href="/">返回总览</a></div></section>`); }
      res.end(html);
    } catch (error) {
      console.error("[web] 500:", error.stack || error.message);
      res.statusCode = 500;
      res.end(layout("服务错误", `${pageIntro("服务暂时出错", "请稍后再试")}`));
    }
  });
}

export function startWeb({ db, host = "127.0.0.1", port = 8090 }) {
  const app = createApp({ db });
  return new Promise((resolve) => {
    app.listen(port, host, () => {
      console.log("[web] http://" + host + ":" + port + "/ （只读页面，Ctrl+C 退出）");
      resolve(app);
    });
  });
}
