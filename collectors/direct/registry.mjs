import { collectKami } from "./kami.mjs";
import { collectIkunLove } from "./ikunlove.mjs";
import { collectMooncake } from "./mooncake.mjs";
import { collectShopApi } from "./shop-api.mjs";
import { collectDujiao } from "./dujiao.mjs";
import { collectAikaShop } from './aikashop.mjs';
import { PLATFORM16688_SHOPS, collect16688 } from './platform16688.mjs';
import { collectAichong } from './aichong.mjs';

// 这里只登记我们逐个核验过的原站公开入口。URL 不接受运行时任意传入，
// 避免把采集器变成通用代理或 SSRF 入口。
const TARGETS = [
  ...PLATFORM16688_SHOPS.map(target => ({ ...target, kind: 'platform16688', intervalMinutes: 60 })),
  { id: 'aichong', name: 'AI补给站', kind: 'aichong', origin: 'https://aichong.xin', intervalMinutes: 60 },
  {id:'aikashop',name:'AI卡商城',kind:'aikashop',origin:'https://aikashop.com',intervalMinutes:720},
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
    id: "redeemgpt",
    name: "RedeemGPT",
    kind: "kami",
    origin: "https://faka.redeemgpt.com",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 30,
    maxPages: 5,
    pageSize: 100,
  },
  {
    id: "ai666",
    name: "AI666",
    kind: "kami",
    origin: "https://ai666.id",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 30,
    maxPages: 5,
    pageSize: 100,
  },
  {
    id: "shopcardai",
    name: "CardAI",
    kind: "kami",
    origin: "https://shopcardai.click",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 30,
    maxPages: 5,
    pageSize: 100,
  },
  {
    id: "web3chirou",
    name: "蔚莱云AI",
    kind: "kami",
    origin: "https://web3chirou.com",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 60,
    maxPages: 5,
    pageSize: 100,
  },
  {
    id: "lynnzee",
    name: "LynnZee",
    kind: "kami",
    origin: "https://lynnzee.myweb999.cfd",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 30,
    maxPages: 5,
    pageSize: 100,
  },
  {
    id: "zhanghao66",
    name: "账号66",
    kind: "kami",
    origin: "https://zhanghao66.com",
    endpoint: "/user/api/index/commodity",
    intervalMinutes: 30,
    maxPages: 5,
    pageSize: 100,
  },
  { id: "yufenggpt", name: "御风AI", kind: "kami", origin: "https://yufenggpt.com", endpoint: "/user/api/index/commodity", intervalMinutes: 30, maxPages: 5, pageSize: 100 },
  { id: "google7676", name: "以太AI", kind: "kami", origin: "https://google7676.top", endpoint: "/user/api/index/commodity", intervalMinutes: 30, maxPages: 5, pageSize: 100 },
  { id: "tehuio", name: "Tehuio", kind: "kami", origin: "https://tehuio.com", endpoint: "/user/api/index/commodity", intervalMinutes: 30, maxPages: 5, pageSize: 100 },
  { id: "codesky", name: "花生店铺", kind: "kami", origin: "https://store.codesky.qzz.io", endpoint: "/user/api/index/commodity", intervalMinutes: 30, maxPages: 5, pageSize: 100 },
  { id: "fk10886", name: "10886源头发卡网", kind: "kami", origin: "https://fk.10886.xyz", endpoint: "/user/api/index/commodity", intervalMinutes: 30, maxPages: 5, pageSize: 100 },
  { id: "gugugaga", name: "Gpt全自助发货", kind: "kami", origin: "https://gugugugagaga.taootp.com", endpoint: "/user/api/index/commodity", intervalMinutes: 30, maxPages: 5, pageSize: 100 },
  { id: "flyai", name: "FlyAI", kind: "dujiao", origin: "https://flyai.qzz.io", endpoint: "/api/v1/public/products", intervalMinutes: 30 },
  { id: "otaor", name: "Acc-OTAOR", kind: "dujiao", origin: "https://acc.otaor.com", endpoint: "/api/v1/public/products", intervalMinutes: 30 },
  { id: "whh985", name: "王哈哈AI", kind: "dujiao", origin: "https://shop.whh985.com", endpoint: "/api/v1/public/products", intervalMinutes: 30 },
  { id: "aictk", name: "艾琳AI", kind: "dujiao", origin: "https://shop.aictk.shop", endpoint: "/api/v1/public/products", intervalMinutes: 30 },
  { id: "ccdawang", name: "CC大王", kind: "dujiao", origin: "https://ccdawang.win", endpoint: "/api/v1/public/products", intervalMinutes: 30 },
  {
    id: "morimm",
    name: "MoriMM",
    kind: "dujiao",
    origin: "https://morimm.com",
    endpoint: "/api/v1/public/products",
    intervalMinutes: 30,
  },
  {
    id: "burstpro-ai",
    name: "BurstPro AI",
    kind: "dujiao",
    origin: "https://burstpro-ai.online",
    endpoint: "/api/v1/public/products",
    intervalMinutes: 30,
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
  dujiao: collectDujiao,
  aikashop: collectAikaShop,
  platform16688: collect16688,
  aichong: collectAichong,
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

// wzyp.cn 的公开 ShopApi 在普通家庭网络可用，但当前会对本项目
// 生产 VPS 返回 WAF 挑战页。它们保留为显式可选目标，不在默认列表中启用。
export const DEFAULT_DIRECT_TARGET_IDS = Object.freeze([
  'aikashop', 'otaor',
  "aisou", "redeemgpt", "ai666", "shopcardai", "web3chirou", "morimm", "burstpro-ai", "ikunlove", "mooncake",
  "lynnzee", "zhanghao66", "yufenggpt", "google7676", "tehuio",
  "codesky", "fk10886", "gugugaga", "flyai", "whh985", "aictk", "ccdawang",
  ...PLATFORM16688_SHOPS.map(target => target.id),
  'aichong',
]);

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
