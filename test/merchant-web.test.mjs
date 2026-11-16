import {shopPublicId} from '../lib/merchant-x.mjs';
import {reviewWithProductFixture as reviewMerchantApplication} from './fixtures/merchant-approval.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, storeSnapshot } from '../lib/db.mjs';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createApp } from '../lib/web.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createAccountAuth} from '../lib/account-auth.mjs';
import { merchantApplicationHref } from '../lib/merchant-badges.mjs';

test('public merchant intake stays private; approval keeps comprehensive results unchanged and preserves pure price order', async () => {
  const directory=mkdtempSync(path.join(os.tmpdir(),'merchant-web-'));
  const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:');
  const app=createApp({db,submissionsDb,adminOptions:{merchantBridgeDir:directory}});
  try {
    storeSnapshot(db,{source:'direct-shops',snapshotId:'merchant-web',fetchedAt:new Date().toISOString(),products:[{
      productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[100,110].map((price,i)=>({
        offerId:'merchant-web-'+i,title:'ChatGPT Plus 代充 1个月 新开续费均可',storeName:'合成测试商店'+i,
        price,currency:'CNY',status:'in_stock',stockCount:2,url:`https://merchant-${i}.com/product/1`,
      })),
    }]});
    await new Promise(r=>app.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.address().port;
    const store=createRetentionStore(submissionsDb,{secret:'fixture-merchant-reader-'.repeat(3)}),auth=createAccountAuth(store);
    const challenge=auth.requestCode('owner@example.org','fixture','register');
    const code=JSON.parse(submissionsDb.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+challenge.requestId).payload).code;
    const registered=await auth.register({...challenge,code,password:'fixture merchant password 73',phone:'10000000000',contactType:'wechat',contactValue:'private_contact'});
    submissionsDb.prepare('INSERT INTO reader_phone_verifications(account_id,phone,verified_at) VALUES(?,?,?)').run(registered.account.id,'10000000000',new Date().toISOString());
    const readerCookie='airadar_reader='+registered.token;
    const form=await fetch(base+'/submit-shop',{headers:{cookie:readerCookie}}),html=await form.text();
    assert.equal(form.status,200);
    assert.match(form.headers.get('x-robots-tag'),/noindex/);
    assert.match(html,/<form id="merchant-submission" action="\/api\/merchant-applications" method="post">/);
    assert.doesNotMatch(html,/content="index, follow/);
    assert.match(html,/店铺已收录/);
    assert.doesNotMatch(html,/店主已核验/);
    const privacy=await(await fetch(base+'/privacy')).text();
    assert.match(privacy,/收录状态标识/);
    assert.doesNotMatch(privacy,/身份核验标识|店主已核验/);
    const csrf=html.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers={origin:base,'content-type':'application/json',cookie:readerCookie+'; airadar_csrf='+csrf,'x-csrf-token':csrf};
    const payload={shopName:'合成测试商店1',shopUrl:'https://merchant-1.com/',platform:'auto',productAreas:['chatgpt','grok_x','mail_verify'],email:'owner@example.org', contact:'private-contact@example.test',details:'仅限后台的合成审核说明',consent:true};
    const send=(body,extra={})=>fetch(base+'/api/merchant-applications',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/merchant-applications')).status,405);
    assert.equal((await send(payload,{'x-csrf-token':'bad'})).status,403);
    assert.equal((await send(payload,{origin:'https://evil.com'})).status,403);
    assert.equal((await send({...payload,consent:false})).status,422);
    assert.equal((await send(payload,{'content-type':'text/plain'})).status,415);
    assert.equal((await send({...payload,details:'x'.repeat(17000)})).status,413);
    const result=await send(payload),body=await result.json();
    assert.equal(result.status,201);assert.match(body.id,/^MA-/);assert.deepEqual(Object.keys(body),['ok','id']);
    assert.equal(submissionsDb.prepare('SELECT status FROM merchant_applications').get().status,'pending');
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory,'approved.json'))).merchants,[]);
    const duplicate=await send(payload);assert.equal(duplicate.status,409);assert.doesNotMatch(await duplicate.text(),new RegExp(body.id));
    const route='/?family=chatgpt&product=chatgpt-plus';
    const before=await(await fetch(base+route)).text();
    assert.doesNotMatch(before,/<span class="merchant-verified"/);
    assert.match(before,/合成测试商店0/);assert.match(before,/合成测试商店1/);
    assert.match(before,/href="\/submit-shop"/);
    reviewMerchantApplication(submissionsDb,body.id,{action:'approve',note:'已用店内公告确认身份与公开采集授权',actor:'fixture',expectedVersion:1,ownershipConfirmed:true,permissionConfirmed:true},{bridgeDir:directory});
    const after=await(await fetch(base+route,{headers:{cookie:'airadar_nocache=1'}})).text();
    assert.equal((after.match(/<span class="merchant-verified"/g)||[]).length,1);
    assert.match(after,/合成测试商店1<span class="merchant-verified"/);
    assert.match(after,/>已验证商家<\/span>/);
    assert.doesNotMatch(after,/店主已核验|站长已核验店铺经营身份/);
    assert.ok(after.indexOf('合成测试商店0')<after.indexOf('合成测试商店1'));
    const byPrice=await(await fetch(base+route+'&sort=price_asc')).text();
    assert.ok(byPrice.indexOf('合成测试商店0')<byPrice.indexOf('合成测试商店1'));
    assert.doesNotMatch(after,/private-contact|仅限后台|已用店内公告|merchantIdentity/);
    const detail=await(await fetch(base+'/product?source=direct-shops&id=chatgpt-plus-recharge',{headers:{cookie:'airadar_nocache=1'}})).text();
    assert.equal((detail.match(/<span class="merchant-verified"/g)||[]).length,1,'clean product page renders one quote badge');
    assert.equal((detail.match(/>已验证商家<\/span>/g)||[]).length,1);
    assert.match(detail,/<h2>合成测试商店1<span class="merchant-verified"[^>]*>已验证商家<\/span>/,'desktop badge stays inline with the shop name, not a stretched flex-column row');
    assert.doesNotMatch(detail,/店主已核验|站长已核验店铺经营身份/);
    assert.match(detail,/href="\/claim-shop\?shop=[a-f0-9]{24}/);
    const shopId=shopPublicId('domain:merchant-1.com');
    for(const prefix of ['', '/en']){
      const homepage=await(await fetch(base+prefix+'/shop?id='+shopId,{headers:{cookie:'airadar_nocache=1'}})).text();
      assert.match(homepage,prefix?/>Verified merchant</:/>已验证商家</);
      assert.match(homepage,prefix?/saved mainland China phone number/:/已保存中国大陆手机号/);
    }
    submissionsDb.exec('DELETE FROM reader_phone_verifications');
    const listed=await(await fetch(base+'/shop?id='+shopId,{headers:{cookie:'airadar_nocache=1'}})).text();
    assert.match(listed,/>店铺已收录</);assert.doesNotMatch(listed,/>已验证商家</);
    reviewMerchantApplication(submissionsDb,body.id,{action:'pause',note:'合成测试暂停授权流程',expectedVersion:2},{bridgeDir:directory});
    const paused=await(await fetch(base+route)).text();
    assert.doesNotMatch(paused,/<span class="merchant-verified"/);
    assert.match(paused,/合成测试商店1/,'publicly collected existing prices do not disappear just for pausing ownership');
    const legacy=await fetch(base+'/submit?topic=merchant_claim&shop=test&url=https://merchant-1.com/product/1',{redirect:'manual'});
    assert.equal(legacy.status,303);assert.equal(legacy.headers.get('location'),'/submit-shop?shop=test');
    assert.doesNotMatch(await(await fetch(base+'/sitemap.xml')).text(),/submit-shop/);
  } finally {
    if(app.listening)await new Promise(r=>app.close(r));
    db.close();submissionsDb.close();rmSync(directory,{recursive:true,force:true});
  }
});

test('claim links prefill only an exact independent origin or trusted shared shop homepage',()=>{
  const read=offer=>new URL(merchantApplicationHref(offer),'https://airadar.vip').searchParams.get('url');
  assert.equal(read({url:'https://merchant.com/product/1?secret=oops'}),'https://merchant.com');
  assert.equal(read({source:'ldxp-goods',url:'https://16688.com.cn/goods/G123',extra:{shopNo:'S1',shopUrl:'https://16688.com.cn/shop/S1'}}),'');
  assert.equal(read({source:'direct-shops',url:'https://16688.com.cn/goods/G123',extra:{shopNo:'S1',shopUrl:'https://16688.com.cn/shop/S1'}}),'https://16688.com.cn/shop/S1');
  assert.doesNotThrow(()=>read({url:'https://merchant.com/product/1',extra:'broken json'}));
});
