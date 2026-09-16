import test from 'node:test';
import assert from 'node:assert/strict';
import {openSubmissionsDb,createSubmission} from '../lib/submissions.mjs';
import {createMerchantApplication,getMerchantApplication,reviewMerchantApplication,convertSupplySubmission} from '../lib/merchant-onboarding.mjs';
import {importSupplyIntakes} from '../lib/merchant-intake.mjs';
import {recordMerchantReply,listMerchantReplies,queueReplyClarification} from '../lib/merchant-replies.mjs';
import {queueMerchantMail,drainMerchantMail,merchantMailStatus} from '../lib/merchant-mail.mjs';
import {queuePreflightResultMail} from '../lib/merchant-preflight-mail.mjs';
import {mailPanel} from '../lib/merchant-workflow-ui.mjs';
const start=new Date('2026-09-08T04:00:00Z');
function fixture(t){
 const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
 const {id}=createMerchantApplication(db,{shopName:'回复测试',shopUrl:'https://reply-shop.com/',productAreas:['chatgpt'],contact:'owner',email:'owner@example.org',consent:true},{now:start});
 let tick=0;const messages=[],now=()=>new Date(+start+(++tick)*60000);
 const drain=()=>drainMerchantMail(db,{now:now(),from:'notice@airadar.vip',env:{},transport:{sendMail:async m=>{messages.push(m);return {accepted:[m.to]};}}});
 const reply=(messageId='abc123',change={})=>recordMerchantReply(db,{applicationId:id,messageId,threadId:'thread123',sender:'owner@example.org',authentication:'gmail-aligned',expectedVersion:1,receivedAt:new Date(+start+1000).toISOString(),summary:'已补充公开商品目录链接',publicUrls:['https://reply-shop.com/products'],...change},{now:now()});
 const result=(r,code='not_found')=>{const at=now();return queuePreflightResultMail(db,getMerchantApplication(db,id),{id:'MT-NEW',applicationVersion:1,requestedAt:r?.reply.createdAt||start.toISOString(),fresh:true,status:'waiting_adapter',result:{status:'waiting_adapter',reasonCode:code,checkedAt:at.toISOString()}},{now:at});};
 return {db,id,messages,now,drain,reply,result};
}
test('two normal notices plus one outcome per new verified reply, not per retest',async t=>{
 const f=fixture(t);await f.drain();f.result();await f.drain();assert.equal(f.messages.length,2);
 const r=f.reply();assert.equal(r.created,true);assert.equal(f.messages.length,2);
 f.result(r);await f.drain();assert.equal(f.messages.length,3);
 f.result(r,'invalid_catalog');await f.drain();assert.equal(f.messages.length,3);
 assert.equal(f.reply().created,false);
 assert.equal(f.reply('abc124').created,false); // Same materials, another message.
 const r2=f.reply('abc125',{summary:'商品已修复，现在可以读取价格',publicUrls:['https://reply-shop.com/products/plus']});
 f.result(r2);await f.drain();assert.equal(f.messages.length,4);
 assert.equal(listMerchantReplies(f.db,f.id).length,2);
 assert.equal(getMerchantApplication(f.db,f.id).status,'pending');
});
test('new reply does not turn a stale preflight into a new notification',async t=>{
 const f=fixture(t);await f.drain();f.result();await f.drain();f.reply();
 assert.equal(f.result(),false);await f.drain();assert.equal(f.messages.length,2);
});
test('reply round waits silently on success, then approval supplies its result',async t=>{
 const f=fixture(t);await f.drain();f.result();await f.drain();const r=f.reply();
 queuePreflightResultMail(f.db,getMerchantApplication(f.db,f.id),{fresh:true,status:'ready',requestedAt:r.reply.createdAt,applicationVersion:1,result:{status:'ready'}},{now:f.now()});
 await f.drain();assert.equal(f.messages.length,2);
 reviewMerchantApplication(f.db,f.id,{action:'approve',expectedVersion:1,ownershipConfirmed:true,permissionConfirmed:true},{now:f.now(),bridgeDir:null});
 await f.drain();assert.equal(f.messages.length,3);assert.match(f.messages[2].subject,/审核已通过/);
});
test('mismatched sender, unverified authentication, secrets and wrong version cannot create a round',t=>{
 const f=fixture(t);
 for(const change of [{sender:'other@example.org'},{authentication:'unverified'},{expectedVersion:2},{summary:'password=do-not-store'},{publicUrls:['https://reply-shop.com/?token=private']},{receivedAt:'2999-01-01T00:00:00Z'}])assert.throws(()=>f.reply('bad123',change));
 assert.equal(listMerchantReplies(f.db,f.id).length,0);
});
test('mail cannot borrow another application round and old queued results are retired',async t=>{
 const f=fixture(t);await f.drain();f.result();const r=f.reply();
 await f.drain();assert.equal(f.messages.length,1);
 assert.equal(queueMerchantMail(f.db,{id:f.id,email:'owner@example.org',stage:'need_info',replyRoundId:r.reply.id+999,eventKey:f.id+':forged',now:f.now()}),false);
 f.result(r);await f.drain();assert.equal(f.messages.length,2);
});
test('backend shows escaped reply materials and describes per-round notifications',t=>{
 const f=fixture(t);f.reply('safe123',{summary:'说明 <script>alert(1)</script>'});
 const html=mailPanel(getMerchantApplication(f.db,f.id),merchantMailStatus(f.db,f.id),'csrf',{configured:true});
 assert.match(html,/店主补充资料/);assert.match(html,/常规流程两封/);assert.match(html,/本轮/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);
});
test('a reply needing identity clarification gets one accurate email, without faking a test',async t=>{
 const f=fixture(t);await f.drain();f.result();await f.drain();const r=f.reply();
 assert.equal(queueReplyClarification(f.db,f.id,{replyId:r.reply.id,reason:'shop_relationship',now:f.now()}),true);
 assert.equal(queueReplyClarification(f.db,f.id,{replyId:r.reply.id,reason:'shop_relationship',now:f.now()}),false);
 await f.drain();assert.equal(f.messages.length,3);
 assert.match(f.messages[2].text,/暂时无法确认/);assert.match(f.messages[2].text,/不是.*店铺无法打开/);
 assert.throws(()=>queueReplyClarification(f.db,f.id,{replyId:r.reply.id,reason:'invented'}));
 assert.equal(getMerchantApplication(f.db,f.id).status,'pending');
});
test('supply conversion keeps reply-material deduplication across original and canonical IDs',t=>{
 const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
 const payload={shopName:'供应转换测试',shopUrl:'https://reply-converted-shop.com/',productAreas:['chatgpt'],contact:'owner',email:'owner@example.org',consent:true};
 const source=createSubmission(db,{kind:'cooperation',topic:'supply',subject:payload.shopName,metadata:{productArea:'chatgpt',scale:'trial',assurance:'full_warranty',settlement:'cny'},contextUrl:payload.shopUrl,details:'公开目录的供应测试资料',contact:payload.contact,email:payload.email,consent:true},{now:start});
 importSupplyIntakes(db,[source.id],{now:start});
 const data={applicationId:source.id,messageId:'beforeconvert',threadId:'conversion',sender:payload.email,authentication:'gmail-aligned',expectedVersion:1,receivedAt:new Date(+start+1000).toISOString(),summary:'公开目录已确认',publicUrls:[payload.shopUrl]};
 const reply=recordMerchantReply(db,data,{now:new Date(+start+2000)});
 const app=convertSupplySubmission(db,source.id,{...payload,ownershipConfirmed:true,permissionConfirmed:true,note:'确认公开读取和来源资料'},{now:new Date(+start+3000)});
 const duplicate=recordMerchantReply(db,{...data,applicationId:app.id,messageId:'afterconvert',receivedAt:new Date(+start+4000).toISOString()},{now:new Date(+start+5000)});
 assert.equal(duplicate.created,false);assert.equal(duplicate.reply.id,reply.reply.id);
});
