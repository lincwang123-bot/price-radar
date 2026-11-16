import {latestMerchantReply} from './merchant-replies.mjs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { normalizeEmail, initMerchantMailSchema, queueMerchantMail } from './merchant-mail.mjs';
import {merchantMailGroup,reconcileMerchantMailPolicy} from './merchant-mail-policy.mjs';
import {normalizeCollectionAccess} from './merchant-collection-access.mjs';
import {latestMerchantPreflight} from './merchant-preflight-store.mjs';
import {accountProfile,profileContact} from './account-profile.mjs';
import {merchantPhoneVerificationRequired} from './merchant-phone-policy.mjs';

const PROCESS_SECRET = process.env.SUBMISSION_HASH_SECRET || randomBytes(32);
const AREAS = new Set(['chatgpt', 'claude', 'gemini', 'grok_x', 'muse', 'mail_verify', 'other']);
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
    BEGIN SELECT RAISE(ABORT, 'merchant audit is append-only'); END;
  CREATE TABLE IF NOT EXISTS merchant_submission_links (
    source_submission_id TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE, converted_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_conversion_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_submission_id TEXT NOT NULL UNIQUE,
    application_id TEXT NOT NULL UNIQUE, converted_at TEXT NOT NULL, actor TEXT NOT NULL,
    note TEXT NOT NULL, ownership_confirmed INTEGER NOT NULL CHECK(ownership_confirmed=1),
    permission_confirmed INTEGER NOT NULL CHECK(permission_confirmed=1)
  );
  CREATE TRIGGER IF NOT EXISTS merchant_links_no_update BEFORE UPDATE ON merchant_submission_links
    BEGIN SELECT RAISE(ABORT, 'merchant conversion link is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS merchant_links_no_delete BEFORE DELETE ON merchant_submission_links
    BEGIN SELECT RAISE(ABORT, 'merchant conversion link is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS merchant_conversion_no_update BEFORE UPDATE ON merchant_conversion_actions
    BEGIN SELECT RAISE(ABORT, 'merchant conversion audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS merchant_conversion_no_delete BEFORE DELETE ON merchant_conversion_actions
    BEGIN SELECT RAISE(ABORT, 'merchant conversion audit is append-only'); END;`);
  if (!db.prepare('PRAGMA table_info(merchant_applications)').all().some(row=>row.name==='email')) db.exec('ALTER TABLE merchant_applications ADD COLUMN email TEXT');
  if (!db.prepare('PRAGMA table_info(merchant_applications)').all().some(row=>row.name==='collection_access')) db.exec('ALTER TABLE merchant_applications ADD COLUMN collection_access TEXT');
  for(const column of ['applicant_account_id','phone'])if(!db.prepare('PRAGMA table_info(merchant_applications)').all().some(row=>row.name===column))db.exec(`ALTER TABLE merchant_applications ADD COLUMN ${column} TEXT`);
  if (!db.prepare('PRAGMA table_info(merchant_application_actions)').all().some(row=>row.name==='public_reply')) db.exec("ALTER TABLE merchant_application_actions ADD COLUMN public_reply TEXT NOT NULL DEFAULT ''");
  initMerchantMailSchema(db);
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
  let decoded;
  try { decoded=decodeURIComponent(raw); } catch { fail(422,'店铺链接编码无效'); }
  if ((decoded.match(/https?:\/\//gi)||[]).length!==1 || /[\s，,；;]/.test(decoded)) fail(422,'请只填写一个完整的店铺主页；多个网址需分开提交');
  let url;
  try { url = new URL(raw); } catch { fail(422, '请填写完整的 HTTPS 店铺链接'); }
  if (url.protocol === 'http:') fail(422, '请填写以 https:// 开头的店铺网址，当前地址使用了 http://。');
  const host = url.hostname.toLowerCase();
  const labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || isIP(host.replace(/^\[|\]$/g, '')) || host.endsWith('.') || labels.length < 2
      || labels.some(l => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))
      || !/^[a-z]{2,63}$/.test(labels.at(-1))
      || /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid|example|onion)$/.test(host)
      || /^(?:localhost|metadata)(?:\.|$)/.test(host)) fail(422, '店铺链接必须是公网 HTTPS 域名，不得包含端口、查询参数或登录凭据');
  const shared = host.replace(/^www\./, '');
  if (shared === 'catfk.com') {
    const match = /^\/shop\/([A-Za-z0-9_-]{1,100})\/?$/.exec(url.pathname);
    if (!match || /^(?:admin|api|shop|goods|login|register|order|orders)$/i.test(match[1])) fail(422, '猫店请提交 /shop/店铺标识 的店铺主页，不能提交平台首页或商品链接');
    return { identity: `shop:catfk:${match[1]}`, platform: 'independent', shopUrl: `https://${host}/shop/${match[1]}` };
  }
  if (shared === '16688.com.cn') {
    const match = /^\/shop\/(S\d{1,20})\/?$/.exec(url.pathname);
    if (!match) fail(422, '16688 请提交 /shop/S… 店铺主页，不能提交平台首页或商品链接');
    return { identity: `shop:16688:${match[1]}`, platform: '16688', shopUrl: `https://${host}/shop/${match[1]}` };
  }
  if (['wzyp.cn', 'ldxp.cn', 'pay.ldxp.cn'].includes(shared)) {
    const match = /^\/(?:shop\/)?([A-Za-z0-9_-]{1,100})\/?$/.exec(url.pathname);
    if (match && /^(?:shop|goods|item|product|products|login|register|admin|api|shopApi|account|order|orders|user|search|category|about|help|favicon|robots|sitemap)$/i.test(match[1])) fail(422, '请提交可区分商家的店铺主页');
    if (!match) fail(422, '链动小铺请提交 /shop/店铺标识 的店铺主页，不能提交平台首页或商品链接');
    return { identity: `shop:${shared === 'pay.ldxp.cn' ? 'ldxp-pay' : shared === 'wzyp.cn' ? 'wzyp' : 'ldxp'}:${match[1]}`, platform: 'ldxp', shopUrl: `https://${host}/shop/${match[1]}` };
  }
  if (['cardnav.xyz', 'goaihop.com', 'relaywatch.online'].includes(shared)) fail(422, '请填写商家自己的店铺链接，不支持目录平台认领');
  if (url.href.length > 500) fail(422, '店铺链接编码后不能超过 500 个字符，请使用简短的店铺主页');
  return { identity: `domain:${host}`, platform: 'independent', shopUrl: url.href };
}
export function canonicalShopIdentity(url) { return shopDescriptor(url).identity; }

// Explicit maintenance repair for the former pay.ldxp domain-wide identity.
// Only pending applications, exact existing shop URL, no approval or mail mutation.
export function migratePendingPayShopIdentities(db,{now=new Date()}={}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const repaired=[];
    for(const row of db.prepare("SELECT * FROM merchant_applications WHERE identity='domain:pay.ldxp.cn' AND status='pending'").all()) {
      const target=shopDescriptor(row.shop_url);
      if(!target.identity.startsWith('shop:ldxp-pay:'))continue;
      if(db.prepare('SELECT 1 FROM merchant_applications WHERE identity=?').get(target.identity))fail(409,'链动店铺身份重复，需要人工核对');
      const stamp=dateValue(now).toISOString();
      // The applicant's URL/content did not change. Preserve its version so the
      // original reply and its mail allowance stay attached. Old tests are
      // invalidated by identity, not by manufacturing a new submission round.
      db.prepare('UPDATE merchant_applications SET identity=?,platform=?,updated_at=? WHERE public_id=?').run(target.identity,target.platform,stamp,row.public_id);
      db.prepare(`INSERT INTO merchant_application_actions(application_id,created_at,actor,action,previous_status,status,note,ownership_confirmed,permission_confirmed,version)
        VALUES(?,?,?,'repair_platform_identity','pending','pending',?,0,0,?)`).run(row.public_id,stamp,'system:platform-adapter',`修正平台识别，按原店铺路径区分商家；原网址未变，未批准、未发送邮件。${row.identity} → ${target.identity}`,row.version);
      repaired.push(row.public_id);
    }
    db.exec('COMMIT');return repaired;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}

function dateValue(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(422, '时间格式不正确');
  return date;
}
function verifiedPhoneQuery(db){
  if(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('reader_profiles','reader_phone_verifications')").get().n!==2)return null;
  return db.prepare(`SELECT v.verified_at FROM reader_phone_verifications v
    JOIN reader_profiles p ON p.account_id=v.account_id AND p.phone=v.phone WHERE p.account_id=? AND p.phone=?`);
}
function application(row,phoneVerification=null) {
  if (!row) return null;
  return { id: row.public_id, createdAt: row.created_at, updatedAt: row.updated_at, shopName: row.shop_name,
    shopUrl: row.shop_url, identity: row.identity, platform: row.platform, productAreas: JSON.parse(row.product_areas),
    contact: row.contact, email: row.email || null, phone:row.phone||null,applicantAccountId:row.applicant_account_id||null,phoneVerified:!!phoneVerification,phoneVerifiedAt:phoneVerification||null, details: row.details, consentAt: row.consent_at, status: row.status,
    version: row.version, identityVerifiedAt: row.identity_verified_at, approvedAt: row.approved_at };
}
export function validatedMerchantPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(422, '申请格式不正确');
  if (payload.website || payload.companyWebsite || payload.honeypot) fail(422, '提交未通过校验');
  const shopName = clean(payload.shopName, '店铺名称', 100, 2);
  const shop = shopDescriptor(payload.shopUrl);
  const platform = payload.platform ?? 'auto';
  if (!['auto', '16688', 'ldxp', 'independent'].includes(platform) || (platform !== 'auto' && platform !== shop.platform)) fail(422, '店铺链接与平台选项不匹配');
  if (!Array.isArray(payload.productAreas) || !payload.productAreas.length || payload.productAreas.length > AREAS.size || payload.productAreas.some(a => !AREAS.has(a))) fail(422, '请选择有效的主营品类');
  const productAreas = [...new Set(payload.productAreas)].sort();
  const contact = clean(payload.contact, '联系方式', 128, 3);
  const email = payload.email ? normalizeEmail(payload.email) : null;
  if (payload.email && !email) fail(422,'请填写一个有效的通知邮箱');
  if (!email) fail(422,'请填写通知邮箱，用于接收接入测试及审核进度');
  const details = clean(payload.details, '补充说明', 1500);
  if (payload.consent !== true && !(payload.consentContact === true && payload.consentCollection === true)) fail(422, '请同意联系核验和公开商品目录采集');
  rejectSecrets([shopName, shop.shopUrl, contact, details]);
  return { shopName, shop, productAreas, contact, email, details };
}
function insertMerchantApplication(db, values, time, client = null, { notify = true } = {}) {
  const { shopName, shop, productAreas, contact, email, details } = values, timestamp = time.toISOString();
  const day = new Date(time.getTime() + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
  const id = `MA-${day}-${randomBytes(6).toString('hex').toUpperCase()}`;
  db.prepare(`INSERT INTO merchant_applications(public_id,created_at,updated_at,shop_name,shop_url,identity,platform,product_areas,contact,details,consent_at,client_hash,email,applicant_account_id,phone)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, timestamp, timestamp, shopName, shop.shopUrl, shop.identity, shop.platform, JSON.stringify(productAreas), contact, details, timestamp, client, email,values.applicantAccountId||null,values.phone||null);
  if (notify) queueMerchantMail(db,{id,email,stage:'received',eventKey:id+':received',now:time});
  return { id, status: 'pending' };
}
export function createMerchantApplication(db, payload, { clientAddress, now = new Date(), secret = PROCESS_SECRET, applicant=null, notify=true, phoneVerificationRequired=merchantPhoneVerificationRequired() } = {}) {
  if (!(typeof secret === 'string' || Buffer.isBuffer(secret)) || secret.length < 32) throw new Error('商家申请哈希密钥至少需要 32 个字符');
  const time = dateValue(now), timestamp = time.toISOString();
  const client = createHmac('sha256', secret).update(String(clientAddress || 'unknown')).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    // Re-read the current account/contact under the insertion lock. When SMS
    // is required, proof must match that number; never trust client flags.
    let currentApplicant=null;
    if(applicant){
      if(typeof applicant.accountId!=='string'||!applicant.accountId)fail(401,'提交店铺前请先注册并登录');
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_accounts'").get())fail(401,'提交店铺前请先注册并登录');
      const account=db.prepare('SELECT id,email FROM retention_accounts WHERE id=?').get(applicant.accountId);
      if(!account)fail(401,'提交店铺前请先注册并登录');
      const profile=accountProfile(db,account.id);
      if(!profile)fail(422,'请先在商家入驻流程补齐手机号和联系账号');
      if(phoneVerificationRequired){
        if(!verifiedPhoneQuery(db))fail(422,'提交店铺前请先完成中国大陆手机号短信验证');
        if(!/^\+861[3-9]\d{9}$/.test(profile.phone))fail(422,'商家入驻暂仅支持中国大陆 +86 手机号短信验证');
        if(!profile.phoneVerified)fail(422,'提交店铺前请先完成手机号短信验证');
      }
      currentApplicant={accountId:account.id,email:account.email,phone:profile.phone,contact:profileContact(profile)};
    }
    const values=validatedMerchantPayload(currentApplicant?{...payload,email:currentApplicant.email,contact:currentApplicant.contact}:payload);
    if(currentApplicant){values.applicantAccountId=currentApplicant.accountId;values.phone=currentApplicant.phone;}
    db.prepare('UPDATE merchant_applications SET client_hash=NULL WHERE client_hash IS NOT NULL AND created_at < ?').run(new Date(time.getTime() - 48 * 3600000).toISOString());
    const hourly = db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE client_hash=? AND created_at>=?').get(client, new Date(time.getTime() - 3600000).toISOString()).n;
    const daily = db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE client_hash=? AND created_at>=?').get(client, new Date(time.getTime() - 86400000).toISOString()).n;
    if (hourly >= 3 || daily >= 5) fail(429, '提交过于频繁，请稍后再试');
    const emailDaily=db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE email=? COLLATE NOCASE AND created_at>=?').get(values.email,new Date(time.getTime()-86400000).toISOString()).n;
    if(emailDaily>=5)fail(429,'该邮箱今日提交次数过多，请稍后再试');
    // An older shared-host record may still have its former domain identity.
    const duplicate = db.prepare("SELECT 1 FROM merchant_applications WHERE identity=? OR rtrim(shop_url,'/')=rtrim(?,'/')").get(values.shop.identity,values.shop.shopUrl);
    if (duplicate) fail(409, '该店铺已提交申请，请通过联系渠道向站方补充核验信息');
    const result = insertMerchantApplication(db, values, time, client, { notify });
    db.exec('COMMIT');
    return result;
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

export function supplySubmissionForConversion(db, id) {
  if (typeof id !== 'string' || !/^CO-[A-Z0-9-]+$/.test(id)) fail(404, '供应投稿不存在');
  const source = db.prepare('SELECT * FROM cooperation_submissions WHERE public_id=?').get(id);
  if (!source) fail(404, '供应投稿不存在');
  if (source.topic !== 'supply') fail(422, '仅供应投稿可以转为店铺申请');
  return source;
}
export function linkedMerchantApplication(db, id) {
  const row = db.prepare(`SELECT a.public_id AS id,a.shop_name AS shopName,a.shop_url AS shopUrl,a.status
    FROM merchant_submission_links l JOIN merchant_applications a ON a.public_id=l.application_id WHERE l.source_submission_id=?`).get(id);
  return row ? { ...row } : null;
}
export function conversionFormValues(payload) {
  const values = Object.fromEntries(['shopName','shopUrl','contact','email','details','note'].map(key => {
    const value = typeof payload?.[key] === 'string' ? payload[key] : '';
    // HTTP bodies are already bounded. Preserve overlong ordinary text so the
    // reviewer can shorten it intentionally instead of silently losing input.
    try { rejectSecrets([value]); return [key, value]; } catch { return [key, '']; }
  }));
  values.productAreas = Array.isArray(payload?.productAreas) ? payload.productAreas.filter(value => AREAS.has(value)).slice(0, AREAS.size) : [];
  return values;
}
export function convertSupplySubmission(db, id, payload, { actor = 'admin', now = new Date() } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    supplySubmissionForConversion(db, id);
    // A repeated POST returns the original association; it never edits that application.
    const linked = linkedMerchantApplication(db, id);
    if (linked) { db.exec('COMMIT'); return { id: linked.id, status: linked.status, alreadyConverted: true }; }
    if(db.prepare('PRAGMA table_info(merchant_supply_intake)').all().some(row=>row.name==='status')) {
      const intake=db.prepare('SELECT status FROM merchant_supply_intake WHERE source_submission_id=?').get(id);
      if(intake&&intake.status!=='pending')fail(409,'该供应投稿已移出待审核，请先恢复为待审核再转入');
    }
    if (payload?.ownershipConfirmed !== true || payload?.permissionConfirmed !== true) fail(422, '请核实店铺归属，并另行确认公开商品目录采集授权；原供应投稿授权不能代替采集授权');
    const note = clean(payload.note, '授权核验说明', 1500, 5), reviewer = clean(actor, '审核人', 100, 1);
    rejectSecrets([note, reviewer]);
    // Reuse every public application field check, but not its public-IP rate limit.
    const values = validatedMerchantPayload({ ...payload, consent: true });
    const existing = db.prepare("SELECT public_id AS id,shop_name AS shopName,shop_url AS shopUrl FROM merchant_applications WHERE identity=? OR rtrim(shop_url,'/')=rtrim(?,'/')").get(values.shop.identity,values.shop.shopUrl);
    if (existing) {
      const error = new MerchantApplicationError(409, '该店铺已有申请，请查看现有记录并人工核对联系人；本次未创建或合并申请');
      error.existingApplication = { ...existing }; throw error;
    }
    const time = dateValue(now), timestamp = time.toISOString(), result = insertMerchantApplication(db, values, time);
    db.prepare('INSERT INTO merchant_submission_links(source_submission_id,application_id,converted_at) VALUES(?,?,?)').run(id, result.id, timestamp);
    db.prepare(`INSERT INTO merchant_conversion_actions(source_submission_id,application_id,converted_at,actor,note,ownership_confirmed,permission_confirmed)
      VALUES(?,?,?,?,?,1,1)`).run(id, result.id, timestamp, reviewer, note);
    reconcileMerchantMailPolicy(db,result.id);
    db.exec('COMMIT'); return result;
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

export function listMerchantApplications(db, { status, page = 1 } = {}) {
  if (status && status !== 'all' && !STATES.has(status)) fail(422, '审核状态无效');
  const pageNumber = Math.max(1, Math.min(100000, Number.parseInt(page, 10) || 1));
  const where = status && status !== 'all' ? ' WHERE status=?' : '';
  const args = where ? [status] : [];
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM merchant_applications${where}`).get(...args).n);
  const phoneQuery=verifiedPhoneQuery(db);
  const items = db.prepare(`SELECT * FROM merchant_applications${where} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?`).all(...args, (pageNumber - 1) * 30).map(row=>application(row,phoneQuery?.get(row.applicant_account_id||'',row.phone||'')?.verified_at));
  return { items, total, page: pageNumber, pageSize: 30 };
}
export function getMerchantApplication(db, id) {
  const row=db.prepare('SELECT * FROM merchant_applications WHERE public_id=?').get(id);
  const result = application(row,row&&verifiedPhoneQuery(db)?.get(row.applicant_account_id||'',row.phone||'')?.verified_at);
  if (!result) return null;
  result.actions = db.prepare('SELECT created_at AS createdAt,actor,action,previous_status AS previousStatus,status,note,public_reply AS publicReply,ownership_confirmed AS ownershipConfirmed,permission_confirmed AS permissionConfirmed,version FROM merchant_application_actions WHERE application_id=? ORDER BY id').all(id);
  const conversion = db.prepare(`SELECT source_submission_id AS sourceSubmissionId,converted_at AS convertedAt,actor,note,
    ownership_confirmed AS ownershipConfirmed,permission_confirmed AS permissionConfirmed FROM merchant_conversion_actions WHERE application_id=?`).get(id);
  if (conversion) result.conversion = { ...conversion };
  return result;
}
export function approvedMerchantBadges(db) {
  const phoneQuery=verifiedPhoneQuery(db);
  return db.prepare("SELECT * FROM merchant_applications WHERE status='approved' ORDER BY identity").all().map(row => ({
    id: 'merchant-' + createHash('sha256').update(row.identity).digest('hex').slice(0, 16), identity: row.identity,
    shopName: row.shop_name, shopUrl: row.shop_url, platform: row.platform, status: 'approved', version: row.version,
    identityVerifiedAt: row.identity_verified_at, approvedAt: row.approved_at,
    phoneVerifiedAt:phoneQuery?.get(row.applicant_account_id||'',row.phone||'')?.verified_at||null,
    ...(row.collection_access==null?{}:{collectionAccess:approvedCollectionAccess(row)}),
  }));
}
function approvedCollectionAccess(row){
  const access=normalizeCollectionAccess(JSON.parse(row.collection_access),{shopUrl:row.shop_url});
  if(access.permissionScope!=='ongoing')fail(422,'单次测试许可不能用于持续采集');
  return access;
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
  // Keep only the public origins of historical restrictions, including paused
  // applications. The collector may not have seen the brief approved state.
  const restrictedOrigins = [...new Set(db.prepare('SELECT shop_url,collection_access FROM merchant_applications WHERE collection_access IS NOT NULL').all().map(row=>{
    normalizeCollectionAccess(JSON.parse(row.collection_access),{shopUrl:row.shop_url});
    return new URL(row.shop_url).origin;
  }))].sort();
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), merchants: approvedMerchantBadges(db), restrictedOrigins };
  const content = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(content) > 256 * 1024) fail(422, '批准清单过大，超过 256 KiB 字节限制');
  if (bridgeDir) atomicManifest(bridgeDir, content);
  return manifest;
}
export function reviewMerchantApplication(db, id, review, { bridgeDir = merchantBridgeDir(db), resultsDir = bridgeDir?path.join(path.dirname(bridgeDir),'data','merchant-preflights'):null, now = new Date(), notify = true } = {}) {
  if (!review || !['approve', 'reject', 'pause', 'restore', 'request_info','reply'].includes(review.action)) fail(422, '审核操作无效');
  const note = clean(review.note, '审核说明', 1500);
  const publicReply = clean(review.publicReply, '发给店主的回复', 1500, review.action==='reply'?1:0);
  const actor = clean(review.actor || 'admin', '审核人', 100, 1);
  rejectSecrets([note, actor,publicReply]);
  if (!Number.isSafeInteger(review.expectedVersion) || review.expectedVersion < 1) fail(409, '请刷新申请后再审核');
  const timestamp = dateValue(now).toISOString();
  let priorManifest = null, wroteManifest = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM merchant_applications WHERE public_id=?').get(id);
    if (!row) fail(404, '申请不存在');
    if (row.version !== review.expectedVersion) fail(409, '申请已被更新，请刷新后再审核');
    if(review.action==='approve'&&!verifiedPhoneQuery(db)?.get(row.applicant_account_id||'',row.phone||'')?.verified_at)fail(422,'审核通过前请先完成当前账号已保存手机号的短信验证');
    if(review.action==='approve'&&!normalizeEmail(row.email))fail(422,'审核通过前请先补齐并核对店主通知邮箱');
    if(review.action==='approve'&&!row.consent_at)fail(422,'申请未记录公开商品目录读取同意');
    if(review.action==='approve'&&!latestMerchantPreflight(db,id,{resultsDir,now})?.canApprove)fail(422,'请先完成当前申请版本的测试采集，取得 24 小时内的有效商品样例');
    if(publicReply&&!normalizeEmail(row.email))fail(422,'请先补齐并核对店主邮箱，再发送回复');
    if(review.action==='reply') {
      if(db.prepare("SELECT id FROM merchant_application_actions WHERE application_id=? AND action='reply' AND public_reply=? AND created_at>=?").get(id,publicReply,new Date(+dateValue(now)-300000).toISOString())) {db.exec('COMMIT');return getMerchantApplication(db,id);}
      const action=db.prepare(`INSERT INTO merchant_application_actions(application_id,created_at,actor,action,previous_status,status,note,ownership_confirmed,permission_confirmed,version,public_reply) VALUES(?,?,?,'reply',?,?,?,0,0,?,?)`).run(id,timestamp,actor,row.status,row.status,note,row.version,publicReply);
      queueMerchantMail(db,{id,email:row.email,stage:'reply',eventKey:id+':reply:'+action.lastInsertRowid,publicReply,now});
      db.exec('COMMIT');return getMerchantApplication(db,id);
    }
    if (review.action==='request_info' && row.status!=='pending') fail(422,'仅待审核申请可要求补充资料');
    if (review.action==='restore' && !['rejected','paused'].includes(row.status)) fail(422,'仅已拒绝或暂存的申请可恢复待审核');
    if(review.queueAction===true && !['reject','pause','restore'].includes(review.action))fail(422,'队列处理操作无效');
    if(review.queueAction===true && review.action!=='restore' && row.status!=='pending')fail(422,'仅待审核申请可从队列拒绝或暂存');
    const status = { approve: 'approved', reject: 'rejected', pause: 'paused', restore:'pending', request_info:row.status }[review.action];
    let access=row.collection_access;
    const hasRestrictedRequest=db.prepare('PRAGMA table_info(merchant_preflight_requests)').all().some(column=>column.name==='collection_access')
      &&!!db.prepare('SELECT 1 FROM merchant_preflight_requests WHERE application_id=? AND collection_access IS NOT NULL LIMIT 1').get(id);
    if(status==='approved'&&(access!=null||hasRestrictedRequest)){
      const preflight=latestMerchantPreflight(db,id,{resultsDir,now});
      if(!preflight?.canApprove||preflight.collectionAccess?.permissionScope!=='ongoing')fail(422,'请先完成当前读取范围的有效测试并确认持续采集许可');
      access=JSON.stringify(preflight.collectionAccess);
    }
    db.prepare('UPDATE merchant_applications SET status=?,version=version+1,updated_at=?,identity_verified_at=?,approved_at=?,collection_access=? WHERE public_id=?').run(status, timestamp, row.identity_verified_at, status==='approved'?timestamp:null, access, id);
    db.prepare(`INSERT INTO merchant_application_actions(application_id,created_at,actor,action,previous_status,status,note,ownership_confirmed,permission_confirmed,version,public_reply)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, timestamp, actor, review.action, row.status, status, note, Number(review.ownershipConfirmed === true), Number(review.permissionConfirmed === true), row.version + 1,publicReply);
    if(notify&&review.action!=='restore'&&!review.queueAction)queueMerchantMail(db,{id,email:row.email,stage:review.action==='request_info'?'need_info':status,eventKey:id+':review:'+(row.version+1),publicReply,now});
    reconcileMerchantMailPolicy(db,id);
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

// Keep unanswered applications out of the active review queue after four
// reminder messages have actually been handed to the mail provider. Queued,
// retrying, or permanently failed messages are not counted as sent.
const MERCHANT_REMINDER_INTERVAL_MS=7*24*3600000;
export function reconcileUnansweredMerchantApplications(db,{bridgeDir=merchantBridgeDir(db),resultsDir,now=new Date()}={}) {
  initMerchantSchema(db);
  const date=dateValue(now),timestamp=date.toISOString();
  const ids=db.prepare("SELECT public_id FROM merchant_applications WHERE status='pending' ORDER BY created_at").all().map(row=>row.public_id);
  const staged=[];
  for(const id of ids){
    const app=getMerchantApplication(db,id);
    const group=merchantMailGroup(db,id);
    if(!app||app.status!=='pending'||!group)continue;
    const placeholders=group.ids.map(()=>'?').join(',');
    const replyRound=db.prepare(`SELECT id FROM merchant_reply_rounds WHERE application_id IN (${placeholders}) ORDER BY id DESC LIMIT 1`).get(...group.ids)?.id||0;
    const reply=latestMerchantReply(db,id);
    const sent=db.prepare(`SELECT id,event_key,accepted_at,created_at FROM merchant_mail_outbox
      WHERE application_id IN (${placeholders}) AND status='accepted' AND attempts>0
      AND ((stage='need_info' AND reply_round_id=?) OR
        (stage='reply' AND public_reply<>'' AND EXISTS(SELECT 1 FROM merchant_application_actions a
          WHERE a.application_id=merchant_mail_outbox.application_id AND a.action='reply'
          AND a.public_reply=merchant_mail_outbox.public_reply AND
          (a.note LIKE '%提醒%' OR a.note LIKE '%reminder%' OR a.note LIKE '%manual-retest%'))))
      AND created_at>=? ORDER BY id`).all(...group.ids,replyRound,reply?.createdAt||app.createdAt);
    if(sent.length>=4){
      const updated=reviewMerchantApplication(db,id,{action:'pause',expectedVersion:app.version,
        actor:'system:no-reply-reminders',note:'补充资料提醒已由邮件服务接受，本轮累计 4 次且未收到后续回复；自动移入暂存，收到有效回复后可恢复。'},
        {bridgeDir,resultsDir,now,notify:false});
      if(updated.status==='paused')staged.push(id);
      continue;
    }
    if(!sent.length)continue;
    const last=sent.at(-1),lastAttempt=Date.parse(last.accepted_at||last.created_at);
    if(!Number.isFinite(lastAttempt)||+date-lastAttempt<MERCHANT_REMINDER_INTERVAL_MS)continue;
    const ordinal=sent.length+1;
    const message=`温馨提醒：此前发送的补充资料清单尚未收到后续回复。如仍希望申请收录，请直接回复本邮件并保留申请编号 ${id}；若暂不处理，无需额外操作。已提交的资料不用重复发送，也不需要关闭访问防护或提供账号密码。`;
    queueMerchantMail(db,{id,email:app.email,stage:'need_info',replyRoundId:replyRound,
      eventKey:`${id}:no-reply-followup:v1:${replyRound}:${ordinal}`,publicReply:message,now:date});
  }
  return staged;
}
export const stageUnansweredMerchantApplications=reconcileUnansweredMerchantApplications;

// Explicit operator correction after matching the applicant's reply. This is
// deliberately NOT a general domain migration or an approval operation.
export function correctPendingMerchantUrl(db,id,shopUrl,{expectedVersion,expectedUrl,confirmedReplyEmail,note,actor='admin',now=new Date()}={}) {
  const target=shopDescriptor(shopUrl),reason=clean(note,'网址更正依据',800,5),operator=clean(actor,'操作人',100,1);
  rejectSecrets([reason,operator]);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)fail(409,'请刷新申请后再更正');
  db.exec('BEGIN IMMEDIATE');
  try {
    const app=getMerchantApplication(db,id);
    if(!app)fail(404,'申请不存在');
    if(app.status!=='pending'||app.version!==expectedVersion||app.shopUrl!==expectedUrl)fail(409,'申请状态已变化，请重新核对');
    if(!normalizeEmail(confirmedReplyEmail)||confirmedReplyEmail.toLowerCase()!==app.email?.toLowerCase())fail(422,'需核对原申请邮箱的回复');
    const before=new URL(app.shopUrl),after=new URL(target.shopUrl);
    if(app.platform!=='independent'||target.platform!=='independent'||before.hostname.replace(/^www\./,'')!==after.hostname.replace(/^www\./,'')||before.pathname!==after.pathname||before.href===after.href)fail(422,'此操作仅支持已确认的同店 www 地址更正');
    if(db.prepare('SELECT 1 FROM merchant_applications WHERE identity=? AND public_id<>?').get(target.identity,id))fail(409,'新地址已有申请，请先人工核对');
    const stamp=dateValue(now).toISOString();
    db.prepare('UPDATE merchant_applications SET shop_url=?,identity=?,version=version+1,updated_at=? WHERE public_id=?').run(target.shopUrl,target.identity,stamp,id);
    db.prepare(`INSERT INTO merchant_application_actions(application_id,created_at,actor,action,previous_status,status,note,ownership_confirmed,permission_confirmed,version)
      VALUES(?,?,?,'correct_url','pending','pending',?,0,0,?)`).run(id,stamp,operator,`${app.shopUrl} → ${target.shopUrl}\n${reason}`,app.version+1);
    // Keep all delivery history and lifetime budget. Retire only never-attempted
    // outdated result copy; the normal reconciliation can prepare a fresh test.
    db.prepare("UPDATE merchant_mail_outbox SET status='superseded',error_code='url_corrected' WHERE application_id=? AND stage IN ('need_info','collection_failed') AND status IN ('queued','retry','failed') AND attempts=0").run(id);
    reconcileMerchantMailPolicy(db,id);
    db.exec('COMMIT');return getMerchantApplication(db,id);
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}

export function updateMerchantEmail(db,id,email,{actor='admin',expectedVersion,confirmed=false,now=new Date(),notify=true}={}) {
  const address=normalizeEmail(email);
  if(!address)fail(422,'请填写有效的通知邮箱');
  if(!confirmed)fail(422,'请确认邮箱由申请人本人提供，不要从其他店铺推断');
  db.exec('BEGIN IMMEDIATE');
  try {
    const app=getMerchantApplication(db,id);
    if(!app)fail(404,'申请不存在');
    if(app.version!==expectedVersion)fail(409,'申请已更新，请刷新');
    const stamp=dateValue(now).toISOString();
    db.prepare('UPDATE merchant_applications SET email=? WHERE public_id=?').run(address,id);
    db.prepare("UPDATE merchant_mail_outbox SET status='superseded' WHERE application_id=? AND recipient<>? AND status IN ('queued','retry','failed')").run(id,address);
    const action=db.prepare('INSERT INTO merchant_email_actions(application_id,email,created_at,actor) VALUES(?,?,?,?)').run(id,address,stamp,clean(actor,'审核人',100,1));
    if(notify)queueMerchantMail(db,{id,email:address,stage:app.status==='pending'?'received':app.status,eventKey:id+':email:'+action.lastInsertRowid,now});
    db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
