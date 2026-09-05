import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  directOfferExclusionReason,
  groupDirectOffers,
  stableDirectSnapshotId,
} from "../collectors/direct/catalog.mjs";
import { collectorFor, directTargets } from "../collectors/direct/registry.mjs";
import { claimSourceAttempt } from "../lib/source-timing.mjs";

export const sourceId = "direct-shops";
export const sourceLabel = "原始店铺直采";

export async function pull(ctx) {
  const cfg = ctx.config?.sources?.[sourceId] ?? {};
  const minIntervalMinutes = positiveNumber(cfg.min_interval_minutes, 30);
  const timing = claimSourceAttempt(ctx.db, sourceId, minIntervalMinutes);
  if (!timing.allowed) {
    ctx.log?.(`[${sourceId}] 距上次实际尝试仅 ${timing.elapsedMinutes.toFixed(1)}min（< ${minIntervalMinutes}min），跳过本轮。`);
    return { source: sourceId, skipped: true, snapshotId: null };
  }

  const targets = directTargets(Array.isArray(cfg.targets) && cfg.targets.length ? cfg.targets : undefined);
  const cacheDir = path.join(ctx.dataDir, "direct-shops-cache");
  mkdirSync(cacheDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const allOffers = [];
  const staleTargets = [];

  for (const target of targets) {
    const cachePath = path.join(cacheDir, `${target.id}.json`);
    const cached = readTargetCache(cachePath);
    const ageMinutes = cached?.fetchedAt ? (Date.now() - Date.parse(cached.fetchedAt)) / 60000 : Infinity;
    if (cached && Number.isFinite(ageMinutes) && ageMinutes < target.intervalMinutes) {
      allOffers.push(...cached.offers);
      ctx.log?.(`[${sourceId}] ${target.name} 命中本地缓存（${ageMinutes.toFixed(0)}min / ${target.intervalMinutes}min）。`);
      continue;
    }

    try {
      const collect = collectorFor(target);
      const offers = validateTargetOffers(
        await collect(target, {
          capturedAt,
          fetchImpl: globalThis.fetch,
          requestDelayMs: positiveNumber(cfg.request_delay_ms, 500),
        }),
        target,
      );
      writeTargetCache(cachePath, { targetId: target.id, fetchedAt: capturedAt, offers });
      allOffers.push(...offers);
      ctx.log?.(`[${sourceId}] ${target.name}: ${offers.length} 条公开商品。`);
    } catch (error) {
      if (!cached) {
        throw new Error(`${target.name} 首次采集失败，本轮不发布部分快照: ${error.message}`);
      }
      staleTargets.push(target.id);
      allOffers.push(...cached.offers);
      ctx.log?.(`[${sourceId}] ${target.name} 采集失败，沿用上次完整缓存: ${error.message}`);
    }
  }

  const products = groupDirectOffers(allOffers);
  if (!products.length) throw new Error("原始店铺未产出可确认分类的有效报价");
  const publishedOfferCount = products.reduce((count, product) => count + product.offers.length, 0);
  // 内容指纹不是观察事件 ID：A→B→A 必须产生第三个观察，否则历史去重
  // 会让当前页面停在 B；相同报价的新一轮成功核验也需要保留新时间。
  const contentId = stableDirectSnapshotId(products.flatMap((product) => product.offers), staleTargets);
  const snapshotId = `${contentId}-${Date.parse(capturedAt)}`;
  const excludedCounts = allOffers.reduce((counts, offer) => {
    const reason = directOfferExclusionReason(offer);
    if (reason) counts[reason] += 1;
    return counts;
  }, { out_of_stock: 0, no_warranty: 0 });
  const excludedCount = excludedCounts.out_of_stock + excludedCounts.no_warranty;
  const unclassifiedCount = allOffers.length - publishedOfferCount - excludedCount;
  ctx.log?.(
    `[${sourceId}] 汇总 ${allOffers.length} 条，发布 ${publishedOfferCount} 条，` +
    `过滤售罄 ${excludedCounts.out_of_stock} 条、明确无质保/无售后 ${excludedCounts.no_warranty} 条，` +
    `未可靠分类 ${Math.max(0, unclassifiedCount)} 条。`,
  );

  return {
    source: sourceId,
    snapshotId,
    snapshot: {
      source: sourceId,
      snapshotId,
      fetchedAt: capturedAt,
      generatedAt: capturedAt,
      publishedAt: null,
      stale: staleTargets.length > 0,
      products,
    },
  };
}

function validateTargetOffers(offers, target) {
  // 接口请求和响应结构均已被 collector 验证时，空列表代表该店当前
  // 没有公开商品，不应该被冒充为网络/解析失败。
  if (!Array.isArray(offers)) throw new Error("返回值不是商品列表");
  const seen = new Set();
  for (const offer of offers) {
    if (!offer?.offerId || seen.has(offer.offerId)) throw new Error(`商品 ID 缺失或重复: ${offer?.offerId ?? "空"}`);
    seen.add(offer.offerId);
    const price = Number(offer.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`商品 ${offer.offerId} 价格无效`);
    try {
      const url = new URL(offer.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    } catch {
      throw new Error(`商品 ${offer.offerId} 链接无效`);
    }
    if (offer.sourceId !== target.id) throw new Error(`商品 ${offer.offerId} 来源标识不一致`);
  }
  return offers;
}

function readTargetCache(file) {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value && Array.isArray(value.offers) ? value : null;
  } catch {
    return null;
  }
}

function writeTargetCache(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, file);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
