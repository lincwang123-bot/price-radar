import test from 'node:test';
import assert from 'node:assert/strict';
import {readAssignedLiteral} from '../lib/static-js-literal.mjs';
import {collectTerry,parseTerryCatalog} from '../collectors/direct/terry.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const origin='https://aiterry.shop',target={id:'terry',name:'Terry会员代充',origin};
const script="const products=[{id:1,price:114,stock:46,sold:24},{id:2,price:619,stock:0,sold:20}];\nconst productPresentation={1:{plan:'Plus',route:'菲区 VISA 卡充值'},2:{plan:'5X',route:'iOS 礼品卡购买'}};\n"+
 'product.name=`ChatGPT ${presentation.plan}｜${presentation.route}｜质保订阅一个月`; const rendered=`<small>¥</small>${p.price} 库存：${p.stock}`;';
const pricing="const retail=new Map(products.map(p=>[p.id,p.price]));window.agentPriceMode=d.user?.state==='approved';p.price=window.agentPriceMode&&d.prices[p.id]!=null?d.prices[p.id]:retail.get(p.id);";
const checkout="url.searchParams.set('buy', id);price.textContent=`¥${product.price}`;";
const home='<script src="script.js?v=1"></script><script src="agent-pricing.js?v=1"></script><script src="checkout-view.js?v=1"></script>';
const capturedAt='2026-09-10T08:00:00.000Z';
test('static data reader handles quoted keys, escapes and trailing commas without evaluating code',()=>{
 const value=readAssignedLiteral("const products=[{'name':'a\\\'b','stock':2,price:1.25,enabled:true,other:null,},];",'products');
 assert.equal(value[0].name,"a'b");assert.equal(value[0].stock,2);assert.equal(value[0].price,1.25);
 for(const source of ['[fetch("secret")]','[...other]','[{get price(){return 1}}]','[{price:1,price:2}]','[{__proto__:{}}]','[{price:1+2}]','[]+evil()','['.repeat(20)+']'.repeat(20)])assert.throws(()=>readAssignedLiteral('const products='+source+';','products'),{code:'INVALID_CATALOG'});
});
test('Terry uses public retail prices, declared inventory and real buy links; sold-out rows stay excluded',()=>{
 const rows=parseTerryCatalog(script,pricing,checkout,target,capturedAt);
 assert.deepEqual(rows.map(r=>[r.price,r.stockCount,r.url]),[[114,46,origin+'/?buy=1'],[619,0,origin+'/?buy=2']]);
 assert.equal(rows[0].currency,'CNY');assert.equal(rows[0].priceBasis,'listed');
 assert.equal(rows[1].status,'out_of_stock');assert.equal(summarizeMerchantOffers(rows).validCount,1);
 for(const args of [[script,pricing.replace("==='approved'","==='other'"),checkout],[script.replace('¥','USD'),pricing,checkout],[script.replace('price:114','price:0'),pricing,checkout],[script,pricing,checkout.replace("'buy'","'id'")]])assert.throws(()=>parseTerryCatalog(...args,target,capturedAt),{code:'INVALID_CATALOG'});
});
test('approved Terry merchant reads only homepage-linked public files and respects robots before every request',async()=>{
 const pages={'/robots.txt':'User-agent: *\nDisallow: /api/','/':home,'/script.js':script,'/agent-pricing.js':pricing,'/checkout-view.js':checkout},calls=[];
 const fetchImpl=async value=>{const path=new URL(value).pathname;calls.push(path);assert.ok(path in pages);return new Response(pages[path],{headers:{'content-type':'text/plain'}});};
 const result=await probeMerchantCatalog({id:'merchant-terry',identity:'domain:aiterry.shop',shopName:target.name,shopUrl:origin+'/',platform:'independent'},{merchantFetchFactory:()=>fetchImpl,sleep:async()=>{}},capturedAt,Date.now()+30000);
 assert.equal(result.offers.length,2);assert.equal(result.offers[0].sourceId,'merchant-terry');assert.equal(calls.length,5);assert.ok(calls.every(p=>!p.startsWith('/api/')));
 calls.length=0;pages['/robots.txt']='User-agent: *\nDisallow: /script.js';
 await assert.rejects(collectTerry(target,{fetchImpl,sleep:async()=>{}}),{code:'ROBOTS_DISALLOWED'});
 assert.deepEqual(calls,['/robots.txt','/']);
});
