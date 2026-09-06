import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

const PROCESS_SECRET = process.env.SUBMISSION_HASH_SECRET || randomBytes(32);
const AREAS = new Set(['chatgpt', 'claude', 'gemini', 'grok_x', 'api_relay', 'mail_verify', 'other']);
const STATES = new Set(['pending', 'approved', 'rejected', 'paused']);
export class MerchantApplicationError extends Error {
  constructor(status, message) { super(message); this.name = 'MerchantApplicationError'; this.status = status; }
}
const fail = (status, message) => { throw new MerchantApplicationError(status, message); };

export function initMerchantSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, shop_name TEXT NOT NULL,
    shop_url TEXT NOT NULL, identity TEXT NOT NULL UNIQUE, platform TEXT NOT NULL,
    product_areas TEXT NOT NULL, contact TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
    consent_at TEXT NOT NULL, client_hash TEXT, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected','paused')),
    version INTEGER NOT NULL DEFAULT 1, identity_verified_at TEXT, approved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_merchant_queue ON merchant_applications(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_merchant_client ON merchant_applications(client_hash, created_at);
  CREATE TABLE IF NOT EXISTS merchant_application_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT NOT NULL, created_at TEXT NOT NULL,
    actor TEXT NOT NULL, action TEXT NOT NULL, previous_status TEXT NOT NULL,
    status TEXT NOT NULL, note TEXT NOT NULL, ownership_confirmed INTEGER NOT NULL,
    permission_confirmed INTEGER NOT NULL, version INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_merchant_actions ON merchant_application_actions(application_id, id);
  CREATE TRIGGER IF NOT EXISTS merchant_actions_no_update BEFORE UPDATE ON merchant_application_actions
    BEGIN SELECT RAISE(ABORT, 'merchant audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS merchant_actions_no_delete BEFORE DELETE ON merchant_application_actions
    BEGIN SELECT RAISE(ABORT, 'merchant audit is append-only'); END;`);
}

function clean(value, field, max, min = 0) {
  if (value == null && !min) return '';
  if (typeof value !== 'string') fail(422, `${field}格式不正确`);
  const result = value.replace(/\r\n?/g, '\n').trim();
  if (result.length < min || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(422, `${field}请填写 ${min}–${max} 个有效字符`);
  return result;
}
function rejectSecrets(values) {
  const content = values.join('\n');
  if ([/\bsk-[\w-]{16,}/i, /\bgh[pousr]_[\w]{20,}/i, /\bxox[baprs]-[\w-]{12,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, /\bBearer\s+[\w.~+/=-]{16,}/i,
    /(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|密码|口令)\s*[:=：]\s*\S+/i].some(p => p.test(content))) fail(422, '请删除密码、API Key 或私钥等敏感凭据后再提交');
}

function shopDescriptor(input) {
  const raw = clean(input, '店铺链接', 500, 10);
  let url;
  try { url = new URL(raw); } catch { fail(422, '请填写完整的 HTTPS 店铺链接'); }
  const host = url.hostname.toLowerCase();
  const labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || isIP(host.replace(/^\[|\]$/g, '')) || host.endsWith('.') || labels.length < 2
      || labels.some(l => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))
      || !/^[a-z]{2,63}$/.test(labels.at(-1))
      || /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid|example|onion)$/.test(host)
      || /^(?:localhost|metadata)(?:\.|$)/.test(host)) fail(422, '店铺链接必须是公网 HTTPS 域名，不得包含端口、查询参数或登录凭据');
  const shared = host.replace(/^www\./, '');
  if (shared === '16688.com.cn') {
    const match = /^\/shop\/(S\d{1,20})\/?$/.exec(url.pathname);
    if (!match) fail(422, '16688 请提交 /shop/S… 店铺主页，不能提交平台首页或商品链接');
    return { identity: `shop:16688:${match[1]}`, platform: '16688', shopUrl: `https://${host}/shop/${match[1]}` };
  }
  if (['wzyp.cn', 'ldxp.cn'].includes(shared)) {
    const match = /^\/(?:shop\/)?([A-Za-z0-9_-]{1,100})\/?$/.exec(url.pathname);
    if (match && /^(?:shop|goods|item|product|products|login|register|admin|api|shopApi|account|order|orders|user|search|category|about|help|favicon|robots|sitemap)$/i.test(match[1])) fail(422, '请提交可区分商家的店铺主页');
    if (!match) fail(422, '链动小铺请提交 /shop/店铺标识 的店铺主页，不能提交平台首页或商品链接');
    return { identity: `shop:${shared === 'wzyp.cn' ? 'wzyp' : 'ldxp'}:${match[1]}`, platform: 'ldxp', shopUrl: `https://${host}/shop/${match[1]}` };
  }
  if (['priceai.cc', 'data.priceai.cc', 'cardnav.xyz', 'goaihop.com', 'relaywatch.online'].includes(shared)) fail(422, '请填写商家自己的店铺链接，不支持目录平台认领');
  if (url.href.length > 500) fail(422, '店铺链接编码后不能超过 500 个字符，请使用简短的店铺主页');
  return { identity: `domain:${host}`, platform: 'independent', shopUrl: url.href };
}
export function canonicalShopIdentity(url) { return shopDescriptor(url).identity; }

function dateValue(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(422, '时间格式不正确');
  return date;
}
function application(row) {
  if (!row) return null;
  return { id: row.public_id, createdAt: row.created_at, updatedAt: row.updated_at, shopName: row.shop_name,
    shopUrl: row.shop_url, identity: row.identity, platform: row.platform, productAreas: JSON.parse(row.product_areas),
    contact: row.contact, details: row.details, consentAt: row.consent_at, status: row.status,
    version: row.version, identityVerifiedAt: row.identity_verified_at, approvedAt: row.approved_at };
}
export function createMerchantApplication(db, payload, { clientAddress, now = new Date(), secret = PROCESS_SECRET } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(422, '申请格式不正确');
  if (payload.website || payload.companyWebsite || payload.honeypot) fail(422, '提交未通过校验');
  const shopName = clean(payload.shopName, '店铺名称', 100, 2);
  const shop = shopDescriptor(payload.shopUrl);
  const platform = payload.platform ?? 'auto';
  if (!['auto', '16688', 'ldxp', 'independent'].includes(platform) || (platform !== 'auto' && platform !== shop.platform)) fail(422, '店铺链接与平台选项不匹配');
  if (!Array.isArray(payload.productAreas) || !payload.productAreas.length || payload.productAreas.length > AREAS.size || payload.productAreas.some(a => !AREAS.has(a))) fail(422, '请选择有效的主营品类');
  const productAreas = [...new Set(payload.productAreas)].sort();
  const contact = clean(payload.contact, '联系方式', 128, 3);
  const details = clean(payload.details, '补充说明', 1500);
  if (payload.consent !== true && !(payload.consentContact === true && payload.consentCollection === true)) fail(422, '请同意联系核验和公开商品目录采集');
  rejectSecrets([shopName, shop.shopUrl, contact, details]);
  if (!(typeof secret === 'string' || Buffer.isBuffer(secret)) || secret.length < 32) throw new Error('商家申请哈希密钥至少需要 32 个字符');
  const time = dateValue(now), timestamp = time.toISOString();
  const client = createHmac('sha256', secret).update(String(clientAddress || 'unknown')).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE merchant_applications SET client_hash=NULL WHERE client_hash IS NOT NULL AND created_at < ?').run(new Date(time.getTime() - 48 * 3600000).toISOString());
    const hourly = db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE client_hash=? AND created_at>=?').get(client, new Date(time.getTime() - 3600000).toISOString()).n;
    const daily = db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE client_hash=? AND created_at>=?').get(client, new Date(time.getTime() - 86400000).toISOString()).n;
    if (hourly >= 3 || daily >= 5) fail(429, '提交过于频繁，请稍后再试');
    const duplicate = db.prepare('SELECT 1 FROM merchant_applications WHERE identity=?').get(shop.identity);
    if (duplicate) fail(409, '该店铺已提交申请，请通过联系渠道向站方补充核验信息');
    const day = new Date(time.getTime() + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
    const id = `MA-${day}-${randomBytes(6).toString('hex').toUpperCase()}`;
    db.prepare(`INSERT INTO merchant_applications(public_id,created_at,updated_at,shop_name,shop_url,identity,platform,product_areas,contact,details,consent_at,client_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, timestamp, timestamp, shopName, shop.shopUrl, shop.identity, shop.platform, JSON.stringify(productAreas), contact, details, timestamp, client);
    db.exec('COMMIT');
    return { id, status: 'pending' };
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

export function listMerchantApplications(db, { status, page = 1 } = {}) {
  if (status && status !== 'all' && !STATES.has(status)) fail(422, '审核状态无效');
  const pageNumber = Math.max(1, Math.min(100000, Number.parseInt(page, 10) || 1));
  const where = status && status !== 'all' ? ' WHERE status=?' : '';
  const args = where ? [status] : [];
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM merchant_applications${where}`).get(...args).n);
  const items = db.prepare(`SELECT * FROM merchant_applications${where} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?`).all(...args, (pageNumber - 1) * 30).map(application);
  return { items, total, page: pageNumber, pageSize: 30 };
}
export function getMerchantApplication(db, id) {
  const result = application(db.prepare('SELECT * FROM merchant_applications WHERE public_id=?').get(id));
  if (!result) return null;
  result.actions = db.prepare('SELECT created_at AS createdAt,actor,action,previous_status AS previousStatus,status,note,ownership_confirmed AS ownershipConfirmed,permission_confirmed AS permissionConfirmed,version FROM merchant_application_actions WHERE application_id=? ORDER BY id').all(id);
  return result;
}
export function approvedMerchantBadges(db) {
  return db.prepare("SELECT * FROM merchant_applications WHERE status='approved' ORDER BY identity").all().map(row => ({
    id: 'merchant-' + createHash('sha256').update(row.identity).digest('hex').slice(0, 16), identity: row.identity,
    shopName: row.shop_name, shopUrl: row.shop_url, platform: row.platform, status: 'approved', version: row.version,
    identityVerifiedAt: row.identity_verified_at, approvedAt: row.approved_at,
  }));
}
export function merchantBridgeDir(db) {
  if (process.env.MERCHANT_BRIDGE_DIR) return path.resolve(process.env.MERCHANT_BRIDGE_DIR);
  const file = db?.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  if (!file) return null;
  const directory = path.dirname(file);
  return path.join(path.basename(directory) === 'submissions' ? path.dirname(directory) : directory, 'merchant-bridge');
}
function atomicManifest(directory, content) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, 'approved.json');
  const temporary = path.join(directory, `.approved-${randomBytes(10).toString('hex')}.tmp`);
  try { writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' }); chmodSync(temporary, 0o600); renameSync(temporary, target); }
  finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return target;
}
export function syncApprovedMerchantManifest(db, bridgeDir = merchantBridgeDir(db)) {
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), merchants: approvedMerchantBadges(db) };
  if (manifest.merchants.length > 100) fail(422, '已批准店铺达到当前采集容量，请先暂停不再收录的店铺');
  const content = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(content) > 256 * 1024) fail(422, '批准清单超过采集容量，请先精简店铺链接或暂停不再收录的店铺');
  if (bridgeDir) atomicManifest(bridgeDir, content);
  return manifest;
}
export function reviewMerchantApplication(db, id, review, { bridgeDir = merchantBridgeDir(db), now = new Date() } = {}) {
  if (!review || !['approve', 'reject', 'pause'].includes(review.action)) fail(422, '审核操作无效');
  const note = clean(review.note, '核验说明', 1500, 5);
  const actor = clean(review.actor || 'admin', '审核人', 100, 1);
  rejectSecrets([note, actor]);
  if (!Number.isSafeInteger(review.expectedVersion) || review.expectedVersion < 1) fail(409, '请刷新申请后再审核');
  if (review.action === 'approve' && (review.ownershipConfirmed !== true || review.permissionConfirmed !== true)) fail(422, '通过前必须确认店铺归属和公开目录采集许可');
  const timestamp = dateValue(now).toISOString();
  let priorManifest = null, wroteManifest = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM merchant_applications WHERE public_id=?').get(id);
    if (!row) fail(404, '申请不存在');
    if (row.version !== review.expectedVersion) fail(409, '申请已被更新，请刷新后再审核');
    const status = { approve: 'approved', reject: 'rejected', pause: 'paused' }[review.action];
    if (status === 'approved' && row.status !== 'approved' && db.prepare("SELECT COUNT(*) n FROM merchant_applications WHERE status='approved'").get().n >= 100) fail(422, '已批准店铺达到当前采集容量，请先暂停不再收录的店铺');
    const verifiedAt = status === 'approved' ? timestamp : null;
    db.prepare('UPDATE merchant_applications SET status=?,version=version+1,updated_at=?,identity_verified_at=?,approved_at=? WHERE public_id=?').run(status, timestamp, verifiedAt, verifiedAt, id);
    db.prepare(`INSERT INTO merchant_application_actions(application_id,created_at,actor,action,previous_status,status,note,ownership_confirmed,permission_confirmed,version)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, timestamp, actor, review.action, row.status, status, note, Number(review.ownershipConfirmed === true), Number(review.permissionConfirmed === true), row.version + 1);
    if (bridgeDir) {
      try { priorManifest = readFileSync(path.join(bridgeDir, 'approved.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      syncApprovedMerchantManifest(db, bridgeDir); wroteManifest = true;
    }
    db.exec('COMMIT');
    return getMerchantApplication(db, id);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (wroteManifest) {
      // Restore the previous approved set if SQLite could not commit after rename.
      if (priorManifest) atomicManifest(bridgeDir, priorManifest);
      else { try { unlinkSync(path.join(bridgeDir, 'approved.json')); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; } }
    }
    throw error;
  }
}
