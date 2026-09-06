// 采集编排：遍历启用的源 → 拉取 → 幂等入库 → 汇总变更
import { storeSnapshot, lastSnapshotId, metaSet } from "./db.mjs";
import { registry } from "../sources/registry.mjs";

/**
 * @param {object} opts { db, config, dataDir, log }
 * @param {string[]} [onlySources]
 * @returns {Promise<object[]>} per-source results
 */
export async function runPull(opts, onlySources = []) {
  const { db, config, dataDir, log = console.log } = opts;
  const results = [];
  const sources = Object.entries(config.sources ?? {}).filter(([, s]) => s.enabled);

  for (const [id, srcCfg] of sources) {
    if (onlySources.length && !onlySources.includes(id)) continue;
    const def = registry[id];
    if (!def) {
      log(`[${id}] ⚠ 无适配器，跳过。`);
      continue;
    }
    const started = Date.now();
    try {
      const before = lastSnapshotId(db, id);
      const outcome = await def.pull({ db, config, dataDir, log: (m) => log(m) });
      let stored = null;
      if (outcome.snapshot) {
        stored = storeSnapshot(db, outcome.snapshot);
      } else {
        // 适配器未产出快照（旧指针语义的兜底）
        stored = { inserted: false, productCount: 0, offerCount: 0 };
      }
      const after = lastSnapshotId(db, id);
      const inserted = stored?.inserted === true;
      if (!outcome.skipped) metaSet(db,`health:${id}`,JSON.stringify({source:id,checkedAt:new Date().toISOString(),status:outcome.snapshot?.stale?"stale":"ok",snapshotId:after,maxAgeMinutes:Number(srcCfg.max_cache_age_minutes)||1440}));
      results.push({
        source: id,
        ok: true,
        ms: Date.now() - started,
        reusedCache: outcome.reusedCache ?? false,
        newSnapshot: inserted,
        snapshotId: outcome.snapshotId ?? after ?? before,
        products: stored?.productCount ?? 0,
        offers: stored?.offerCount ?? 0,
      });
      if (inserted) {
        log(`[${id}] 已入库 ${stored.productCount} 产品 / ${stored.offerCount} 报价（${outcome.reusedCache ? "raw 缓存" : "新下载"}）。`);
      } else {
        log(`[${id}] 快照 ${after} 此前已在库，跳过重复入库。`);
      }
    } catch (err) {
      metaSet(db,`health:${id}`,JSON.stringify({source:id,checkedAt:new Date().toISOString(),status:"failed",message:"采集失败，请检查服务日志"}));
      results.push({ source: id, ok: false, ms: Date.now() - started, error: err.message });
      log(`[${id}] ✗ 拉取失败: ${err.message}`);
    }
  }
  return results;
}
