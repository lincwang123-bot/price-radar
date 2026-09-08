import test from 'node:test';
import assert from 'node:assert/strict';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createApp} from '../lib/web.mjs';
import {hashAdminPassword} from '../lib/admin.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {buildProductDirectory} from '../lib/product-directory.mjs';
import {createMerchantX,normalizeXHandle,shopPublicId,shopDescriptorForOffer} from '../lib/merchant-x.mjs';

function fixture(){
 const db=openSubmissionsDb(':memory:'),quotes=openDb(':memory:');let time=new Date();
 storeSnapshot(quotes,{source:'priceai',snapshotId:'x-shops',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'one',title:'ChatGPT Plus 代充1个月',price:99,currency:'CNY',status:'in_stock',storeName:'合成店铺',url:'https://merchant.com/product/1'}]}]});
 const readDirectory=()=>{const snapshot=quotes.prepare('SELECT * FROM snapshots').get();return buildProductDirectory([{source:'priceai',products:quotes.prepare('SELECT * FROM products').all().map(p=>projectProduct(quotes,'priceai',snapshot,p))}]);};
 const service=createMerchantX({privateDb:db,readDirectory,secret:'s'.repeat(64),now:()=>time});
 const shop=[...service.catalog().values()][0];assert.ok(shop);
 return {db,quotes,service,shop,advance:ms=>{time=new Date(+time+ms);},close:()=>{quotes.close();db.close();}};
}
const start=(f,handle='shop_owner')=>f.service.start({shopId:f.shop.id,xHandle:handle,email:'owner@example.com',consent:true},{clientAddress:'test-client'});
const submit=(f,r)=>f.service.submit({id:r.id,token:r.token,proofType:'post',proofUrl:'https://x.com/'+r.xHandle+'/status/1234567890',shopProofUrl:'https://merchant.com/about',details:'店铺联系页面已放入我的 X 主页与认领码'});

test('X handles normalize to canonical account links and reject hostile or non-profile URLs',()=>{
 for(const input of ['@Shop_Owner','https://x.com/Shop_Owner?s=21','https://twitter.com/Shop_Owner/'])assert.equal(normalizeXHandle(input),'shop_owner');
 for(const input of ['https://x.com.evil.com/owner','https://evil.com/x.com/owner','https://x.com/u/status/123','https://x.com@evil.com/owner','https://x.com/intent','javascript:alert(1)','a'.repeat(16),'user/name'])assert.throws(()=>normalizeXHandle(input));
});
test('shared marketplaces require trusted exact-store evidence, never a platform-wide claim',()=>{
 assert.equal(shopDescriptorForOffer({source:'priceai',url:'https://16688.com.cn/goods/G1',extra:{shopUrl:'https://16688.com.cn/shop/S1',shopNo:'S1'}}),null);
 const s=shopDescriptorForOffer({source:'direct-shops',url:'https://16688.com.cn/goods/G1',extra:{shopUrl:'https://16688.com.cn/shop/S1',shopNo:'S1'}});
 assert.equal(s.id,shopPublicId('shop:16688:S1'));assert.notEqual(s.id,shopPublicId('shop:16688:S2'));
 assert.equal(shopDescriptorForOffer({source:'priceai',url:'https://merchant.com/p',extra:'bad json'}),null);
});
test('claim proof submission is private and never publishes an X association before explicit review',()=>{
 const f=fixture();try{
  const r=start(f);assert.match(r.code,/^AIR-[A-F0-9]{10}$/);assert.equal(r.status,'draft');assert.equal(f.service.profiles().length,0);
  assert.throws(()=>f.service.status({id:r.id,token:'a'.repeat(64)}));
  assert.throws(()=>f.service.submit({id:r.id,token:r.token,proofType:'post',proofUrl:'https://x.com/someone_else/status/123',details:'店铺公告有我的联系方式'}));
  assert.throws(()=>f.service.submit({id:r.id,token:r.token,proofType:'profile',shopProofUrl:'https://evil.com/proof',details:'店铺公告有我的联系方式'}));
  const pending=submit(f,r);assert.equal(pending.status,'pending');assert.equal(f.service.profiles().length,0);
  const version=f.service.get(r.id).version;
  assert.throws(()=>f.service.review(r.id,{action:'approve',version,note:'只有申请人自述'}));
  f.service.review(r.id,{action:'approve',version,xConfirmed:true,shopConfirmed:true,note:'人工核对了 X 认领码与店铺公告'});
  assert.equal(f.service.profiles()[0].xHandle,'shop_owner');
  const state=f.service.status({id:r.id,token:r.token});assert.equal(state.status,'approved');assert.ok(!('email' in state));assert.ok(!('details' in state));assert.ok(!('note' in state));
  assert.throws(()=>f.db.prepare('UPDATE merchant_x_actions SET note=?').run('rewrite'));
 }finally{f.close();}
});
test('an existing public X association cannot be overwritten silently; revoke removes display without deleting prices',()=>{
 const f=fixture();try{
  const a=start(f);submit(f,a);f.service.review(a.id,{action:'approve',version:2,xConfirmed:true,shopConfirmed:true,note:'已检查双方的独立控制证明'});
  const b=start(f,'new_owner');submit(f,b);
  assert.throws(()=>f.service.review(b.id,{action:'approve',version:2,xConfirmed:true,shopConfirmed:true,note:'店主提出更换 X 账号关联'}));
  assert.equal(f.service.profiles()[0].xHandle,'shop_owner');
  f.service.review(b.id,{action:'approve',version:2,xConfirmed:true,shopConfirmed:true,replaceConfirmed:true,note:'已联系原经营者并确认账号变更'});
  assert.equal(f.service.get(a.id).status,'revoked');assert.equal(f.service.profiles().length,1);assert.equal(f.service.profiles()[0].xHandle,'new_owner');
  assert.throws(()=>f.service.review(b.id,{action:'revoke',version:2,note:'过期版本不可提交'}));
  f.service.review(b.id,{action:'revoke',version:3,note:'经营者主动申请撤销账号展示'});
  assert.equal(f.service.profiles().length,0);assert.equal(f.quotes.prepare('SELECT COUNT(*) n FROM offers').get().n,1);
 }finally{f.close();}
});
test('claims require publication consent, bound drafts expire and requests are throttled',()=>{
 const f=fixture();try{
  assert.throws(()=>f.service.start({shopId:f.shop.id,xHandle:'owner',email:'owner@example.com',consent:false}));
  const r=start(f);f.advance(8*86400000);assert.throws(()=>submit(f,r));
  for(let i=0;i<3;i++)start(f,'owner_'+i);
  assert.throws(()=>start(f,'owner_four'),e=>e.status===429);
 }finally{f.close();}
});

test('HTTP claim flow requires same-origin CSRF and admin review; approved X displays beside quotes and in a shareable shop page',async()=>{
 const f=fixture(),bridge=mkdtempSync(path.join(os.tmpdir(),'airadar-x-test-'));const adminOrigin='https://airadar.test',password='synthetic-x-review-password';
 const app=createApp({db:f.quotes,submissionsDb:f.db,adminOptions:{origin:adminOrigin,username:'owner',passwordHash:await hashAdminPassword(password),merchantBridgeDir:bridge,merchantPreflightResultsDir:bridge}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const get=(url,cookie='')=>fetch(base+url,{headers:{cookie},redirect:'manual'});
 try{
  let response=await get('/claim-shop?shop='+f.shop.id),html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('x-robots-tag'),/noindex/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const csrf=html.match(/data-x-csrf value="([^"]+)"/)[1],cookie=response.headers.getSetCookie()[0].split(';')[0];
  const post=(action,payload,origin=base,csrfValue=csrf)=>fetch(base+'/api/shop-claims/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie,'X-CSRF-Token':csrfValue},body:JSON.stringify(payload)});
  const input={shopId:f.shop.id,xHandle:'@shop_owner',email:'private-owner@example.com',consent:true};
  assert.equal((await post('start',input,'https://attacker.test')).status,403);assert.equal((await post('start',input,base,'bad')).status,403);
  response=await post('start',input);assert.equal(response.status,201);const receipt=await response.json();
  assert.equal((await get('/api/shop-claims/start')).status,405);
  response=await post('submit',{id:receipt.id,token:receipt.token,proofType:'profile',details:'店铺的联系页已注明本 X 账号'});assert.equal(response.status,200);
  const productPath='/?family=chatgpt&product=chatgpt-plus',before=await(await get(productPath)).text();assert.ok(!before.includes('class="merchant-x"'));
  const detailPath='/admin/x-claims/'+receipt.id;assert.equal((await get(detailPath)).status,303);
  const login=await get('/admin/login'),loginHtml=await login.text(),loginToken=loginHtml.match(/name="csrf" value="([^"]+)"/)[1],loginCookie=login.headers.getSetCookie()[0].split(';')[0];
  const adminPost=(url,fields,adminCookie)=>fetch(base+url,{method:'POST',redirect:'manual',headers:{Origin:adminOrigin,Cookie:adminCookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});
  const logged=await adminPost('/admin/login',{username:'owner',password,csrf:loginToken},loginCookie);assert.equal(logged.status,303);const adminCookie=logged.headers.getSetCookie()[0].split(';')[0];
  const detail=await(await get(detailPath,adminCookie)).text(),adminCsrf=detail.match(/name="csrf" value="([^"]+)"/)[1];assert.ok(detail.includes(receipt.code));assert.ok(detail.includes('private-owner@example.com'));
  const fields={csrf:adminCsrf,version:2,action:'approve',note:'private-check: inspected live X code and independent shop control'};
  assert.equal((await adminPost(detailPath,fields,adminCookie)).status,422);
  assert.equal((await adminPost(detailPath,{...fields,xConfirmed:'true',shopConfirmed:'true'},adminCookie)).status,303);
  const after=await(await get(productPath)).text();assert.ok(after.includes('href="https://x.com/shop_owner"'));assert.ok(after.includes('class="merchant-x"'));
  assert.deepEqual([...after.matchAll(/data-price="([^"]+)"/g)].map(m=>m[1]),[...before.matchAll(/data-price="([^"]+)"/g)].map(m=>m[1]));
  const legacy=await(await get('/product?source=priceai&id=chatgpt-plus-recharge')).text();assert.equal((legacy.match(/class="merchant-x"/g)||[]).length,2);
  const shop=await(await get('/shop?id='+f.shop.id)).text();assert.ok(shop.includes('class="merchant-x"'));assert.ok(shop.includes('https://twitter.com/intent/tweet?'));assert.ok(shop.includes('rel="canonical" href="https://airadar.vip/shop?id='+f.shop.id+'"'));
  for(const page of [after,legacy,shop])for(const privateValue of ['private-owner@example.com','private-check:',receipt.code,receipt.token])assert.ok(!page.includes(privateValue),'private claim values must not be public');
  assert.equal((await get('/shop?id='+'a'.repeat(24))).status,404);
  assert.equal((await post('status',{id:receipt.id,token:'a'.repeat(64)})).status,404);
  assert.equal((await post('status',{id:receipt.id,token:receipt.token})).status,200);
 }finally{await new Promise(r=>app.close(r));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();f.close();rmSync(bridge,{recursive:true,force:true});}
});
