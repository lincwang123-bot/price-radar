// 盯盘规则引擎：在“最近两次快照 + 滚动窗口”上对每个产品求值，输出触发事件。
// 支持的规则 kind：
//   min_below        —— 最低价跌破阈值；阈值之下再创新低也会再次提醒
//   drop_pct         —— 相对近 N 个快照窗口高点的跌幅 ≥ pct% 时提醒（含继续下探再提醒）
//   cheapest_changed —— 最低价 offer 换了（按 url/offerId 指纹）
//   offer_gone       —— 上一快照的最低价 offer 消失/全场无货时提醒
import {
  recentSnapshots, productsOfSnapshot, offersOfProduct, metaGet, metaSet,
} from "./db.mjs";
import { projectProduct, sourceHealth, offerListed } from './quote-policy.mjs';

const EPS = 1e-6;

function recentHealthySnapshots(db, sourceId, n) {
  return db.prepare(
    `SELECT * FROM snapshots
     WHERE source = ? AND stale = 0
     ORDER BY fetched_at DESC, rowid DESC LIMIT ?`
  ).all(sourceId, n);
}

function stateGet(db, key) {
  const row = db.prepare("SELECT state FROM rule_state WHERE rule_key = ?").get(key);
  if (!row || !row.state) return {};
  try { return JSON.parse(row.state); } catch { return {}; }
}
function stateSet(db, key, s) {
  db.prepare(
    "INSERT INTO rule_state (rule_key, state, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(rule_key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(s), new Date().toISOString());
}

const KIND_LABEL = {
  min_below: "跌破阈值",
  drop_pct: "窗口急跌",
  cheapest_changed: "最低价换源",
  offer_gone: "最低价消失",
};

function fmtPrice(p, cur = "CNY") {
  if (p == null) return "-";
  const sym = cur === "CNY" ? "¥" : `${cur} `;
  return `${sym}${p}`;
}

/** 在某快照的产品下求该产品的最低 offer（全部报价里价格最小者） */
function cheapestOffer(offers) {
  if (!offers?.length) return null;
  return offers.reduce((m, o) =>
    (o.price != null && (m == null || o.price < m.price - EPS) ? o : m), null);
}
function fpOf(o) {
  return o?.url || o?.offerId || null;
}

/**
 * 对某个 rule 在某 source 的最新快照上求值。
 * @returns {object[]} alerts
 */
function evalRule(db, rule, sourceId, snapList, snapById) {
  const latest = snapList[0];
  if (!latest) return [];
  const prev = snapList[1] ?? null; // 上一快照（可能没有）
  const products = productsOfSnapshot(db, sourceId, latest.snapshot_id);
  const alerts = [];

  const prevProducts = new Map();
  if (prev) {
    for (const p of productsOfSnapshot(db, sourceId, prev.snapshot_id)) {
      prevProducts.set(p.product_id, p);
    }
  }
  const prevOffersByProduct = new Map();
  if (prev) {
    for (const p of productsOfSnapshot(db, sourceId, prev.snapshot_id)) {
      prevOffersByProduct.set(p.product_id, offersOfProduct(db, sourceId, prev.snapshot_id, p.product_id));
    }
  }

  for (const prod of products) {
    if (rule.product && rule.product !== "*" && prod.product_id !== rule.product) continue;
    const key = `${rule.id}|${sourceId}|${prod.product_id}`;
    const current = projectProduct(db,sourceId,latest,prod);
    if (!current.comparable || current.stale || current.offers.some(o=>o.quote_stale)) continue;
    const offers = current.offers.filter(offerListed);
    const curLow = current.lowest_price;
    const curCheapest = cheapestOffer(offers);
    const prevProd = prevProducts.get(prod.product_id) ?? null;
    const previous = prevProd ? projectProduct(db,sourceId,prev,prevProd,{historical:true}) : null;
    if(previous && (!previous.comparable || previous.stale || previous.comparison_key !== current.comparison_key)) continue;
    const prevLow = previous?.lowest_price ?? null;
    const prevCheapest = cheapestOffer((previous?.offers ?? []).filter(o=>!o.quote_stale&&offerListed(o)));
    const name = prod.name || prod.product_id;

    const push = (kind, message, productId = prod.product_id) =>
      alerts.push({
        ts: new Date().toISOString(),
        source: sourceId,
        productId,
        productName: name,
        ruleId: rule.id,
        kind,
        message,
      });

    if (rule.kind === "min_below" && curLow != null && rule.threshold != null) {
      const st = stateGet(db, key);
      const below = curLow <= rule.threshold + EPS;
      if (below) {
        const crossedDown = !st.wasBelow;
        const newLow = st.wasBelow && (st.lastLow == null || curLow < st.lastLow - EPS);
        if (crossedDown || newLow) {
          push("min_below",
            `${name} 最低价 ${fmtPrice(curLow)} 已跌至阈值 ${fmtPrice(rule.threshold)} 以下` +
            (prevLow != null && curLow < prevLow - EPS ? `（上轮 ${fmtPrice(prevLow)}）` : ""));
        }
        st.wasBelow = true;
        st.lastLow = st.lastLow == null ? curLow : Math.min(st.lastLow, curLow);
      } else {
        st.wasBelow = false;
        st.lastLow = null;
      }
      stateSet(db, key, st);
    }

    if (rule.kind === "drop_pct" && curLow != null && rule.pct != null) {
      // 窗口：当前快照之前的 rule.window 个快照（不含当前）
      const n = Math.max(1, Math.floor(rule.window ?? 12));
      const snaps = recentHealthySnapshots(db, sourceId, n + 1); // 含当前，不把不完整快照纳入价格窗口
      const windowLows = [];
      for (let i = 1; i < snaps.length; i++) {
        const row = productsOfSnapshot(db,sourceId,snaps[i].snapshot_id).find(p=>p.product_id===prod.product_id);
        const point = row ? projectProduct(db,sourceId,snaps[i],row,{historical:true}) : null;
        if (point?.comparable && point.comparison_key === current.comparison_key && point.lowest_price != null) windowLows.push(point.lowest_price);
      }
      const high = windowLows.length ? Math.max(...windowLows) : null;
      if (high != null && high > EPS) {
        const dropPct = ((high - curLow) / high) * 100;
        const st = stateGet(db, key);
        if (dropPct >= rule.pct - EPS) {
          const newly = !st.active;
          const deeper = st.active && (st.low == null || curLow < st.low - EPS);
          if (newly || deeper) {
            push("drop_pct",
              `${name} 窗口高点 ${fmtPrice(high)} → 现最低 ${fmtPrice(curLow)}，跌幅 ${dropPct.toFixed(1)}% ≥ ${rule.pct}%`);
          }
          st.active = true;
          st.low = st.low == null ? curLow : Math.min(st.low, curLow);
        } else if (st.active) {
          // 已回升到跌幅阈值之下，解除活跃，避免路径依赖误判
          st.active = false;
          st.low = null;
        }
        stateSet(db, key, st);
      }
    }

    if (rule.kind === "cheapest_changed") {
      if (curCheapest && prevCheapest) {
        const a = fpOf(curCheapest);
        const b = fpOf(prevCheapest);
        if (a && b && a !== b) {
          const curPrice = curCheapest.price;
          const prevPrice = prevCheapest.price;
          const delta =
            curPrice != null && prevPrice != null
              ? (curPrice > prevPrice ? `（+${(curPrice - prevPrice).toFixed(2)}）` :
                 curPrice < prevPrice ? `（-${(prevPrice - curPrice).toFixed(2)}）` : "")
              : "";
          push("cheapest_changed",
            `${name} 最低价 offer 变更：${prevCheapest.store_name || prevCheapest.source_name || "-"} ` +
            `${fmtPrice(prevPrice)} → ${curCheapest.store_name || curCheapest.source_name || "-"} ` +
            `${fmtPrice(curPrice)} ${delta}  ${curCheapest.url || ""}`);
        }
      }
    }

    if (rule.kind === "offer_gone") {
      const st = stateGet(db, key);
      const prevFp = fpOf(prevCheapest);
      const stillThere = prevFp
        ? offers.some((o) => fpOf(o) === prevFp && (o.status ?? "available") !== "out_of_stock")
        : false;
      const vanished = prevFp != null && !stillThere;
      const allOut = offers.length === 0 || (curLow == null && offers.every((o) => (o.status ?? "available") === "out_of_stock"));
      const goneNow = vanished || allOut;
      if (goneNow && !st.gone) {
        push("offer_gone",
          `${name} 上一快照最低价 offer ${fmtPrice(prevLow ?? prevCheapest?.price)}` +
          (vanished ? `（${prevCheapest?.url || prevCheapest?.source_name || "?"}）已消失/无货` : " 全场无货") +
          (curLow != null ? `；现最低 ${fmtPrice(curLow)}` : ""));
      }
      st.gone = goneNow;
      stateSet(db, key, st);
    }
  }
  return alerts;
}

/**
 * 运行一次盯盘求值（基于库内现有快照）。
 * 每个源维护“已求值水位线”：最新快照与上次求值时相同 → 跳过（防止重复告警）。
 * @returns {object[]} alerts（同时写入 alerts 表）
 */
export function runWatch(db, watchCfg) {
  const alerts = [];
  const rules = (watchCfg?.rules ?? []).filter((r) => r.enabled !== false);
  if (!rules.length) return alerts;

  // 按源分组
  const bySource = new Map();
  for (const rule of rules) {
    const sourceId = rule.source ?? "priceai";
    if (!bySource.has(sourceId)) bySource.set(sourceId, []);
    bySource.get(sourceId).push(rule);
  }

  for (const [sourceId, sourceRules] of bySource) {
    const latest = recentSnapshots(db, sourceId, 1)[0];
    if (!latest) continue;
    const health = sourceHealth(db,sourceId);
    if (health.status === 'failed' && Date.parse(health.checkedAt)>=Date.parse(latest.fetched_at)) continue;
    // 不完整采集只作数据可见性标记，不得制造“降价/换店/下架”假告警。
    // 不推进 watermark，让后续健康快照仍能与上次健康数据比较。
    if (Number(latest.stale) === 1) continue;
    const snaps = recentHealthySnapshots(db, sourceId, 2);
    const latestId = latest.snapshot_id;
    const wmKey = `watch_wm_${sourceId}`;
    const wm = metaGet(db, wmKey);
    if (wm === latestId) {
      // 该源没有新快照：跳过求值（min_below 等有状态规则也不会丢重置）
      continue;
    }
    const byId = new Map(snaps.map((s) => [s.snapshot_id, s]));
    for (const rule of sourceRules) {
      try {
        const ev = evalRule(db, rule, sourceId, snaps, byId);
        alerts.push(...ev);
      } catch (err) {
        console.warn(`[watch] 规则 ${rule.id} 求值失败: ${err.message}`);
      }
    }
    metaSet(db, wmKey, latestId);
  }
  if (alerts.length) {
    const ins = db.prepare(
      "INSERT INTO alerts (ts, source, product_id, product_name, rule_id, kind, message) VALUES (?,?,?,?,?,?,?)"
    );
    for (const a of alerts) {
      ins.run(a.ts, a.source, a.productId, a.productName, a.ruleId, a.kind, a.message);
    }
  }
  return alerts;
}
