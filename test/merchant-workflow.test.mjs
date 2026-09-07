import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createMerchantApplication, getMerchantApplication, canonicalShopIdentity, reviewMerchantApplication, initMerchantSchema, updateMerchantEmail } from '../lib/merchant-onboarding.mjs';
import { importSupplyIntakes, listSupplyIntakes } from '../lib/merchant-intake.mjs';
import { reconcileAutomaticPreflights } from '../lib/merchant-preflight-store.mjs';
import { drainMerchantMail, queueMerchantMail, merchantMailStatus, mailConfiguration, normalizeEmail } from '../lib/merchant-mail.mjs';
import { supplyIntakeReview } from '../lib/merchant-workflow-ui.mjs';

const payload = { shopName:'测试店铺', shopUrl:'https://workflow-shop.com/', productAreas:['chatgpt'], contact:'other-contact', email:'owner@example.org', consent:true };
test('unread intake catalogue is not represented as an observed zero-price catalogue',()=>{
  const html=supplyIntakeReview({...payload,id:'CO-20260907-TEST1234',version:1},{status:'unavailable',result:{status:'unavailable',rawCount:0,validCount:0,reasonCode:'timeout',samples:[]}},{items:[]},'csrf');
  assert.doesNotMatch(html,/有效报价 0 条|原始解析 0 条/);
  assert.match(html,/暂时读取失败/);
});
function fixture(t) {
  const db = openSubmissionsDb(':memory:');
  const dir = mkdtempSync(path.join(os.tmpdir(),'merchant-workflow-'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  return {db, options:{bridgeDir:dir, resultsDir:path.join(dir,'results'),now:new Date('2026-09-07T08:00:00Z')}};
}
test('new merchant applications require a single valid email and enqueue a private receipt transactionally', t=>{
  const {db,options}=fixture(t);
  for (const email of ['', 'bad', 'a@b.com,b@c.com','a@b.com\r\nBcc:x@y.com']) assert.throws(()=>createMerchantApplication(db,{...payload,email},options),{status:422});
  const {id}=createMerchantApplication(db,payload,options);
  assert.equal(getMerchantApplication(db,id).email,payload.email);
  assert.equal(merchantMailStatus(db,id).items[0].stage,'received');
  assert.equal(merchantMailStatus(db,id).items[0].status,'queued');
  assert.throws(()=>canonicalShopIdentity('https://catfk.com/shop/x%EF%BC%8Chttps://wzyp.cn/shop/y'),{status:422});
});
test('email migration preserves applications; recipient edits are confirmed and old unsent recipients revoked', t=>{
  const {db,options}=fixture(t);
  const {id}=createMerchantApplication(db,payload,options);
  db.exec('ALTER TABLE merchant_applications DROP COLUMN email');
  initMerchantSchema(db);
  assert.equal(getMerchantApplication(db,id).email,null);
  assert.equal(getMerchantApplication(db,id).shopName,payload.shopName);
  assert.throws(()=>updateMerchantEmail(db,id,'new@example.org',{expectedVersion:1}),{status:422});
  updateMerchantEmail(db,id,'new@example.org',{expectedVersion:1,confirmed:true,now:options.now});
  assert.equal(getMerchantApplication(db,id).email,'new@example.org');
  assert.equal(db.prepare('SELECT status FROM merchant_mail_outbox WHERE recipient=?').get(payload.email).status,'superseded');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_email_actions').get().n,1);
});
test('SMTP DATA ambiguity is visible and never automatically retried',async t=>{
  const {db,options}=fixture(t);
  const {id}=createMerchantApplication(db,payload,options);
  let calls=0;
  const transport={sendMail:async()=>{calls++;throw Object.assign(new Error('private-server-response'),{code:'ECONNECTION',command:'DATA'});}};
  await drainMerchantMail(db,{transport,from:'notify@airadar.vip',now:options.now});
  await drainMerchantMail(db,{transport,from:'notify@airadar.vip',now:new Date(+options.now+86400000)});
  assert.equal(calls,1);assert.equal(merchantMailStatus(db,id).items[0].status,'uncertain');
});
test('supply intake preserves originals and identity uncertainty, auto tests without false consent and deduplicates runs',t=>{
  const {db,options}=fixture(t);
  createMerchantApplication(db,payload,options);
  const urls=['https://wzyp.cn/shop/testshop','https://workflow-shop.com/','https://catfk.com/shop/x%EF%BC%8Chttps://wzyp.cn/shop/y'];
  const ids=urls.map((url,i)=>{
    const id='CO-20260907-FIXTURE'+i;
    db.prepare(`INSERT INTO cooperation_submissions(public_id,created_at,topic,subject,product_area,scale,assurance,settlement,source_url,details,contact,consent_at,content_hash) VALUES(?,?,'supply','供货标题','chatgpt','trial','full_warranty','cny',?,'保留内容','original-contact',?,'fixture')`).run(id,options.now.toISOString(),url,options.now.toISOString());
    return id;
  });
  assert.equal(importSupplyIntakes(db,ids,{now:options.now}).imported,3);
  assert.equal(importSupplyIntakes(db,ids,{now:options.now}).imported,0);
  const list=listSupplyIntakes(db);
  assert.equal(list.length,3);
  assert.ok(list.find(x=>x.id===ids[1]).existingApplication);
  assert.ok(list.find(x=>x.id===ids[2]).urlError);
  reconcileAutomaticPreflights(db,options);
  reconcileAutomaticPreflights(db,options);
  const rows=db.prepare('SELECT * FROM merchant_preflight_requests').all();
  assert.equal(rows.length,2,'one application + one nonduplicate intake');
  assert.ok(rows.every(r=>r.ownership_confirmed===0&&r.permission_confirmed===0));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_submission_links').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cooperation_submissions').get().n,3);
  assert.equal(JSON.parse(readFileSync(path.join(options.bridgeDir,'preflight-requests.json'))).requests.length,2);
});
test('mail transport is configuration gated, deduplicated, bounded and exposes only safe failures',async t=>{
  const {db,options}=fixture(t);
  const {id}=createMerchantApplication(db,payload,options);
  assert.equal(mailConfiguration({}).configured,false);
  assert.equal(normalizeEmail('a@b.com\nBcc:x@y.com'),null);
  await drainMerchantMail(db,{now:options.now});
  assert.equal(merchantMailStatus(db,id).items[0].status,'queued');
  let sends=0;
  const transport={sendMail:async message=>{sends++; assert.doesNotMatch(message.text,/other-contact|internal-secret/); return {accepted:[payload.email]};}};
  await drainMerchantMail(db,{transport,from:'notify@airadar.vip',now:options.now});
  await drainMerchantMail(db,{transport,from:'notify@airadar.vip',now:options.now});
  assert.equal(sends,1);
  queueMerchantMail(db,{id,email:payload.email,stage:'need_info',eventKey:id+':info',now:options.now});
  queueMerchantMail(db,{id,email:payload.email,stage:'need_info',eventKey:id+':info',now:options.now});
  await drainMerchantMail(db,{from:'notify@airadar.vip',now:options.now,transport:{sendMail:async()=>{throw Object.assign(new Error('password=internal-secret'),{code:'EAUTH'});}}});
  assert.equal(merchantMailStatus(db,id).items[0].status,'failed');
  assert.doesNotMatch(JSON.stringify(merchantMailStatus(db,id)),/internal-secret/);
  reviewMerchantApplication(db,id,{action:'reject',expectedVersion:1,note:'内部说明不要发给客户'},{bridgeDir:options.bridgeDir,now:options.now});
  assert.equal(merchantMailStatus(db,id).items.some(row=>row.stage==='rejected'),false);
});
