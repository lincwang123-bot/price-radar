import test from 'node:test';
import assert from 'node:assert/strict';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { convertSupplySubmission, linkedMerchantApplication, getMerchantApplication, createMerchantApplication, syncApprovedMerchantManifest, conversionFormValues } from '../lib/merchant-onboarding.mjs';

const time = new Date('2026-09-07T04:00:00.000Z');
const fields = { shopName: '核验后的店铺', shopUrl: 'https://wzyp.cn/shop/sample-shop', contact: 'confirmed@example.org', productAreas: ['chatgpt'],
  details: '管理员确认的资料', note: '已向店主核实归属与公开目录采集授权', ownershipConfirmed: true, permissionConfirmed: true };
const options = { actor: 'owner', now: time };
function setup(t) {
  const db = openSubmissionsDb(':memory:');t.after(() => db.close());
  const source = (n = 1, topic = 'supply') => {
    const id = `CO-20260907-${String(n).padStart(12,'0')}`;
    db.prepare(`INSERT INTO cooperation_submissions(public_id,created_at,topic,subject,product_area,scale,assurance,settlement,source_url,details,contact,consent_at,content_hash,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,time.toISOString(),topic,'供应广告标题不是店名','chatgpt','small','conditional','cny','https://wzyp.cn/shop/sample-shop','原投稿私有资料','original@example.org',time.toISOString(),String(n),'reviewing');
    return id;
  };
  return { db, source };
}
test('conversion creates only pending application with immutable private provenance, preserves CO and is idempotent', t => {
  const { db, source } = setup(t), id = source();
  const original = db.prepare('SELECT * FROM cooperation_submissions WHERE public_id=?').get(id);
  const result = convertSupplySubmission(db,id,fields,options);
  assert.match(result.id,/^MA-20260907-[A-F0-9]{12}$/);
  assert.equal(result.status,'pending');
  const application = getMerchantApplication(db,result.id);
  assert.equal(application.shopName,fields.shopName);assert.equal(application.contact,fields.contact);
  assert.equal(application.identityVerifiedAt,null);assert.equal(application.approvedAt,null);
  assert.equal(application.conversion.sourceSubmissionId,id);assert.equal(application.conversion.actor,'owner');
  assert.equal(application.conversion.note,fields.note);assert.equal(application.conversion.permissionConfirmed,1);
  assert.deepEqual(db.prepare('SELECT * FROM cooperation_submissions WHERE public_id=?').get(id),original);
  assert.equal(convertSupplySubmission(db,id,fields,options).id,result.id);
  assert.equal(linkedMerchantApplication(db,id).id,result.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_conversion_actions').get().n,1);
  for(const table of ['merchant_submission_links','merchant_conversion_actions']) {
    assert.throws(()=>db.exec(`DELETE FROM ${table}`),/append-only/);
  }
  const manifest=JSON.stringify(syncApprovedMerchantManifest(db,null));
  assert.doesNotMatch(manifest,/confirmed@|original@|原投稿|管理员|CO-/);assert.deepEqual(JSON.parse(manifest).merchants,[]);
});
test('only supply can convert and authorization plus canonical field validation are required', t => {
  const { db, source } = setup(t), id = source();
  assert.throws(()=>convertSupplySubmission(db,source(2,'demand'),fields,options),{status:422});
  assert.throws(()=>convertSupplySubmission(db,'FB-20260907-000000000001',fields,options),{status:404});
  for(const change of [{ownershipConfirmed:false},{permissionConfirmed:false},{note:'yes'},{note:'password=secret'},{note:'字'.repeat(1501)},
    {shopName:''},{shopUrl:'http://wzyp.cn/shop/sample-shop'},{shopUrl:'https://127.0.0.1/'},{shopUrl:'https://wzyp.cn/item/abc'},
    {contact:''},{details:'api_key=secret'},{productAreas:['bad']}])
    assert.throws(()=>convertSupplySubmission(db,id,{...fields,...change},options),{status:422});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,0);
});
test('canonical duplicate returns existing application without merging contact or linking CO', t => {
  const { db, source } = setup(t), id = source();
  const existing=createMerchantApplication(db,{...fields,contact:'existing-owner@example.org',shopUrl:'https://www.wzyp.cn/sample-shop',consent:true},{now:time});
  assert.throws(()=>convertSupplySubmission(db,id,fields,options),error=>error.status===409&&error.existingApplication?.id===existing.id);
  assert.equal(linkedMerchantApplication(db,id),null);
  assert.equal(getMerchantApplication(db,existing.id).contact,'existing-owner@example.org');
});
test('conversion rolls back application and link when private audit insert fails; admins bypass only public IP throttle', t => {
  const { db, source } = setup(t), id=source();
  db.exec("CREATE TRIGGER break_conversion BEFORE INSERT ON merchant_conversion_actions BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
  assert.throws(()=>convertSupplySubmission(db,id,fields,options),/fixture audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,0);
  assert.equal(linkedMerchantApplication(db,id),null);db.exec('DROP TRIGGER break_conversion');
  for(let n=1;n<=6;n++)convertSupplySubmission(db,n===1?id:source(n),{...fields,shopUrl:`https://conversion-${n}.com/`},options);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_applications WHERE client_hash IS NOT NULL').get().n,0);
});
test('failed form preserves ordinary overlong input but removes credentials and confirmation flags', () => {
  const input=conversionFormValues({...fields,details:'字'.repeat(1501),note:'api_key=private-token'});
  assert.equal(input.details,'字'.repeat(1501));assert.equal(input.note,'');
  assert.equal(input.ownershipConfirmed,undefined);assert.equal(input.permissionConfirmed,undefined);
});
