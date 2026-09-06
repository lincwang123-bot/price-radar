import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  dbPath: path.join(__dirname, "..", "data", "radar.sqlite"),
  dataDir: path.join(__dirname, "..", "data"),
  sources: {
    priceai: { enabled: true, label: "PriceAI（AI 订阅/中转 API 比价雷达）" },
    "ldxp-goods": {
      enabled: true,
      label: "RelayWatch·链动小铺(LDXP) 卡网商品价",
      keywords: ["chatgpt plus", "gpt pro", "claude pro"], // 定向盯价关键词
      min_interval_minutes: 15,
    },
    "cardnav-official": {
      enabled: true,
      label: "CardNav·官方订阅 App Store 区价",
      min_interval_minutes: 720, // 官方区价约每日刷新；默认 12h 拉一次
      pages: [
        "chatgpt-go", "chatgpt-plus", "chatgpt-pro-5x", "chatgpt-pro-20x",
        "claude-pro", "claude-max-5x", "claude-max-20x",
        "gemini-ai-plus", "gemini-advanced", "gemini-ai-ultra",
        "grok-supergrok-lite", "grok-supergrok", "grok-supergrok-heavy",
        "copilot-pro", "x-basic", "x-premium", "x-premium-plus",
      ],
    },
    "goaihop-relay": {
      enabled: true,
      label: "GoAIHop·中转 API 套餐价+可用性",
      min_interval_minutes: 360, // 可用性指标约几十分钟级刷新；默认 6h 拉一次
    },
    "direct-shops": {
      enabled: true,
      label: "原始店铺直采",
      min_interval_minutes: 30,
      request_delay_ms: 500,
      targets: [
        'aikashop', 'otaor',
        "aisou", "redeemgpt", "ai666", "shopcardai", "web3chirou", "morimm", "burstpro-ai", "ikunlove", "mooncake",
        "lynnzee", "zhanghao66", "yufenggpt", "google7676", "tehuio",
        "codesky", "fk10886", "gugugaga", "flyai", "whh985", "aictk", "ccdawang",
      ],
    },
  },
  watch: {
    enabled: true,
    // 规则见 README「盯盘规则」；kind: min_below | drop_pct | cheapest_changed | offer_gone
    rules: [
      {
        id: "chatgpt-plus-recharge-below-105",
        kind: "min_below",
        source: "direct-shops",
        product: "chatgpt-plus-recharge",
        threshold: 105,
        term: "1m",
        currency: "CNY",
      },
      {
        id: "chatgpt-any-drop-8pct",
        kind: "drop_pct",
        source: "direct-shops",
        window: 24, // 最近 24 个快照（约 2h，@5min/个）
        pct: 8,     // 相对窗口高点的跌幅 %
      },
    ],
  },
  notify: {
    console: true,
    logFile: true,
    webhooks: [
      // 例：企业微信/钉钉/飞书自定义机器人
      // { "format": "generic", "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx" }
      // 例：Telegram Bot
      // { "format": "telegram", "token": "123:ABC", "chat_id": "-100123" }
    ],
  },
};

export function loadConfig() {
  const f = path.join(__dirname, "..", "config.json");
  if (existsSync(f)) {
    try {
      const user = JSON.parse(readFileSync(f, "utf8"));
      return deepMerge(structuredClone(DEFAULTS), user);
    } catch (err) {
      console.warn(`[config] 解析 ${f} 失败，使用默认配置: ${err.message}`);
    }
  }
  return structuredClone(DEFAULTS);
}

function deepMerge(base, over) {
  if (over == null) return base;
  if (typeof over !== "object" || Array.isArray(over)) return over;
  for (const [k, v] of Object.entries(over)) {
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      base[k] = deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
