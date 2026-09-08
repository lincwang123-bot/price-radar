import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { initSupplyIntakeSchema, importSupplyIntakes, getSupplyIntake, listSupplyIntakes, reviewSupplyIntake } from '../lib/merchant-intake.mjs';
import { createMerchantApplication, getMerchantApplication, reviewMerchantApplication, convertSupplySubmission } from '../lib/merchant-onboarding.mjs';
import { listMerchantReviewQueue } from '../lib/merchant-review-queue.mjs';
import { queueAutomaticPreflight, reconcileAutomaticPreflights, latestMerchantPreflight, syncPreflightManifest } from '../lib/merchant-preflight-store.mjs';
import { queueMerchantMail } from '../lib/merchant-mail.mjs';
import { createAdmin, hashAdminPassword } from '../lib/admin.mjs';
import { recordMerchantReply } from '../lib/merchant-replies.mjs';

const stamp='2026-09-09T00:00:00.000Z';
const payload=n=>({shopName:'正式申请'+n,shopUrl:`https://queue-merchant-${n}.com/`,productAreas:['chatgpt'],email:'owner@example.org',contact:'fixture-contact',consent:true});
function fixture(t) {
  const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(os.tmpdir(),'merchant-queue-test-'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  return {db,options:{bridgeDir:dir,resultsDir:dir,now:new Date(stamp)}};
}
function supply(db,n,{createdAt=stamp,importAt=stamp}={}) {
  const id=`CO-20260909-QUEUE${n}`;
  db.prepare(`INSERT INTO cooperation_submissions(public_id,created_at,topic,subject,product_area,scale,assurance,settlement,source_url,details,contact,consent_at,content_hash)
    VALUES(?,?,'supply',?,'chatgpt','trial','full_warranty','cny',?,'保留原始资料','owner@example.org',?,'fixture')`).run(id,createdAt,'供应投稿'+n,`https://queue-supply-${n}.com/`,createdAt);
  importSupplyIntakes(db,[id],{now:new Date(importAt)});return id;
}
test('legacy intake migration preserves data, defaults pending and is repeatable',t=>{
  const {db}=fixture(t);
  db.exec('CREATE TABLE merchant_supply_intake(source_submission_id TEXT PRIMARY KEY,created_at TEXT NOT NULL,actor TEXT NOT NULL,email TEXT)');
  db.prepare('INSERT INTO merchant_supply_intake VALUES(?,?,?,?)').run('CO-LEGACY',stamp,'old-admin','owner@example.org');
  initSupplyIntakeSchema(db);initSupplyIntakeSchema(db);
  assert.deepEqual({...db.prepare('SELECT status,version,created_at,email FROM merchant_supply_intake').get()},{status:'pending',version:1,created_at:stamp,email:'owner@example.org'});
});
test('reject, defer and restore are durable, versioned, audited and never send new mail',t=>{
  const {db,options}=fixture(t),id=supply(db,1);
  const before={...db.prepare('SELECT * FROM cooperation_submissions WHERE public_id=?').get(id)};
  const mailCount=db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n;
  const review=(action,expectedVersion,note='不在收录范围')=>reviewSupplyIntake(db,id,{action,expectedVersion,note,actor:'owner'},options);
  assert.throws(()=>review('approve',1),{status:422});
  assert.throws(()=>review('reject',99),{status:409});
  assert.throws(()=>review('reject',1,'x'.repeat(1501)),{status:422});
  assert.equal(review('reject',1).status,'rejected');
  assert.equal(listSupplyIntakes(db).length,0);
  assert.equal(listSupplyIntakes(db,{status:'rejected'})[0].id,id);
  assert.equal(importSupplyIntakes(db,[id]).imported,0);
  assert.equal(getSupplyIntake(db,id).status,'rejected');
  assert.throws(()=>review('pause',2),{status:422});
  assert.throws(()=>convertSupplySubmission(db,id,{}),{status:409});
  assert.equal(review('restore',2).status,'pending');
  assert.equal(review('pause',3).status,'paused');
  assert.equal(review('restore',4).version,5);
  assert.deepEqual(getSupplyIntake(db,id).actions.map(row=>row.action),['reject','restore','pause','restore']);
  assert.throws(()=>db.exec("UPDATE merchant_intake_actions SET note='tamper'"),/append-only/);
  assert.throws(()=>db.exec('DELETE FROM merchant_intake_actions'),/append-only/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n,mailCount);
  assert.deepEqual({...db.prepare('SELECT * FROM cooperation_submissions WHERE public_id=?').get(id)},before);
});
test('both sources share counts, chronological sorting and pagination, excluding converted intakes',t=>{
  const {db,options}=fixture(t),ids=[];
  for(let i=0;i<32;i++)ids.push(supply(db,i,{createdAt:new Date(+options.now+i*1000).toISOString(),importAt:'2026-09-10T00:00:00Z'}));
  const fresh=createMerchantApplication(db,payload('new'),{now:new Date(+options.now+90000)});
  let queue=listMerchantReviewQueue(db);
  assert.equal(queue.total,33);assert.equal(queue.items.length,30);assert.equal(queue.items[0].id,fresh.id);
  assert.equal(listMerchantReviewQueue(db,{page:2}).items.length,3);
  assert.equal(new Set([...queue.items,...listMerchantReviewQueue(db,{page:2}).items].map(app=>app.id)).size,33);
  reviewSupplyIntake(db,ids[0],{action:'reject',expectedVersion:1},options);
  reviewMerchantApplication(db,fresh.id,{action:'pause',expectedVersion:1,queueAction:true},options);
  const converted=convertSupplySubmission(db,ids[1],{...payload('converted'),ownershipConfirmed:true,permissionConfirmed:true,note:'已核实店铺归属与采集授权'},options);
  queue=listMerchantReviewQueue(db);
  assert.equal(queue.total,31);assert.equal(queue.counts.rejected,1);assert.equal(queue.counts.paused,1);
  assert.equal(listMerchantReviewQueue(db,{status:'paused'}).items[0].id,fresh.id);
  assert.ok([...queue.items,...listMerchantReviewQueue(db,{page:2}).items].some(app=>app.id===converted.id));
  assert.ok(![...queue.items,...listMerchantReviewQueue(db,{page:2}).items].some(app=>app.id===ids[1]));
  assert.throws(()=>reviewSupplyIntake(db,ids[1],{action:'reject',expectedVersion:1},options),{status:409});
  assert.equal(listMerchantReviewQueue(db,{page:999}).page,2);
  assert.throws(()=>listMerchantReviewQueue(db,{status:'malicious'}),{status:422});
});
test('processed intakes stop preflight work and stale result emails; restore needs a new test version',t=>{
  const {db,options}=fixture(t),id=supply(db,1),request=queueAutomaticPreflight(db,id,options);
  queueMerchantMail(db,{id,email:'owner@example.org',stage:'need_info',eventKey:'old-result',now:options.now});
  assert.equal(JSON.parse(readFileSync(path.join(options.bridgeDir,'preflight-requests.json'))).requests.length,1);
  reviewSupplyIntake(db,id,{action:'pause',expectedVersion:1},options);
  assert.equal(syncPreflightManifest(db,options).requests.length,0);
  assert.equal(queueAutomaticPreflight(db,id,{...options,force:true}),null);
  assert.equal(db.prepare("SELECT status FROM merchant_mail_outbox WHERE stage='need_info'").get().status,'superseded');
  reconcileAutomaticPreflights(db,options);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_preflight_requests').get().n,1);
  writeFileSync(path.join(options.resultsDir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:id,applicationVersion:1,identity:request.identity,startedAt:stamp,checkedAt:stamp,status:'ready',rawCount:1,validCount:1,message:'sample',samples:[{title:'ChatGPT 月卡',currency:'CNY',price:100,url:'https://queue-supply-1.com/item/1'}]}));
  reviewSupplyIntake(db,id,{action:'restore',expectedVersion:2},options);
  assert.equal(latestMerchantPreflight(db,id,options).status,'expired');
  const next=queueAutomaticPreflight(db,id,{...options,now:new Date(+options.now+60001)});
  assert.equal(next.applicationVersion,3);assert.notEqual(next.id,request.id);
});
test('formal application restore cannot bypass approval and leaves mail history intact',t=>{
  const {db,options}=fixture(t),{id}=createMerchantApplication(db,payload(1),options);
  const count=()=>db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n,before=count();
  assert.throws(()=>reviewMerchantApplication(db,id,{action:'restore',expectedVersion:1},options),{status:422});
  reviewMerchantApplication(db,id,{action:'reject',expectedVersion:1,queueAction:true,note:'暂不收录'},options);
  const restored=reviewMerchantApplication(db,id,{action:'restore',expectedVersion:2,queueAction:true},options);
  assert.equal(restored.status,'pending');assert.equal(restored.approvedAt,null);
  assert.equal(restored.actions.at(-1).action,'restore');assert.equal(count(),before);
  assert.deepEqual(JSON.parse(readFileSync(path.join(options.bridgeDir,'approved.json'))).merchants,[]);
});
test('fresh checks after restore and supply conversion remain approvable with older reply history',t=>{
  const {db,options}=fixture(t),{id}=createMerchantApplication(db,payload(1),options);
  const reply=(applicationId,expectedVersion,messageId,now)=>recordMerchantReply(db,{applicationId,expectedVersion,messageId,threadId:messageId,sender:'owner@example.org',authentication:'gmail-aligned',receivedAt:now.toISOString(),summary:'已补充商品资料',publicUrls:[]},{now});
  reply(id,1,'formalreply',new Date(+options.now+1000));
  reviewMerchantApplication(db,id,{action:'pause',expectedVersion:1,queueAction:true},options);
  reviewMerchantApplication(db,id,{action:'restore',expectedVersion:2,queueAction:true},options);
  const source=supply(db,1);
  reviewSupplyIntake(db,source,{action:'pause',expectedVersion:1},options);
  reviewSupplyIntake(db,source,{action:'restore',expectedVersion:2},options);
  reply(source,3,'supplyreply',new Date(+options.now+1000));
  const converted=convertSupplySubmission(db,source,{...payload(2),ownershipConfirmed:true,permissionConfirmed:true,note:'已核实店铺归属与采集授权'},options);
  const later={...options,now:new Date(+options.now+120000)};
  for(const appId of [id,converted.id]) {
    const request=queueAutomaticPreflight(db,appId,later),app=getMerchantApplication(db,appId);
    writeFileSync(path.join(options.resultsDir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:appId,applicationVersion:app.version,identity:app.identity,startedAt:request.requestedAt,checkedAt:request.requestedAt,status:'ready',rawCount:1,validCount:1,message:'sample',samples:[{title:'ChatGPT 月卡',currency:'CNY',price:100,url:app.shopUrl+'item/1'}]}));
    assert.equal(latestMerchantPreflight(db,appId,later).canApprove,true);
  }
});
test('admin queue actions enforce session, origin, CSRF and version, update filters and preserve notes',async t=>{
  const {db,options}=fixture(t),id=supply(db,1),ma=createMerchantApplication(db,payload(1),options);
  const origin='https://airadar.test',password='queue-admin-fixture-password';
  const admin=createAdmin({submissionsDb:db,merchantBridgeDir:options.bridgeDir,merchantPreflightResultsDir:options.resultsDir,origin,username:'owner',passwordHash:await hashAdminPassword(password)});
  const server=createServer(async(req,res)=>{try{await admin(req,res,new URL(req.url,origin));}catch(error){res.statusCode=500;res.end(error.message);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`,target='/admin/merchants/'+id;
    const request=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
    const post=(url,fields,cookie='',headers={})=>request(url,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie,...headers},body:new URLSearchParams(fields)});
    assert.equal((await post(target,{action:'reject',queueAction:'true'})).headers.get('location'),'/admin/login');
    const login=await request('/admin/login'),loginHtml=await login.text();
    const signed=await post('/admin/login',{username:'owner',password,csrf:/name="csrf" value="([^"]+)"/.exec(loginHtml)[1]},login.headers.getSetCookie()[0].split(';')[0]);
    const cookie=signed.headers.getSetCookie()[0].split(';')[0],get=url=>request(url,{headers:{cookie}});
    const initial=await (await get('/admin/merchants')).text(),csrf=/name="csrf" value="([^"]+)"/.exec(initial)[1];
    assert.match(initial,/待审核 · 2/);assert.match(initial,/填写意见 · 拒绝 \/ 暂存/);
    const fields={action:'reject',queueAction:'true',version:'1',csrf,note:'<script>不在收录范围</script>',returnStatus:'pending',returnPage:'1'};
    for(const [change,headers,status] of [[{csrf:'forged'},{},403],[{},{origin:'https://evil.test'},403],[{version:'2'},{},409],[{action:'approve'},{},422]])assert.equal((await post(target,{...fields,...change},cookie,headers)).status,status);
    const mailCount=db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n;
    const rejected=await post(target,fields,cookie);
    assert.equal(rejected.status,303);assert.equal(rejected.headers.get('location'),'/admin/merchants?status=pending&page=1');
    const pending=await (await get('/admin/merchants')).text();assert.match(pending,/待审核 · 1/);assert.doesNotMatch(pending,new RegExp('data-application-id="'+id+'"'));
    const archived=await (await get('/admin/merchants?status=rejected')).text();assert.match(archived,/已拒绝 · 1/);assert.match(archived,/&lt;script&gt;不在收录范围/);assert.doesNotMatch(archived,/<script>不在收录范围/);
    const detail=await (await get(target)).text();assert.match(detail,/处理记录/);assert.match(detail,/自动检测已停止/);assert.doesNotMatch(detail,/核对资料并转为正式申请/);
    assert.equal((await post(target,{...fields,action:'restore',version:'2',returnStatus:'rejected'},cookie)).status,303);
    assert.equal(getSupplyIntake(db,id).status,'pending');
    const maPath='/admin/merchants/'+ma.id;
    assert.equal((await post(maPath,{...fields,action:'pause'},cookie)).status,303);
    assert.equal(getMerchantApplication(db,ma.id).status,'paused');
    assert.match(await (await get('/admin/merchants?status=paused')).text(),new RegExp(ma.id));
    assert.equal((await post(maPath,{...fields,action:'restore',version:'2'},cookie)).status,303);
    assert.equal(getMerchantApplication(db,ma.id).status,'pending');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n,mailCount);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
