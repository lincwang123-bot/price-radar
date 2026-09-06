import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {openSubmissionsDb,listSubmissions} from '../lib/submissions.mjs';
import {createApp} from '../lib/web.mjs';
import {sponsoredContent} from '../lib/commerce-ui.mjs';
test('共享域旧merchant_id不能冒认独立商家或产生广告曝光',()=>{
 for(const host of ['16688.com.cn','wzyp.cn']){
  const product={source:'priceai',product_id:'chatgpt-plus-recharge',snapshot_id:'old'};
  const offer={...product,offer_id:'old-offer',merchant_id:'domain:'+host,source_id:'pretend-merchant',url:'https://'+host+'/goods/1',price:100,currency:'CNY',status:'in_stock'};
  const campaign={id:'legacy',source:product.source,product_id:product.product_id,offer_id:offer.offer_id,merchant_id:offer.merchant_id,status:'approved',reviewed_at:new Date().toISOString(),placement:'sponsored_product',start_at:new Date(Date.now()-1000).toISOString(),end_at:new Date(Date.now()+3600000).toISOString()};
  let impressions=0;assert.equal(sponsoredContent([offer],[campaign],{product,recordImpression:()=>impressions++}),'');assert.equal(impressions,0);
 }
});
async function fixture(run){const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:'),analytics=openAnalytics(':memory:','synthetic-test-secret-32-chars-long'),app=createApp({db,submissionsDb,analytics});try{
 storeSnapshot(db,{source:'direct-shops',snapshotId:'commerce',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[100,110].map((price,i)=>({offerId:'o'+i,title:'ChatGPT Plus 代充 1个月',storeName:'虚构店铺'+i,price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://merchant.test/product/'+i}))}]});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));await run({base:'http://127.0.0.1:'+app.address().port,db,submissionsDb,analytics});
}finally{if(app.listening)await new Promise(r=>app.close(r));analytics.close();submissionsDb.close();db.close();}}
test('广告无默认样例，approved匹配活动独立展示且不改变自然顺序',async()=>fixture(async({base,analytics})=>{
 const route='/product?source=direct-shops&id=chatgpt-plus-recharge';const before=await(await fetch(base+route)).text();assert.doesNotMatch(before,/<section[^>]*sponsored-area/);
 assert.match(before,/<div class="store-risk-modal" id="store-risk-modal" hidden>/);assert.match(before,/\.store-risk-modal\[hidden\]\{display:none\}/);assert.match(before,/closest\("a\[data-store-risk\]"\)/);assert.match(before,/closest\("\[data-store-risk-cancel\]"\)\) close\(\)/);assert.match(before,/const close = [\s\S]*?modal.hidden = true/);
 analytics.outbound.saveCampaign({id:'sample',merchant_id:'domain:merchant.test',source:'direct-shops',product_id:'chatgpt-plus-recharge',offer_id:'o1',label:'虚构已审核广告',placement:'sponsored_product',start_at:new Date(Date.now()-1000).toISOString(),end_at:new Date(Date.now()+3600000).toISOString()},{approve:true});
 const after=await(await fetch(base+route)).text();assert.match(after,/Sponsored \/ 广告/);assert.match(after,/rel="noopener noreferrer nofollow sponsored"/);assert.equal(after.match(/<tbody>([\s\S]*?)<\/tbody>/)[1],before.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]);assert.match(after,/data-outbound-target="https:\/\/merchant.test/);assert.match(after,/href="\/go\?/);assert.match(after,/link.dataset.outboundTarget/);assert.match(after,/searchParams.set\('ack','1'\)/);assert.match(after,/href="\/submit-shop\?/);
 const card=after.match(/<article class="sponsor-card">[\s\S]*?<\/article>/)[0];assert.match(card,/¥110/);assert.match(card,/在售/);assert.match(card,/报价时间/);assert.match(card,/datetime="/);assert.doesNotMatch(card,/原店采集|第三方采集|商家同步|认证|排名|#2/);
 const privacy=await(await fetch(base+'/privacy')).text();assert.match(privacy,/更新于2026年9月6日/);assert.match(privacy,/不代表屏幕可见曝光或真实人数/);
 const ad=await(await fetch(base+'/advertise')).text();assert.match(ad,/人工确认/);assert.doesNotMatch(ad,/¥299|锁定早期价格/);assert.match(ad,/rel="canonical" href="https:\/\/airadar.vip\/advertise"/);assert.match(await(await fetch(base+'/sitemap.xml')).text(),/\/advertise<\/loc>/);
 for(const path of ['/','/advertise','/sources',route]){const h=await(await fetch(base+path)).text();const visible=h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,'');assert.doesNotMatch(visible,/PriceAI|CardNav|GoAIHop|LDXP|RelayWatch/);assert.doesNotMatch(visible,/已认证商家|保障购买|保证销量/);}
}));
test('广告与认领申请结构化验证、CSRF保护、私人信息仅存后台',async()=>fixture(async({base,submissionsDb})=>{
 const page=await(await fetch(base+'/submit?topic=sponsor_apply')).text(),token=page.match(/name="csrf-token" content="([^\"]+)"/)[1];assert.match(page,/<form method="post" action="\/api\/submissions"/);assert.match(page,/name="placement"/);assert.match(page,/noindex/);
 const payload={kind:'feedback',topic:'sponsor_apply',subject:'虚构商家 ChatGPT Plus',contextUrl:'https://merchant.test',contact:'example@merchant.test',details:'这是合成测试申请，需要人工确认商品广告档期。',consent:true,metadata:{placement:'product',duration:'1m'}};
 const send=(body,csrf=token)=>fetch(base+'/api/submissions',{method:'POST',headers:{'content-type':'application/json',origin:base,cookie:'airadar_csrf='+token,'x-csrf-token':csrf},body:JSON.stringify(body)});
 assert.equal((await send(payload,'wrong')).status,403);assert.equal((await send({...payload,metadata:{placement:'bad',duration:'1m'}})).status,422);assert.equal((await send(payload)).status,201);
 const rows=listSubmissions(submissionsDb,{kind:'feedback'});assert.equal(rows[0].topic,'sponsor_apply');assert.match(rows[0].details,/广告位置：product/);
 assert.doesNotMatch(await(await fetch(base+'/advertise')).text(),/example@merchant.test/);
 const claim={...payload,topic:'merchant_claim',metadata:{relationship:'owner',verification:'domain'}};assert.equal((await send(claim)).status,201);assert.equal(listSubmissions(submissionsDb,{kind:'feedback'}).find(r=>r.topic==='merchant_claim').status,'new');
}));
test('跨店新入口保留被自然去重来源的已批准广告，单次GET曝光且不改变自然排序',async()=>fixture(async({base,db,analytics})=>{
 storeSnapshot(db,{source:'priceai',snapshotId:'ad-duplicate',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[{offerId:'ad-copy',title:'ChatGPT Plus 代充 1个月',storeName:'虚构店铺1',price:110,currency:'CNY',status:'in_stock',stockCount:1,url:'https://merchant.test/product/1'}]}]});
 const route='/?family=chatgpt&product=chatgpt-plus',before=await(await fetch(base+route)).text();
 analytics.outbound.saveCampaign({id:'cross-source',merchant_id:'domain:merchant.test',source:'priceai',product_id:'chatgpt-plus-recharge',offer_id:'ad-copy',label:'跨来源已批准广告',placement:'sponsored_product',start_at:new Date(Date.now()-1000).toISOString(),end_at:new Date(Date.now()+3600000).toISOString()},{approve:true});
 let impressions=0;const original=analytics.outbound.recordImpression;analytics.outbound.recordImpression=(...args)=>{impressions++;return original(...args);};
 const after=await(await fetch(base+route)).text();assert.equal(impressions,1);assert.equal((after.match(/<article class="sponsor-card">/g)||[]).length,1);assert.match(after,/跨来源已批准广告/);
 const natural=html=>html.match(/<div class="directory-quotes">([\s\S]*?)<p class="note">第 /)[1];assert.equal(natural(after),natural(before));assert.equal((after.match(/data-directory-quote /g)||[]).length,2);
 await fetch(base+route,{method:'HEAD'});assert.equal(impressions,1);
 const link=after.match(/<article class="sponsor-card">[\s\S]*?href="([^\"]+)"/)[1].replaceAll('&amp;','&');assert.equal(new URL(link,base).searchParams.get('source'),'priceai');assert.equal((await fetch(base+link,{redirect:'manual'})).status,200);
}));
