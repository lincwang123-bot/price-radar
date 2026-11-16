import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DIRECT_TARGET_IDS } from '../collectors/direct/registry.mjs';
import { recommendedKeywords } from '../sources/ldxp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  dbPath: path.join(__dirname, "..", "data", "radar.sqlite"),
  dataDir: path.join(__dirname, "..", "data"),
  sources: {
    "ldxp-goods": {
      enabled: true,
      label: "RelayWatch·链动小铺(LDXP) 卡网商品价",
      keywords: [...recommendedKeywords],
      min_interval_minutes: 30,
      page_size: 100,
      max_pages_per_keyword: 2,
      max_requests: 24,
      request_delay_ms: 1000,
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
      enabled: false,
      label: "GoAIHop·中转 API 套餐价+可用性",
      min_interval_minutes: 360, // 可用性指标约几十分钟级刷新；默认 6h 拉一次
    },
    "direct-shops": {
      enabled: true,
      label: "原始店铺直采",
      min_interval_minutes: 30,
      request_delay_ms: 500,
      discovery: { platform16688: true },
      targets: [...DEFAULT_DIRECT_TARGET_IDS],
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
  offerRetention: {
    enabled: false, // 每晚低峰把超出窗口的明细滚成 K 线并清理。默认关，站长确认后再开。
    dedupe: false, // 热窗口之外，价格和库存没变就不再保留新行。默认关。
    days: 30,
    candleHours: 4, // 上海时区对齐。4 小时即 0/4/8/12/16/20 点。可选 1/2/3/4/6/8/12/24。
    protectSnapshots: 160, // 至少保留最近 160 个完整快照，盖住走势 120 点
    quietHourStart: 2, // 上海时间；起止相等（如都为 2）时采集侧不滚动，仅由 timer 执行
    quietHourEnd: 5,
    batchSnapshots: 20, // 每批删除的快照数
    maxDeleteBatches: 40, // 每次最多删除批数
    maxRollSnapshots: 400, // 每次最多滚动快照数
    busyTimeout: 10000, // SQLite 锁等待上限（毫秒）
    maxRuntimeMs: 2400000, // 批次边界检查的运行上限（毫秒）
    dedupeSnapshots: 4, // timer 每次去重快照总上限，去重默认关闭
    dedupePerCycle: 4,
    archiveDir: null,
    reserveBytes: 2 * 1024 * 1024 * 1024,
    allowUnarchivedDelete: false,
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
      const config = deepMerge(structuredClone(DEFAULTS), user);
      config.sources=Object.fromEntries(Object.entries(config.sources).filter(([id])=>Object.hasOwn(DEFAULTS.sources,id)));
      config.watch.rules=(config.watch.rules||[]).filter(rule=>!rule.source||Object.hasOwn(config.sources,rule.source));
      config.sources['goaihop-relay'] = {...config.sources['goaihop-relay'], enabled:false};
      return config;
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
