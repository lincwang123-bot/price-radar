import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicNetworkFetch, publicHttpsUrl } from './public-network-fetch.mjs';
import { merchantIdentityForUrl, merchantIdentityForOffer } from './merchant-identity.mjs';
import { authorizeMerchantTarget } from './merchant-target-capability.mjs';
import { collectorFor, directTargets, DEFAULT_DIRECT_TARGET_IDS, SHOP_API_TARGET_IDS } from '../collectors/direct/registry.mjs';
import { safeFetchJson, isAccessDeniedError } from './safe-fetch.mjs';

export { merchantIdentityForUrl, merchantIdentityForOffer } from './merchant-identity.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_MERCHANTS = 100;
const MAX_MANIFEST_BYTES = 256 * 1024;
const RETRY_MINUTES = 30;
const knownTargets = () => directTargets([...DEFAULT_DIRECT_TARGET_IDS,...SHOP_API_TARGET_IDS]);
const targetIdentity = target => merchantIdentityForUrl(target.shopNo ? `${target.origin}/shop/${target.shopNo}` : target.token ? `${target.origin}/shop/${target.token}` : target.origin);

export function readApprovedManifest(bridgeDir = process.env.MERCHANT_BRIDGE_DIR) {
  if (!bridgeDir) return { merchants:[],fingerprint:'none',valid:true };
  try {
    const file = path.join(bridgeDir,'approved.json');
    if (statSync(file).size > MAX_MANIFEST_BYTES) throw new Error('oversized');
    const payload = JSON.parse(readFileSync(file,'utf8'));
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.merchants) || payload.merchants.length > MAX_MERCHANTS) throw new Error('invalid');
    const seen = new Set();
    const merchants = payload.merchants.map(row => {
      const url = publicHttpsUrl(row.shopUrl);
      const identity = merchantIdentityForUrl(url.href);
      if (url.search || url.hash || !identity || row.identity !== identity || row.id !== `merchant-${hash(identity).slice(0,16)}` ||
          row.status !== 'approved' || !['auto','16688','ldxp','independent'].includes(row.platform) ||
          typeof row.shopName !== 'string' || !row.shopName.trim() || row.shopName.length > 120 ||
          !Number.isFinite(Date.parse(row.approvedAt)) || !Number.isFinite(Date.parse(row.identityVerifiedAt)) ||
          seen.has(identity)) throw new Error('invalid');
      if (row.version !== undefined && !(Number.isSafeInteger(row.version) && row.version > 0)) throw new Error('invalid');
      seen.add(identity);
      return {id:row.id,identity,shopName:row.shopName,shopUrl:url.href,platform:row.platform,status:'approved',
        version:row.version,approvedAt:row.approvedAt,identityVerifiedAt:row.identityVerifiedAt};
    });
    return {merchants,fingerprint:hash(JSON.stringify(merchants)),valid:true};
  } catch (error) {
    return {merchants:[],fingerprint:error.code === 'ENOENT' ? 'missing' : 'invalid',valid:error.code === 'ENOENT'};
  }
}

function readCache(file) { try { return JSON.parse(readFileSync(file,'utf8')); } catch { return null; } }
function writeCache(file,value) { const temp=`${file}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(value));renameSync(temp,file); }
function validatedOffers(offers,target,merchant,capturedAt) {
  if (!Array.isArray(offers) || offers.length > 2000) throw new Error('目录格式无效或超限');
  const seen = new Set();
  return offers.map(offer => {
    const url = publicHttpsUrl(offer.url);
    if (url.origin !== target.origin || offer.sourceId !== target.id || !offer.offerId || seen.has(offer.offerId) ||
        !Number.isFinite(Number(offer.price)) || Number(offer.price) <= 0) throw new Error('商品来源验证失败');
    seen.add(offer.offerId);
    return {...offer,capturedAt,extra:{...offer.extra,merchantIdentity:merchant.identity,merchantCollectionId:merchant.id,
      shopUrl:merchant.shopUrl,...(target.shopNo?{shopNo:target.shopNo}:{})}};
  });
}

async function collectMerchant(merchant, ctx, capturedAt, deadline) {
  const url = publicHttpsUrl(merchant.shopUrl);
  const known = knownTargets().find(target => targetIdentity(target) === merchant.identity);
  let target = known ? {...known,id:merchant.id,name:merchant.shopName} : {id:merchant.id,name:merchant.shopName,origin:url.origin,currency:'CNY',maxPages:5,pageSize:100};
  if (merchant.identity.startsWith('shop:16688:')) target = {...target,kind:'platform16688',shopNo:merchant.identity.split(':')[2],origin:'https://www.16688.com.cn'};
  else if (merchant.identity.startsWith('shop:wzyp:')) target = {...target,kind:'shopApi',token:merchant.identity.split(':')[2],origin:'https://wzyp.cn',maxCategories:10,maxPagesPerCategory:4};
  else if (merchant.identity.startsWith('shop:ldxp:')) return {unsupported:true};
  const fetchImpl = (ctx.merchantFetchFactory ?? createPublicNetworkFetch)(target.origin,{totalTimeoutMs:Math.max(1,Math.min(30000,deadline-Date.now()))});
  const options = {capturedAt,fetchImpl,timeoutMs:8000,maxBytes:1024*1024,maxRedirects:0,requestDelayMs:0};
  authorizeMerchantTarget(target);
  if (!target.kind) {
    // Probe only two known read-only public APIs. Never execute page scripts,
    // solve challenges, authenticate, enumerate paths, or publish partial data.
    for (const [kind,endpoint] of [['dujiao','/api/v1/public/products?page=1&page_size=100'],['kami','/user/api/index/commodity?limit=100&page=1']]) {
      let payload;
      try {
        payload = await safeFetchJson(new URL(endpoint,target.origin).href,{...options,allowedOrigins:[target.origin]});
      } catch (error) {
        if (isAccessDeniedError(error) || (error.status && error.status !== 404)) throw error;
        if (!error.status && !/JSON|json|content-type|响应格式/.test(error.message)) throw error;
        continue;
      }
      const recognized = kind === 'dujiao'
        ? Array.isArray(payload.data) && (payload.data.length ? payload.data.every(p => Array.isArray(p?.skus) && (p.id != null || p.slug != null) && (p.title != null || p.name != null)) : [0,200].includes(payload.status_code))
        : Array.isArray(payload.data) && (payload.data.length ? payload.data.every(p => p && (p.id != null || p.commodity_id != null || p.goods_id != null) &&
          (typeof p.name === 'string' || typeof p.title === 'string') && (p.price != null || p.user_price != null) && !Array.isArray(p.skus)) : [0,200].includes(payload.code));
      if (!recognized) continue;
      target.kind = kind;
      let first = true;
      options.fetchImpl = (value,init) => {
        if (first) {first=false;return Promise.resolve(new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}}));}
        return fetchImpl(value,init);
      };
      break;
    }
    if (!target.kind) return {unsupported:true};
  }
  return {offers:validatedOffers(await collectorFor(target)(target,options),target,merchant,capturedAt)};
}

export async function collectApprovedMerchants(ctx, {manifest,existingOffers=[],capturedAt,maxCacheAgeMinutes=1440} = {}) {
  const cacheDir = path.join(ctx.dataDir,'direct-shops-cache','approved-merchants');
  mkdirSync(cacheDir,{recursive:true});
  const offers = [], health = [];
  const deadline = Date.now()+60000;
  const fixed = knownTargets();
  const states = manifest.merchants.map(merchant => {
    const version = hash(JSON.stringify(merchant)).slice(0,16);
    const file = path.join(cacheDir,`${merchant.id}-${version}.json`);
    return {merchant,file,cached:readCache(file)};
  }).sort((a,b) => (Date.parse(a.cached?.checkedAt)||0)-(Date.parse(b.cached?.checkedAt)||0));
  for (const {merchant,file,cached} of states) {
    const matched = fixed.find(target => targetIdentity(target) === merchant.identity);
    const existing = matched ? existingOffers.filter(offer => offer.sourceId === matched.id) : [];
    if (existing.length) {
      const lastSuccess = existing.map(o=>o.capturedAt).sort().at(-1);
      const live = existing.every(o=>!['stale','unavailable'].includes(o.extra?.quoteHealth?.status));
      health.push({id:merchant.id,identity:merchant.identity,name:merchant.shopName,status:live?'active':'unavailable',checkedAt:capturedAt,lastSuccess,offerCount:existing.length,detail:live?'已接入现有公开目录':'原店暂时不可用'});
      continue;
    }
    let state = cached;
    const elapsed = (Date.now()-Date.parse(cached?.checkedAt))/60000;
    if (!cached || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RETRY_MINUTES) {
      if (Date.now() >= deadline) {
        health.push({id:merchant.id,identity:merchant.identity,name:merchant.shopName,status:'queued',checkedAt:capturedAt,lastSuccess:cached?.lastSuccess||null,offerCount:0,detail:'等待下一轮公开目录检查'});
        continue;
      }
      try {
        const result = await collectMerchant(merchant,ctx,capturedAt,deadline);
        state = result.unsupported ? {status:'waiting_adapter',checkedAt:capturedAt,offers:[],lastSuccess:null}
          : {status:'active',checkedAt:capturedAt,lastSuccess:capturedAt,offers:result.offers};
      } catch {
        state = {status:'unavailable',checkedAt:capturedAt,lastSuccess:cached?.lastSuccess||null,offers:cached?.offers||[]};
      }
      writeCache(file,state);
    }
    const age = (Date.now()-Date.parse(state.lastSuccess))/60000;
    const usable = Number.isFinite(age) && age >= 0 && age <= maxCacheAgeMinutes && Array.isArray(state.offers);
    const usableOffers = usable ? state.offers : [];
    offers.push(...usableOffers.map(offer=>({...offer,extra:{...offer.extra,quoteHealth:{status:state.status==='active'?'cached':'stale',maxAgeMinutes:maxCacheAgeMinutes}}})));
    health.push({id:merchant.id,identity:merchant.identity,name:merchant.shopName,status:state.status,checkedAt:state.checkedAt,lastSuccess:state.lastSuccess,offerCount:usableOffers.length,
      detail:state.status==='active'?'已读取公开目录':state.status==='waiting_adapter'?'当前店铺系统待适配':'公开目录暂时不可用，请稍后重试'});
  }
  return {offers,health};
}
