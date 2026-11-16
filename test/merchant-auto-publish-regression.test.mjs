import {verifyApplicationPhone} from './helpers/merchant-phone.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication,approvedMerchantBadges,getMerchantApplication,reviewMerchantApplication,reconcileUnansweredMerchantApplications} from '../lib/merchant-onboarding.mjs';
import {queueAutomaticPreflight,reconcileAutomaticPreflights,latestMerchantPreflight} from '../lib/merchant-preflight-store.mjs';
import {recordMerchantReply} from '../lib/merchant-replies.mjs';
import {readApprovedManifest,probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {listMerchantReviewQueue} from '../lib/merchant-review-queue.mjs';
import {normalizeCollectionAccess} from '../lib/merchant-collection-access.mjs';
import {collectHostedPublicCatalog} from '../collectors/direct/hosted-public-catalog.mjs';
const shop='https://gptibo.com/r/U1CQ32',page='https://cocos666a.github.io/tibo-price/';
const html='<a href="'+shop+'">原店</a><table><tr><th>商品名称和规格</th><th>价格（CNY）</th><th>在售状态</th><th>原店购买链接</th></tr><tr><td>ChatGPT Plus 1个月</td><td>¥129 / 月</td><td>在售</td><td><a href="'+shop+'/product/chatgpt">购买</a></td></tr></table>';
function f(t){const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'merchant-auto-'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});const now=new Date('2026-10-12T00:00:00.000Z'),options={bridgeDir:dir,resultsDir:dir,now};const {id}=createMerchantApplication(db,{shopName:'测试店',shopUrl:shop,productAreas:['chatgpt'],email:'owner@example.org',contact:'owner',consent:true},options);verifyApplicationPhone(db,id);return {db,dir,id,options};}
function ready(f,r,extra={}){writeFileSync(path.join(f.dir,r.id+'.json'),JSON.stringify({schemaVersion:1,id:r.id,applicationId:f.id,applicationVersion:r.applicationVersion,identity:r.identity,startedAt:r.requestedAt,checkedAt:r.requestedAt,status:'ready',rawCount:1,validCount:1,samples:[{title:'ChatGPT Plus 1个月',price:129,currency:'CNY',url:shop+'/product/chatgpt'}],message:'测试完成',...(r.collectionAccess?{collectionAccess:r.collectionAccess}:{}),...extra}));}
test('SMS verified valid goods auto approve without a reply and collect without claiming identity verification',t=>{const x=f(t),r=queueAutomaticPreflight(x.db,x.id,x.options);ready(x,r);reconcileAutomaticPreflights(x.db,x.options);const a=getMerchantApplication(x.db,x.id);assert.equal(a.status,'approved');assert.equal(a.identityVerifiedAt,null);assert.equal(a.actions.at(-1).actor,'system:valid-products-auto-publish');const m=readApprovedManifest(x.dir);assert.equal(m.valid,true);assert.equal(m.merchants.length,1);reconcileAutomaticPreflights(x.db,x.options);assert.equal(getMerchantApplication(x.db,x.id).actions.length,1);});
test('failed parsing moves only the queue view into adapting, retaining the application',t=>{const x=f(t),r=queueAutomaticPreflight(x.db,x.id,x.options);ready(x,r,{status:'no_valid_offers',validCount:0,samples:[],reasonCode:'no_valid_quotes'});const q=listMerchantReviewQueue(x.db,x.options);assert.equal(q.counts.pending,0);assert.equal(q.counts.adapting,1);assert.equal(getMerchantApplication(x.db,x.id).status,'pending');assert.equal(listMerchantReviewQueue(x.db,{...x.options,status:'adapting'}).items[0].id,x.id);});
test('four audited accepted legacy reminders stage; trusted later reply restores only an automatic pause',t=>{const x=f(t);for(let i=0;i<4;i++)reviewMerchantApplication(x.db,x.id,{action:'reply',expectedVersion:1,actor:'codex:manual-reminder',note:'补资料提醒',publicReply:'补资料提醒 '+i},{...x.options,now:new Date(+x.options.now+i*1000)});x.db.exec("UPDATE merchant_mail_outbox SET status='accepted',attempts=1,accepted_at=created_at WHERE stage='reply'");reconcileUnansweredMerchantApplications(x.db,{...x.options,now:new Date(+x.options.now+10000)});assert.equal(getMerchantApplication(x.db,x.id).status,'paused');const input={applicationId:x.id,messageId:'newverified',threadId:'thread',sender:'owner@example.org',authentication:'gmail-aligned',expectedVersion:2,receivedAt:new Date(+x.options.now+20000).toISOString(),summary:'新的有效商品资料',publicUrls:[page]};assert.throws(()=>recordMerchantReply(x.db,{...input,sender:'other@example.org'},{now:new Date(+x.options.now+20000)}));const r=recordMerchantReply(x.db,input,{now:new Date(+x.options.now+20000)});assert.equal(r.reply.applicationVersion,3);assert.equal(getMerchantApplication(x.db,x.id).status,'pending');assert.deepEqual(reconcileUnansweredMerchantApplications(x.db,{...x.options,now:new Date(+x.options.now+30000)}),[]);reviewMerchantApplication(x.db,x.id,{action:'pause',actor:'admin',expectedVersion:3},x.options);assert.throws(()=>recordMerchantReply(x.db,{...input,messageId:'manualpause',expectedVersion:4},{now:new Date(+x.options.now+30000)}));});
test('hosted catalog binds exact verified page, shop, buy links, rate, and preflight result',async t=>{const x=f(t),reply=recordMerchantReply(x.db,{applicationId:x.id,messageId:'hostedreply',threadId:'hostedthread',sender:'owner@example.org',authentication:'gmail-aligned',expectedVersion:1,receivedAt:x.options.now.toISOString(),summary:'公开价目页允许持续读取，每三秒一次',publicUrls:[page]},x.options).reply;const access={mode:'hosted_catalog',replyId:reply.id,publicUrls:[page],minimumIntervalMs:3000,permissionScope:'ongoing'};assert.deepEqual(normalizeCollectionAccess(access,{shopUrl:shop}),access);for(const patch of [{publicUrls:[page+'other']},{minimumIntervalMs:1100}])assert.throws(()=>normalizeCollectionAccess({...access,...patch},{shopUrl:shop}));assert.throws(()=>normalizeCollectionAccess(access,{shopUrl:'https://other-shop.org/'}));const opts={capturedAt:x.options.now.toISOString(),fetchImpl:async()=>new Response(html,{headers:{'content-type':'text/html'}})};const offers=await collectHostedPublicCatalog({id:'fixture',name:'测试'},shop,access,opts);assert.equal(offers[0].price,129);for(const bad of [html.replace('href="'+shop+'"','href="https://other.org/"'),html.replace(shop+'/product/chatgpt','https://other.org/product/1')])await assert.rejects(()=>collectHostedPublicCatalog({id:'fixture',name:'测试'},shop,access,{...opts,fetchImpl:async()=>new Response(bad)}));const r=queueAutomaticPreflight(x.db,x.id,{...x.options,collectionAccess:access});ready(x,r);assert.equal(latestMerchantPreflight(x.db,x.id,x.options).canApprove,true);reconcileAutomaticPreflights(x.db,x.options);assert.equal(getMerchantApplication(x.db,x.id).status,'approved');assert.deepEqual(readApprovedManifest(x.dir).merchants[0].collectionAccess,access);const requests=[];await assert.rejects(()=>probeMerchantCatalog(readApprovedManifest(x.dir).merchants[0],{dataDir:x.dir,merchantFetchFactory:origin=>{assert.equal(origin,'https://cocos666a.github.io');return async url=>{requests.push(url);return new Response('User-agent: *\nDisallow: /');};}},x.options.now.toISOString(),Date.now()+30000));assert.deepEqual(requests,['https://cocos666a.github.io/robots.txt']);});
test('an expired successful sample can renew after three checks; failed or empty results are not blindly retried',t=>{const x=f(t);for(let i=0;i<3;i++){const o={...x.options,now:new Date(+x.options.now+i*61000),force:true},r=queueAutomaticPreflight(x.db,x.id,o);ready(x,r);}const later={...x.options,now:new Date(+x.options.now+25*3600000)};const r=queueAutomaticPreflight(x.db,x.id,later);assert.equal(r.status,'pending');assert.equal(x.db.prepare('SELECT COUNT(*) n FROM merchant_preflight_requests').get().n,4);});

test('approval requires current account and saved phone even when submission verification is paused or unset',t=>{
 const x=f(t),r=queueAutomaticPreflight(x.db,x.id,x.options);ready(x,r);
 const original=process.env.AIRADAR_MERCHANT_PHONE_VERIFICATION;
 t.after(()=>{if(original===undefined)delete process.env.AIRADAR_MERCHANT_PHONE_VERIFICATION;else process.env.AIRADAR_MERCHANT_PHONE_VERIFICATION=original;});
 const review=()=>reviewMerchantApplication(x.db,x.id,{action:'approve',expectedVersion:1},x.options);
 for(const mode of ['paused',undefined]){
  if(mode===undefined)delete process.env.AIRADAR_MERCHANT_PHONE_VERIFICATION;else process.env.AIRADAR_MERCHANT_PHONE_VERIFICATION=mode;
  for(const mutation of [
   "DELETE FROM reader_phone_verifications",
   "UPDATE reader_phone_verifications SET phone='10000000000'",
   "UPDATE merchant_applications SET applicant_account_id='different-account'",
   "UPDATE merchant_applications SET phone='10000000000'",
   "UPDATE reader_profiles SET phone='10000000000'"
  ]){
   verifyApplicationPhone(x.db,x.id);x.db.exec(mutation);
   reconcileAutomaticPreflights(x.db,x.options);
   assert.equal(getMerchantApplication(x.db,x.id).status,'pending');
   assert.throws(review,/先完成.*短信验证/);
   assert.equal(getMerchantApplication(x.db,x.id).actions.length,0);
  }
 }
 verifyApplicationPhone(x.db,x.id);review();assert.equal(getMerchantApplication(x.db,x.id).status,'approved');
});

test('public badge data follows current SMS proof while legacy approval remains listed',t=>{
 const x=f(t),r=queueAutomaticPreflight(x.db,x.id,x.options);ready(x,r);reconcileAutomaticPreflights(x.db,x.options);
 assert.ok(approvedMerchantBadges(x.db)[0].phoneVerifiedAt);
 x.db.exec("UPDATE reader_profiles SET phone='10000000000'");
 reconcileAutomaticPreflights(x.db,x.options);
 const badge=approvedMerchantBadges(x.db)[0];
 assert.equal(badge.phoneVerifiedAt,null);assert.ok(badge.approvedAt);
 assert.equal(getMerchantApplication(x.db,x.id).status,'approved');
 assert.equal(readApprovedManifest(x.dir).merchants.length,1);
});
