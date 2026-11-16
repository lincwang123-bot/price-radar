import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  directOfferExclusionReason,
  groupDirectOffers,
  stableDirectSnapshotId,
} from "../collectors/direct/catalog.mjs";
import { collectorFor, directTargets } from "../collectors/direct/registry.mjs";
import { claimSourceAttempt } from "../lib/source-timing.mjs";
import { metaGet, metaSet } from "../lib/db.mjs";
import { isAccessDeniedError } from '../lib/safe-fetch.mjs';
import { readDirectImports } from '../lib/direct-transfer.mjs';
import { readApprovedManifest, collectApprovedMerchants, merchantRetryMinutes, merchantIdentityForUrl, MERCHANT_REFRESH_MINUTES } from '../lib/merchant-collection.mjs';
import {discover16688,loadDiscovered16688} from '../lib/direct-discovery.mjs';
import {retryingPublicFetch} from '../lib/direct-read-retry.mjs';
import {classifyPreflightError} from '../lib/merchant-preflight-guidance.mjs';
import {publicHttpsUrl} from '../lib/public-network-fetch.mjs';
import {normalizeRefreshBefore,refreshPending} from '../lib/collection-refresh.mjs';

export const sourceId = "direct-shops";
export const sourceLabel = "原始店铺直采";

// Restrictions survive a pause/removal from approved.json. Otherwise a formerly
// restricted merchant could silently return through a fixed target or import.
// Removing a guard requires an explicit operator-reviewed migration, never an
// empty/missing manifest or an automatic cache cleanup.
const RESTRICTED_ORIGINS_KEY = 'merchant-onboarding:restricted-origins';
function restrictionOrigin(value) {
  const url = new URL(value);
  // The 16688 adapter uses the www endpoint for both accepted shop URL aliases.
  if (url.hostname === '16688.com.cn') url.hostname = 'www.16688.com.cn';
  return url.origin;
}
function rememberRestrictedOrigins(db, manifest) {
  const raw = metaGet(db, RESTRICTED_ORIGINS_KEY);
  const saved = raw == null ? [] : JSON.parse(raw);
  if (!Array.isArray(saved) || saved.length > 10000 || saved.some(origin =>
    typeof origin !== 'string' || publicHttpsUrl(origin).origin !== origin || restrictionOrigin(origin) !== origin))
    throw new Error('公开读取约束记录无效，请站方核对后恢复采集');
  const origins = new Set(saved);
  for (const origin of manifest.restrictedOrigins || []) origins.add(restrictionOrigin(origin));
  for (const row of manifest.merchants) if (row.collectionAccess) origins.add(restrictionOrigin(row.shopUrl));
  const value = JSON.stringify([...origins].sort());
  if (value !== raw) metaSet(db, RESTRICTED_ORIGINS_KEY, value);
  return origins;
}
const restrictedUrl = (origins, value) => {
  try { return origins.has(restrictionOrigin(value)); } catch { return false; }
};

export async function pull(ctx) {
  const refreshBefore=normalizeRefreshBefore(ctx.refreshBefore);
  const cfg = ctx.config?.sources?.[sourceId] ?? {};
  const minIntervalMinutes = positiveNumber(cfg.min_interval_minutes, 30);
  const timing = claimSourceAttempt(ctx.db, sourceId, minIntervalMinutes);
  const bridgeDir = ctx.merchantBridgeDir ?? process.env.MERCHANT_BRIDGE_DIR;
  const manifest = readApprovedManifest(bridgeDir);
  const restrictedOrigins = rememberRestrictedOrigins(ctx.db, manifest);
  const beforePublicRequest = async url => {
    for (const origin of rememberRestrictedOrigins(ctx.db,readApprovedManifest(bridgeDir))) restrictedOrigins.add(origin);
    if (restrictedUrl(restrictedOrigins,String(url)))
      throw Object.assign(new Error('读取范围已限制，停止旧目录采集'),{code:'COLLECTION_SCOPE_RESTRICTED'});
  };
  const legacyFetch = async (url, options) => {
    await beforePublicRequest(url);
    return (ctx.fetchImpl ?? globalThis.fetch)(url,options);
  };
  const previousManifest = metaGet(ctx.db,'merchant-onboarding:manifest');
  const merchantCycle = manifest.merchants.length > 0 || restrictedOrigins.size > 0 || (previousManifest != null && previousManifest !== manifest.fingerprint);
  if (!timing.allowed && !merchantCycle && !refreshBefore) {
    ctx.log?.(`[${sourceId}] 距上次实际尝试仅 ${timing.elapsedMinutes.toFixed(1)}min（< ${minIntervalMinutes}min），跳过本轮。`);
    return { source: sourceId, skipped: true, snapshotId: null };
  }

  const targets = directTargets(Array.isArray(cfg.targets) && cfg.targets.length ? cfg.targets : undefined);
  const cacheDir = path.join(ctx.dataDir, "direct-shops-cache");
  mkdirSync(cacheDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const allOffers = [];
  const staleTargets = [];
  const health = [];
  const maxCacheAgeMinutes = positiveNumber(cfg.max_cache_age_minutes, 1440);
  const requestDelayMs = positiveNumber(cfg.request_delay_ms, 500);
  let attemptedTargets = 0;
  const deniedOrigins = new Map();
  if(cfg.discovery?.platform16688===true) {
    let discovered=loadDiscovered16688(ctx.dataDir);
    // Discovery enumerates the shared platform before it knows each shop's
    // identity, so an origin restriction must also stop that API path.
    if(timing.allowed && !restrictedUrl(restrictedOrigins, 'https://www.16688.com.cn')) {
      const result=await discover16688({dataDir:ctx.dataDir,fetchImpl:legacyFetch,sleep:ctx.sleep});
      discovered=result.targets;
      const {targets:ignored,...metrics}=result;
      metaSet(ctx.db,'health:direct-discovery',JSON.stringify({...metrics,storeCount:discovered.length}));
      if(result.blockedOrigin)deniedOrigins.set(result.blockedOrigin,Object.assign(new Error('16688 公开目录访问受限'),{code:result.reasonCode==='robots_disallowed'?'ROBOTS_DISALLOWED':'ACCESS_DENIED'}));
      ctx.log?.(`[${sourceId}] 16688 原站发现：${result.status}，本轮新增 ${result.discoveredCount} 家，动态名单 ${discovered.length} 家。`);
    }
    const ids=new Set(targets.map(row=>row.id));
    targets.push(...discovered.filter(row=>!ids.has(row.id)));
  }
  let previousHealth = [],previousCheckedAt=null;
  try { const previous=JSON.parse(metaGet(ctx.db,'health:direct-targets') || '{}');previousHealth=previous.targets||[];previousCheckedAt=previous.checkedAt; } catch {}

  for (const target of targets) {
    if (restrictedUrl(restrictedOrigins, target.origin)) continue;
    const cachePath = path.join(cacheDir, `${target.id}.json`);
    const cached = readTargetCache(cachePath);
    const ageMinutes = cached?.fetchedAt ? (Date.now() - Date.parse(cached.fetchedAt)) / 60000 : Infinity;
    const prior = previousHealth.find(row=>row.target===target.id);
    const forceRefresh=refreshPending(refreshBefore,prior?.checkedAt||cached?.fetchedAt,prior?.lastRefreshBefore);
    const refreshMarker=prior?.lastRefreshBefore?{lastRefreshBefore:prior.lastRefreshBefore}:{};
    const identity=merchantIdentityForUrl(target.shopNo?target.origin+'/shop/'+target.shopNo:target.token?target.origin+'/shop/'+target.token:target.origin);
    const retryAge=(Date.now()-Date.parse(prior?.checkedAt||previousCheckedAt))/60000;
    const approved=manifest.merchants.some(row=>row.identity===identity);
    const targetInterval=approved?Math.min(target.intervalMinutes,MERCHANT_REFRESH_MINUTES):target.intervalMinutes;
    const failed=['stale','unavailable'].includes(prior?.status);
    const retryApproved=approved&&failed&&merchantRetryMinutes(prior?.reasonCode)===5&&retryAge>=5;
    const refreshApproved=approved&&!failed&&ageMinutes>=targetInterval;
    if ((refreshBefore&&!forceRefresh)||(!forceRefresh&&!timing.allowed&&!retryApproved&&!refreshApproved)) {
      const usable = cached && Number.isFinite(ageMinutes) && ageMinutes >= 0 && (ageMinutes <= maxCacheAgeMinutes || failed);
      const status = usable ? (failed ? 'stale' : 'cached') : 'unavailable';
      if (usable) allOffers.push(...withHealth(cached.offers,status,maxCacheAgeMinutes));
      if (status === 'stale' || status === 'unavailable') staleTargets.push(target.id);
      health.push({target:target.id,name:target.name,status,checkedAt:prior?.checkedAt||cached?.fetchedAt||previousCheckedAt,lastSuccess:cached?.fetchedAt||null,ageMinutes:Number.isFinite(ageMinutes)?Math.round(ageMinutes):null,reasonCode:prior?.reasonCode||null,...refreshMarker});
      continue;
    }
    if (!forceRefresh && !deniedOrigins.has(target.origin) && !failed && cached && Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes < Math.min(targetInterval, maxCacheAgeMinutes)) {
      allOffers.push(...withHealth(cached.offers, 'cached', maxCacheAgeMinutes));
      health.push({target:target.id,name:target.name,status:"cached",checkedAt:prior?.checkedAt||cached.fetchedAt,lastSuccess:cached.fetchedAt,ageMinutes:Math.round(ageMinutes),...refreshMarker});
      ctx.log?.(`[${sourceId}] ${target.name} 命中本地缓存（${ageMinutes.toFixed(0)}min / ${targetInterval}min）。`);
      continue;
    }

    try {
      if (deniedOrigins.has(target.origin)) throw deniedOrigins.get(target.origin);
      const collect = collectorFor(target);
      if (attemptedTargets > 0) await (ctx.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))))(requestDelayMs);
      attemptedTargets += 1;
      const offers = validateTargetOffers(
        await collect(target, {
          capturedAt,
          fetchImpl: retryingPublicFetch(legacyFetch,{sleep:ctx.sleep,maxRetries:2}),
          checkoutFetchImpl:legacyFetch,
          beforeRequest:beforePublicRequest,
          previousOffers:cached?.offers,
          onCheckoutAccessDenied:error=>deniedOrigins.set(target.origin,error),
          requestDelayMs,
        }),
        target,
      );
      writeTargetCache(cachePath, { targetId: target.id, fetchedAt: capturedAt, offers });
      allOffers.push(...withHealth(offers, 'ok', maxCacheAgeMinutes));
      health.push({target:target.id,name:target.name,status:"ok",checkedAt:capturedAt,lastSuccess:capturedAt,ageMinutes:0,...refreshMarker,...(forceRefresh?{lastRefreshBefore:refreshBefore}:{})});
      ctx.log?.(`[${sourceId}] ${target.name}: ${offers.length} 条公开商品。`);
    } catch (error) {
      if (isAccessDeniedError(error)||error.code==='ROBOTS_DISALLOWED') deniedOrigins.set(target.origin, error);
      staleTargets.push(target.id);
      const usable = cached && Number.isFinite(ageMinutes) && ageMinutes >= 0;
      if (usable) allOffers.push(...withHealth(cached.offers, 'stale', maxCacheAgeMinutes));
      health.push({target:target.id,name:target.name,status:usable?"stale":"unavailable",checkedAt:capturedAt,lastSuccess:cached?.fetchedAt||null,ageMinutes:Number.isFinite(ageMinutes)?Math.round(ageMinutes):null,...classifyPreflightError(error),...refreshMarker,...(forceRefresh?{lastRefreshBefore:refreshBefore}:{})});
      ctx.log?.(`[${sourceId}] ${target.name} 采集失败，${usable?"保留上次采集价格，标记待核对":"无成功采集记录，暂不展示报价"}: ${error.message}`);
    }
  }

  // Imported public snapshots are passive evidence only. Never add them to
  // the network target loop or overwrite the active collectors' caches.
  const activeIds=new Set(targets.map(target=>target.id));
  for(const record of readDirectImports(ctx.dataDir)){
    const target=record.target;
    if(restrictedUrl(restrictedOrigins,target.origin))continue;
    if(activeIds.has(target.id))continue;
    if(record.status==='ok'){
      allOffers.push(...withHealth(record.offers,'cached',240));
      health.push({target:target.id,name:target.name,status:'cached',lastSuccess:record.checkedAt,ageMinutes:Math.round((Date.now()-Date.parse(record.checkedAt))/60000),imported:true});
    }else{
      staleTargets.push(target.id);
      health.push({target:target.id,name:target.name,status:'unavailable',lastSuccess:null,ageMinutes:null,imported:true});
    }
  }
  const collectionManifest = {...manifest, merchants:manifest.merchants.filter(row =>
    row.collectionAccess || !restrictedUrl(restrictedOrigins,row.shopUrl))};
  const merchantResult = await collectApprovedMerchants({...ctx,refreshBefore},{manifest:collectionManifest,existingOffers:allOffers,existingHealth:health,capturedAt,maxCacheAgeMinutes});
  // Recheck approval at publication time as an operator may pause a merchant
  // while a bounded network request is in flight.
  const currentManifest = readApprovedManifest(bridgeDir);
  const currentRestrictedOrigins = rememberRestrictedOrigins(ctx.db,currentManifest);
  const approvedIds = new Set(currentManifest.merchants.filter(row =>
    manifest.merchants.some(original=>original.id===row.id && JSON.stringify(original)===JSON.stringify(row))).map(row=>row.id));
  // A restriction may have been approved while the fixed collector was in
  // flight. Its older offers and caches cannot become a publication bypass.
  const targetOrigins = new Map(targets.map(target => [target.id,target.origin]));
  for (let i=allOffers.length-1;i>=0;i--) if (
    restrictedUrl(currentRestrictedOrigins,allOffers[i].url) ||
    restrictedUrl(currentRestrictedOrigins,targetOrigins.get(allOffers[i].sourceId))) allOffers.splice(i,1);
  const currentRestrictedIds = new Set(currentManifest.merchants.filter(row=>row.collectionAccess).map(row=>row.id));
  allOffers.push(...merchantResult.offers.filter(offer=>approvedIds.has(offer.extra?.merchantCollectionId) &&
    (!restrictedUrl(currentRestrictedOrigins,offer.url) || currentRestrictedIds.has(offer.extra?.merchantCollectionId))));
  const merchantHealth = merchantResult.health.filter(row=>approvedIds.has(row.id));
  staleTargets.push(...merchantHealth.filter(row=>row.status==='unavailable').map(row=>row.id));
  metaSet(ctx.db,'health:merchant-onboarding',JSON.stringify({source:'merchant-onboarding',status:currentManifest.valid?'ok':'unavailable',checkedAt:capturedAt,manifestValid:currentManifest.valid,targets:merchantHealth}));
  metaSet(ctx.db,'merchant-onboarding:manifest',manifest.fingerprint);
  const products = groupDirectOffers(allOffers);
  // Failed caches remain timestamped historical observations, not live minima.
  metaSet(ctx.db,"health:direct-targets",JSON.stringify({source:sourceId,checkedAt:capturedAt,maxCacheAgeMinutes,targets:health}));
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

function withHealth(offers,status,maxAgeMinutes) {
  return offers.map(offer=>({...offer,extra:{...offer.extra,quoteHealth:{status,maxAgeMinutes}}}));
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
