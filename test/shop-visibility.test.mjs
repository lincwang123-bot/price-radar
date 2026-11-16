import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDb,storeSnapshot,metaSet} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication} from '../lib/merchant-onboarding.mjs';
import {buildShopCatalog,shopPublicId} from '../lib/merchant-x.mjs';
import {shopQuoteTime,shopQuoteStatus} from '../lib/merchant-x-ui.mjs';
import {createApp} from '../lib/web.mjs';

test('failed collection retains timestamped prices but not current minima; successful empty catalog and pause remove quotes',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:');
 const dir=mkdtempSync(path.join(tmpdir(),'shop-visibility-'));let server;
 const identity='domain:visibility.example.org',id=shopPublicId(identity),at=new Date(Date.now()-3600000).toISOString();
 try{
  for(const [i,status] of ['approved','pending','paused','rejected'].entries()){
   const created=createMerchantApplication(privateDb,{shopName:'持续展示测试店'+i,shopUrl:'https://'+(i?'other-'+i+'.example.org':'visibility.example.org'),platform:'independent',productAreas:['chatgpt'],email:'private-owner-'+i+'@example.org',contact:'TG: private_contact',details:'private_details',consent:true},{clientAddress:'fixture-'+i,secret:'visibility-fixture-'.repeat(3),notify:false});
   privateDb.prepare('UPDATE merchant_applications SET status=?,approved_at=?,identity_verified_at=? WHERE public_id=?').run(status,at,at,created.id);
  }
  const save=(snapshotId,stale=false,empty=false)=>storeSnapshot(db,{source:'direct-shops',snapshotId,fetchedAt:new Date().toISOString(),products:empty?[]:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'visibility-1',storeName:'持续展示测试店0',title:'ChatGPT Plus 月卡代充',price:123.45,currency:'CNY',status:'in_stock',stockCount:2,url:'https://visibility.example.org/buy/1',capturedAt:at,extra:{quoteHealth:{status:stale?'stale':'cached',maxAgeMinutes:1440}}}]}]});
  save('initial');
  server=createApp({db,submissionsDb:privateDb,adminOptions:{merchantBridgeDir:dir}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const get=async url=>{const response=await fetch(base+url);return {status:response.status,html:await response.text()};};
  const searchPath='/?shop_q='+encodeURIComponent('持续展示测试店');
  let result=await get(searchPath);assert.equal(result.status,200);assert.equal([...result.html.matchAll(/data-shop-result="/g)].length,1);assert.match(result.html,/1 条有效报价/);
  let shop=await get('/shop?id='+id);assert.match(shop.html,/123\.45/);assert.match(shop.html,/报价更新时间/);assert.ok(shop.html.includes('datetime="'+at+'"'));
  save('failed',true);
  metaSet(db,'health:merchant-onboarding',JSON.stringify({targets:[{identity,status:'unavailable',lastSuccess:at,reasonCode:'timeout'}]}));
  for(const empty of [false,true]){
   if(empty)save('expired',true,true);
   result=await get(searchPath);assert.match(result.html,/找到 1 家店铺/);assert.doesNotMatch(result.html,/报价更新中/);assert.match(result.html,/0 条有效报价/);assert.ok(result.html.includes('datetime="'+at+'"'));
   shop=await get('/shop?id='+id);assert.equal(shop.status,200);assert.ok(shop.html.includes('datetime="'+at+'"'));
   for(const html of [result.html,shop.html])if(empty)assert.match(html,/报价读取超时/);else {assert.match(html,/1 条上次采集报价/);assert.match(html,/本次更新失败，价格待核对/);}
   if(empty){assert.match(shop.html,/店铺入口仍保留/);assert.doesNotMatch(shop.html,/123\.45|class="x-list-row"/);}else {assert.match(shop.html,/123\.45/);assert.match(shop.html,/最近成功采集时间/);}
   for(const html of [result.html,shop.html])assert.doesNotMatch(html,/private-owner|private_contact|private_details|reasonCode|identityVerifiedAt/);
   const prices=await get('/?family=chatgpt&product=chatgpt-plus');if(empty)assert.doesNotMatch(prices.html,/123\.45/);else {assert.match(prices.html,/data-price="123.45"/);assert.match(prices.html,/本次更新失败，价格待核对/);assert.ok(prices.html.includes('datetime="'+at+'"'));assert.doesNotMatch((await get('/')).html,/data-directory-minimum[^>]*>¥123\.45/);}
  }
  save('failed-before-pause',true);
  privateDb.prepare("UPDATE merchant_applications SET status='paused' WHERE identity=?").run(identity);
  result=await get(searchPath);assert.match(result.html,/没有找到相关店铺/);assert.equal((await get('/shop?id='+id)).status,404);
 }finally{
  if(server){await new Promise(r=>server.close(r));await server.merchantWorkflowDone?.();await server.retentionWorkflowDone?.();}
  privateDb.close();db.close();rmSync(dir,{recursive:true,force:true});
 }
});

test('empty shop labels distinguish queued, timeout, restricted, failed and unadapted catalogs without exposing diagnostics',()=>{
 const identity='domain:status.example.org',lastSuccess='2026-09-28T01:00:00Z';
 const approvedMerchants=[{identity,shopName:'状态测试店',shopUrl:'https://status.example.org/',status:'approved'}];
 for(const [status,reasonCode,label] of [
  ['queued',null,'等待采集'],['unavailable','timeout','报价读取超时'],
  ...['robots_disallowed','security_challenge','access_denied','login_required','rate_limited'].map(reason=>['unavailable',reason,'公开读取受限']),
  ...['network_error','dns_error','server_error','unknown'].map(reason=>['unavailable',reason,'报价暂时读取失败']),
  ['waiting_adapter',null,'报价接入待适配'],['no_valid_offers',null,'暂无有效报价']
 ]){
  const shop=[...buildShopCatalog([],{approvedMerchants,health:[{identity,status,reasonCode,lastSuccess,detail:'PRIVATE_DIAGNOSTIC'}]}).values()][0];
  const html=shopQuoteStatus(shop);assert.ok(html.includes(label),`${status}/${reasonCode}`);
  assert.match(html,/最近成功读取目录/);assert.match(html,/2026\/09\/28 09:00/);
  assert.doesNotMatch(html,/报价更新中|PRIVATE_DIAGNOSTIC|reasonCode/);
 }
 const shop=[...buildShopCatalog([],{approvedMerchants,health:[{identity,status:'queued'}]}).values()][0];
 assert.doesNotMatch(shopQuoteStatus(shop),/<time|最近成功读取目录/);
});

test('fallback catalog validates approval and exact shop identity, deduplicates and refuses blocked sites',()=>{
 const approved=(shopUrl,status='approved')=>({shopUrl,shopName:'目录测试店',identity:'domain:'+new URL(shopUrl).hostname,status,email:'not-public@example.org'});
 const catalog=buildShopCatalog([],{approvedMerchants:[approved('https://good.example.org/'),approved('https://good.example.org/'),approved('https://pending.example.org/','pending'),approved('https://fk.10886.xyz/'),{...approved('https://wrong.example.org/'),identity:'domain:other.example.org'}]});
 assert.equal(catalog.size,1);assert.equal([...catalog.values()][0].entries.length,0);assert.ok(!JSON.stringify([...catalog.values()]).includes('not-public'));
 assert.equal(shopQuoteTime(null),'');assert.equal(shopQuoteTime('invalid'),'');assert.match(shopQuoteTime('2026-09-19T00:05:00Z'),/2026\/09\/19 08:05（北京时间）/);
});
