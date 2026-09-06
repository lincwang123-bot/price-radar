import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { canonicalShopIdentity, createMerchantApplication, listMerchantApplications, getMerchantApplication,
  reviewMerchantApplication, approvedMerchantBadges, syncApprovedMerchantManifest, merchantBridgeDir } from '../lib/merchant-onboarding.mjs';

const payload = (over = {}) => ({ shopName: '测试商店', shopUrl: 'https://merchant-shop.com/', platform: 'auto', productAreas: ['chatgpt'], contact: 'owner@example.org', details: '公开商品目录', consent: true, ...over });
const options = { now: new Date('2026-09-07T04:00:00Z'), clientAddress: '198.51.100.3', secret: 'x'.repeat(32) };
const approval = (over = {}) => ({ action: 'approve', note: '已通过店铺公告核实所有权和公开目录采集许可', ownershipConfirmed: true, permissionConfirmed: true, actor: 'reviewer', expectedVersion: 1, ...over });
function fixture(t) {
  const db = openSubmissionsDb(':memory:');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'merchant-intake-'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, dir };
}

test('shop identity keeps shared merchants separate and independent www hosts exact', () => {
  assert.equal(canonicalShopIdentity('https://www.16688.com.cn/shop/S123'), 'shop:16688:S123');
  assert.equal(canonicalShopIdentity('https://16688.com.cn/shop/S124/'), 'shop:16688:S124');
  assert.equal(canonicalShopIdentity('https://wzyp.cn/shop/AbC123'), 'shop:wzyp:AbC123');
  assert.equal(canonicalShopIdentity('https://wzyp.cn/AbC123'), 'shop:wzyp:AbC123');
  assert.equal(canonicalShopIdentity('https://www.merchant-shop.com/item/2'), 'domain:www.merchant-shop.com');
  assert.notEqual(canonicalShopIdentity('https://merchant-shop.com/'), canonicalShopIdentity('https://www.merchant-shop.com/'));
  for (const url of ['http://merchant-shop.com/', 'https://user:pass@merchant-shop.com/', 'https://127.0.0.1/', 'https://[::1]/', 'https://2130706433/',
    'https://metadata.google.internal/', 'https://localhost/', 'https://com/', 'https://shop.local/', 'https://shop.com:8443/', 'https://shop.com/?token=abc',
    'https://16688.com.cn/', 'https://16688.com.cn/goods/G123', 'https://wzyp.cn/item/123', 'https://wzyp.cn/goods', 'https://priceai.cc/']) {
    assert.throws(() => canonicalShopIdentity(url), { status: 422 }, url);
  }
  assert.throws(() => canonicalShopIdentity('https://merchant-shop.com/' + '中'.repeat(450)), { status: 422 });
});

test('bridge fallback remains inside generic DB fixture directory and supports production submissions sibling', t => {
  const { dir } = fixture(t);
  const local = openSubmissionsDb(path.join(dir, 'submissions.sqlite'));
  const production = openSubmissionsDb(path.join(dir, 'submissions', 'submissions.sqlite'));
  try {
    assert.equal(merchantBridgeDir(local), path.join(realpathSync(dir), 'merchant-bridge'));
    assert.equal(merchantBridgeDir(production), path.join(realpathSync(dir), 'merchant-bridge'));
  } finally { local.close(); production.close(); }
});

test('intake stores private fields only in submissions DB, deduplicates identity and never fetches', t => {
  const { db } = fixture(t);
  const result = createMerchantApplication(db, payload(), options);
  assert.match(result.id, /^MA-20260907-[A-F0-9]{12}$/);
  assert.equal(result.status, 'pending');
  assert.throws(() => createMerchantApplication(db, payload({ shopUrl: 'https://merchant-shop.com/other' }), options), error => error.status === 409 && !error.message.includes(result.id) && !error.message.includes('pending'));
  const record = getMerchantApplication(db, result.id);
  assert.equal(record.contact, 'owner@example.org');
  assert.deepEqual(record.productAreas, ['chatgpt']);
  assert.equal(record.platform, 'independent');
  assert.equal(record.version, 1);
  assert.deepEqual(record.actions, []);
  assert.equal(listMerchantApplications(db, { status: 'pending' }).total, 1);
  assert.deepEqual(approvedMerchantBadges(db), []);
  assert.equal(merchantBridgeDir(db), null);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='feedback_submissions'").get());
});

test('required consent, lengths, trap, category, credentials and platform validation', t => {
  const { db } = fixture(t);
  for (const change of [{ consent: false }, { shopName: 'x' }, { details: 'a'.repeat(1501) }, { website: 'spam' }, { productAreas: ['unknown'] },
    { contact: 'sk-' + 'x'.repeat(40) }, { details: 'password: supersecret' }, { platform: '16688' }, { contact: 'x' }]) {
    assert.throws(() => createMerchantApplication(db, payload(change), options), { status: 422 });
  }
  assert.equal(listMerchantApplications(db).total, 0);
  assert.equal(createMerchantApplication(db, payload({ consent: false, consentContact: true, consentCollection: true }), options).status, 'pending');
});

test('rate limits and retention retain no raw client address', t => {
  const { db } = fixture(t);
  for (let i = 0; i < 3; i++) createMerchantApplication(db, payload({ shopUrl: `https://shop-${i}.com/` }), options);
  assert.throws(() => createMerchantApplication(db, payload({ shopUrl: 'https://four.com/' }), options), { status: 429 });
  const row = db.prepare('SELECT client_hash FROM merchant_applications LIMIT 1').get();
  assert.match(row.client_hash, /^[a-f0-9]{64}$/);
  createMerchantApplication(db, payload({ shopUrl: 'https://later.com/' }), { ...options, now: new Date('2026-09-10T04:00:00Z') });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE client_hash IS NULL').get().n, 3);
});

test('approval publishes sanitized manifest; pause removes badge; optimistic versions and append-only audit', t => {
  const { db, dir } = fixture(t);
  const { id } = createMerchantApplication(db, payload(), options);
  for (const change of [{ ownershipConfirmed: false }, { permissionConfirmed: false }, { note: 'yes' }]) assert.throws(() => reviewMerchantApplication(db, id, approval(change), { bridgeDir: dir }), { status: 422 });
  const approved = reviewMerchantApplication(db, id, approval(), { bridgeDir: dir, now: options.now });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.version, 2);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'approved.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.merchants.length, 1);
  assert.equal(manifest.merchants[0].identity, 'domain:merchant-shop.com');
  assert.match(manifest.merchants[0].id, /^merchant-[a-f0-9]{16}$/);
  assert.equal(manifest.merchants[0].identityVerifiedAt, options.now.toISOString());
  assert.doesNotMatch(JSON.stringify(manifest), /owner@example|公开商品目录|reviewer|contact|client_hash|consent/);
  assert.equal(statSync(path.join(dir, 'approved.json')).mode & 0o777, 0o600);
  assert.throws(() => reviewMerchantApplication(db, id, approval(), { bridgeDir: dir }), { status: 409 });
  const paused = reviewMerchantApplication(db, id, approval({ action: 'pause', note: '店铺维护，暂停公开收录', expectedVersion: 2 }), { bridgeDir: dir });
  assert.equal(paused.identityVerifiedAt, null);
  assert.deepEqual(approvedMerchantBadges(db), []);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'approved.json'))).merchants, []);
  const again = reviewMerchantApplication(db, id, approval({ expectedVersion: 3 }), { bridgeDir: dir });
  assert.equal(again.version, 4);
  assert.equal(again.actions.length, 3);
  assert.throws(() => db.exec('DELETE FROM merchant_application_actions'), /append-only/);
  assert.throws(() => db.exec("UPDATE merchant_application_actions SET note='changed'"), /append-only/);
});

test('manifest write or audit insertion failures roll back approval', t => {
  const { db, dir } = fixture(t);
  const { id } = createMerchantApplication(db, payload(), options);
  const blockedDir = path.join(dir, 'is-file'); writeFileSync(blockedDir, 'occupied');
  assert.throws(() => reviewMerchantApplication(db, id, approval(), { bridgeDir: blockedDir }));
  assert.equal(getMerchantApplication(db, id).status, 'pending');
  assert.equal(getMerchantApplication(db, id).actions.length, 0);
  syncApprovedMerchantManifest(db, dir);
  const before = readFileSync(path.join(dir, 'approved.json'), 'utf8');
  db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON merchant_application_actions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(() => reviewMerchantApplication(db, id, approval(), { bridgeDir: dir }), /audit unavailable/);
  assert.equal(readFileSync(path.join(dir, 'approved.json'), 'utf8'), before);
  assert.equal(getMerchantApplication(db, id).status, 'pending');
});

test('COMMIT failure restores previous manifest and DB status; startup recovers manifest from DB', t => {
  const { db, dir } = fixture(t);
  const { id } = createMerchantApplication(db, payload(), options);
  syncApprovedMerchantManifest(db, dir);
  const before = readFileSync(path.join(dir, 'approved.json'), 'utf8');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE parent_test(id INTEGER PRIMARY KEY);
    CREATE TABLE child_test(parent_id INTEGER REFERENCES parent_test(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER fail_commit AFTER INSERT ON merchant_application_actions BEGIN INSERT INTO child_test VALUES(999); END;`);
  assert.throws(() => reviewMerchantApplication(db, id, approval(), { bridgeDir: dir }), /FOREIGN KEY/);
  assert.equal(getMerchantApplication(db, id).status, 'pending');
  assert.equal(getMerchantApplication(db, id).actions.length, 0);
  assert.equal(readFileSync(path.join(dir, 'approved.json'), 'utf8'), before);
  writeFileSync(path.join(dir, 'approved.json'), '{"stale":true}');
  syncApprovedMerchantManifest(db, dir);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'approved.json'))).merchants, []);
});

test('approval cannot overflow the collector manifest limit and invalidate existing merchants', t => {
  const { db } = fixture(t);
  const { id } = createMerchantApplication(db, payload(), options);
  const insert = db.prepare(`INSERT INTO merchant_applications(public_id,created_at,updated_at,shop_name,shop_url,identity,platform,product_areas,contact,consent_at,status,version,identity_verified_at,approved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'approved',2,?,?)`);
  const timestamp = options.now.toISOString();
  for (let i = 0; i < 100; i++) insert.run(`MA-FIXTURE-${i}`, timestamp, timestamp, '已核验商家', `https://merchant-${i}.com/`, `domain:merchant-${i}.com`, 'independent', '["chatgpt"]', 'private-contact', timestamp, timestamp, timestamp);
  assert.throws(() => reviewMerchantApplication(db, id, approval(), { bridgeDir: null }), { status: 422 });
  assert.equal(getMerchantApplication(db, id).status, 'pending');
  assert.equal(getMerchantApplication(db, id).actions.length, 0);
  assert.equal(syncApprovedMerchantManifest(db, null).merchants.length, 100);
});
