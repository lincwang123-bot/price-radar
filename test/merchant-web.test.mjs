import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, storeSnapshot } from '../lib/db.mjs';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createApp } from '../lib/web.mjs';
import { reviewMerchantApplication } from '../lib/merchant-onboarding.mjs';
import { merchantApplicationHref } from '../lib/merchant-badges.mjs';

test('public merchant intake persists privately and live owner badges follow approval without affecting quote order', async () => {
  const directory=mkdtempSync(path.join(os.tmpdir(),'merchant-web-'));
  const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:');
  const app=createApp({db,submissionsDb,adminOptions:{merchantBridgeDir:directory}});
  try {
    storeSnapshot(db,{source:'direct-shops',snapshotId:'merchant-web',fetchedAt:new Date().toISOString(),products:[{
      productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[100,110].map((price,i)=>({
        offerId:'merchant-web-'+i,title:'ChatGPT Plus 代充 1个月',storeName:'合成测试商店'+i,
        price,currency:'CNY',status:'in_stock',stockCount:2,url:`https://merchant-${i}.com/product/1`,
      })),
    }]});
    await new Promise(r=>app.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.address().port;
    const form=await fetch(base+'/submit-shop'),html=await form.text();
    assert.equal(form.status,200);
    assert.match(form.headers.get('x-robots-tag'),/noindex/);
    assert.match(html,/<form id="merchant-submission" action="\/api\/merchant-applications" method="post">/);
    assert.doesNotMatch(html,/content="index, follow/);
    const csrf=html.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers={origin:base,'content-type':'application/json',cookie:'airadar_csrf='+csrf,'x-csrf-token':csrf};
    const payload={shopName:'合成测试商店1',shopUrl:'https://merchant-1.com/',platform:'auto',productAreas:['chatgpt','grok_x','api_relay','mail_verify'],contact:'private-contact@merchant-1.com',details:'仅限后台的合成审核说明',consent:true};
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
    const after=await(await fetch(base+route)).text();
    assert.equal((after.match(/<span class="merchant-verified"/g)||[]).length,1);
    assert.match(after,/合成测试商店1<span class="merchant-verified"/);
    assert.ok(after.indexOf('合成测试商店0')<after.indexOf('合成测试商店1'));
    assert.doesNotMatch(after,/private-contact|仅限后台|已用店内公告|merchantIdentity/);
    const detail=await(await fetch(base+'/product?source=direct-shops&id=chatgpt-plus-recharge')).text();
    assert.equal((detail.match(/<span class="merchant-verified"/g)||[]).length,2,'desktop and mobile render badge');
    assert.match(detail,/href="\/submit-shop\?/);
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
  assert.equal(read({source:'priceai',url:'https://16688.com.cn/goods/G123',extra:{shopNo:'S1',shopUrl:'https://16688.com.cn/shop/S1'}}),'');
  assert.equal(read({source:'direct-shops',url:'https://16688.com.cn/goods/G123',extra:{shopNo:'S1',shopUrl:'https://16688.com.cn/shop/S1'}}),'https://16688.com.cn/shop/S1');
  assert.doesNotThrow(()=>read({url:'https://merchant.com/product/1',extra:'broken json'}));
});
