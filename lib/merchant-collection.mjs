import {collectAizcPublic,AIZC_ORIGIN,AIZC_MAX_REQUESTS} from '../collectors/direct/aizc-public.mjs';
import {publicPageUrl} from './public-catalog-html.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicNetworkFetch, publicHttpsUrl } from './public-network-fetch.mjs';
import { merchantIdentityForUrl, merchantIdentityForOffer } from './merchant-identity.mjs';
import { authorizeMerchantTarget } from './merchant-target-capability.mjs';
import { collectorFor, directTargets, DEFAULT_DIRECT_TARGET_IDS, SHOP_API_TARGET_IDS, MERCHANT_ONLY_TARGET_IDS } from '../collectors/direct/registry.mjs';
import { BBSHARE_MAX_REQUESTS } from '../collectors/direct/bbshare.mjs';
import { collectPublicHtml, robotsPolicy, PUBLIC_HTML_MAX_REQUESTS } from '../collectors/direct/public-html.mjs';
import {DUJIAOKA_HTML_MAX_REQUESTS} from '../collectors/direct/dujiaoka-html.mjs';
import { safeFetchJson, safeFetchText, isAccessDeniedError } from './safe-fetch.mjs';
import { summarizeMerchantOffers } from './merchant-quote-preview.mjs';
import {merchantUrlBlocked} from './merchant-blocklist.mjs';
import {classifyPreflightError} from './merchant-preflight-guidance.mjs';
import {retryingPublicFetch} from './direct-read-retry.mjs';
import {isPublicProductsCatalog,collectPublicProducts} from '../collectors/direct/public-products.mjs';
import {canonical16688ShopNo} from './platform16688-identity.mjs';
import {collectDawnformPublic,DAWNFORM_ORIGIN,DAWNFORM_INTERVAL_MS} from '../collectors/direct/dawnform-public.mjs';
import {sharedMerchantReadRate} from './merchant-public-read-rate.mjs';
import {collectReviewedHtml} from '../collectors/direct/reviewed-html.mjs';
import {normalizeCollectionAccess} from './merchant-collection-access.mjs';
import {collectPublicReplyPages} from '../collectors/direct/public-reply-pages.mjs';
import {collectHostedPublicCatalog} from '../collectors/direct/hosted-public-catalog.mjs';
import {collectProdClub,PRODCLUB_ORIGIN,PRODCLUB_MAX_REQUESTS} from '../collectors/direct/prodclub.mjs';
import {collectGetVip,GETVIP_ORIGIN,GETVIP_MAX_REQUESTS} from '../collectors/direct/getvip.mjs';
import {normalizeRefreshBefore,refreshPending} from './collection-refresh.mjs';

export { merchantIdentityForUrl, merchantIdentityForOffer } from './merchant-identity.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_MANIFEST_BYTES = 256 * 1024;
const RETRY_MINUTES = 30;
const MERCHANT_READ_TIMEOUT_MS = 30000;
// Ported from GitHub PR #5. ShopApi is a handful of POSTs, but production WAF makes
// each call slow. Keep this budget off the public-HTML cap so a normal category list
// is not aborted as an HTML crawl: 1 categoryList + maxCategories(10) * maxPagesPerCategory(4)
// plus a few retries. Live catfk uses the same ShopApi collector on its own origin.
export const SHOP_API_MAX_REQUESTS = 45;
export const SHOP_API_TOTAL_TIMEOUT_MS = 50_000;
export const MERCHANT_REFRESH_MINUTES = 5;
const TRANSIENT_REASONS = new Set(['timeout','network_error','dns_error','server_error']);
export const merchantRetryMinutes = reasonCode => TRANSIENT_REASONS.has(reasonCode) ? 5 : RETRY_MINUTES;
const knownTargets = () => directTargets([...DEFAULT_DIRECT_TARGET_IDS,...SHOP_API_TARGET_IDS,...MERCHANT_ONLY_TARGET_IDS]);
const targetIdentity = target => merchantIdentityForUrl(target.shopNo ? `${target.origin}/shop/${target.shopNo}` : target.token ? `${target.origin}/shop/${target.token}` : target.origin);

export function readApprovedManifest(bridgeDir = process.env.MERCHANT_BRIDGE_DIR) {
  if (!bridgeDir) return { merchants:[],fingerprint:'none',valid:true };
  try {
    const file = path.join(bridgeDir,'approved.json');
    if (statSync(file).size > MAX_MANIFEST_BYTES) throw new Error('oversized');
    const payload = JSON.parse(readFileSync(file,'utf8'));
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.merchants)) throw new Error('invalid');
    const restrictedOrigins = payload.restrictedOrigins === undefined ? [] : payload.restrictedOrigins;
    if (!Array.isArray(restrictedOrigins) || restrictedOrigins.length > 10000 || new Set(restrictedOrigins).size !== restrictedOrigins.length ||
      restrictedOrigins.some(origin => typeof origin !== 'string' || publicHttpsUrl(origin).origin !== origin)) throw new Error('invalid');
    const seen = new Set();
    const merchants = payload.merchants.map(row => {
      const url = publicHttpsUrl(row.shopUrl);
      const identity = merchantIdentityForUrl(url.href);
      if (url.search || url.hash || !identity || row.identity !== identity || row.id !== `merchant-${hash(identity).slice(0,16)}` ||
          row.status !== 'approved' || !['auto','16688','ldxp','independent'].includes(row.platform) ||
          typeof row.shopName !== 'string' || !row.shopName.trim() || row.shopName.length > 120 ||
          !Number.isFinite(Date.parse(row.approvedAt)) || (row.identityVerifiedAt!==null&&!Number.isFinite(Date.parse(row.identityVerifiedAt))) ||
          seen.has(identity)) throw new Error('invalid');
      if (row.version !== undefined && !(Number.isSafeInteger(row.version) && row.version > 0)) throw new Error('invalid');
      if (row.collectionAccess !== undefined && row.collectionAccess?.permissionScope !== 'ongoing') throw new Error('invalid');
      seen.add(identity);
      return {id:row.id,identity,shopName:row.shopName,shopUrl:url.href,platform:row.platform,status:'approved',
        version:row.version,approvedAt:row.approvedAt,identityVerifiedAt:row.identityVerifiedAt,
        ...(row.collectionAccess===undefined?{}:{collectionAccess:normalizeCollectionAccess(row.collectionAccess,{shopUrl:row.shopUrl})})};
    });
    return {merchants,restrictedOrigins:[...restrictedOrigins].sort(),fingerprint:hash(JSON.stringify({merchants,restrictedOrigins:[...restrictedOrigins].sort()})),valid:true};
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
      shopUrl:merchant.shopUrl,...(target.shopNo?{shopNo:merchant.identity.split(':')[2],resolvedShopNo:target.shopNo}:{})}};
  });
}

export async function probeMerchantCatalog(merchant, ctx, capturedAt, deadline) {
  if(merchantUrlBlocked(merchant.shopUrl))throw new Error('该店铺已被站方暂停采集');
  const url = publicHttpsUrl(merchant.shopUrl);
  const access=merchant.collectionAccess===undefined?null:normalizeCollectionAccess(merchant.collectionAccess,{shopUrl:merchant.shopUrl});
  const known = knownTargets().find(target => targetIdentity(target) === merchant.identity);
  let target = known ? {...known,id:merchant.id,name:merchant.shopName} : {id:merchant.id,name:merchant.shopName,origin:url.origin,currency:'CNY',maxPages:5,pageSize:100};
  if (merchant.identity.startsWith('shop:16688:')) target = {...target,kind:'platform16688',shopNo:merchant.identity.split(':')[2],origin:'https://www.16688.com.cn'};
  else if (merchant.identity.startsWith('shop:wzyp:')) target = {...target,kind:'shopApi',token:merchant.identity.split(':')[2],origin:'https://wzyp.cn',maxCategories:10,maxPagesPerCategory:4};
  else if (merchant.identity.startsWith('shop:ldxp-pay:')) target = {...target,kind:'shopApi',token:merchant.identity.split(':')[2],origin:'https://pay.ldxp.cn',maxCategories:10,maxPagesPerCategory:4};
  else if (merchant.identity.startsWith('shop:ldxp:')) return {unsupported:true};
  else if(url.hostname.replace(/^www\./,'')==='catfk.com') {
    const token=/^\/shop\/([A-Za-z0-9_-]{1,100})\/?$/.exec(url.pathname)?.[1];
    if(!token||merchantIdentityForUrl(url.href)!==`shop:catfk:${token}`)return {unsupported:true,reasonCode:'unsupported_platform'};
    target={...target,kind:'catfk',token,maxCategories:10,maxPagesPerCategory:4};
  }
  const dawnform=merchant.identity==='domain:faka.dawnform.top'&&url.origin===DAWNFORM_ORIGIN&&url.pathname==='/'&&!url.search&&!url.hash;
  const prodclub=!access&&url.origin===PRODCLUB_ORIGIN&&!url.search&&!url.hash&&(url.pathname==='/'||/^\/r\/[A-Za-z0-9]{1,32}\/?$/.test(url.pathname));
  const aizc=!access&&merchant.identity==='domain:www.aizc.club'&&url.origin===AIZC_ORIGIN&&url.pathname==='/'&&!url.search&&!url.hash;
  const getvip=!access&&url.origin===GETVIP_ORIGIN&&url.pathname==='/'&&!url.search&&!url.hash;
  if(dawnform)target={...target,kind:'dawnformPublic'};
  const readOrigin=access?.mode==='hosted_catalog'?new URL(access.publicUrls[0]).origin:target.origin;
  // 16688 shop catalogues can exceed the default 1 MiB HTML budget (XAI S209643 ~1.9 MiB).
  // Keep HTML/other adapters on 1 MiB; only enlarge the wire budget for platform16688 JSON lists.
  const catalogMaxBytes=target.kind==='platform16688'?4*1024*1024:1024*1024;
  const shopApi=!access&&(target.kind==='shopApi'||target.kind==='catfk');
  const networkFetch = (ctx.merchantFetchFactory ?? createPublicNetworkFetch)(readOrigin,{timeoutMs:15000,totalTimeoutMs:Math.max(1,Math.min(shopApi?SHOP_API_TOTAL_TIMEOUT_MS:MERCHANT_READ_TIMEOUT_MS,deadline-Date.now())),
    maxBytes:catalogMaxBytes,
    maxRequests:access?.mode==='hosted_catalog'?2:dawnform?2:aizc?AIZC_MAX_REQUESTS:getvip?GETVIP_MAX_REQUESTS:prodclub?PRODCLUB_MAX_REQUESTS:shopApi?SHOP_API_MAX_REQUESTS:target.kind==='bbshare'?BBSHARE_MAX_REQUESTS:target.kind==='dujiaokaHtml'?DUJIAOKA_HTML_MAX_REQUESTS:PUBLIC_HTML_MAX_REQUESTS});
  let discoveryPolicy, lastDiscoveryStart = 0;
  const minimumMs=access?.minimumIntervalMs||(dawnform?DAWNFORM_INTERVAL_MS:1100);
  const rateFetch=dawnform||access?sharedMerchantReadRate(networkFetch,{dataDir:ctx.dataDir,origin:readOrigin,minimumMs,
    interval:()=>Math.max(minimumMs,discoveryPolicy?.delay||0),deadline,sleep:ctx.sleep}):networkFetch;
  const permittedFetch = async (value,init={}) => {
    if(access){const requested=publicHttpsUrl(String(value));
      if(requested.origin!==readOrigin||(init.method||'GET').toUpperCase()!=='GET'||init.body!=null
        ||(requested.href!==readOrigin+'/robots.txt'&&!access.publicUrls.includes(requested.href)))
        throw Object.assign(new Error('请求超出已核验公开页面范围'),{code:'PREFLIGHT_INTERNAL_ERROR'});
    }
    if(discoveryPolicy&&!discoveryPolicy.allows(value))throw Object.assign(new Error('公开页面读取被 robots 禁止'),{code:'ROBOTS_DISALLOWED'});
    const interval=Math.max(discoveryPolicy?.delay||0,1100);
    const wait=Math.max(0,interval-(Date.now()-lastDiscoveryStart));
    if(Date.now()+wait>=deadline)throw new Error('公开目录采集超时');
    if(wait)await (ctx.sleep||delay)(wait,undefined,{signal:init.signal});
    init.signal?.throwIfAborted();lastDiscoveryStart=Date.now();
    const headers=new Headers(init.headers);headers.set('user-agent','AiradarBot/1.0 (+https://airadar.vip)');
    return rateFetch(value,{...init,headers});
  };
  // Known adapters also identify this collector. ShopApi shares one policy and
  // request-start limiter across category reads, product pages and retries.
  const fetchImpl = retryingPublicFetch(permittedFetch,{deadline,sleep:ctx.sleep,maxRetries:dawnform||aizc||access?.mode==='hosted_catalog'?0:1});
  const options = {capturedAt,fetchImpl,checkoutFetchImpl:permittedFetch,timeoutMs:15000,maxBytes:catalogMaxBytes,maxRedirects:0,requestDelayMs:0,deadline,sleep:ctx.sleep};
  authorizeMerchantTarget(target);
  if (access || !target.kind || dawnform || aizc || target.kind === 'shopApi' || target.kind === 'catfk' || target.kind === 'platform16688') {
    // Read crawler permissions before guessing standard public API endpoints.
    // The same policy, user agent and request budget cover discovery and all
    // later pages (including retries); HTML fallback reuses this robots result.
    let policy;
    try { policy = robotsPolicy(await safeFetchText(readOrigin+'/robots.txt',{...options,headers:{accept:'text/plain'},maxBytes:512*1024,allowedOrigins:[readOrigin]})); }
    catch (error) { if(error.status!==404)throw error;policy=robotsPolicy(''); }
    discoveryPolicy=policy;options.robotsPolicy=policy;
  }
  if(access)return {offers:validatedOffers(await (access.mode==='hosted_catalog'?collectHostedPublicCatalog(target,merchant.shopUrl,access,options):collectPublicReplyPages(target,access,options)),target,merchant,capturedAt)};
  if(aizc)return {offers:validatedOffers(await collectAizcPublic(target,options),target,merchant,capturedAt)};
  if(dawnform)return {offers:validatedOffers(await collectDawnformPublic(target,options),target,merchant,capturedAt)};
  // Reviewed public catalogue: referral codes affect promotions, not the
  // default retail prices read here. Page-only permission still takes priority.
  if(getvip)
    return {offers:validatedOffers(await collectGetVip(target,options),target,merchant,capturedAt)};
  if(prodclub)
    return {offers:validatedOffers(await collectProdClub(target,options),target,merchant,capturedAt)};
  if(['https://bei-bei.shop','https://alivip.vip'].includes(url.origin)&&url.pathname==='/'&&!url.search&&!url.hash)
    return {offers:validatedOffers(await collectReviewedHtml(target,options),target,merchant,capturedAt)};
  if(target.kind==='platform16688') {
    const metadata=await safeFetchJson(target.origin+'/shopApi/shop/detail',{
      ...options,allowedOrigins:[target.origin],allowedMethods:['POST'],method:'POST',maxBytes:128*1024,
      headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({shop_no:target.shopNo}),
    });
    target.shopNo=canonical16688ShopNo(metadata,target.shopNo);
  }
  if (!target.kind) {
    const policy=discoveryPolicy;
    // An applicant may give a complete static product detail page directly.
    // Read that exact page after robots, without guessing APIs or other pages.
    if(publicPageUrl(url.href,url.origin)&&policy.allows(url)) {
      return {offers:validatedOffers(await collectPublicReplyPages(target,{publicUrls:[url.href]},options),target,merchant,capturedAt)};
    }
    // Prefer public pages and the read-only interfaces they actually advertise.
    // A guessed conventional endpoint can require login even when a storefront
    // exposes a complete public catalogue through a different contract.
    let htmlNotFound=false, htmlInvalid=null, htmlDenied=null;
    if(url.pathname==='/'&&policy.allows(url)) {
      try{return {offers:validatedOffers(await collectPublicHtml(target,options),target,merchant,capturedAt)};}
      catch(error){
        // An identified catalogue with incomplete product evidence needs an
        // adapter fix. A guessed endpoint must not replace that evidence with
        // an unrelated login/access error or hide an incomplete catalogue.
        // An ACG/kami storefront may render detail pages the generic HTML
        // reader cannot reconcile while exposing its own read-only catalogue
        // API. Only a recognised API contract below may replace it; otherwise
        // the original HTML failure is still reported.
        if(error.code==='INVALID_CATALOG'){htmlInvalid=error;}
        // A storefront challenge page may sit in front of HTML only while the
        // platform's own public read-only catalogue API stays open. Try only
        // the recognised API contracts below; if none answers, report the
        // original challenge instead of a guessed-endpoint error.
        else if(isAccessDeniedError(error)){htmlDenied=error;}
        else{
        if(error.code!=='UNSUPPORTED_PUBLIC_HTML'&&error.status!==404)throw error;
        htmlNotFound=error.status===404;
        }
      }
    }
    for (const [kind,endpoint] of [['dujiao','/api/v1/public/products?page=1&page_size=100'],['kami','/user/api/index/commodity?limit=100&page=1']]) {
      if(!policy.allows(new URL(endpoint,target.origin)))continue;
      let payload;
      try {
        payload = await safeFetchJson(new URL(endpoint,target.origin).href,{...options,allowedOrigins:[target.origin]});
      } catch (error) {
        // A guessed login/API error must not replace an already identified
        // public catalogue that failed to parse.
        if (htmlInvalid||htmlDenied) continue;
        if (isAccessDeniedError(error) || (error.status && error.status !== 404)) throw error;
        if (!error.status && !/^safe-fetch: JSON (?:响应类型无效（|解析失败:)/.test(error.message)) throw error;
        continue;
      }
      const recognized = kind === 'dujiao'
        ? Array.isArray(payload.data) && (payload.data.length ? payload.data.every(p => Array.isArray(p?.skus) && (p.id != null || p.slug != null) && (p.title != null || p.name != null)) : [0,200].includes(payload.status_code))
        : Array.isArray(payload.data) && (payload.data.length ? payload.data.every(p => p && (p.id != null || p.commodity_id != null || p.goods_id != null) &&
          (typeof p.name === 'string' || typeof p.title === 'string') && (p.price != null || p.user_price != null) && !Array.isArray(p.skus)) : [0,200].includes(payload.code));
      if(!recognized&&kind==='dujiao'&&isPublicProductsCatalog(payload)){
        let first=true;
        const cachedFetch=(value,init)=>{if(first){first=false;return Promise.resolve(new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}}));}return fetchImpl(value,init);};
        return {offers:validatedOffers(await collectPublicProducts(target,{...options,fetchImpl:cachedFetch}),target,merchant,capturedAt)};
      }
      if (!recognized) continue;
      target.kind = kind;
      let first = true;
      options.fetchImpl = (value,init) => {
        if (first) {first=false;return Promise.resolve(new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}}));}
        return fetchImpl(value,init);
      };
      break;
    }
    if (!target.kind) {
      if(htmlInvalid)throw htmlInvalid;
      if(htmlDenied)throw htmlDenied;
      if(!policy.allows(url))throw Object.assign(new Error('公开目录读取被 robots 禁止'),{code:'ROBOTS_DISALLOWED'});
      return htmlNotFound?{unsupported:true,reasonCode:'not_found',httpStatus:404}
        :{unsupported:true,reasonCode:'unsupported_platform'};
    }
  }
  return {offers:validatedOffers(await collectorFor(target)(target,options),target,merchant,capturedAt)};
}

export async function collectApprovedMerchants(ctx, {manifest,existingOffers=[],existingHealth=[],capturedAt,maxCacheAgeMinutes=1440} = {}) {
  const refreshBefore=normalizeRefreshBefore(ctx.refreshBefore);
  const cacheDir = path.join(ctx.dataDir,'direct-shops-cache','approved-merchants');
  mkdirSync(cacheDir,{recursive:true});
  const offers = [], health = [];
  // The daemon has a five-minute cadence. Leave a bounded three-minute window
  // for approved catalogues; each individual shop still has its 30s ceiling.
  const deadline = Date.now()+180000;
  const fixed = knownTargets();
  const states = manifest.merchants.filter(merchant=>!merchantUrlBlocked(merchant.shopUrl)).map(merchant => {
    const version = hash(JSON.stringify(merchant)).slice(0,16);
    const file = path.join(cacheDir,`${merchant.id}-${version}.json`);
    return {merchant,file,cached:readCache(file)};
  }).sort((a,b) => (Date.parse(a.cached?.checkedAt)||0)-(Date.parse(b.cached?.checkedAt)||0));
  for (const {merchant,file,cached} of states) {
    const matched = !merchant.collectionAccess&&fixed.find(target => targetIdentity(target) === merchant.identity);
    const existing = matched ? existingOffers.filter(offer => offer.sourceId === matched.id) : [];
    const fixedHealth=matched?existingHealth.find(row=>row.target===matched.id):null;
    if (existing.length||(refreshBefore&&fixedHealth)) {
      const lastSuccess = existing.map(o=>o.capturedAt).sort().at(-1)||fixedHealth?.lastSuccess||null;
      const live = !['stale','unavailable'].includes(fixedHealth?.status)&&existing.every(o=>!['stale','unavailable'].includes(o.extra?.quoteHealth?.status));
      const validCount = live ? summarizeMerchantOffers(existing).validCount : 0;
      health.push({id:merchant.id,identity:merchant.identity,name:merchant.shopName,status:live?(validCount?'active':'no_valid_offers'):'unavailable',checkedAt:fixedHealth?.checkedAt||capturedAt,lastSuccess,offerCount:existing.length,validCount,
        ...(fixedHealth?.lastRefreshBefore?{lastRefreshBefore:fixedHealth.lastRefreshBefore}:{}),
        detail:live?(validCount?'已接入现有公开目录':'目录可读取，暂无符合展示规则的报价'):'原店暂时不可用'});
      continue;
    }
    let state = cached, refreshQueued = false;
    const elapsed = (Date.now()-Date.parse(cached?.checkedAt))/60000;
    const retryMinutes=cached?.status==='unavailable'?merchantRetryMinutes(cached.reasonCode)
      :cached?.status==='active'?MERCHANT_REFRESH_MINUTES:RETRY_MINUTES;
    const forceRefresh=refreshPending(refreshBefore,cached?.checkedAt,cached?.lastRefreshBefore);
    if (refreshBefore?forceRefresh:!cached || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= retryMinutes) {
      // A nearly spent round must not turn a healthy shop into a failed read.
      // Keep deferred cache timestamps so the oldest shop leads the next round.
      if (deadline - Date.now() < MERCHANT_READ_TIMEOUT_MS) {
        if (!cached) {
          health.push({id:merchant.id,identity:merchant.identity,name:merchant.shopName,status:'queued',checkedAt:refreshBefore?null:capturedAt,lastSuccess:null,offerCount:0,...(refreshBefore?{refreshQueued:true}:{}),detail:'等待下一轮公开目录检查'});
          continue;
        }
        // Queueing a refresh is not a failed read. Reuse the same timestamped
        // cache through the normal expiry checks, and keep its place next round.
        refreshQueued = true;
      } else {
        try {
          const result = await probeMerchantCatalog(merchant,ctx,capturedAt,deadline);
          state = result.unsupported ? {status:'waiting_adapter',checkedAt:capturedAt,offers:cached?.offers||[],lastSuccess:cached?.lastSuccess||null,reasonCode:result.reasonCode||'unsupported_platform'}
            : {status:'active',checkedAt:capturedAt,lastSuccess:capturedAt,offers:result.offers};
        } catch(error) {
          state = {status:'unavailable',checkedAt:capturedAt,lastSuccess:cached?.lastSuccess||null,offers:cached?.offers||[],...classifyPreflightError(error)};
        }
        if(forceRefresh)state.lastRefreshBefore=refreshBefore;
        else if(cached?.lastRefreshBefore)state.lastRefreshBefore=cached.lastRefreshBefore;
        writeCache(file,state);
      }
    }
    const age = (Date.now()-Date.parse(state.lastSuccess))/60000;
    // A failed refresh does not erase the last successful observation. Keep
    // its original timestamp, even beyond the live-quote freshness window.
    const usable = Number.isFinite(age) && age >= 0 && (age <= maxCacheAgeMinutes || ['unavailable','waiting_adapter'].includes(state.status)) && Array.isArray(state.offers);
    const usableOffers = usable ? state.offers : [];
    offers.push(...usableOffers.map(offer=>({...offer,extra:{...offer.extra,quoteHealth:{status:state.status==='active'?'cached':'stale',maxAgeMinutes:maxCacheAgeMinutes}}})));
    const validCount = state.status === 'active' ? summarizeMerchantOffers(usableOffers).validCount : 0;
    const status = state.status === 'active' && !validCount ? 'no_valid_offers' : state.status;
    const rejectedProductCount = state.status === 'active' ? Math.max(0,...usableOffers.map(offer=>offer.extra?.catalogValidation?.rejectedCount||0)) : 0;
    health.push({id:merchant.id,identity:merchant.identity,name:merchant.shopName,status,checkedAt:state.checkedAt,lastSuccess:state.lastSuccess,offerCount:usableOffers.length,validCount,reasonCode:state.reasonCode||null,
      ...(state.lastRefreshBefore?{lastRefreshBefore:state.lastRefreshBefore}:{}),
      ...(refreshQueued?{refreshQueued:true}:{}),
      ...(rejectedProductCount?{rejectedProductCount}:{}),
      detail:status==='active'?(rejectedProductCount?`已读取公开目录，${rejectedProductCount} 个资料不一致的商品待核对`:'已读取公开目录'):status==='no_valid_offers'?'目录可读取，暂无符合展示规则的报价':status==='waiting_adapter'?'当前店铺系统待适配':'公开目录暂时不可用，请稍后重试'});
  }
  return {offers,health};
}
