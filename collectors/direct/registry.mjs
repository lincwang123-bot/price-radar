import { collectKami } from "./kami.mjs";
import { collectIkunLove } from "./ikunlove.mjs";
import { collectMooncake } from "./mooncake.mjs";
import { collectShopApi } from "./shop-api.mjs";

// 这里只登记我们逐个核验过的原站公开入口。URL 不接受运行时任意传入，
// 避免把采集器变成通用代理或 SSRF 入口。
const TARGETS = [
  {
    id: "aisou",
    name: "AI搜",
    kind: "kami",
    origin: "https://aisou.pro",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 30,
    maxPages: 5,
    pageSize: 100,
  },
  {
    id: "ikunlove",
    name: "IkunLove",
    kind: "ikunlove",
    origin: "https://ikunlove.best",
    endpoint: "/api/shop/products",
    intervalMinutes: 30,
  },
  {
    id: "mooncake",
    name: "Mooncake",
    kind: "mooncake",
    origin: "https://fk1.ybkjs.top",
    endpoint: "/mooncake-official-media/catalog.js",
    intervalMinutes: 720,
  },
  shop("wzyp-harvey", "派大星", "harvey"),
  shop("wzyp-paimon", "派蒙AI", "paimon"),
  shop("wzyp-ai-choice", "AI优选站", "QOZ92954"),
  shop("wzyp-direct", "GPTplus直营", "caoyuhan520"),
  shop("wzyp-lightyear", "光年AI", "M24HF217"),
];

const COLLECTORS = {
  kami: collectKami,
  ikunlove: collectIkunLove,
  mooncake: collectMooncake,
  shopApi: collectShopApi,
};

function shop(id, name, token) {
  return {
    id,
    name,
    token,
    kind: "shopApi",
    origin: "https://wzyp.cn",
    intervalMinutes: 60,
    pageSize: 100,
    maxPagesPerCategory: 4,
    maxCategories: 40,
  };
}

export const DEFAULT_DIRECT_TARGET_IDS = Object.freeze(TARGETS.map((target) => target.id));

export function directTargets(ids = DEFAULT_DIRECT_TARGET_IDS) {
  const requested = new Set(ids);
  const selected = TARGETS.filter((target) => requested.has(target.id));
  const missing = [...requested].filter((id) => !TARGETS.some((target) => target.id === id));
  if (missing.length) throw new Error(`未登记的直采来源: ${missing.join(", ")}`);
  return selected;
}

export function collectorFor(target) {
  const collector = COLLECTORS[target.kind];
  if (!collector) throw new Error(`来源 ${target.id} 没有对应采集器: ${target.kind}`);
  return collector;
}
