import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReviewedHtml} from '../collectors/direct/reviewed-html.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {parsePublicCentsCatalog} from '../lib/public-cents-catalog.mjs';

test('reviewed Beibei decorations preserve full titles and restrictions while mismatched plans still fail',async()=>{
 const origin='https://bei-bei.shop',name='ChatGPT Plus 月卡｜菲区官方正规卡充【质保30天】【卡密可囤五天】';
 const row={'@type':'Product',name:'ChatGPT Plus 月卡 ｜ 菲区卡充',offers:{'@type':'Offer',price:114,priceCurrency:'CNY',availability:'https://schema.org/InStock',url:origin+'/products/one'}};
 const target=authorizeMerchantTarget({id:'fixture',name:'测试店',origin});
 const run=(patch={})=>collectReviewedHtml(target,{sleep:async()=>{},fetchImpl:async u=>new Response(u.endsWith('/robots.txt')?'User-agent: *\nAllow: /':u===origin+'/'?`<article class="product-card"><h3>${name}</h3><strong>¥114</strong><a href="/products/one">详情</a></article>`:`<script type="application/ld+json">${JSON.stringify({...row,...patch})}</script><main><h1>${name}</h1><div class="price">¥114</div></main>`)});
 const offers=await run();assert.equal(offers.length,1);assert.equal(offers[0].title,name);assert.match(offers[0].extra.warrantyEvidence,/质保30天/);
 for(const changed of ['ChatGPT Pro 月卡 ｜ 菲区卡充','ChatGPT Plus 年卡 ｜ 菲区卡充','ChatGPT Plus 月卡 ｜ 菲区续费卡充'])await assert.rejects(run({name:changed}),{code:'INVALID_CATALOG'});
 await assert.rejects(collectReviewedHtml({...target},{fetchImpl:async()=>assert.fail()}),/未授权/);
 await assert.rejects(collectReviewedHtml(authorizeMerchantTarget({...target,origin:'https://unreviewed.example'})),/未登记/);
});

test('reviewed cents isolation excludes incomplete products without reusing their stale prices',()=>{
 const target={id:'fixture',name:'fixture',origin:'https://alivip.vip'},at='2026-10-08T04:00:00Z';
 const product={id:'good',name:'ChatGPT Go 月卡充值',category:'gpt',active:true,price:14300,sku:null,canPurchase:true,stockState:'available',stockQuantity:46};
 const payload={categories:[{id:'gpt',name:'ChatGPT',active:true}],products:[product,{...product,id:'unavailable',pricingUnavailable:true,canPurchase:false,stockState:undefined,stockQuantity:undefined},{...product,id:'incomplete',canPurchase:undefined,stockState:undefined,stockQuantity:undefined}]};
 assert.throws(()=>parsePublicCentsCatalog(payload,target,at),{code:'INVALID_CATALOG'});
 const rows=parsePublicCentsCatalog(payload,target,at,{isolateInvalidProducts:true});assert.deepEqual(rows.map(r=>[r.price,r.status]),[[143,'in_stock']]);assert.equal(rows[0].extra.catalogValidation.rejectedCount,2);
 assert.throws(()=>parsePublicCentsCatalog({...payload,products:payload.products.slice(1)},target,at,{isolateInvalidProducts:true}),{code:'INVALID_CATALOG'});
 assert.throws(()=>parsePublicCentsCatalog({...payload,products:[product,product]},target,at,{isolateInvalidProducts:true}),{code:'INVALID_CATALOG'});
 assert.throws(()=>parsePublicCentsCatalog({...payload,total:99},target,at,{isolateInvalidProducts:true}),{code:'COLLECTOR_LIMIT'});
});
