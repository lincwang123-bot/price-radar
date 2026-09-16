import test from 'node:test';
import assert from 'node:assert/strict';
import {createMerchantShopUrlResolver,normalizeMerchantSubmission} from '../lib/merchant-shop-url.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {openDb} from '../lib/db.mjs';
import {createMerchantApplication} from '../lib/merchant-onboarding.mjs';
import {createApp} from '../lib/web.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createAccountAuth} from '../lib/account-auth.mjs';
const body={shopName:'别名测试店铺',shopUrl:'https://www.16688.com.cn/shop/XIAOQING2',platform:'16688',productAreas:['chatgpt'],contact:'fixture_owner',email:'fixture@example.org',consent:true};
const reply=(data={shop_no:'S332568',shop_alias:'XIAOQING2'})=>new Response(JSON.stringify({code:1,data}),{headers:{'content-type':'application/json'}});

test('16688 aliases resolve through the exact official endpoint and preserve canonical deduplication',async()=>{
 let calls=0;const resolve=createMerchantShopUrlResolver({fetchFactory:(origin,limits)=>{
  assert.equal(origin,'https://www.16688.com.cn');assert.equal(limits.maxRequests,1);assert.equal(limits.timeoutMs,8000);
  return async(url,init)=>{calls++;assert.equal(url,origin+'/shopApi/shop/detail');assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{shop_no:'XIAOQING2'});return reply();};
 }});
 const normalized=await normalizeMerchantSubmission(body,{resolveShopUrl:resolve});assert.equal(normalized.shopUrl,'https://www.16688.com.cn/shop/S332568');assert.equal(body.shopUrl,'https://www.16688.com.cn/shop/XIAOQING2');
 assert.equal(await resolve('https://16688.com.cn/shop/XIAOQING2/'),normalized.shopUrl);assert.equal(calls,1);
 assert.equal(await resolve('https://16688.com.cn/shop/S332568'),'https://16688.com.cn/shop/S332568');assert.equal(await resolve('https://xiaocaiyu.vip/'),'https://xiaocaiyu.vip/');assert.equal(calls,1);
 const db=openSubmissionsDb(':memory:');try{createMerchantApplication(db,normalized);assert.throws(()=>createMerchantApplication(db,{...body,shopUrl:'https://16688.com.cn/shop/S332568'}),e=>e.status===409);assert.equal(db.prepare('SELECT identity FROM merchant_applications').get().identity,'shop:16688:S332568');}finally{db.close();}
});

test('invalid URLs and incomplete applications do not make external requests',async()=>{
 let calls=0;const resolve=createMerchantShopUrlResolver({fetchFactory:()=>{calls++;return async()=>reply();}});
 for(const url of ['http://xiaocaiyu.vip/','https://www.16688.com.cn/','https://www.16688.com.cn/goods/G123','https://user:pass@www.16688.com.cn/shop/XIAOQING2','https://www.16688.com.cn/shop/XIAOQING2?token=x','https://www.16688.com.cn/shop/XIAOQING2#x','https://16688.com.cn.attacker.net/shop/XIAOQING2?x=1','https://www.16688.com.cn/shop/XIAOQING2，https://example.org/','https://www.16688.com.cn/shop/%58IAOQING2','https://127.0.0.1/shop/XIAOQING2'])await assert.rejects(resolve(url));
 for(const invalid of [{...body,consent:false},{...body,shopName:''},{...body,productAreas:[]},{...body,email:''},{...body,website:'bot'}])await assert.rejects(normalizeMerchantSubmission(invalid,{resolveShopUrl:resolve}));
 assert.equal(calls,0);
});

test('wrong-shop replies, missing aliases and denied or redirected responses fail closed',async()=>{
 for(const response of [reply({shop_no:'S7',shop_alias:'OTHER'}),reply({shop_no:'S7'}),reply({shop_no:'../../internal',shop_alias:'XIAOQING2'}),new Response('{"code":0,"msg":"arbitrary upstream text"}',{headers:{'content-type':'application/json'}}),new Response('denied',{status:403}),new Response('',{status:302,headers:{location:'https://example.org/'}})]){
  const resolve=createMerchantShopUrlResolver({fetchFactory:()=>async()=>response});await assert.rejects(resolve(body.shopUrl),e=>[422,503].includes(e.status)&&!e.message.includes('arbitrary upstream text'));
 }
});

test('resolution coalesces requests, bounds concurrency, and can retry after synchronous failures',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r);
 const resolve=createMerchantShopUrlResolver({fetchFactory:()=>async(url,init)=>{calls++;await gate;return reply({shop_no:'S1',shop_alias:JSON.parse(init.body).shop_no});}});
 const one=resolve(body.shopUrl),same=resolve(body.shopUrl);const more=['A','B','C'].map(x=>resolve('https://16688.com.cn/shop/'+x));
 await assert.rejects(resolve('https://16688.com.cn/shop/D'),e=>e.status===503);release();await Promise.all([one,same,...more]);assert.equal(calls,4);
 let time=0,attempt=0;const retry=createMerchantShopUrlResolver({now:()=>time,fetchFactory:()=>{if(++attempt===1)throw new Error('private network error');return async()=>reply();}});
 await assert.rejects(retry(body.shopUrl),e=>e.status===503&&!e.message.includes('private'));time=11000;assert.equal(await retry(body.shopUrl),'https://www.16688.com.cn/shop/S332568');assert.equal(attempt,2);
});

test('the authenticated submission API awaits alias resolution, rejects duplicates and rechecks deleted sessions',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:');let resolveCalls=0,release,entered;
 const waiting=new Promise(r=>entered=r);const pause=new Promise(r=>release=r);
 const server=createApp({db,submissionsDb:privateDb,retentionOptions:{env:{},secret:'fixture-alias-secret'.repeat(3)},merchantUrlResolver:async(url)=>{resolveCalls++;if(url.endsWith('SECOND')){entered();await pause;return 'https://www.16688.com.cn/shop/S2';}return 'https://www.16688.com.cn/shop/S332568';}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const store=createRetentionStore(privateDb,{secret:'fixture-alias-secret'.repeat(3)}),auth=createAccountAuth(store);
  const challenge=auth.requestCode(body.email,'fixture','register'),code=JSON.parse(privateDb.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+challenge.requestId).payload).code;
  const user=await auth.register({...challenge,code,password:'fixture merchant password 73',phone:'13800138000',contactType:'wechat',contactValue:'fixture_owner'});
  const page=await fetch(base+'/submit-shop',{headers:{cookie:'airadar_reader='+user.token}}),html=await page.text();const csrf=html.match(/name="csrf-token" content="([^"]+)"/)[1];
  const csrfCookie=page.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const headers={origin:base,'content-type':'application/json','x-csrf-token':csrf,cookie:csrfCookie+'; airadar_reader='+user.token};
  const send=(payload,extra={})=>fetch(base+'/api/merchant-applications',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(payload)});
  assert.equal((await send(body,{cookie:csrfCookie})).status,401);assert.equal(resolveCalls,0);
  assert.equal((await send({...body,consent:false})).status,422);assert.equal(resolveCalls,0);
  let r=await send(body);assert.equal(r.status,201);assert.ok((await r.json()).id);assert.equal(resolveCalls,1);
  assert.equal(privateDb.prepare('SELECT shop_url FROM merchant_applications').get().shop_url,'https://www.16688.com.cn/shop/S332568');
  r=await send({...body,shopUrl:'https://16688.com.cn/shop/S332568'});assert.equal(r.status,409);assert.equal(resolveCalls,1);
  const inFlight=send({...body,shopUrl:'https://16688.com.cn/shop/SECOND'});await waiting;store.logout(user.token);release();assert.equal((await inFlight).status,401);assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,1);
 }finally{release?.();await new Promise(r=>server.close(r));await server.retentionWorkflowDone();await server.merchantWorkflowDone();db.close();privateDb.close();}
});
