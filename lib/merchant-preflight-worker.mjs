import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalShopIdentity } from './merchant-onboarding.mjs';
import { probeMerchantCatalog } from './merchant-collection.mjs';
import { summarizeMerchantOffers } from './merchant-quote-preview.mjs';
import { classifyPreflightError, isPreflightReasonCode, isPreflightHttpStatus, preflightGuidance } from './merchant-preflight-guidance.mjs';
import { acquirePreflightLock, preflightLockPath, validPreflightId } from './merchant-preflight-lock.mjs';

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
      if (!/^MT-[A-F0-9]{24}$/.test(row.id) || !/^(?:MA-\d{8}-[A-F0-9]{12}|CO-\d{8}-[A-Z0-9]{8,16})$/.test(row.applicationId)
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
export async function processMerchantPreflights(ctx, { requestId } = {}) {
  if (requestId !== undefined && !validPreflightId(requestId)) return { valid: false, processed: 0 };
  const bridgeDir = ctx.merchantBridgeDir || process.env.MERCHANT_BRIDGE_DIR;
  const queue = readPreflightRequests(bridgeDir);
  if (!queue.valid || !queue.requests.length) return { valid: queue.valid, processed: 0 };
  const directory = path.join(ctx.dataDir, 'merchant-preflights');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Manual requests skip the scheduled batch, but never duplicate that same
  // request's network work. The isolated immediate service bounds concurrency.
  const releaseBatch = requestId ? () => {} : acquirePreflightLock(path.join(directory, '.worker.lock'), path.join(directory, '.worker-recovery'));
  if (!releaseBatch) return { valid: true, processed: 0 };
  let processed = 0, attempts = 0;
  const deadline = Date.now() + 60000;
  try {
    for (const request of queue.requests) {
      if (requestId && request.id !== requestId) continue;
      if (attempts >= 2 || Date.now() >= deadline) break;
      if (existsSync(path.join(directory, `${request.id}.json`))) continue;
      const current = readPreflightRequests(bridgeDir).requests.find(row => row.id === request.id);
      if (!current || !same(current, request)) continue;
      const releaseRequest = acquirePreflightLock(preflightLockPath(directory, request.id));
      if (!releaseRequest) continue;
      try {
      if (existsSync(path.join(directory, `${request.id}.json`))) continue;
      attempts++;
      const startedAt = new Date().toISOString();
      let details;
      let stage = 'catalog';
      try {
        const merchant = { ...request, id: 'merchant-' + createHash('sha256').update(request.identity).digest('hex').slice(0, 16) };
        const catalog = await probeMerchantCatalog(merchant, ctx, startedAt, deadline);
        stage = 'preview';
        details = catalog.unsupported
          ? { status: 'waiting_adapter', rawCount: 0, validCount: 0, samples: [], reasonCode: isPreflightReasonCode(catalog.reasonCode) ? catalog.reasonCode : 'unsupported_platform',
            ...(isPreflightHttpStatus(catalog.httpStatus) ? { httpStatus: catalog.httpStatus } : {}) }
          : { ...summarizeMerchantOffers(catalog.offers), status: 'ready', message: '已读取商品目录。请人工核对样例的价格、规格和商品页；检测不代表交易或售后保证。' };
        if (details.status === 'ready' && !details.validCount) details = { ...details, status: 'no_valid_offers', reasonCode: 'no_valid_quotes' };
      } catch (error) {
        details = { status: 'unavailable', rawCount: 0, validCount: 0, samples: [],
          ...(stage === 'preview' ? { reasonCode: 'internal_error' } : classifyPreflightError(error)) };
      }
      details.message = preflightGuidance(details).explanation;
      const latest = readPreflightRequests(bridgeDir).requests.find(row => row.id === request.id);
      if (!latest || !same(latest, request)) continue;
      saveResult(directory, { schemaVersion: 1, id: request.id, applicationId: request.applicationId,
        applicationVersion: request.applicationVersion, identity: request.identity, startedAt, checkedAt: new Date().toISOString(), ...details });
      processed++;
      } finally { releaseRequest(); }
    }
    return { valid: true, processed };
  } finally {
    releaseBatch();
  }
}
