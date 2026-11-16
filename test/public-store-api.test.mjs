import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizesPublicStoreScript, parsePublicStoreList, parsePublicStoreDetail } from '../lib/public-store-api.mjs';
import { collectPublicHtml } from '../collectors/direct/public-html.mjs';
import { authorizeMerchantTarget } from '../lib/merchant-target-capability.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
const script = 'function money(n){if(!Number.isFinite(n))return"待定";const yuan=n/100;return`¥${Number.isInteger(yuan)?yuan:yuan.toFixed(2)}`} const p={price:money(row.price)}; const paths={products:"/api/store/products"};const api={getProduct:s=>get(`${paths.products}/${encodeURIComponent(s)}`)};const url=`/store/products/${encodeURIComponent(row.slug||row.id)}`;';
const product = { id:'abc', slug:'gpt-plus', name:'ChatGPT Plus 月卡代充', description:'充值到自己的账号，质保订阅30天。', price:14000, status:'ACTIVE', stockQuantity:2, soldCount:1084, isSoldOut:false,
  detailContent:JSON.stringify({details:'不质保封号。',sourceUrl:'https://upstream.com/products/secret',stockLabel:'售罄的旧快照'}) };
const target = () => authorizeMerchantTarget({id:'merchant-any-domain',name:'通用商城',origin:'https://another-shop.com'});

test('linked storefront recognition verifies the price formatter instead of guessing cent units', () => {
  assert.equal(recognizesPublicStoreScript(script), true);
  for (const s of [script.replace('/100','/1000'),script.replace('¥','$'),script.replace('money(row.price)','other(row.price)'),script.replace('getProduct','deleteProduct'),script.replace('/api/store/products','/api/store/orders')]) assert.equal(recognizesPublicStoreScript(s),false);
});

test('live list/details provide current inventory and prices; upstream snapshots and foreign links are ignored', () => {
  const rows = parsePublicStoreList({products:[product,{...product,id:'paused',slug:'paused',status:'PAUSED',price:0}]});
  assert.equal(rows.length,1);
  const row = parsePublicStoreDetail({product},rows[0],target(),new Date().toISOString());
  assert.equal(row.price,140); assert.equal(row.stockCount,2); assert.equal(row.status,'in_stock');
  assert.equal(row.url,'https://another-shop.com/store/products/gpt-plus');
  assert.doesNotMatch(JSON.stringify(row),/upstream.com|旧快照|1084/);
  assert.equal(summarizeMerchantOffers([row]).validCount,1);
});

test('unbounded, duplicate, ambiguous units and racing stock do not produce a partial catalogue', () => {
  for (const payload of [{products:[product,product]},{products:[{...product,price:140.5}]},{products:[{...product,stockQuantity:0}]},{products:[product],total:20},{products:[product],hasMore:true}]) assert.throws(()=>parsePublicStoreList(payload));
  for (const key of ['price','name','slug','status','stockQuantity']) assert.throws(()=>parsePublicStoreDetail({product:{...product,[key]:'changed'}},product,target(),new Date().toISOString()));
});

test('script-driven shop uses only declared modules and recognized GET endpoints with the same robots policy', async () => {
  const calls=[];
  const t=target();
  const fetchImpl=async (url,init)=>{
    const path=new URL(url).pathname;calls.push([path,init.method]);
    const pages={'/robots.txt':'User-agent: *\nAllow: /','/':'<script type="module" src="/assets/index.js"></script>','/assets/index.js':script};
    return path in pages?new Response(pages[path]):new Response(JSON.stringify(path==='/api/store/products'?{products:[product]}:{product}),{headers:{'content-type':'application/json'}});
  };
  const rows=await collectPublicHtml(t,{fetchImpl,sleep:async()=>{}});
  assert.equal(rows.length,1);
  assert.deepEqual(calls.map(r=>r[0]),['/robots.txt','/','/assets/index.js','/api/store/products','/api/store/products/gpt-plus']);
  assert.ok(calls.every(r=>r[1]==='GET'));
  calls.length=0;
  await assert.rejects(collectPublicHtml(t,{sleep:async()=>{},fetchImpl:(url,init)=>url.endsWith('/robots.txt')?Promise.resolve(new Response('User-agent: *\nDisallow: /api/')):fetchImpl(url,init)}),{code:'ROBOTS_DISALLOWED'});
  assert.ok(!calls.some(r=>r[0].startsWith('/api/')));
});
