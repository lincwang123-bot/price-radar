// 告警输出：控制台 / JSONL 文件 / 通用 Webhook（企业微信、钉钉、飞书、Telegram、Server酱 均可适配）
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function budget(value, fallback) { return Number.isFinite(value)&&value>0 ? Math.min(value,30000) : fallback; }
async function boundedFetch(url, options, timeoutMs) {
  const controller=new AbortController(); let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(()=>fetch(url,{...options,signal:controller.signal})),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Webhook timeout'));},timeoutMs);}),
    ]);
  } finally {clearTimeout(timer);controller.abort();}
}

/**
 * @param {object[]} alerts [{ts, source, productId, productName, ruleId, kind, message}]
 * @param {object} cfg notify section: { console, logFile, webhooks: [...] }
 * @param {string} [alertsPath] JSONL 输出路径
 */
export async function notify(alerts, cfg, alertsPath) {
  if (!alerts?.length) return { sent: 0 };
  const webhooks = cfg?.webhooks ?? [];
  const logFile = cfg?.logFile ?? true;

  // 控制台：折行展示
  if (cfg?.console ?? true) {
    console.log("\n========== 🚨 盯盘提醒 ==========");
    for (const a of alerts) {
      console.log(`[${a.ts}] ${a.productName || a.productId}｜${a.message}`);
    }
    console.log("==================================\n");
  }

  if (logFile && alertsPath) {
    mkdirSync(path.dirname(alertsPath), { recursive: true });
    for (const a of alerts) {
      appendFileSync(alertsPath, JSON.stringify(a) + "\n");
    }
  }

  const summary =
    `盯盘提醒 ${alerts.length} 条\n` +
    alerts.map((a) => `• [${a.productName || a.productId}] ${a.message}`).join("\n");

  let sent = 0;
  const deadline=performance.now()+budget(cfg?.totalTimeoutMs,5000);
  for (const wh of webhooks) {
    const remaining=deadline-performance.now();
    if(remaining<=0) break;
    const timeoutMs=Math.min(budget(cfg?.timeoutMs,2000),remaining);
    try {
      const fmt = wh.format ?? "generic";
      if (fmt === "telegram") {
        const url = `https://api.telegram.org/bot${wh.token}/sendMessage`;
        const res = await boundedFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: wh.chat_id, text: summary, disable_web_page_preview: true }),
        },timeoutMs);
        if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
      } else {
        // generic 默认发送 {text}（企业微信/钉钉/飞书/Server酱 常见字段见下）
        const payload =
          fmt === "serverchan"
            ? { title: "盯盘提醒", desp: summary }
            : fmt === "wecom"
              ? { msgtype: "text", text: { content: summary } }
              : { text: summary };
        const res = await boundedFetch(wh.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },timeoutMs);
        if (!res.ok) throw new Error(`${fmt} HTTP ${res.status}`);
      }
      sent += 1;
    } catch (err) {
      console.warn(`[notify] Webhook ${wh.format ?? "generic"} 发送失败: ${err.message}`);
    }
  }
  return { sent };
}
