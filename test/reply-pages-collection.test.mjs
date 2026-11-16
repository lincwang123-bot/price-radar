import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseReviewedAcgItem} from '../lib/public-acg-item.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';
const origin='https://liunenglabs.xyz',url=origin+'/item/1',target={id:'merchant-liu',name:'LiuNengAI',origin};
const item={id:1,name:'ChatGPT Plus',price:123,user_price:110,status:1,only_user:0,login:false,seckill_status:0,draft_status:0,inventory_hidden:0,widget:[],config:[],stock:999999,is_stock:true,delivery_way:1};
const product={'@type':'Product',name:item.name,url,description:'用户本人账户订阅充值服务',offers:{'@type':'Offer',url,price:123,priceCurrency:'CNY'}};
const html=(data=item,ld=product,visiblePrice=123)=>`<script>setVar("_var_item",${JSON.stringify(data)});</script><script type="application/ld+json">${JSON.stringify(ld)}</script><main><h1>ChatGPT Plus</h1><div class="price"><i>loading</i></div><a href="/item/1" data-plan-link="plus">ChatGPT Plus ¥${visiblePrice} · 推荐</a></main>`;
test('reviewed ACG service page requires agreeing public prices and preserves availability without inventing card inventory',()=>{
 const offer=parseReviewedAcgItem(html(),{url},target,new Date().toISOString());
 assert.equal(offer.price,123);assert.equal(offer.status,'in_stock');assert.equal(offer.stockCount,null);
 assert.equal(summarizeMerchantOffers([offer]).validCount,1);
 const out=parseReviewedAcgItem(html({...item,stock:0,is_stock:false}),{url},target,new Date().toISOString());
 assert.equal(out.status,'out_of_stock');assert.equal(summarizeMerchantOffers([out]).validCount,0);
 for(const body of [html({...item,price:110}),html(item,{...product,name:'different'}),html(item,product,99),html({...item,only_user:1}),html({...item,config:[{price:10}]}),html({...item,stock:0})])assert.throws(()=>parseReviewedAcgItem(body,{url},target,new Date().toISOString()));
 assert.throws(()=>parseReviewedAcgItem(html().replace('setVar("_var_item",','setVar("_var_item",globalThis.sideEffect=1,'),{url},target,new Date().toISOString()));
 assert.equal(globalThis.sideEffect,undefined);
 for(const body of [html().replace('</main>','<div class="ln-purchase-conditions">按剩余期限退款</div><div class="ln-purchase-conditions">无质保</div></main>'),html()+'<aside class="ln-purchase-conditions">无质保</aside>'])assert.throws(()=>parseReviewedAcgItem(body,{url},target,new Date().toISOString()));
 assert.equal(parseReviewedAcgItem(html(),{url:'https://other.net/item/1'},{...target,origin:'https://other.net'},new Date().toISOString()),null);
});
test('page-only collection reads exactly robots plus supplied URLs; robots delay is honored and no JS/API is downloaded',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const dir=mkdtempSync(path.join(tmpdir(),'reply-pages-'));
 const calls=[];const access={mode:'public_pages_only',replyId:16,publicUrls:[url],minimumIntervalMs:1100,permissionScope:'ongoing'};
 const merchant={id:target.id,identity:'domain:liunenglabs.xyz',shopUrl:origin+'/',shopName:target.name,platform:'independent',collectionAccess:access};
 const ctx={dataDir:dir,sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:()=>async value=>{calls.push({url:String(value),at:Date.now()});return new Response(String(value).endsWith('/robots.txt')?'User-agent: *\nAllow: /\nCrawl-delay: 3':html(),{headers:{'content-type':'text/html'}});}};
 try{const result=await probeMerchantCatalog(merchant,ctx,new Date().toISOString(),Date.now()+30000);assert.equal(result.offers.length,1);assert.deepEqual(calls.map(c=>c.url),[origin+'/robots.txt',url]);assert.ok(calls[1].at-calls[0].at>=3000);
  calls.length=0;ctx.merchantFetchFactory=()=>async value=>{calls.push({url:String(value)});return new Response(String(value).endsWith('/robots.txt')?'User-agent: *\nDisallow: /api/':'<div id="app"></div><script src="/assets/app.js"></script>',{headers:{'content-type':'text/html'}});};
  const shop='https://zoksho.cc.cd';await assert.rejects(probeMerchantCatalog({...merchant,shopUrl:shop+'/',identity:'domain:zoksho.cc.cd',collectionAccess:{...access,publicUrls:[shop+'/']}},ctx,new Date().toISOString(),Date.now()+30000),e=>e.code==='PAGE_REQUIRES_RENDERING');
  assert.deepEqual(calls.map(c=>c.url),[shop+'/robots.txt',shop+'/']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid page scope makes zero network calls; robots denial never fetches a supplied page',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reply-pages-deny-'));let calls=0;
 const access={mode:'public_pages_only',replyId:16,publicUrls:[origin+'/api/items'],minimumIntervalMs:1100,permissionScope:'ongoing'};
 const merchant={id:target.id,identity:'domain:liunenglabs.xyz',shopUrl:origin+'/',shopName:target.name,platform:'independent',collectionAccess:access};
 const ctx={dataDir:dir,merchantFetchFactory:()=>async()=>{calls++;return new Response('User-agent: *\nDisallow: /');}};
 try{await assert.rejects(probeMerchantCatalog(merchant,ctx,new Date().toISOString(),Date.now()+30000));assert.equal(calls,0);
  for(const bad of [null,false,0,''])await assert.rejects(probeMerchantCatalog({...merchant,collectionAccess:bad},ctx,new Date().toISOString(),Date.now()+30000));assert.equal(calls,0);
  await assert.rejects(probeMerchantCatalog({...merchant,collectionAccess:{...access,publicUrls:[url]}},ctx,new Date().toISOString(),Date.now()+30000),e=>e.code==='ROBOTS_DISALLOWED');assert.equal(calls,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
