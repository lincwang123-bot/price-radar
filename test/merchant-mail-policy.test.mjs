import test from 'node:test';
import assert from 'node:assert/strict';
import {openSubmissionsDb,createSubmission} from '../lib/submissions.mjs';
import {createMerchantApplication,reviewMerchantApplication,updateMerchantEmail,convertSupplySubmission} from '../lib/merchant-onboarding.mjs';
import {importSupplyIntakes} from '../lib/merchant-intake.mjs';
import {queueMerchantMail,drainMerchantMail} from '../lib/merchant-mail.mjs';
import {reconcileMerchantMailPolicy} from '../lib/merchant-mail-policy.mjs';
import {mailPanel,mailSummary} from '../lib/merchant-workflow-ui.mjs';

const now=new Date('2026-09-07T12:00:00Z');
const payload={shopName:'邮件规则测试',shopUrl:'https://two-mail-shop.com/',productAreas:['chatgpt'],contact:'owner-contact',email:'owner@example.org',consent:true};
function fixture(t){
 const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
 const {id}=createMerchantApplication(db,payload,{now});
 const messages=[];
 const drain=(transport={sendMail:async m=>{messages.push(m);return {accepted:[m.to]};}})=>drainMerchantMail(db,{transport,from:'notice@airadar.vip',now,env:{}});
 const queue=(stage,key=stage)=>queueMerchantMail(db,{id,email:payload.email,stage,eventKey:id+':'+key,now});
 const approve=(version=1)=>reviewMerchantApplication(db,id,{action:'approve',expectedVersion:version,ownershipConfirmed:true,permissionConfirmed:true},{now,bridgeDir:null});
 return {db,id,messages,drain,queue,approve};
}
test('successful application sends only receipt and approval, never progress or publication',async t=>{
 const f=fixture(t);await f.drain();
 for(const stage of ['testing','ready','test_delayed']){assert.equal(f.queue(stage),false);await f.drain();}
 f.approve();await f.drain();f.queue('published');await f.drain();
 assert.equal(f.messages.length,2);
 assert.match(f.messages[0].subject,/申请已收到/);assert.match(f.messages[1].subject,/审核已通过/);
 assert.doesNotMatch(f.messages[1].text,/再发一封/);
});
test('failure is the one result slot across retests, email edits and later approval',async t=>{
 const f=fixture(t);await f.drain();f.queue('need_info','failure-1');await f.drain();
 f.queue('need_info','failure-2');
 updateMerchantEmail(f.db,f.id,'corrected@example.org',{expectedVersion:1,confirmed:true,now});
 f.approve();f.queue('published');await f.drain();
 assert.equal(f.messages.length,2);
 assert.equal(f.db.prepare('SELECT status FROM merchant_applications WHERE public_id=?').get(f.id).status,'approved');
});
test('an unsent failure is replaced by approval, but an explicit human reply is not automatic',async t=>{
 const f=fixture(t);f.queue('need_info');f.approve();
 await f.drain();assert.equal(f.messages.length,2);assert.match(f.messages[1].subject,/审核已通过/);
 queueMerchantMail(f.db,{id:f.id,email:payload.email,stage:'reply',eventKey:f.id+':manual',publicReply:'站长主动回复，非自动通知。',now});
 await f.drain();assert.equal(f.messages.length,3);assert.match(f.messages[2].text,/站长主动回复/);
});
test('supply submission, intake and converted application share the same two-mail budget',async t=>{
 const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
 const {id}=createSubmission(db,{kind:'cooperation',topic:'supply',subject:'供应测试店铺',metadata:{productArea:'chatgpt',scale:'trial',assurance:'full_warranty',settlement:'cny'},contextUrl:payload.shopUrl,details:'这是测试使用的真实公开目录说明',contact:payload.contact,email:payload.email,consent:true},{now});
 const messages=[],options={now,env:{},from:'notice@airadar.vip',transport:{sendMail:async m=>{messages.push(m);return {accepted:[m.to]};}}};
 await drainMerchantMail(db,options);importSupplyIntakes(db,[id],{now});await drainMerchantMail(db,options);
 queueMerchantMail(db,{id,email:payload.email,stage:'need_info',eventKey:id+':failure',now});await drainMerchantMail(db,options);
 const app=convertSupplySubmission(db,id,{...payload,ownershipConfirmed:true,permissionConfirmed:true,note:'测试确认公开目录授权'},{now});
 reviewMerchantApplication(db,app.id,{action:'approve',expectedVersion:1,ownershipConfirmed:true,permissionConfirmed:true},{now,bridgeDir:null});
 await drainMerchantMail(db,options);
 assert.equal(messages.length,2);
});
test('legacy unsent stages are cancelled without modifying accepted or ambiguous deliveries',async t=>{
 const f=fixture(t);await f.drain();
 const add=(stage,status,attempts,key)=>f.db.prepare('INSERT INTO merchant_mail_outbox(event_key,application_id,recipient,stage,created_at,next_attempt_at,status,attempts) VALUES(?,?,?,?,?,?,?,?)').run(f.id+':'+key,f.id,payload.email,stage,now.toISOString(),now.toISOString(),status,attempts);
 add('ready','accepted',1,'old-ready');
 add('testing','retry',1,'old-testing');add('published','queued',0,'old-published');add('need_info','queued',0,'old-failure');
 add('approved','uncertain',1,'old-ambiguous');
 const accepted=f.db.prepare("SELECT * FROM merchant_mail_outbox WHERE status IN ('accepted','uncertain')").all();
 assert.ok(reconcileMerchantMailPolicy(f.db).suppressed>=3);assert.equal(reconcileMerchantMailPolicy(f.db).suppressed,0);
 assert.deepEqual(f.db.prepare("SELECT * FROM merchant_mail_outbox WHERE status IN ('accepted','uncertain')").all(),accepted);
 await f.drain();assert.equal(f.messages.length,1);
});
test('drainer enforces the policy even against legacy rows inserted outside the queue helper',async t=>{
 const f=fixture(t);await f.drain();f.approve();await f.drain();
 f.db.prepare("INSERT INTO merchant_mail_outbox(event_key,application_id,recipient,stage,created_at,next_attempt_at) VALUES(?,?,?,'approved',?,?)").run(f.id+':legacy-approved',f.id,payload.email,now.toISOString(),now.toISOString());
 await f.drain();assert.equal(f.messages.length,2);
});
test('uncertain result reserves the second slot; safe connection retries keep the same message identity',async t=>{
 const a=fixture(t);await a.drain();a.queue('need_info');
 await a.drain({sendMail:async()=>{throw Object.assign(new Error('hidden'),{code:'ECONNECTION',command:'DATA'});}});
 a.approve();await a.drain();assert.equal(a.messages.length,1);
 const b=fixture(t);await b.drain();b.queue('need_info');const keys=[];
 await b.drain({sendMail:async m=>{keys.push(m.messageId);throw Object.assign(new Error('hidden'),{code:'ECONNECTION',command:'CONN'});}});
 await drainMerchantMail(b.db,{from:'notice@airadar.vip',env:{},now:new Date(+now+120000),transport:{sendMail:async m=>{keys.push(m.messageId);return {accepted:[m.to]};}}});
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});
test('rejecting or pausing before an unsent approval cancels stale approval without another automatic email',async t=>{
 const f=fixture(t);f.approve();
 reviewMerchantApplication(f.db,f.id,{action:'pause',expectedVersion:2},{now,bridgeDir:null});
 await f.drain();assert.equal(f.messages.length,1);assert.match(f.messages[0].subject,/收到/);
});
test('concurrent drains reserve the same lifetime budget while SMTP is in flight',async t=>{
 const f=fixture(t);let release,started;const gate=new Promise(resolve=>{release=resolve;}),sending=new Promise(resolve=>{started=resolve;});
 const first=f.drain({sendMail:async m=>{f.messages.push(m);started();await gate;return {accepted:[m.to]};}});
 await sending;f.queue('need_info');await f.drain();f.approve();await f.drain();release();await first;
 assert.equal(f.messages.length,2);
});
test('admin policy copy distinguishes cancelled notices from provider acceptance and labels manual replies',()=>{
 assert.match(mailSummary({items:[{status:'superseded',errorCode:'mail_policy_limit'}]}),/未发送/);
 assert.match(mailSummary({items:[{status:'accepted'}]}),/发送服务已接受/);
 const html=mailPanel({...payload,id:'MA-TEST',version:1},{items:[]},'csrf',{configured:true});
 assert.match(html,/最多两封自动邮件/);assert.match(html,/重测、改邮箱或后续批准不会再追加/);
});
