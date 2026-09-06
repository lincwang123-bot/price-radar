import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, openSync, fstatSync, readSync, closeSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';
import { MerchantApplicationError, getMerchantApplication, merchantBridgeDir } from './merchant-onboarding.mjs';

const HOUR = 3600_000, DAY = 24 * HOUR, MAX_RESULT = 64 * 1024;
const fail = (status, message) => { throw new MerchantApplicationError(status, message); };
const timeValue = value => { const n = new Date(value).getTime(); if (!Number.isFinite(n)) fail(422, '时间格式不正确'); return n; };
export function initMerchantPreflightSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_preflight_requests (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, application_id TEXT NOT NULL,
    application_version INTEGER NOT NULL, identity TEXT NOT NULL, shop_name TEXT NOT NULL,
    shop_url TEXT NOT NULL, platform TEXT NOT NULL, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    actor TEXT NOT NULL, ownership_confirmed INTEGER NOT NULL, permission_confirmed INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_merchant_preflight_app ON merchant_preflight_requests(application_id, sequence);
  CREATE TRIGGER IF NOT EXISTS merchant_preflight_no_update BEFORE UPDATE ON merchant_preflight_requests
    BEGIN SELECT RAISE(ABORT, 'merchant preflight audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS merchant_preflight_no_delete BEFORE DELETE ON merchant_preflight_requests
    BEGIN SELECT RAISE(ABORT, 'merchant preflight audit is append-only'); END;`);
}
const requestFromRow = row => row ? ({ id: row.id, applicationId: row.application_id, applicationVersion: row.application_version,
  identity: row.identity, shopName: row.shop_name, shopUrl: row.shop_url, platform: row.platform,
  requestedAt: row.requested_at, expiresAt: row.expires_at }) : null;

export function merchantPreflightResultsDir(db) {
  const file = db?.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  return file ? path.join(path.dirname(file), 'merchant-preflights') : null;
}
function safeSampleUrl(value, request) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname, shop = new URL(request.shopUrl);
    const normalizeHost = value => ['16688', 'ldxp'].includes(request.platform) ? value.replace(/^www\./, '') : value;
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port
      && url.protocol === shop.protocol && normalizeHost(host) === normalizeHost(shop.hostname)
      && !isIP(host.replace(/^\[|\]$/g, '')) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)
      && !/(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid|example|onion)$/i.test(host)
      && !/^(?:localhost|metadata)(?:\.|$)/i.test(host);
  } catch { return false; }
}
function isoTime(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value ? Date.parse(value) : NaN; }
function readResult(request, resultsDir, now) {
  if (!resultsDir) return { result: null, invalid: false };
  let fd;
  try {
    fd = openSync(path.join(resultsDir, `${request.id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_RESULT) return { result: null, invalid: true };
    const buffer = Buffer.alloc(MAX_RESULT + 1);
    let length = 0, n;
    while (length < buffer.length && (n = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += n;
    if (length > MAX_RESULT) return { result: null, invalid: true };
    const result = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    const start = isoTime(result.startedAt), checked = isoTime(result.checkedAt);
    if (result.schemaVersion !== 1 || result.id !== request.id || result.applicationId !== request.applicationId
      || result.applicationVersion !== request.applicationVersion || result.identity !== request.identity
      || !Number.isFinite(start) || !Number.isFinite(checked) || start < Date.parse(request.requestedAt)
      || checked < start || checked > Date.parse(request.expiresAt) || checked > now
      || !['ready', 'no_valid_offers', 'waiting_adapter', 'unavailable'].includes(result.status)
      || !Number.isSafeInteger(result.rawCount) || result.rawCount < 0 || result.rawCount > 1_000_000
      || !Number.isSafeInteger(result.validCount) || result.validCount < 0 || result.validCount > result.rawCount
      || typeof result.message !== 'string' || result.message.length > 1000
      || !Array.isArray(result.samples) || result.samples.length > 5 || result.samples.length > result.validCount
      || result.samples.some(sample => !sample || typeof sample.title !== 'string' || !sample.title.trim() || sample.title.length > 500
        || typeof sample.price !== 'number' || !Number.isFinite(sample.price) || sample.price <= 0
        || typeof sample.currency !== 'string' || !/^[A-Z]{3,6}$/.test(sample.currency) || !safeSampleUrl(sample.url, request))
      || (result.status === 'ready' && (!result.validCount || !result.samples.length))) return { result: null, invalid: true };
    // Return only the public collector contract, never unexpected fields from disk.
    return { invalid: false, result: { schemaVersion: 1, id: result.id, applicationId: result.applicationId,
      applicationVersion: result.applicationVersion, identity: result.identity, startedAt: result.startedAt, checkedAt: result.checkedAt,
      status: result.status, rawCount: result.rawCount, validCount: result.validCount, message: result.message,
      samples: result.samples.map(({ title, price, currency, url }) => ({ title, price, currency, url })) } };
  } catch (error) { return { result: null, invalid: error.code !== 'ENOENT' }; }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function latestMerchantPreflight(db, id, { resultsDir, now = new Date() } = {}) {
  initMerchantPreflightSchema(db);
  const request = requestFromRow(db.prepare('SELECT * FROM merchant_preflight_requests WHERE application_id=? ORDER BY sequence DESC LIMIT 1').get(id));
  if (!request) return null;
  const timestamp = timeValue(now), application = getMerchantApplication(db, id);
  const { result, invalid } = readResult(request, resultsDir, timestamp);
  const fresh = !!result && timestamp - Date.parse(result.checkedAt) < DAY;
  const matches = application?.version === request.applicationVersion && application.identity === request.identity;
  return { ...request, result, fresh, canApprove: !!(matches && fresh && result?.status === 'ready' && result.validCount > 0),
    status: !matches || (result && !fresh) ? 'expired' : result?.status || (invalid ? 'invalid' : Date.parse(request.expiresAt) <= timestamp ? 'expired' : 'pending') };
}
function atomicManifest(directory, content) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.preflight-${randomBytes(10).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path.join(directory, 'preflight-requests.json'));
  } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function pendingRequests(db, resultsDir, now) {
  return db.prepare(`SELECT p.* FROM merchant_preflight_requests p JOIN merchant_applications a ON a.public_id=p.application_id
    AND a.version=p.application_version AND a.identity=p.identity WHERE p.requested_at<=? AND p.expires_at>?
    AND p.sequence=(SELECT MAX(sequence) FROM merchant_preflight_requests WHERE application_id=p.application_id)
    ORDER BY p.sequence`).all(new Date(now).toISOString(), new Date(now).toISOString()).map(requestFromRow)
    .filter(request => { const state = readResult(request, resultsDir, now); return !state.result && !state.invalid; });
}
export function syncPreflightManifest(db, { bridgeDir = merchantBridgeDir(db), resultsDir, now = new Date(), excludeApplicationId } = {}) {
  initMerchantPreflightSchema(db);
  const requests = pendingRequests(db, resultsDir, timeValue(now)).filter(request => request.applicationId !== excludeApplicationId);
  if (requests.length > 20) fail(422, '测试队列已满，请等待现有测试完成');
  const manifest = { schemaVersion: 1, requests };
  if (bridgeDir) atomicManifest(bridgeDir, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function queueMerchantPreflight(db, id, review, { bridgeDir = merchantBridgeDir(db), resultsDir, now = new Date() } = {}) {
  initMerchantPreflightSchema(db);
  if (!bridgeDir || !resultsDir) fail(503, '测试采集目录尚未配置');
  if (review?.ownershipConfirmed !== true || review?.permissionConfirmed !== true) fail(422, '测试前必须确认店铺归属和公开目录采集许可');
  if (!Number.isSafeInteger(review.expectedVersion) || review.expectedVersion < 1) fail(409, '请刷新申请后再测试');
  const actor = String(review.actor || 'admin').trim();
  if (!actor || actor.length > 100 || /[\u0000-\u001f\u007f]/.test(actor)) fail(422, '审核人格式不正确');
  const timestamp = timeValue(now);
  let priorManifest = null, wroteManifest = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const application = getMerchantApplication(db, id);
    if (!application) fail(404, '申请不存在');
    if (application.version !== review.expectedVersion) fail(409, '申请已被更新，请刷新后再测试');
    const previous = db.prepare('SELECT requested_at FROM merchant_preflight_requests WHERE application_id=? ORDER BY sequence DESC LIMIT 1').get(id);
    if (previous && timestamp - Date.parse(previous.requested_at) < 60_000) fail(429, '同一店铺请间隔 60 秒后再测试');
    if (pendingRequests(db, resultsDir, timestamp).filter(request => request.applicationId !== id).length >= 20) fail(429, '测试队列已满，请等待现有测试完成');
    const requestId = `MT-${randomBytes(12).toString('hex').toUpperCase()}`;
    db.prepare(`INSERT INTO merchant_preflight_requests(id,application_id,application_version,identity,shop_name,shop_url,platform,requested_at,expires_at,actor,ownership_confirmed,permission_confirmed)
      VALUES(?,?,?,?,?,?,?,?,?,?,1,1)`).run(requestId, id, application.version, application.identity, application.shopName,
      application.shopUrl, application.platform, new Date(timestamp).toISOString(), new Date(timestamp + HOUR).toISOString(), actor);
    try { priorManifest = readFileSync(path.join(bridgeDir, 'preflight-requests.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    syncPreflightManifest(db, { bridgeDir, resultsDir, now }); wroteManifest = true;
    db.exec('COMMIT');
    return latestMerchantPreflight(db, id, { resultsDir, now });
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (wroteManifest) {
      if (priorManifest) atomicManifest(bridgeDir, priorManifest);
      else { try { unlinkSync(path.join(bridgeDir, 'preflight-requests.json')); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; } }
    }
    throw error;
  }
}
// The HTTP approval route calls this before reviewMerchantApplication; direct domain callers retain their existing contract.
export function assertPreflightApproval(db, id, review, options = {}) {
  const application = getMerchantApplication(db, id);
  if (!application) fail(404, '申请不存在');
  if (application.version !== review.expectedVersion) fail(409, '申请已被更新，请刷新后再审核');
  if (!latestMerchantPreflight(db, id, options)?.canApprove) fail(422, '请先完成当前申请版本的测试采集，取得 24 小时内的有效商品样例');
  if (review.sampleReviewed !== true) fail(422, '通过前必须人工检查测试商品样例');
}
