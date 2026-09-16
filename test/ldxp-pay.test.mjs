import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantIdentityForUrl,merchantIdentityForOffer} from '../lib/merchant-identity.mjs';
import {canonicalShopIdentity,createMerchantApplication,migratePendingPayShopIdentities} from '../lib/merchant-onboarding.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {offerChannel} from '../lib/channels.mjs';
import {merchantIdForUrl} from '../lib/offer-provenance.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {recordMerchantReply} from '../lib/merchant-replies.mjs';
import {initMerchantPreflightSchema,queueAutomaticPreflight,latestMerchantPreflight} from '../lib/merchant-preflight-store.mjs';

test('pay.ldxp is isolated by shop, never a domain-wide merchant or a wzyp alias',()=>{
  const url='https://pay.ldxp.cn/shop/one';
  assert.equal(canonicalShopIdentity(url),'shop:ldxp-pay:one');
  assert.equal(merchantIdentityForUrl(url),'shop:ldxp-pay:one');
  assert.notEqual(merchantIdentityForUrl(url),merchantIdentityForUrl('https://ldxp.cn/shop/one'));
  assert.notEqual(merchantIdentityForUrl(url),merchantIdentityForUrl('https://pay.ldxp.cn/shop/two'));
  for(const bad of ['https://pay.ldxp.cn/','https://pay.ldxp.cn/item/g1','https://pay.ldxp.cn/admin']) {
    assert.equal(merchantIdentityForUrl(bad),null);assert.throws(()=>canonicalShopIdentity(bad));
  }
  const offer={source:'direct-shops',url:'https://pay.ldxp.cn/item/g1',extra:{shopUrl:url}};
  assert.equal(merchantIdentityForOffer(offer),'shop:ldxp-pay:one');
  assert.equal(merchantIdentityForOffer({...offer,source:'ldxp-goods'}),null);
  assert.equal(merchantIdentityForOffer({...offer,extra:{shopUrl:'https://wzyp.cn/shop/one'}}),null);
  assert.equal(merchantIdForUrl(offer.url),null);
  assert.equal(offerChannel(offer).id,'ldxp');
});

test('pay preflight selects only the original same-origin public ShopApi and respects denial',async()=>{
  const row={id:'merchant-test',identity:'shop:ldxp-pay:one',shopName:'店一',shopUrl:'https://pay.ldxp.cn/shop/one'};
  const calls=[];
  const ctx={merchantFetchFactory:origin=>{assert.equal(origin,'https://pay.ldxp.cn');return async(url,init)=>{
    calls.push(url);assert.equal(JSON.parse(init.body).token,'one');
    return Response.json(url.includes('categoryList')?{code:1,data:[{id:1,name:'AI'}]}:{code:1,data:{list:[{goods_key:'g1',name:'ChatGPT Plus 月卡代充',price:120,stock:3}],total:1}});
  };}};
  const result=await probeMerchantCatalog(row,ctx,new Date().toISOString(),Date.now()+30000);
  assert.equal(result.offers.length,1);assert.equal(result.offers[0].price,120);
  assert.deepEqual(calls.map(u=>new URL(u).pathname),['/shopApi/Shop/categoryList','/shopApi/Shop/goodsList']);
  let deniedCalls=0;
  await assert.rejects(probeMerchantCatalog(row,{merchantFetchFactory:()=>async()=>{deniedCalls++;return new Response('denied',{status:403});}},new Date().toISOString(),Date.now()+30000));
  assert.equal(deniedCalls,1);
});

test('legacy pending pay identity repair is audited and idempotent, never approves or emails',t=>{
  const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
  const {id}=createMerchantApplication(db,{shopName:'店一',shopUrl:'https://pay.ldxp.cn/shop/one',productAreas:['chatgpt'],email:'one@example.org',contact:'one@example.org',consent:true});
  db.prepare("UPDATE merchant_applications SET identity='domain:pay.ldxp.cn',platform='independent' WHERE public_id=?").run(id);
  const before=db.prepare('SELECT * FROM merchant_mail_outbox').all();
  assert.deepEqual(migratePendingPayShopIdentities(db),[id]);
  const row=db.prepare('SELECT identity,platform,status,version,identity_verified_at FROM merchant_applications WHERE public_id=?').get(id);
  assert.equal(row.identity,'shop:ldxp-pay:one');assert.equal(row.platform,'ldxp');assert.equal(row.status,'pending');assert.equal(row.version,1);assert.equal(row.identity_verified_at,null);
  assert.deepEqual(db.prepare('SELECT * FROM merchant_mail_outbox').all(),before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_application_actions').get().n,1);
  assert.deepEqual(migratePendingPayShopIdentities(db),[]);
});
test('pay identity repair never rewrites approved identities and rolls back if audit fails',t=>{
  const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
  const {id}=createMerchantApplication(db,{shopName:'店一',shopUrl:'https://pay.ldxp.cn/shop/one',productAreas:['chatgpt'],email:'one@example.org',contact:'one@example.org',consent:true});
  db.prepare("UPDATE merchant_applications SET identity='domain:pay.ldxp.cn',platform='independent',status='approved' WHERE public_id=?").run(id);
  assert.deepEqual(migratePendingPayShopIdentities(db),[]);
  db.prepare("UPDATE merchant_applications SET status='pending' WHERE public_id=?").run(id);
  db.exec("CREATE TRIGGER reject_repair_audit BEFORE INSERT ON merchant_application_actions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>migratePendingPayShopIdentities(db),/audit unavailable/);
  assert.equal(db.prepare('SELECT identity FROM merchant_applications WHERE public_id=?').get(id).identity,'domain:pay.ldxp.cn');
});
test('identity repair invalidates old preflight but a fresh test still matches the existing reply round',t=>{
  const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'pay-identity-test-'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const early=new Date('2026-09-08T02:00:00Z'),now=new Date('2026-09-08T04:00:00Z');
  const {id}=createMerchantApplication(db,{shopName:'店一',shopUrl:'https://pay.ldxp.cn/shop/one',productAreas:['chatgpt'],email:'one@example.org',contact:'one@example.org',consent:true},{now:early});
  db.prepare("UPDATE merchant_applications SET identity='domain:pay.ldxp.cn',platform='independent' WHERE public_id=?").run(id);
  recordMerchantReply(db,{applicationId:id,messageId:'reply1',threadId:'thread1',sender:'one@example.org',authentication:'gmail-aligned',expectedVersion:1,receivedAt:early.toISOString(),summary:'补充公开读取说明',publicUrls:[]},{now:early});
  initMerchantPreflightSchema(db);
  db.prepare(`INSERT INTO merchant_preflight_requests(id,application_id,application_version,identity,shop_name,shop_url,platform,requested_at,expires_at,actor,ownership_confirmed,permission_confirmed)
    VALUES(?,?,1,'domain:pay.ldxp.cn','店一','https://pay.ldxp.cn/shop/one','independent',?,?,'fixture',0,0)`).run('MT-'+'A'.repeat(24),id,early.toISOString(),new Date(+early+3600000).toISOString());
  migratePendingPayShopIdentities(db,{now});
  const options={bridgeDir:dir,resultsDir:dir,now};
  assert.equal(latestMerchantPreflight(db,id,options).canApprove,false);
  const request=queueAutomaticPreflight(db,id,options);assert.equal(request.identity,'shop:ldxp-pay:one');assert.equal(request.applicationVersion,1);
  writeFileSync(path.join(dir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:id,applicationVersion:1,identity:request.identity,startedAt:request.requestedAt,checkedAt:request.requestedAt,status:'ready',rawCount:1,validCount:1,message:'测试完成',samples:[{title:'ChatGPT Plus 月卡代充',price:120,currency:'CNY',url:'https://pay.ldxp.cn/item/g1'}]}));
  assert.equal(latestMerchantPreflight(db,id,options).canApprove,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_reply_rounds').get().n,1);
});
