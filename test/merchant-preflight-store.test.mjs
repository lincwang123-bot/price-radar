import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, mkdirSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createMerchantApplication, getMerchantApplication, reviewMerchantApplication } from '../lib/merchant-onboarding.mjs';
import { queueMerchantPreflight, latestMerchantPreflight, syncPreflightManifest, assertPreflightApproval } from '../lib/merchant-preflight-store.mjs';

const now = new Date('2026-09-07T04:00:00.000Z');
const review = { ownershipConfirmed: true, permissionConfirmed: true, expectedVersion: 1, actor: 'owner', sampleReviewed: true };
function fixture(t) {
  const db = openSubmissionsDb(':memory:'), dir = mkdtempSync(path.join(os.tmpdir(), 'merchant-preflight-'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const makeApp = (n = 0) => createMerchantApplication(db, { shopName: '样例店铺', shopUrl: `https://merchant-${n}.com/`, platform: 'auto',
    productAreas: ['chatgpt'], contact: 'private@example.org', details: '保密审核材料', consent: true }, { now, clientAddress: String(n) }).id;
  const options = { bridgeDir: dir, resultsDir: dir, now };
  return { db, dir, makeApp, options };
}
function validResult(request, overrides = {}) {
  return { schemaVersion: 1, id: request.id, applicationId: request.applicationId, applicationVersion: request.applicationVersion,
    identity: request.identity, startedAt: request.requestedAt, checkedAt: request.requestedAt, status: 'ready', rawCount: 1, validCount: 1,
    samples: [{ title: '月付商品', price: 20, currency: 'USD', url: 'https://merchant-0.com/item/1' }], message: '测试采集完成', ...overrides };
}
test('preflight requests are permission checked, privately audited, bounded and expire after one hour', t => {
  const { db, dir, makeApp, options } = fixture(t), id = makeApp();
  for (const change of [{ ownershipConfirmed: false }, { permissionConfirmed: false }])
    assert.throws(() => queueMerchantPreflight(db, id, { ...review, ...change }, options), { status: 422 });
  assert.throws(() => queueMerchantPreflight(db, id, { ...review, expectedVersion: 2 }, options), { status: 409 });
  const request = queueMerchantPreflight(db, id, review, options);
  assert.match(request.id, /^MT-[0-9A-F]{24}$/);
  assert.equal(request.status, 'pending');
  const content = readFileSync(path.join(dir, 'preflight-requests.json'), 'utf8');
  assert.doesNotMatch(content, /private@|保密|contact|actor|permission|details/);
  assert.equal(statSync(path.join(dir, 'preflight-requests.json')).mode & 0o777, 0o600);
  assert.equal(getMerchantApplication(db, id).status, 'pending');
  assert.equal(getMerchantApplication(db, id).version, 1);
  assert.throws(() => queueMerchantPreflight(db, id, review, options), { status: 429 });
  assert.throws(() => db.prepare('DELETE FROM merchant_preflight_requests').run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE merchant_preflight_requests SET actor='other'").run(), /append-only/);
  for (let n = 1; n < 20; n++) queueMerchantPreflight(db, makeApp(n), review, options);
  const overflow = makeApp(20);
  assert.throws(() => queueMerchantPreflight(db, overflow, review, options), { status: 429 });
  assert.equal(syncPreflightManifest(db, { ...options, now: new Date(+now + 3600_000) }).requests.length, 0);
  assert.equal(latestMerchantPreflight(db, id, { ...options, now: new Date(+now + 3600_000) }).status, 'expired');
  queueMerchantPreflight(db, overflow, review, { ...options, now: new Date(+now + 3600_000) });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_preflight_requests').get().n, 21);
});
test('only latest matching ready result is accepted, fresh for 24h, without publishing offers', t => {
  const { db, dir, makeApp, options } = fixture(t), id = makeApp();
  const request = queueMerchantPreflight(db, id, review, options), target = path.join(dir, request.id + '.json');
  writeFileSync(target, JSON.stringify(validResult(request)));
  assert.equal(latestMerchantPreflight(db, id, options).canApprove, true);
  assert.doesNotThrow(() => assertPreflightApproval(db, id, review, options));
  assert.throws(() => assertPreflightApproval(db, id, { ...review, sampleReviewed: false }, options), { status: 422 });
  assert.equal(syncPreflightManifest(db, options).requests.length, 0);
  assert.equal(latestMerchantPreflight(db, id, { ...options, now: new Date(+now + 2 * 3600_000) }).canApprove, true);
  assert.equal(latestMerchantPreflight(db, id, { ...options, now: new Date(+now + 24 * 3600_000) }).canApprove, false);
  assert.equal(latestMerchantPreflight(db, id, { ...options, now: new Date(+now + 24 * 3600_000) }).status, 'expired');
  assert.equal(getMerchantApplication(db, id).status, 'pending');
  queueMerchantPreflight(db, id, review, { ...options, now: new Date(+now + 60_000) });
  assert.equal(latestMerchantPreflight(db, id, options).canApprove, false, 'newer request supersedes earlier success');
  reviewMerchantApplication(db, id, { ...review, action: 'pause', note: '暂停收录等待核验' }, { bridgeDir: dir, now });
  assert.equal(latestMerchantPreflight(db, id, options).status, 'expired');
  assert.equal(syncPreflightManifest(db, options).requests.length, 0, 'changed version cancels pending requests');
});
test('malformed, mismatched, oversized, future, expired and unsafe results fail closed', t => {
  const { db, dir, makeApp, options } = fixture(t), id = makeApp();
  const request = queueMerchantPreflight(db, id, review, options), target = path.join(dir, request.id + '.json');
  const sample = validResult(request).samples[0];
  const variants = [{ id: 'MT-' + 'F'.repeat(24) }, { applicationId: 'MA-OTHER' }, { applicationVersion: 2 }, { identity: 'domain:wrong.com' },
    { checkedAt: new Date(+now + 1).toISOString() }, { startedAt: new Date(+now - 1).toISOString() },
    { checkedAt: new Date(+now + 3600_001).toISOString() }, { startedAt: 'invalid' }, { validCount: 2 }, { validCount: 0, samples: [] },
    { samples: Array(6).fill(sample), validCount: 6, rawCount: 6 }, { samples: [{ ...sample, price: -1 }] },
    { samples: [{ ...sample, url: 'javascript:alert(1)' }] }, { samples: [{ ...sample, url: 'http://127.0.0.1/' }] },
    { samples: [{ ...sample, url: 'https://unrelated-shop.com/item/1' }] },
    { samples: [{ ...sample, url: 'https://www.merchant-0.com/item/1' }] },
    { samples: [{ ...sample, url: 'https://user:pass@merchant-0.com/' }] }, { message: 'x'.repeat(65_536) }];
  for (const variant of variants) {
    writeFileSync(target, JSON.stringify(validResult(request, variant)));
    assert.equal(latestMerchantPreflight(db, id, options).status, 'invalid', JSON.stringify(variant).slice(0, 150));
    assert.throws(() => assertPreflightApproval(db, id, review, options), { status: 422 });
  }
  for (const status of ['waiting_adapter', 'no_valid_offers', 'unavailable']) {
    writeFileSync(target, JSON.stringify(validResult(request, { status, validCount: 0, rawCount: 0, samples: [] })));
    assert.equal(latestMerchantPreflight(db, id, options).canApprove, false);
  }
});
test('manifest revocation precedes review and failed queue writes leave no unaudited request', t => {
  const { db, dir, makeApp, options } = fixture(t), id = makeApp(), other = makeApp(1);
  queueMerchantPreflight(db, id, review, options);
  assert.equal(syncPreflightManifest(db, { ...options, excludeApplicationId: id }).requests.length, 0);
  assert.equal(getMerchantApplication(db, id).status, 'pending');
  assert.equal(syncPreflightManifest(db, options).requests.length, 1, 'startup reconstructs requests from private audit');
  const manifest = path.join(dir, 'preflight-requests.json');
  renameSync(manifest, manifest + '.backup'); mkdirSync(manifest);
  try {
    assert.throws(() => queueMerchantPreflight(db, other, review, options));
    assert.equal(latestMerchantPreflight(db, other, options), null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_preflight_requests').get().n, 1);
  } finally { rmSync(manifest, { recursive: true }); renameSync(manifest + '.backup', manifest); }
});
