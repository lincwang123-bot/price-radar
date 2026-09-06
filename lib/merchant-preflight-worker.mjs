import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalShopIdentity } from './merchant-onboarding.mjs';
import { probeMerchantCatalog } from './merchant-collection.mjs';
import { summarizeMerchantOffers } from './merchant-quote-preview.mjs';

const HOUR = 3600000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function readPreflightRequests(bridgeDir, now = Date.now()) {
  if (!bridgeDir) return { valid: true, requests: [] };
  try {
    const file = path.join(bridgeDir, 'preflight-requests.json');
    if (statSync(file).size > 64 * 1024) throw new Error('oversized');
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.requests) || payload.requests.length > 20) throw new Error('invalid');
    const seen = new Set();
    const requests = payload.requests.map(row => {
      const requested = Date.parse(row.requestedAt), expires = Date.parse(row.expiresAt);
      if (!/^MT-[A-F0-9]{24}$/.test(row.id) || !/^MA-\d{8}-[A-F0-9]{12}$/.test(row.applicationId)
        || !Number.isSafeInteger(row.applicationVersion) || row.applicationVersion < 1
        || typeof row.shopName !== 'string' || !row.shopName.trim() || row.shopName.length > 100
        || !['16688', 'ldxp', 'independent'].includes(row.platform)
        || row.identity !== canonicalShopIdentity(row.shopUrl)
        || !Number.isFinite(requested) || !Number.isFinite(expires) || expires <= requested || expires - requested > HOUR
        || requested > now + 1000 || seen.has(row.id) || seen.has(row.applicationId)) throw new Error('invalid');
      seen.add(row.id); seen.add(row.applicationId);
      return { id: row.id, applicationId: row.applicationId, applicationVersion: row.applicationVersion, identity: row.identity,
        shopName: row.shopName, shopUrl: row.shopUrl, platform: row.platform, requestedAt: row.requestedAt, expiresAt: row.expiresAt };
    });
    return { valid: true, requests: requests.filter(row => Date.parse(row.expiresAt) > now).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)) };
  } catch (error) { return { valid: error.code === 'ENOENT', requests: [] }; }
}

function saveResult(directory, result) {
  const file = path.join(directory, `${result.id}.json`);
  const temporary = path.join(directory, `.${result.id}-${randomBytes(8).toString('hex')}.tmp`);
  const content = JSON.stringify(result);
  if (Buffer.byteLength(content) > 64 * 1024) throw new Error('preflight result too large');
  try { writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' }); renameSync(temporary, file); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

// Called by the existing collector, not the web process. Test offers never enter
// the normal snapshot/cache/alert paths, and a test never changes approval state.
export async function processMerchantPreflights(ctx) {
  const bridgeDir = ctx.merchantBridgeDir || process.env.MERCHANT_BRIDGE_DIR;
  const queue = readPreflightRequests(bridgeDir);
  if (!queue.valid || !queue.requests.length) return { valid: queue.valid, processed: 0 };
  const directory = path.join(ctx.dataDir, 'merchant-preflights');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.worker.lock');
  let descriptor;
  try { descriptor = openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize recovery and recheck while holding it: a second recovering
    // process must never unlink the first process's newly acquired lock.
    const recovery = path.join(directory, '.worker-recovery');
    try { mkdirSync(recovery, { mode: 0o700 }); }
    catch (recoveryError) { if (recoveryError.code === 'EEXIST') return { valid: true, processed: 0 }; throw recoveryError; }
    try {
      try {
        if (Date.now() - statSync(lock).mtimeMs <= 5 * 60000) return { valid: true, processed: 0 };
        unlinkSync(lock);
      } catch (staleError) { if (staleError.code !== 'ENOENT') throw staleError; }
      try { descriptor = openSync(lock, 'wx', 0o600); }
      catch (openError) { if (openError.code === 'EEXIST') return { valid: true, processed: 0 }; throw openError; }
    } finally { rmdirSync(recovery); }
  }
  const ownedLock = fstatSync(descriptor);
  let processed = 0, attempts = 0;
  const deadline = Date.now() + 60000;
  try {
    for (const request of queue.requests) {
      if (attempts >= 2 || Date.now() >= deadline) break;
      if (existsSync(path.join(directory, `${request.id}.json`))) continue;
      const current = readPreflightRequests(bridgeDir).requests.find(row => row.id === request.id);
      if (!current || !same(current, request)) continue;
      attempts++;
      const startedAt = new Date().toISOString();
      let details;
      try {
        const merchant = { ...request, id: 'merchant-' + createHash('sha256').update(request.identity).digest('hex').slice(0, 16) };
        const catalog = await probeMerchantCatalog(merchant, ctx, startedAt, deadline);
        details = catalog.unsupported
          ? { status: 'waiting_adapter', rawCount: 0, validCount: 0, samples: [], message: '尚未找到兼容的公开商品目录。请向店主确认建站系统及版本，或提供只读商品接口文档；不需要账号密码。' }
          : { ...summarizeMerchantOffers(catalog.offers), status: 'ready', message: '已读取商品目录。请人工核对样例的价格、规格和商品页；检测不代表交易或售后保证。' };
        if (details.status === 'ready' && !details.validCount) details = { ...details, status: 'no_valid_offers', message: '目录可以读取，但没有符合网站展示规则的报价。请核对价格、库存、质保、品类及规格后重新测试。' };
      } catch (error) {
        details = { status: 'unavailable', rawCount: 0, validCount: 0, samples: [], message: [401, 403, 429].includes(error.status)
          ? '店铺拒绝访问或限制请求。请店主确认公开目录访问权限或提供只读接口；不会绕过登录、验证码或安全防护。'
          : '暂时无法完整读取目录。请核对网址、店铺可用性或稍后重试；持续失败需要检查接口适配。' };
      }
      const latest = readPreflightRequests(bridgeDir).requests.find(row => row.id === request.id);
      if (!latest || !same(latest, request)) continue;
      saveResult(directory, { schemaVersion: 1, id: request.id, applicationId: request.applicationId,
        applicationVersion: request.applicationVersion, identity: request.identity, startedAt, checkedAt: new Date().toISOString(), ...details });
      processed++;
    }
    return { valid: true, processed };
  } finally {
    closeSync(descriptor);
    try {
      const currentLock = statSync(lock);
      if (currentLock.ino === ownedLock.ino && currentLock.dev === ownedLock.dev) unlinkSync(lock);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
