import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot,metaSet} from '../lib/db.mjs';
import {openSubmissionsDb,createSubmission,updateSubmissionStatus} from '../lib/submissions.mjs';
import {createMerchantApplication,reviewMerchantApplication,getMerchantApplication} from '../lib/merchant-onboarding.mjs';
import {importSupplyIntakes,updateIntakeEmail} from '../lib/merchant-intake.mjs';
import {MAIL_STAGES,merchantMailMessage,merchantMailStatus,drainMerchantMail} from '../lib/merchant-mail.mjs';
import {reconcileMerchantPublication} from '../lib/merchant-publication.mjs';
import {advertiseContent} from '../lib/commerce-ui.mjs';
import {decorateSeo} from '../lib/seo.mjs';
const now=new Date('2026-09-07T12:00:00Z');
function privateFixture(t){const db=openSubmissionsDb(':memory:');t.after(()=>db.close());return db;}
const feedback={kind:'feedback',topic:'suggestion',subject:'改进建议',details:'测试用完整反馈说明',contact:'example-tg',email:'reader@example.org'};
const merchant={shopName:'测试商店',shopUrl:'https://mail-qa-shop.com/',productAreas:['chatgpt'],contact:'example-tg',email:'owner@example.org',consent:true};
test('every notification has branded HTML, useful next steps and a full text alternative; dynamic text cannot inject HTML',()=>{
  for(const stage of Object.keys(MAIL_STAGES)){
    const msg=merchantMailMessage({application_id:'MA-20260907-TEST',recipient:'owner@example.org',stage,event_key:'test:'+stage,public_reply:'资料已核对，请补充店铺介绍。\n<img src=x onerror=alert(1)>'},'notice@airadar.vip',{replyEnabled:true});
    assert.match(msg.html,/max-width:600px/);assert.match(msg.html,/Airadar/);assert.match(msg.html,/&lt;img/);
    assert.equal(msg.from.name,'Airadar 通知');assert.equal(msg.from.address,'notice@airadar.vip');
    assert.match(msg.html,/Airadar · airadar\.vip/);assert.match(msg.subject,/^Airadar：/);
    assert.doesNotMatch(JSON.stringify(msg),/AirRadar/);
    assert.doesNotMatch(msg.html,/<script|<img|onerror="|@import/);
    assert.match(msg.text,/接下来/);assert.ok(msg.text.length>150);assert.match(msg.text,/申请编号/);
    assert.match(msg.html,/href="https:\/\/airadar.vip\/"/);
  }
  const noReply=merchantMailMessage({application_id:'FB-TEST',stage:'need_info',event_key:'test'},'notice@airadar.vip');
  assert.doesNotMatch(noReply.text,/回复此邮件/);
});
test('public partnership content and metadata use Airadar without changing the domain',()=>{
  const html=decorateSeo('<html><head><title>商家合作</title></head><body>'+advertiseContent()+'</body></html>',new URL('https://airadar.vip/advertise'),null);
  assert.match(html,/Airadar · 商家合作/);
  assert.match(html,/了解 Airadar 商品/);
  assert.match(html,/https:\/\/airadar\.vip\/advertise/);
  assert.doesNotMatch(html,/AirRadar/);
});
test('approval requires a valid owner email and atomically queues the approval notice',async t=>{
  const db=privateFixture(t),{id}=createMerchantApplication(db,merchant,{now});
  const review={action:'approve',expectedVersion:1,note:'内部核验记录不要外发',ownershipConfirmed:true,permissionConfirmed:true};
  db.prepare('UPDATE merchant_applications SET email=NULL WHERE public_id=?').run(id);
  assert.throws(()=>reviewMerchantApplication(db,id,review,{now,bridgeDir:null}),{status:422});
  assert.equal(getMerchantApplication(db,id).status,'pending');
  db.prepare('UPDATE merchant_applications SET email=? WHERE public_id=?').run(merchant.email,id);
  db.exec("CREATE TRIGGER fail_approval_mail BEFORE INSERT ON merchant_mail_outbox WHEN NEW.stage='approved' BEGIN SELECT RAISE(ABORT,'approval mail fixture'); END");
  assert.throws(()=>reviewMerchantApplication(db,id,review,{now,bridgeDir:null}),/approval mail fixture/);
  assert.equal(getMerchantApplication(db,id).status,'pending');
  db.exec('DROP TRIGGER fail_approval_mail');
  reviewMerchantApplication(db,id,review,{now,bridgeDir:null});
  assert.equal(getMerchantApplication(db,id).status,'approved');
  const sent=[];
  await drainMerchantMail(db,{transport:{sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}},from:'notice@airadar.vip',now,env:{MERCHANT_MAIL_REPLY_TO:'hello@airadar.vip'}});
  const approval=sent.filter(m=>m.subject==='Airadar：店铺审核已通过');
  assert.equal(approval.length,1);assert.equal(approval[0].to,merchant.email);
  assert.equal(approval[0].replyTo,'hello@airadar.vip');assert.match(approval[0].text,/审核通过不等于已经上架/);
  assert.doesNotMatch(JSON.stringify(sent),/内部核验记录/);
  assert.equal(merchantMailStatus(db,id).items.find(m=>m.stage==='approved').status,'accepted');
});
test('feedback receipt survives adoption; explicit reply and internal note remain separate; double submit is deduplicated',async t=>{
  const db=privateFixture(t),{id}=createSubmission(db,feedback,{now});
  updateSubmissionStatus(db,id,'accepted',{publicReply:'这条建议已采纳，谢谢你的反馈。',note:'只给站长看的内部记录',now});
  let rows=merchantMailStatus(db,id).items;
  assert.deepEqual(rows.map(r=>r.stage),['submission_accepted','submission_received']);
  assert.ok(rows.every(r=>r.status==='queued'));
  updateSubmissionStatus(db,id,'accepted',{publicReply:'这条建议已采纳，谢谢你的反馈。',now});
  assert.equal(merchantMailStatus(db,id).items.length,2);
  updateSubmissionStatus(db,id,'accepted',{note:'只保存新备注',now});
  assert.equal(merchantMailStatus(db,id).items.length,2);
  const messages=[];
  await drainMerchantMail(db,{transport:{sendMail:async m=>{messages.push(m);return {accepted:[feedback.email]};}},from:'notice@airadar.vip',now,env:{MERCHANT_SMTP_HOST:'smtp.resend.com',MERCHANT_MAIL_REPLY_TO:'hello@airadar.vip'}});
  assert.equal(messages.length,2);assert.equal(messages[0].replyTo,'hello@airadar.vip');
  assert.match(messages[0].headers['Resend-Idempotency-Key'],/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(messages),/只给站长|只保存新备注/);
});
test('anonymous feedback stays supported; invalid addresses fail; outbox errors roll back a submission',t=>{
  const db=privateFixture(t);
  createSubmission(db,{...feedback,email:'',contact:''},{now});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n,0);
  assert.throws(()=>createSubmission(db,{...feedback,email:'bad\r\nBcc:x@y.com'},{now}),{status:422});
  db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON merchant_mail_outbox BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.throws(()=>createSubmission(db,feedback,{now}),/fixture/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM feedback_submissions').get().n,1);
});
test('merchant replies do not approve, increment review version or leak internal notes; receipts are retained',t=>{
  const db=privateFixture(t),{id}=createMerchantApplication(db,merchant,{now});
  const reply={action:'reply',expectedVersion:1,publicReply:'请补充你们的公开目录链接，谢谢。',note:'仅给管理员看的信息'};
  reviewMerchantApplication(db,id,reply,{now,bridgeDir:null});
  reviewMerchantApplication(db,id,reply,{now,bridgeDir:null});
  const app=getMerchantApplication(db,id);assert.equal(app.version,1);assert.equal(app.status,'pending');assert.equal(app.actions.length,1);
  assert.equal(merchantMailStatus(db,id).items.length,2);
  assert.doesNotMatch(merchantMailMessage(db.prepare("SELECT * FROM merchant_mail_outbox WHERE stage='reply'").get(),'notice@airadar.vip').html,/仅给管理员/);
});
test('supply replies use the confirmed intake email and preserve the original submission',t=>{
  const db=privateFixture(t),id='CO-20260907-INTAKE';
  db.prepare("INSERT INTO cooperation_submissions(public_id,created_at,topic,subject,product_area,scale,assurance,settlement,source_url,details,contact,consent_at,content_hash) VALUES(?,?,'supply','供应测试','chatgpt','trial','full_warranty','cny','https://mail-qa-shop.com/','完整说明','example-tg',?,'fixture')").run(id,now.toISOString(),now.toISOString());
  importSupplyIntakes(db,[id],{now});updateIntakeEmail(db,id,'confirmed@example.org',{confirmed:true,now});
  updateSubmissionStatus(db,id,'new',{publicReply:'已经收到资料，谢谢。',now});
  assert.equal(db.prepare("SELECT recipient FROM merchant_mail_outbox WHERE stage='reply'").get().recipient,'confirmed@example.org');
  assert.equal(db.prepare('SELECT contact FROM cooperation_submissions').get().contact,'example-tg');
});
test('publication requires fresh actual directory quotes for the exact approved shop, then enqueues once',t=>{
  const db=privateFixture(t),publicDb=openDb(':memory:');t.after(()=>publicDb.close());
  const {id}=createMerchantApplication(db,merchant,{now});
  const approve={action:'approve',expectedVersion:1,note:'已人工核对店铺归属和商品',ownershipConfirmed:true,permissionConfirmed:true};
  reviewMerchantApplication(db,id,approve,{now,bridgeDir:null});
  const later=new Date(+now+60000);
  const health=(status='active',manifestValid=true)=>metaSet(publicDb,'health:merchant-onboarding',JSON.stringify({manifestValid,targets:[{identity:'domain:mail-qa-shop.com',status,lastSuccess:later.toISOString()}]}));
  let sequence=0;
  function snapshot(overrides={}){storeSnapshot(publicDb,{source:'direct-shops',snapshotId:'fixture-'+sequence++,fetchedAt:later.toISOString(),products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'1',title:'ChatGPT Plus 代充1个月',status:'in_stock',currency:'CNY',price:100,url:'https://mail-qa-shop.com/buy/1',capturedAt:later.toISOString(),...overrides}]}]});}
  health();assert.equal(reconcileMerchantPublication(db,publicDb,{now:later}).queued,0);
  for(const overrides of [{status:'sold_out'},{price:0},{title:'ChatGPT Plus 代充1个月 无质保'},{capturedAt:new Date(+now-1000).toISOString()},{url:'https://other-shop.com/buy/1'},{extra:{quoteHealth:{status:'stale'}}}]){
    snapshot(overrides);assert.equal(reconcileMerchantPublication(db,publicDb,{now:later}).queued,0,JSON.stringify(overrides));
  }
  snapshot();health('failed');assert.equal(reconcileMerchantPublication(db,publicDb,{now:later}).queued,0);
  health('active',false);assert.equal(reconcileMerchantPublication(db,publicDb,{now:later}).queued,0);
  health();assert.equal(reconcileMerchantPublication(db,publicDb,{now:later}).queued,1);
  assert.equal(reconcileMerchantPublication(db,publicDb,{now:later}).queued,0);
  const rows=merchantMailStatus(db,id).items;assert.deepEqual(rows.map(r=>r.stage),['published','approved','received']);assert.ok(rows.every(r=>r.status==='queued'));
});
