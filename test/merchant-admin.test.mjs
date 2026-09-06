import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../lib/db.mjs';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createAdmin, hashAdminPassword } from '../lib/admin.mjs';
import { createMerchantApplication, getMerchantApplication, approvedMerchantBadges } from '../lib/merchant-onboarding.mjs';

test('merchant admin protects private intake and confirms approval independently of collection', async () => {
  const db = openDb(':memory:'), submissionsDb = openSubmissionsDb(':memory:');
  const bridgeDir = mkdtempSync(path.join(os.tmpdir(), 'merchant-admin-'));
  const origin = 'https://airadar.test', password = 'merchant-admin-fixture-password';
  let clock = Date.now();
  const admin = createAdmin({ db, submissionsDb, merchantBridgeDir: bridgeDir, origin, username: 'owner', passwordHash: await hashAdminPassword(password), now: () => clock });
  const server = createServer(async (req, res) => {
    try { if (!await admin(req, res, new URL(req.url, origin))) { res.statusCode = 404; res.end(); } }
    catch { res.statusCode = 500; res.end('unexpected failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(base + url, { redirect: 'manual', ...options });
  const post = (url, fields, cookie, extra = {}) => request(url, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', cookie, ...extra }, body: new URLSearchParams(fields) });
  const input = { shopName: '<script>商店</script>', shopUrl: 'https://merchant-fixture.com/', platform: 'auto', productAreas: ['chatgpt'], contact: 'private-owner@example.org', details: '私人核验渠道', consent: true };
  const { id } = createMerchantApplication(submissionsDb, input);
  const detailPath = `/admin/merchants/${id}`;
  try {
    for (const target of ['/admin/merchants', detailPath]) {
      const response = await request(target);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/admin/login');
      assert.doesNotMatch(await response.text(), /private-owner|私人核验/);
    }
    const login = await request('/admin/login'), loginHtml = await login.text();
    const loginCsrf = /name="csrf" value="([^"]+)"/.exec(loginHtml)[1];
    const loginCookie = login.headers.getSetCookie()[0].split(';')[0];
    const loggedIn = await post('/admin/login', { username: 'owner', password, csrf: loginCsrf }, loginCookie);
    assert.equal(loggedIn.status, 303);
    const session = loggedIn.headers.getSetCookie()[0].split(';')[0];
    const get = url => request(url, { headers: { cookie: session } });
    const detail = await get(detailPath), detailHtml = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(detail.headers.get('cache-control'), /no-store/);
    assert.match(detailHtml, /private-owner@example.org/);
    assert.match(detailHtml, /&lt;script&gt;商店&lt;\/script&gt;/);
    assert.doesNotMatch(detailHtml, /<script>商店/);
    assert.match(detailHtml, /href="\/admin\/merchants">店铺审核/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(detailHtml)[1];
    const fields = { action: 'approve', note: '已通过店铺公告与联系人核实归属及采集授权', version: '1', ownershipConfirmed: 'true', permissionConfirmed: 'true', csrf };
    assert.equal((await post(detailPath, fields, session, { origin: 'https://evil.test' })).status, 403);
    assert.equal((await post(detailPath, { ...fields, csrf: 'forged' }, session)).status, 403);
    assert.equal((await post(detailPath, { ...fields, ownershipConfirmed: 'false' }, session)).status, 422);
    assert.equal((await post(detailPath, { ...fields, permissionConfirmed: '1' }, session)).status, 422);
    assert.equal((await post(detailPath, { ...fields, note: 'yes' }, session)).status, 422);
    assert.equal(getMerchantApplication(submissionsDb, id).actions.length, 0);
    assert.equal((await post(detailPath, fields, session)).status, 303);
    const approved = getMerchantApplication(submissionsDb, id);
    assert.equal(approved.version, 2);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.actions[0].actor, 'owner');
    const approvedHtml = await (await get(detailPath)).text();
    assert.match(approvedHtml, /店主已核验/);
    assert.match(approvedHtml, /等待采集/);
    assert.match(approvedHtml, /审核通过且采集成功后展示有效报价/);
    assert.doesNotMatch(approvedHtml, /badge">已接入/);
    assert.equal((await post(detailPath, fields, session)).status, 409);
    assert.equal(approvedMerchantBadges(submissionsDb).length, 1);
    const manifest = readFileSync(path.join(bridgeDir, 'approved.json'), 'utf8');
    assert.doesNotMatch(manifest, /private-owner|私人核验|contact|consent|client_hash|采集授权/);
    assert.equal(JSON.parse(manifest).merchants.length, 1);
    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('health:merchant-onboarding', JSON.stringify({ targets: [
      { identity: 'domain:other-merchant.com', status: 'active' },
      { identity: approved.identity, status: 'waiting_adapter', checkedAt: new Date(clock).toISOString() },
    ] }));
    const healthHtml = await (await get(detailPath)).text();
    assert.match(healthHtml, /待适配/);
    const inbox = await (await get('/admin/merchants?status=approved')).text();
    assert.match(inbox, /已通过 · 1/);
    assert.match(inbox, /待适配/);
    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('health:merchant-onboarding', JSON.stringify({ manifestValid: false, targets: [
      { identity: approved.identity, status: 'active', checkedAt: new Date(clock).toISOString() },
    ] }));
    for (const target of [detailPath, '/admin/merchants?status=approved']) {
      const failedManifest = await (await get(target)).text();
      assert.match(failedManifest, /role="alert">批准清单不可读或无效，已停止授权采集/);
      assert.match(failedManifest, /采集暂不可用/);
      assert.doesNotMatch(failedManifest, /badge">已接入|badge">等待采集/);
    }
    assert.equal((await post(detailPath, { ...fields, action: 'pause', version: '2', note: '店铺维护暂停目录采集' }, session)).status, 303);
    assert.deepEqual(approvedMerchantBadges(submissionsDb), []);
    assert.deepEqual(JSON.parse(readFileSync(path.join(bridgeDir, 'approved.json'))).merchants, []);
    assert.equal(getMerchantApplication(submissionsDb, id).actions.length, 2);
    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('health:merchant-onboarding', JSON.stringify({ manifestValid: true, targets: [
      { identity: approved.identity, status: 'active', checkedAt: new Date(clock).toISOString() },
    ] }));
    clock += 1000;
    assert.equal((await post(detailPath, { ...fields, version: '3' }, session)).status, 303);
    for (const target of [detailPath, '/admin/merchants?status=approved']) {
      const reapproved = await (await get(target)).text();
      assert.match(reapproved, /badge">等待采集/);
      assert.doesNotMatch(reapproved, /badge">已接入/);
    }
    assert.equal((await get('/admin/merchants/MA-NOT-FOUND')).status, 404);
    assert.equal((await get('/admin/merchants?status=malicious')).status, 422);
    assert.equal((await request(detailPath, { method: 'DELETE', headers: { cookie: session } })).status, 405);
    assert.throws(() => createMerchantApplication(submissionsDb, input), error => error.status === 409 && !error.message.includes(id) && !error.message.includes('paused'));
    clock += 3600_001;
    assert.equal((await get(detailPath)).status, 303);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close(); submissionsDb.close(); rmSync(bridgeDir, { recursive: true, force: true });
  }
});
