import {verifyApplicationPhone} from './helpers/merchant-phone.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication,reviewMerchantApplication,updateMerchantEmail} from '../lib/merchant-onboarding.mjs';
import {reconcileAutomaticPreflights,queueAutomaticPreflight,latestMerchantPreflight} from '../lib/merchant-preflight-store.mjs';
import {drainMerchantMail,queueMerchantMail,merchantMailMessage} from '../lib/merchant-mail.mjs';
import {preflightFailureNotice} from '../lib/merchant-preflight-mail.mjs';
import {recordMerchantReply} from '../lib/merchant-replies.mjs';
import {PREFLIGHT_REASON_CODES} from '../lib/merchant-preflight-guidance.mjs';

const now=new Date('2026-09-28T10:01:00Z');
const merchant={shopName:'测试店铺',shopUrl:'https://mail-preflight-shop.com/',productAreas:['chatgpt'],contact:'private-contact',details:'private-application-evidence',email:'owner@example.org',consent:true};
function fixture(t,at=now){
 const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(os.tmpdir(),'preflight-mail-'));
 const options={bridgeDir:dir,resultsDir:path.join(dir,'results'),now:at};
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const {id}=createMerchantApplication(db,merchant,options);
 verifyApplicationPhone(db,id);
 reconcileAutomaticPreflights(db,options);
 function result(reasonCode='not_found',status='waiting_adapter',at=options.now){
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
 assert.match(mail.text,/404/);assert.match(mail.text,/不能据此判断店铺主页不存在/);
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

test('fresh timeout and infrastructure failures email one concise result without blaming the merchant',async t=>{
 for(const reason of ['timeout','network_error','server_error','security_challenge','internal_error','unknown']){
  const {db,result,autoRows}=fixture(t);
  const options=result(reason,'unavailable');reconcileAutomaticPreflights(db,options);
  assert.equal(autoRows().length,1,reason);assert.equal(autoRows()[0].stage,'collection_failed');
  const sent=[];await drainMerchantMail(db,{now:options.now,from:'notice@airadar.vip',env:{},transport:{sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}}});
  const failure=sent.find(m=>m.subject.includes('采集暂未成功'));assert.ok(failure,reason);
  assert.match(failure.text,/检测结果/);assert.doesNotMatch(failure.text,/untrusted-error-secret|private-contact/);
  reconcileAutomaticPreflights(db,options);assert.equal(autoRows().length,1);
 }
});
test('new notification policy does not backfill old failure results',t=>{
 const f=fixture(t,new Date('2026-09-27T12:00:00Z'));
 reconcileAutomaticPreflights(f.db,f.result('timeout','unavailable'));
 assert.equal(f.autoRows().length,0);
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
 const request=db.prepare('SELECT * FROM merchant_preflight_requests WHERE application_id=? ORDER BY sequence DESC LIMIT 1').get(id);
 writeFileSync(path.join(options.resultsDir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:id,applicationVersion:1,identity:request.identity,
  startedAt:request.requested_at,checkedAt:options.now.toISOString(),status:'ready',rawCount:1,validCount:1,message:'有效商品样例',
  samples:[{title:'公开商品',price:20,currency:'USD',url:merchant.shopUrl+'/item/1'}]}));
 queueMerchantMail(db,{id,email:merchant.email,stage:'reply',eventKey:id+':reply:fixture',publicReply:'站长另行说明，需要保留。',now:options.now});
 reviewMerchantApplication(db,id,{action:'approve',expectedVersion:1,note:'内部测试审核记录',ownershipConfirmed:true,permissionConfirmed:true},{...options,bridgeDir:null});
 assert.equal(autoRows()[0].status,'superseded');
 for(const stage of ['received','reply','approved'])assert.equal(db.prepare('SELECT status FROM merchant_mail_outbox WHERE stage=?').get(stage).status,'queued');
});

test('a trusted current-version reply plus an adapted product automatically approves and publishes without setting identity verification',t=>{
 const f=fixture(t),first=f.result();
 reconcileAutomaticPreflights(f.db,first);
 const replyAt=new Date(+first.now+1000);
 recordMerchantReply(f.db,{applicationId:f.id,expectedVersion:1,messageId:'autopublishreply1',threadId:'autopublishthread1',sender:merchant.email,
  authentication:'gmail-aligned',receivedAt:replyAt.toISOString(),summary:'已补充公开商品链接并确认申请资料',publicUrls:[]},{now:new Date(+replyAt+1000)});
 const retryAt=new Date(+first.now+65000);
 reconcileAutomaticPreflights(f.db,{...f.options,now:retryAt});
 const request=f.db.prepare('SELECT * FROM merchant_preflight_requests WHERE application_id=? ORDER BY sequence DESC LIMIT 1').get(f.id);
 assert.ok(Date.parse(request.requested_at)>Date.parse(replyAt.toISOString()));
 writeFileSync(path.join(f.options.resultsDir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:f.id,applicationVersion:1,identity:request.identity,
  startedAt:request.requested_at,checkedAt:new Date(+retryAt+1000).toISOString(),status:'ready',rawCount:1,validCount:1,message:'有效商品样例',
  samples:[{title:'公开订阅商品',price:20,currency:'USD',url:merchant.shopUrl+'item/1'}]}));
 reconcileAutomaticPreflights(f.db,{...f.options,now:new Date(+retryAt+2000)});
 const app=f.db.prepare('SELECT status,identity_verified_at FROM merchant_applications WHERE public_id=?').get(f.id);
 assert.deepEqual({...app},{status:'approved',identity_verified_at:null});
 assert.equal(f.db.prepare("SELECT actor FROM merchant_application_actions WHERE application_id=? AND action='approve'").get(f.id).actor,'system:valid-products-auto-publish');
 assert.equal(JSON.parse(readFileSync(path.join(f.options.bridgeDir,'approved.json'))).merchants.length,1);
});

test('an explicit test_only reply never becomes continuous catalog permission or automatic publication',t=>{
 const f=fixture(t),first=f.result();reconcileAutomaticPreflights(f.db,first);
 const replyAt=new Date(+first.now+1000);
 recordMerchantReply(f.db,{applicationId:f.id,expectedVersion:1,messageId:'testonlyreply1',threadId:'testonlythread1',sender:merchant.email,
  authentication:'gmail-aligned',receivedAt:replyAt.toISOString(),summary:'permissionScope: test_only，只允许本次测试',publicUrls:[]},{now:new Date(+replyAt+1000)});
 const later=new Date(+first.now+65000);
 reconcileAutomaticPreflights(f.db,{...f.options,now:later});
 const request=queueAutomaticPreflight(f.db,f.id,{...f.options,now:later,force:true});
 writeFileSync(path.join(f.options.resultsDir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:f.id,applicationVersion:1,identity:request.identity,
  startedAt:request.requestedAt,checkedAt:new Date(+later+1000).toISOString(),status:'ready',rawCount:1,validCount:1,message:'有效商品样例',
  samples:[{title:'公开商品',price:20,currency:'USD',url:merchant.shopUrl+'/item/1'}]}));
 assert.equal(f.db.prepare('SELECT status FROM merchant_applications WHERE public_id=?').get(f.id).status,'pending');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM merchant_preflight_requests WHERE application_id=?').get(f.id).n,2);
 assert.equal(latestMerchantPreflight(f.db,f.id,{...f.options,now:later}).canApprove,false);
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
  assert.ok(notice.publicReply.length<500);assert.match(notice.publicReply,/检测结果/);
  assert.doesNotMatch(notice.publicReply,/secret-product-payload|onerror|private-contact|private-application-evidence/);
 }
 const notice=preflightFailureNotice(merchant,{status:'no_valid_offers',result:{status:'no_valid_offers',checkedAt:now.toISOString()}});
 assert.equal(notice.stage,'need_info');assert.match(notice.publicReply,/代充或成品号/);assert.match(notice.publicReply,/不要求修改实际商品条件/);
});

test('failure mail states the observed reason and next step in plain short copy',()=>{
 for(const reasonCode of PREFLIGHT_REASON_CODES){
  const status=reasonCode==='no_valid_quotes'?'no_valid_offers':'unavailable';
  const notice=preflightFailureNotice(merchant,{status,result:{status,reasonCode,checkedAt:now.toISOString(),...(reasonCode==='server_error'?{httpStatus:522}:{})}});
  assert.match(notice.publicReply,/下一步/);assert.ok(notice.publicReply.length<500);
  assert.doesNotMatch(notice.publicReply,/转发给建站服务商或 AI|①|必须.*API/);
  if(reasonCode==='server_error')assert.match(notice.publicReply,/HTTP 522/);
  if(['internal_error','unknown','timeout'].includes(reasonCode)){
   assert.equal(notice.stage,'collection_failed');assert.match(notice.publicReply,/暂时无需/);
  }
 }
});

test('纯采集端上限不向店主要资料，robots、无效目录和无有效报价仍然要',()=>{
 const at=now.toISOString();
 const notice=(reasonCode,status=reasonCode==='no_valid_quotes'?'no_valid_offers':'unavailable')=>preflightFailureNotice(merchant,{status,result:{status,reasonCode,checkedAt:at}});
 assert.equal(notice('collector_limit').stage,'collection_failed'); // live renamed test_delayed -> collection_failed
 assert.doesNotMatch(notice('collector_limit').publicReply,/请回复(?:以下资料|：)/);
 assert.match(notice('collector_limit').publicReply,/达到本轮安全读取限制/);
 for(const reasonCode of ['robots_disallowed','invalid_catalog','no_valid_quotes']){
  assert.equal(notice(reasonCode).stage,'need_info',reasonCode);
  assert.match(notice(reasonCode).publicReply,/请回复(?:以下资料|：)/);
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


test('a verified new reply permits one failure notice in its own round, not another initial result',async t=>{
 const f=fixture(t),sent=[];
 const drain=at=>drainMerchantMail(f.db,{now:at,from:'notice@airadar.vip',env:{},transport:{sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}}});
 let options=f.result('timeout','unavailable');reconcileAutomaticPreflights(f.db,options);await drain(options.now);assert.equal(sent.length,2);
 const replyAt=new Date(+now+60000);
 const r=recordMerchantReply(f.db,{applicationId:f.id,messageId:'newfailure123',threadId:'failurethread',sender:merchant.email,authentication:'gmail-aligned',expectedVersion:1,receivedAt:replyAt.toISOString(),summary:'店主已修复目录，请按新公开目录重新核对',publicUrls:['https://mail-preflight-shop.com/products']},{now:replyAt});
 const next=new Date(+now+120000);queueAutomaticPreflight(f.db,f.id,{...f.options,now:next,force:true});
 options=f.result('server_error','unavailable',next);reconcileAutomaticPreflights(f.db,options);await drain(options.now);
 assert.equal(sent.length,3);assert.equal(f.autoRows().at(-1).reply_round_id,r.reply.id);
 reconcileAutomaticPreflights(f.db,options);await drain(options.now);assert.equal(sent.length,3);
});

test('已核验回复中的商品链接让目录解析失败先归站方复核，不重复整套材料',()=>{
 const application={...merchant,version:1};
 const reply={id:18,applicationVersion:1,publicUrls:['https://mail-preflight-shop.com/item/1'],summary:'已有资料，包含不可信文本 secret'};
 for(const reasonCode of ['invalid_catalog','no_valid_quotes']){
  const status=reasonCode==='no_valid_quotes'?'no_valid_offers':'waiting_adapter';
  const notice=preflightFailureNotice(application,{status,result:{status,reasonCode,checkedAt:now.toISOString()}},{reply});
  assert.equal(notice.stage,'collection_failed');assert.match(notice.publicReply,/已收到您补充的公开商品链接/);
  assert.match(notice.publicReply,/先核对现有资料与解析规则/);
  assert.doesNotMatch(notice.publicReply,/请回复：|1–2|建站系统及版本|真实价格、币种、库存、时长|secret/);
 }
 const oldReply={...reply,applicationVersion:0};
 assert.equal(preflightFailureNotice(application,{status:'no_valid_offers',result:{checkedAt:now.toISOString()}},{reply:oldReply}).stage,'need_info');
});

test('当前新轮次解析失败只发一次站方复核结果，普通重测不能再发或要求已有材料',async t=>{
 const f=fixture(t),sent=[];
 const drain=at=>drainMerchantMail(f.db,{now:at,from:'notice@airadar.vip',env:{},transport:{sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}}});
 const initial=f.result('no_valid_quotes','no_valid_offers');reconcileAutomaticPreflights(f.db,initial);await drain(initial.now);
 const replyAt=new Date(+now+60000);
 const reply=recordMerchantReply(f.db,{applicationId:f.id,messageId:'replyaware001',threadId:'replyawarethread',sender:merchant.email,authentication:'gmail-aligned',expectedVersion:1,receivedAt:replyAt.toISOString(),summary:'原邮箱已补充商品链接与真实条件',publicUrls:['https://mail-preflight-shop.com/item/1']},{now:replyAt});
 const next=new Date(+now+120000);queueAutomaticPreflight(f.db,f.id,{...f.options,now:next,force:true});
 const result=f.result('no_valid_quotes','no_valid_offers',next);reconcileAutomaticPreflights(f.db,result);await drain(result.now);
 const rows=f.autoRows().filter(row=>row.reply_round_id===reply.reply.id);
 assert.equal(rows.length,1);assert.equal(rows[0].stage,'collection_failed');assert.equal(rows[0].status,'accepted');
 assert.doesNotMatch(rows[0].public_reply,/请回复：|1–2|建站系统及版本/);
 const later=new Date(+now+240000);queueAutomaticPreflight(f.db,f.id,{...f.options,now:later,force:true});
 reconcileAutomaticPreflights(f.db,f.result('invalid_catalog','waiting_adapter',later));await drain(new Date(+later+5000));
 assert.equal(sent.length,3);assert.equal(f.autoRows().filter(row=>row.reply_round_id===reply.reply.id&&row.status==='accepted').length,1);
});

test('精确诊断仅询问对应事实；静态页面边界和已有资料不重复索授权',()=>{
 const diagnostics={schemaVersion:1,rawCount:1,validCount:0,items:[{index:0,reasonCodes:['inventory_unconfirmed']}],truncated:false};
 const result={status:'no_valid_offers',reasonCode:'no_valid_quotes',rawCount:1,validCount:0,diagnostics,checkedAt:now.toISOString()};
 const notice=preflightFailureNotice(merchant,{status:result.status,result});
 assert.equal(notice.stage,'need_info');assert.match(notice.publicReply,/仅确认样例的实际在售状态/);
 assert.doesNotMatch(notice.publicReply,/1–2|建站系统|质保|时长/);
 const page=preflightFailureNotice(merchant,{status:'waiting_adapter',result:{status:'waiting_adapter',reasonCode:'page_requires_rendering',checkedAt:now.toISOString()}});
 assert.equal(page.stage,'collection_failed');assert.match(page.publicReply,/由站方核对页面适配方式/);assert.doesNotMatch(page.publicReply,/请回复：|请提供|重新授权/);
});
