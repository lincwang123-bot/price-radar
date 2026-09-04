import { safeFetchText } from "../../lib/safe-fetch.mjs";

const CATALOG_PATH = "/mooncake-official-media/catalog.js";
const ASSIGNMENT = /\bwindow\.MOONCAKE_CATALOG\s*=\s*/;

/** Parse the JSON array assigned to window.MOONCAKE_CATALOG without evaluating JavaScript. */
export function parseMooncakeCatalog(script, target, capturedAt = new Date().toISOString()) {
  const source = normalizedTarget(target);
  const timestamp = normalizedCapturedAt(capturedAt);
  const categories = parseAssignedArray(script);
  const offers = [];

  for (const categoryRow of categories) {
    if (!categoryRow || typeof categoryRow !== "object" || !Array.isArray(categoryRow.items)) continue;
    const category = cleanText(categoryRow.name);
    for (const item of categoryRow.items) {
      const offer = itemOffer(item, category, source, timestamp);
      if (offer) offers.push(offer);
    }
  }
  return offers;
}

/** Collect Mooncake's cacheable public JavaScript catalogue. */
export async function collectMooncake(target, options = {}) {
  const source = normalizedTarget(target);
  const capturedAt = normalizedCapturedAt(options.capturedAt ?? new Date().toISOString());
  const endpoint = new URL(target?.endpoint ?? CATALOG_PATH, `${source.origin}/`);
  await requestDelay(options.requestDelayMs ?? target?.requestDelayMs);
  const script = await safeFetchText(endpoint.href, {
    allowedOrigins: [source.origin],
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
    headers: { Accept: "application/javascript,text/javascript;q=0.9,text/plain;q=0.8" },
  });
  return parseMooncakeCatalog(script, source, capturedAt);
}

function parseAssignedArray(script) {
  if (typeof script !== "string") throw new Error("Mooncake 目录必须是文本");
  const match = ASSIGNMENT.exec(script);
  if (!match) throw new Error("Mooncake 目录缺少 window.MOONCAKE_CATALOG 赋值");
  let start = match.index + match[0].length;
  while (/\s/.test(script[start] ?? "")) start += 1;
  if (script[start] !== "[") throw new Error("Mooncake 目录赋值不是 JSON 数组");

  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < script.length; index += 1) {
    const char = script[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
      if (depth < 0) break;
    }
  }
  if (end < 0 || quoted) throw new Error("Mooncake 目录 JSON 数组不完整");

  let value;
  try {
    value = JSON.parse(script.slice(start, end));
  } catch (error) {
    throw new Error(`Mooncake 目录 JSON 解析失败: ${error.message}`);
  }
  if (!Array.isArray(value)) throw new Error("Mooncake 目录根值不是数组");
  return value;
}

function itemOffer(item, category, source, capturedAt) {
  if (!item || typeof item !== "object" || item.isDeleted === true || item.isActive === false) return null;
  const id = identifier(item.id ?? item.item_id);
  const title = cleanText(item.name ?? item.title);
  const price = positiveNumber(item.price);
  if (!id || !title || price === null) return null;
  const inventory = inventoryState(item.stock);
  return {
    offerId: `${source.id}:${id}`,
    sourceId: source.id,
    sourceName: source.name,
    storeName: source.name,
    title,
    category,
    price,
    listedPrice: price,
    feeAmount: null,
    priceBasis: "listed",
    currency: source.currency,
    status: inventory.status,
    stockCount: inventory.stockCount,
    url: `${source.origin}/#item-${encodeURIComponent(id)}`,
    capturedAt,
    expiresAt: null,
    deliveryMode: Number(item.delivery_way) === 0 ? "auto" : Number(item.delivery_way) === 1 ? "manual" : null,
  };
}

function normalizedTarget(target) {
  const id = cleanText(target?.id);
  const name = cleanText(target?.name) || id;
  if (!id) throw new Error("Mooncake 来源缺少 id");
  const origin = normalizedOrigin(target?.origin ?? target?.baseUrl);
  return { ...target, id, name, origin, currency: cleanText(target?.currency) || "CNY" };
}

function normalizedOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("Mooncake 来源 origin 无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Mooncake 来源 origin 必须是无凭据 HTTPS 地址");
  return url.origin;
}

function normalizedCapturedAt(value) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) throw new Error("capturedAt 无效");
  return text;
}

function inventoryState(value) {
  if (value === null || value === undefined || value === "") return { stockCount: null, status: "unknown" };
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isSafeInteger(number) || number < 0) return { stockCount: null, status: "unknown" };
  return { stockCount: number, status: number === 0 ? "out_of_stock" : "in_stock" };
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function identifier(value) {
  const text = cleanText(value);
  return text && text.length <= 200 ? text : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function requestDelay(value) {
  if (value === null || value === undefined || value === "") return Promise.resolve();
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 60_000) {
    throw new Error("requestDelayMs 必须为 0-60000 的整数");
  }
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
