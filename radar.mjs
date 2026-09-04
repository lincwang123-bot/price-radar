#!/usr/bin/env node
// price-radar —— 多源 AI 订阅/API 比价雷达：拉取 → 历史库 → 盯盘提醒
// 用法：
//   node radar.mjs pull [--source priceai]     拉取并入库最新快照
//   node radar.mjs watch [--no-pull]           拉取后求值盯盘规则并通知
//   node radar.mjs daemon [--interval 300]     常驻循环（pull + watch）
//   node radar.mjs products [--source X]       列出最新快照产品
//   node radar.mjs offers <productId>          列出某产品最新报价
//   node radar.mjs history <productId> [--n 20] 打印跨快照最低价走势
//   node radar.mjs alerts [--limit 20]         最近告警
//   node radar.mjs sources                      源与最近状态
//   node radar.mjs submissions [--kind feedback|cooperation] [--status new]
//   node radar.mjs submission-status <编号> <状态>
import path from "node:path";

import { openDb, openDbReadOnly } from "./lib/db.mjs";
import { loadConfig } from "./lib/config.mjs";
import { runPull } from "./lib/pull.mjs";
import { runWatch } from "./lib/watch.mjs";
import { notify } from "./lib/notify.mjs";
import {
  lastSnapshotId, productsOfSnapshot, offersOfProduct, priceSeries,
  recentSnapshots,
} from "./lib/db.mjs";
import { listSubmissions, openSubmissionsDb, updateSubmissionStatus } from "./lib/submissions.mjs";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function has(name) {
  return process.argv.includes(name);
}

function pad(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function cmdPull(config, db) {
  const only = has("--source") ? [arg("--source")] : [];
  const res = await runPull({ db, config, dataDir: config.dataDir }, only);
  for (const r of res) {
    console.log(
      `${r.ok ? "✓" : "✗"} [${r.source}] ${r.ok ? `${r.products} 产品 / ${r.offers} 报价入库` : r.error}（${r.ms}ms）`
    );
  }
  return res;
}

async function cmdWatch(config, db) {
  if (!has("--no-pull")) {
    await runPull({ db, config, dataDir: config.dataDir });
  }
  const alerts = runWatch(db, config.watch);
  const alertsPath = `${config.dataDir}/alerts.jsonl`;
  const { sent } = await notify(alerts, config.notify, alertsPath);
  console.log(`[watch] 本轮提醒 ${alerts.length} 条，webhook 送达 ${sent} 个。`);
  return alerts;
}

async function cmdDaemon(config, db) {
  const interval = Number(arg("--interval", "300")) || 300;
  if (interval < 60) {
    console.warn("[daemon] 建议 interval >= 60 秒（PriceAI 文档要求指针轮询 >= 1min）。");
  }
  console.log(`[daemon] 启动：每 ${interval}s 一轮 pull+watch。Ctrl+C 退出。`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const t0 = Date.now();
    try {
      await runPull({ db, config, dataDir: config.dataDir });
      const alerts = runWatch(db, config.watch);
      await notify(alerts, config.notify, `${config.dataDir}/alerts.jsonl`);
    } catch (err) {
      console.error("[daemon] 轮次失败:", err.message);
    }
    const wait = Math.max(5, interval - Math.round((Date.now() - t0) / 1000));
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

async function cmdProducts(config, db) {
  const source = arg("--source", "priceai");
  const sid = lastSnapshotId(db, source);
  if (!sid) return console.log(`[${source}] 尚无快照，先运行 node radar.mjs pull`), 0;
  console.log(`\n[${source}] 最新快照 ${sid} 产品一览（按 offer 数排序 Top 30）:`);
  const rows = productsOfSnapshot(db, source, sid);
  const sorted = [...rows].sort((a, b) => (b.offer_count ?? 0) - (a.offer_count ?? 0));
  console.log(
    pad("product_id", 26) + pad("名称", 24) + pad("平台", 10) + pad("品类", 8) + pad("最低价", 9) + pad("有货", 6) + "offer数"
  );
  for (const r of sorted.slice(0, 30)) {
    console.log(
      pad(r.product_id, 26) + pad(r.name ?? "", 24) + pad(r.platform ?? "", 10) +
      pad(r.product_type ?? "", 8) + pad(r.lowest_price ?? "-", 9) +
      pad(r.in_stock_count ?? 0, 6) + (r.offer_count ?? 0)
    );
  }
  return 0;
}

async function cmdOffers(config, db, productId) {
  const source = arg("--source", "priceai");
  const sid = lastSnapshotId(db, source);
  if (!sid) return console.log(`[${source}] 尚无快照。`), 0;
  const offers = offersOfProduct(db, source, sid, productId).sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  console.log(`\n[${source}] ${productId} @ ${sid} —— ${offers.length} 条报价（价格升序）:`);
  for (const o of offers.slice(0, 20)) {
    console.log(
      `${pad(o.price ?? "-", 8)} ${pad(o.status ?? "", 12)} ${pad(o.store_name ?? "", 18)} ` +
      `${o.title ?? ""}  ${o.url ?? ""}`
    );
  }
  return 0;
}

async function cmdHistory(config, db, productId) {
  const source = arg("--source", "priceai");
  const n = Number(arg("--n", "20")) || 20;
  const series = priceSeries(db, { source, productId });
  if (!series.length) return console.log(`[${source}] 无 ${productId} 历史。`);
  const tail = series.slice(-n);
  console.log(`\n[${source}] ${productId} 最近 ${tail.length} 个快照最低价走势:`);
  let prev = null;
  for (const s of tail) {
    const p = s.lowest_price;
    const delta = prev != null && p != null ? (p - prev >= 0 ? `  ▲+${(p - prev).toFixed(2)}` : `  ▼${(p - prev).toFixed(2)}`) : "";
    console.log(
      `${pad(s.fetched_at?.slice(0, 19) ?? "", 20)} 最低 ${pad(p ?? "-", 8)} 有货 ${pad(s.in_stock_count, 6)}` +
      ` offer ${pad(s.offer_count, 5)}${delta}`
    );
    if (p != null) prev = p;
  }
  return 0;
}

async function cmdAlerts(config, db) {
  const limit = Number(arg("--limit", "20")) || 20;
  const rows = db.prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT ?").all(limit).reverse();
  console.log(`\n最近 ${rows.length} 条告警:`);
  for (const r of rows) {
    console.log(`[${r.ts?.slice(0, 19)}] ${pad(r.rule_id ?? "", 32)} ${r.product_name || r.product_id}｜${r.message}`);
  }
  return 0;
}

async function cmdSources(config, db) {
  console.log("已启用数据源：");
  for (const [id, cfg] of Object.entries(config.sources ?? {})) {
    if (!cfg.enabled) continue;
    const sid = lastSnapshotId(db, id);
    console.log(`  • ${id}${cfg.label ? `（${cfg.label}）` : ""}${sid ? ` —— 最新快照 ${sid}` : " —— 尚未拉取"}`);
  }
}

async function cmdImport(config, db, file) {
  // 历史回填：把 priceai raw 快照文件导入（幂等）
  const { readFileSync } = await import("node:fs");
  const { rawToSnapshot } = await import("./sources/priceai.mjs");
  const { storeSnapshot } = await import("./lib/db.mjs");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!raw?.snapshot_id) {
    console.log(`[import] ${file} 缺少 snapshot_id，不是合法 priceai raw 快照。`);
    return 1;
  }
  const snap = rawToSnapshot(raw);
  const r = storeSnapshot(db, snap);
  console.log(
    r.inserted
      ? `[import] 已导入 ${snap.snapshotId}：${r.productCount} 产品 / ${r.offerCount} 报价。`
      : `[import] ${snap.snapshotId} 已在库，跳过。`
  );
  return 0;
}

function submissionsDbPath(config) {
  return process.env.SUBMISSIONS_DB_PATH || path.join(path.dirname(config.dataDir), "submissions", "submissions.sqlite");
}

async function cmdSubmissions(config) {
  const kind = arg("--kind", "feedback");
  const status = arg("--status", null);
  const limit = Number(arg("--limit", "50")) || 50;
  const submissionsDb = openSubmissionsDb(submissionsDbPath(config));
  try {
    const rows = listSubmissions(submissionsDb, { kind, status, limit });
    console.log(`\n${kind === "feedback" ? "数据反馈" : "供需合作"}：${rows.length} 条${status ? `（状态 ${status}）` : ""}`);
    for (const row of rows.reverse()) {
      console.log(`\n[${row.public_id}] ${row.created_at} · ${row.status} · ${row.topic}`);
      console.log(`标题：${row.subject || "-"}`);
      if (row.metadata) console.log(`结构：${row.metadata}`);
      if (row.details) console.log(`说明：${row.details}`);
      if (row.context_url) console.log(`链接：${row.context_url}`);
      console.log(`联系：${row.contact || "未留"}`);
    }
  } finally {
    submissionsDb.close();
  }
}

async function cmdSubmissionStatus(config, publicId, status) {
  const submissionsDb = openSubmissionsDb(submissionsDbPath(config));
  try {
    const changed = updateSubmissionStatus(submissionsDb, publicId, status);
    console.log(changed ? `[submission] ${publicId} 已更新为 ${status}` : `[submission] 未找到 ${publicId}`);
    return changed ? 0 : 1;
  } finally {
    submissionsDb.close();
  }
}

async function cmdServe(config, db) {
  // 行情库保持只读；公开投稿写入独立数据库。长驻进程由 SIGINT 结束。
  const host = arg("--host", "127.0.0.1");
  const port = Number(arg("--port", "8090")) || 8090;
  const publicOrigin = String(process.env.PUBLIC_ORIGIN || "").trim();
  if (publicOrigin.startsWith("https://") && String(process.env.SUBMISSION_HASH_SECRET || "").length < 32) {
    throw new Error("公网投稿服务需要至少 32 字符的 SUBMISSION_HASH_SECRET");
  }
  const { startWeb } = await import("./lib/web.mjs");
  const submissionsDb = openSubmissionsDb(submissionsDbPath(config));
  const app = await startWeb({ db, submissionsDb, host, port });
  const shutdown = () => {
    console.log("\n[web] 停止。");
    app.close(() => {
      try { submissionsDb.close(); } catch {}
      try { db.close(); } catch {}
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // 保持进程存活
  await new Promise(() => {});
}

async function main() {
  const [cmd, productId, statusValue] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const config = loadConfig();
  if (cmd === "submissions") return cmdSubmissions(config);
  if (cmd === "submission-status") return cmdSubmissionStatus(config, productId, statusValue);

  const db = cmd === "serve" ? openDbReadOnly(config.dbPath) : openDb(config.dbPath);
  try {
    switch (cmd) {
      case "pull": return await cmdPull(config, db);
      case "watch": return await cmdWatch(config, db);
      case "daemon": return await cmdDaemon(config, db);
      case "products": return await cmdProducts(config, db);
      case "offers": return await cmdOffers(config, db, productId);
      case "history": return await cmdHistory(config, db, productId);
      case "alerts": return await cmdAlerts(config, db);
      case "sources": return await cmdSources(config, db);
      case "import": return await cmdImport(config, db, productId);
      case "serve": return await cmdServe(config, db);
      default:
        console.log(
          `用法: node radar.mjs <pull|watch|daemon|products|offers|history|alerts|sources|submissions|submission-status|import|serve> ...\n` +
          `  import <raw.json>   把历史 priceai raw 快照回填进库\n` +
          `  submissions [--kind feedback|cooperation] [--status new] 查看公开提交\n` +
          `  submission-status <编号> <状态> 更新处理状态\n` +
          `  serve [--port 8090] 启动 Web 页面与投稿接口\n` +
          `  详见 README.md`
        );
        return 1;
    }
  } finally {
    db.close();
  }
}

const code = await main();
process.exitCode = typeof code === "number" ? code : 0;
