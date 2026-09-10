import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPublicHtml} from '../collectors/direct/public-html.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const origin='https://client-catalog.com';
const modulePath='/_next/static/chunks/storefront-abc.js', formatterPath='/_next/static/chunks/catalog-def.js';
const storefront='import{r as money}from"./catalog-def.js";async function load(){const res=await fetch(`/api/products`),data=await res.json();set(data.products);categories(data.categories)}const card={href:`/products/`+p.id,children:[`¥`,money(p.price)]};';
// The static array deliberately disagrees with the live catalog: it is never a price source.
const formatter='var defaults=[{id:`gpt`,price:100}],format=e=>(e/100).toFixed(2);export{format as r,defaults as t};';
const product={id:'gpt',name:'ChatGPT Plus 月卡【菲区代充卡密】',category:'chatgpt',price:12900,active:true,sku:null,stockQuantity:12,stockState:'available',canPurchase:true,description:'充值到自己的账号。质保30天订阅，不保封号。'};
const payload=()=>({categories:[{id:'chatgpt',name:'ChatGPT 会员',active:true}],products:[{...product},{...product,id:'pro',name:'ChatGPT Pro 20X 月卡充值',price:130000,stockQuantity:0,stockState:'sold_out',canPurchase:false}]});
function fixture({data=payload(),source=storefront,money=formatter,policy='User-agent: *\nAllow: /',apiStatus=200,extra=''}={}){
 const calls=[];
 const pages={'/robots.txt':policy,'/':`<script src="/_next/static/chunks/framework.js"></script><link rel="modulepreload" href="${modulePath}"><link rel="modulepreload" href="${formatterPath}">${extra}`,[modulePath]:source,[formatterPath]:money,'/_next/static/chunks/framework.js':'framework'};
 return {calls,sleep:async()=>{},fetchImpl:async(url,init)=>{const p=new URL(url).pathname;calls.push({p,method:init.method});return new Response(p==='/api/products'?JSON.stringify(data):pages[p]||'',{status:p==='/api/products'?apiStatus:200,headers:{'content-type':p==='/api/products'?'application/json':'text/html'}});}};
}
const run=f=>collectPublicHtml(authorizeMerchantTarget({id:'merchant-cents',name:'测试店铺',origin}),f);
test('linked client catalog reads live CNY cents, preserves sold-out status and real product IDs',async()=>{
 const f=fixture(),rows=await run(f);
 assert.deepEqual(rows.map(r=>[r.price,r.status,r.stockCount,r.url]),[[129,'in_stock',12,origin+'/products/gpt'],[1300,'out_of_stock',0,origin+'/products/pro']]);
 assert.equal(summarizeMerchantOffers(rows).validCount,1);
 assert.match(rows[0].extra.warrantyEvidence,/不保封号/);
 assert.deepEqual(f.calls.map(c=>c.p),['/robots.txt','/',modulePath,formatterPath,'/api/products']);
 assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('unproven currency formatter, endpoint or product route never authorize an API read',async()=>{
 for(const options of [{money:formatter.replace('/100','/1')},{source:storefront.replace('money(p.price)','other(p.price)')},{source:storefront.replace('/api/products','/api/orders')},{source:storefront.replace('/products/','/orders/')}]){
  const f=fixture(options);await assert.rejects(run(f));assert.ok(!f.calls.some(c=>c.p==='/api/products'));
 }
});
test('catalog rejects inconsistent stock, ambiguous prices, duplicate IDs, variants and partial responses',async()=>{
 for(const patch of [{price:'12900'},{price:129.5},{price:0},{currency:'USD'},{stockQuantity:0},{canPurchase:false},{sku:'multiple-options'},{id:'../orders'}]){
  const data=payload();Object.assign(data.products[0],patch);await assert.rejects(run(fixture({data})),{code:'INVALID_CATALOG'});
 }
 for(const extra of [{total:3},{hasMore:true},{next:'/page2'},{count:1}])await assert.rejects(run(fixture({data:{...payload(),...extra}})),{code:'COLLECTOR_LIMIT'});
 const duplicate=payload();duplicate.products.push({...product});await assert.rejects(run(fixture({data:duplicate})),{code:'INVALID_CATALOG'});
 const inactive=payload();inactive.products.push({...product,id:'hidden',active:false});assert.equal((await run(fixture({data:inactive}))).length,2);
});
test('robots, access denial and same-origin module constraints remain enforced',async()=>{
 const blocked=fixture({policy:'User-agent: *\nDisallow: /api/'});await assert.rejects(run(blocked),{code:'ROBOTS_DISALLOWED'});assert.ok(!blocked.calls.some(c=>c.p==='/api/products'));
 const denied=fixture({apiStatus:403});await assert.rejects(run(denied),{code:'ACCESS_DENIED'});assert.equal(denied.calls.at(-1).p,'/api/products');
 const foreign=fixture({source:storefront.replace('./catalog-def.js','https://other.com/catalog-def.js')});await assert.rejects(run(foreign));assert.ok(!foreign.calls.some(c=>c.p==='/api/products'));
});
