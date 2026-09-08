import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication,reviewMerchantApplication,updateMerchantEmail} from '../lib/merchant-onboarding.mjs';
import {reconcileAutomaticPreflights,queueAutomaticPreflight} from '../lib/merchant-preflight-store.mjs';
import {drainMerchantMail,queueMerchantMail,merchantMailMessage} from '../lib/merchant-mail.mjs';
import {preflightFailureNotice} from '../lib/merchant-preflight-mail.mjs';
import {PREFLIGHT_REASON_CODES} from '../lib/merchant-preflight-guidance.mjs';

const now=new Date('2026-09-07T12:00:00Z');
const merchant={shopName:'测试店铺',shopUrl:'https://mail-preflight-shop.com/',productAreas:['chatgpt'],contact:'private-contact',details:'private-application-evidence',email:'owner@example.org',consent:true};
function fixture(t){
 const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(os.tmpdir(),'preflight-mail-'));
 const options={bridgeDir:dir,resultsDir:path.join(dir,'results'),now};
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const {id}=createMerchantApplication(db,merchant,options);
 reconcileAutomaticPreflights(db,options);
 function result(reasonCode='not_found',status='waiting_adapter',at=now){
  const r=db.prepare('SELECT * FROM merchant_preflight_requests WHERE application_id=? ORDER BY sequence DESC LIMIT 1').get(id);
  mkdirSync(options.resultsDir,{recursive:true});
  writeFileSync(path.join(options.resultsDir,r.id+'.json'),JSON.stringify({schemaVersion:1,id:r.id,applicationId:id,applicationVersion:r.application_version,identity:r.identity,startedAt:new Date(+at+1000).toISOString(),checkedAt:new Date(+at+2000).toISOString(),status,rawCount:0,validCount:0,samples:[],message:'untrusted-error-secret',...(reasonCode?{reasonCode}:{})}));
  return {...options,now:new Date(+at+3000)};
 }
 const autoRows=()=>db.prepare("SELECT * FROM merchant_mail_outbox WHERE event_key LIKE '%:auto-preflight:%' ORDER BY id").all();
 return {db,id,options,result,autoRows};
}

test('404 automatically emails an actionable materials checklist and private reply channel, without approving',async t=>{
 const {db,id,result,autoRows}=fixture(t),options=result();
 reconcileAutomaticPreflights(db,options);
 const messages=[];
 await drainMerchantMail(db,{now:options.now,from:'notice@airadar.vip',env:{MERCHANT_MAIL_REPLY_TO:'hello@airadar.vip'},transport:{sendMail:async m=>{messages.push(m);return {accepted:[m.to]};}}});
 const mail=messages.find(m=>m.subject.includes('需要补充资料'));
 assert.ok(mail);assert.equal(mail.to,merchant.email);assert.equal(mail.replyTo,'hello@airadar.vip');
 assert.match(mail.text,/404/);assert.match(mail.text,/并不表示您的店铺主页不存在/);
 for(const word of ['建站系统','版本','公开商品列表','商品详情页','只读','申请编号','不要发送'])assert.ok(mail.text.includes(word),word);
 assert.doesNotMatch(mail.text,/private-contact|private-application-evidence|untrusted-error-secret/);
 assert.match(mail.html,/max-width:600px/);assert.match(mail.html,/公开商品列表/);
 assert.equal(autoRows().length,1);assert.equal(autoRows()[0].status,'accepted');
 assert.equal(db.prepare('SELECT status FROM merchant_applications WHERE public_id=?').get(id).status,'pending');
});

test('same reason is deduplicated across ticks and forced retests; a changed reason gets one current notice',t=>{
 const {db,id,options,result,autoRows}=fixture(t);
 reconcileAutomaticPreflights(db,result());reconcileAutomaticPreflights(db,result());
 const later=new Date(+now+120000);
 queueAutomaticPreflight(db,id,{...options,now:later,force:true});
 reconcileAutomaticPreflights(db,result('not_found','waiting_adapter',later));
 assert.equal(autoRows().length,1);
 const again=new Date(+now+240000);
 queueAutomaticPreflight(db,id,{...options,now:again,force:true});
 reconcileAutomaticPreflights(db,result('login_required','unavailable',again));
 assert.equal(autoRows().length,2);
 assert.equal(autoRows()[0].status,'superseded');
 assert.match(autoRows()[1].public_reply,/无需登录/);
});

test('internal/unknown failures remain backend-only instead of spending the result email',t=>{
 for(const reason of ['internal_error','unknown']){
  const {db,result,autoRows}=fixture(t);
  reconcileAutomaticPreflights(db,result(reason,'unavailable'));
  assert.equal(autoRows().length,0);
 }
});

test('expired or legacy reasonless results never request guessed materials',t=>{
 const a=fixture(t),past=a.result();
 reconcileAutomaticPreflights(a.db,{...past,now:new Date(+past.now+86400000)});
 assert.equal(a.autoRows().length,0);
 const b=fixture(t);reconcileAutomaticPreflights(b.db,b.result(null,'unavailable'));
 assert.equal(b.autoRows().length,0);
});

test('approval supersedes detailed automatic failure notices but retains explicit replies and receipt',t=>{
 const {db,id,result,autoRows}=fixture(t),options=result();
 reconcileAutomaticPreflights(db,options);
 queueMerchantMail(db,{id,email:merchant.email,stage:'reply',eventKey:id+':reply:fixture',publicReply:'站长另行说明，需要保留。',now:options.now});
 reviewMerchantApplication(db,id,{action:'approve',expectedVersion:1,note:'内部测试审核记录',ownershipConfirmed:true,permissionConfirmed:true},{...options,bridgeDir:null});
 assert.equal(autoRows()[0].status,'superseded');
 for(const stage of ['received','reply','approved'])assert.equal(db.prepare('SELECT status FROM merchant_mail_outbox WHERE stage=?').get(stage).status,'queued');
});

test('confirmed recipient changes receive the current checklist; a manual information request suppresses automatic notices',t=>{
 const {db,id,result,autoRows}=fixture(t),options=result();
 reconcileAutomaticPreflights(db,options);
 updateMerchantEmail(db,id,'corrected@example.org',{expectedVersion:1,confirmed:true,now:options.now});
 reconcileAutomaticPreflights(db,options);
 assert.equal(autoRows().length,2);assert.equal(autoRows()[0].status,'superseded');assert.equal(autoRows()[1].recipient,'corrected@example.org');
 const a=fixture(t),r=a.result();
 reviewMerchantApplication(a.db,a.id,{action:'request_info',expectedVersion:1,note:'已经人工联系',publicReply:'请提供你们的公开目录说明。'},{...r,bridgeDir:null});
 reconcileAutomaticPreflights(a.db,r);assert.equal(a.autoRows().length,0);
});

test('all known failure reasons have bounded, safe owned copy; no valid quotes request factual product details',()=>{
 for(const reasonCode of PREFLIGHT_REASON_CODES){
  const result={status:reasonCode==='no_valid_quotes'?'no_valid_offers':'unavailable',reasonCode,checkedAt:now.toISOString(),message:'<img src=x onerror=secret>',samples:[{title:'secret-product-payload'}]};
  const notice=preflightFailureNotice({...merchant,shopName:'长'.repeat(100),shopUrl:'https://mail-preflight-shop.com/'+('a'.repeat(450))},{status:result.status,result});
  assert.ok(notice.publicReply.length<=1500,reasonCode+' '+notice.publicReply.length);
  assert.ok(notice.publicReply.length>150);assert.match(notice.publicReply,/检测结果/);
  assert.doesNotMatch(notice.publicReply,/secret-product-payload|onerror|private-contact|private-application-evidence/);
 }
 const notice=preflightFailureNotice(merchant,{status:'no_valid_offers',result:{status:'no_valid_offers',checkedAt:now.toISOString()}});
 assert.equal(notice.stage,'need_info');assert.match(notice.publicReply,/代充或成品号/);assert.match(notice.publicReply,/不需要为了通过测试修改实际商品条件/);
});

test('actionable mail offers simple steps and a forwardable AI brief, never asks merchants to invent an API',()=>{
 for(const reasonCode of ['not_found','unsupported_platform','invalid_catalog','redirect_disallowed','access_denied','login_required','robots_disallowed','rate_limited','no_valid_quotes']){
  const status=reasonCode==='no_valid_quotes'?'no_valid_offers':'unavailable';
  const notice=preflightFailureNotice(merchant,{status,result:{status,reasonCode,checkedAt:now.toISOString()}});
  assert.match(notice.publicReply,/请回复以下资料/);assert.match(notice.publicReply,/转发给建站服务商或 AI/);
  assert.match(notice.publicReply,/不会操作/);assert.match(notice.publicReply,/不要猜测接口/);
  assert.match(notice.publicReply,/不要修改代码或关闭防护/);
  assert.match(notice.publicReply,/无法确认.*无法确认/);
  assert.doesNotMatch(notice.publicReply,/必须.*(?:API|代码)|新建.*接口/);
 }
 for(const reasonCode of ['unknown','internal_error','timeout','network_error','tls_error','dns_error','server_error','collector_limit']){
  const notice=preflightFailureNotice(merchant,{status:'unavailable',result:{status:'unavailable',reasonCode,checkedAt:now.toISOString()}});
  assert.equal(notice.stage,'test_delayed');assert.doesNotMatch(notice.publicReply,/转发给建站服务商或 AI/);
 }
});

test('missing recipient and invalid result do not enqueue mail; stale automatic ready is retired even when reason was mailed already',t=>{
 const a=fixture(t),options=a.result();
 a.db.prepare('UPDATE merchant_applications SET email=NULL WHERE public_id=?').run(a.id);
 reconcileAutomaticPreflights(a.db,options);assert.equal(a.autoRows().length,0);
 const b=fixture(t),current=b.result();
 reconcileAutomaticPreflights(b.db,current);
 b.db.exec("UPDATE merchant_mail_outbox SET status='accepted' WHERE stage='need_info'");
 queueMerchantMail(b.db,{id:b.id,email:merchant.email,stage:'ready',eventKey:b.id+':result:old-ready',now:current.now});
 reconcileAutomaticPreflights(b.db,current);
 assert.equal(b.autoRows().length,1);
 assert.equal(b.db.prepare("SELECT status FROM merchant_mail_outbox WHERE event_key=?").get(b.id+':result:old-ready'),undefined);
 const request=b.db.prepare('SELECT id FROM merchant_preflight_requests ORDER BY sequence DESC LIMIT 1').get();
 writeFileSync(path.join(b.options.resultsDir,request.id+'.json'),'{invalid');
 reconcileAutomaticPreflights(b.db,current);assert.equal(b.autoRows().length,1);
});
