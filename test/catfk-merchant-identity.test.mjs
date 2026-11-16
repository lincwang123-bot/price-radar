import {reviewWithProductFixture as reviewMerchantApplication} from './fixtures/merchant-approval.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {canonicalShopIdentity,createMerchantApplication,getMerchantApplication} from '../lib/merchant-onboarding.mjs';
import {merchantIdentityForUrl,merchantIdentityForOffer} from '../lib/merchant-identity.mjs';
import {readApprovedManifest,probeMerchantCatalog} from '../lib/merchant-collection.mjs';

const payload=shopUrl=>({shopName:'测试店铺',shopUrl,productAreas:['chatgpt'],contact:'owner@example.org',email:'owner@example.org',consent:true});
test('catfk shops are separated by path and reject platform/product URLs',()=>{
  for(const token of ['xiaojiu','CFS0S5H8']){
    const url='https://catfk.com/shop/'+token;
    assert.equal(canonicalShopIdentity(url),'shop:catfk:'+token);
    assert.equal(merchantIdentityForUrl(url),'shop:catfk:'+token);
    assert.equal(canonicalShopIdentity('https://www.catfk.com/shop/'+token+'/'),'shop:catfk:'+token);
  }
  for(const tail of ['/','/shop/','/goods/123','/shop/admin','/shop/xiaojiu?token=a','/shop/xiaojiu#item']){
    assert.throws(()=>canonicalShopIdentity('https://catfk.com'+tail));
    assert.equal(merchantIdentityForUrl('https://catfk.com'+tail),null);
  }
});
test('new catfk shop can be approved without touching a legacy neighbor or sending operator-unrequested mail',t=>{
  const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'catfk-identity-'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const old=createMerchantApplication(db,payload('https://catfk.com/shop/CFS0S5H8'),{notify:false});
  db.prepare("UPDATE merchant_applications SET identity='domain:catfk.com' WHERE public_id=?").run(old.id);
  const original=getMerchantApplication(db,old.id);
  const fresh=createMerchantApplication(db,payload('https://catfk.com/shop/xiaojiu'),{notify:false});
  const result=reviewMerchantApplication(db,fresh.id,{action:'approve',expectedVersion:1,ownershipConfirmed:true,permissionConfirmed:true,note:'站长确认同一商家补建',actor:'test:operator'},{bridgeDir:dir,notify:false});
  assert.equal(result.status,'approved');
  assert.deepEqual(getMerchantApplication(db,old.id),original);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n,0);
  const manifest=readApprovedManifest(dir);
  assert.equal(manifest.valid,true);
  assert.deepEqual(manifest.merchants.map(m=>m.identity),['shop:catfk:xiaojiu']);
  assert.throws(()=>createMerchantApplication(db,payload('https://catfk.com/shop/CFS0S5H8/'),{notify:false}),{status:409});
});
test('public submissions keep receipt mail by default; payload cannot suppress it',t=>{
  const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
  const {id}=createMerchantApplication(db,{...payload('https://catfk.com/shop/public'),notify:false});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM merchant_mail_outbox WHERE application_id=? AND stage='received'").get(id).n,1);
});
test('catfk attribution rejects third-party claims and cross-platform evidence',()=>{
  const offer={source:'direct-shops',url:'https://catfk.com/goods/123',extra:{shopUrl:'https://catfk.com/shop/xiaojiu'}};
  assert.equal(merchantIdentityForOffer(offer),'shop:catfk:xiaojiu');
  assert.equal(merchantIdentityForOffer({...offer,source:'ldxp-goods'}),null);
  assert.equal(merchantIdentityForOffer({...offer,extra:{shopUrl:'https://wzyp.cn/shop/xiaojiu'}}),null);
  assert.equal(merchantIdentityForOffer({...offer,extra:{}}),null);
});

 test('catfk reads the exact shop metadata and each category; rejects mismatched shop evidence',async()=>{
 const merchant={id:'test-shop',identity:'shop:catfk:xiaojiu',shopName:'小久AI',shopUrl:'https://catfk.com/shop/xiaojiu'};
 for(const wrong of ['none','info','goods','missing']){
 const calls=[];
 const result=probeMerchantCatalog(merchant,{sleep:async()=>{},merchantFetchFactory:()=>async(url,init)=>{
 calls.push(url);if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
 const body=JSON.parse(init.body);assert.equal(body.token,'xiaojiu');
 if(url.endsWith('/info'))return Response.json({code:1,data:{token:wrong==='info'?'neighbor':'xiaojiu'}});
 if(url.endsWith('/categoryList'))return Response.json({code:1,data:[{id:1,name:'ChatGPT'},{id:2,name:'Claude'}]});
 assert.ok(url.endsWith('/goodsList'));return Response.json({code:1,data:{total:1,list:[{goods_key:'g'+body.category_id,name:'Plus 月卡代充',price:100,extend:{stock_count:3},user:wrong==='missing'?{}:{token:wrong==='goods'?'neighbor':'xiaojiu'}}]}});
 }},new Date().toISOString(),Date.now()+30000);
 if(wrong==='none'){const r=await result;assert.equal(r.offers.length,2);assert.ok(r.offers.every(o=>o.extra.shopUrl===merchant.shopUrl));assert.equal(calls.length,5);}
 else {await assert.rejects(result,/身份不匹配/);assert.equal(calls.length,wrong==='info'?2:4);}
 assert.ok(calls.every(url=>!url.includes('/api/v1/public/products')));
 }
});
 test('catfk stops at robots or access denial without trying a neighboring endpoint',async()=>{
 for(const response of [()=>new Response('User-agent: *\nDisallow: /shopApi/'),()=>new Response('denied',{status:403})]){
 let calls=0;await assert.rejects(probeMerchantCatalog({id:'test',identity:'shop:catfk:xiaojiu',shopName:'小久',shopUrl:'https://catfk.com/shop/xiaojiu'},{sleep:async()=>{},merchantFetchFactory:()=>async()=>{calls++;return response();}},new Date().toISOString(),Date.now()+30000));assert.equal(calls,1);
 }
});
