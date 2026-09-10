import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPublicHtml} from '../collectors/direct/public-html.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {linkedDujiaoProductModule} from '../lib/public-dujiao-script.mjs';
import {classifyPreflightError} from '../lib/merchant-preflight-guidance.mjs';

const origin='https://public-shop.com';
const main='const base="/api/v1";import("./product-abc.js");';
const product='const c={list:t=>s.get("/public/products",{params:t}),detail:t=>s.get(`/public/products/${t}`)};';
function fixture(allowed=false){
 const calls=[],pages={'/robots.txt':`User-agent: *\nDisallow: /api/\n${allowed?'Allow: /api/v1/public/products\n':''}Sitemap: ${origin}/sitemap.xml`,
 '/':'<div id="app"></div><script src="/assets/index-abc.js"></script>', '/assets/index-abc.js':main,'/assets/product-abc.js':product};
 return {calls,pages,sleep:async()=>{},fetchImpl:async value=>{
  const url=new URL(value);calls.push(url.pathname+url.search);
  if(url.pathname==='/api/v1/public/products'){
   assert.ok(allowed);const id=Number(url.searchParams.get('page'));return Response.json({status_code:200,data:[{id,title:'ChatGPT Plus 月卡充值',slug:'plus-'+id,skus:[{id,price_amount:120+id,auto_stock_available:3,is_active:true}]}],pagination:{page:id,total_page:2,total:2}});
  }
  assert.ok(url.pathname in pages,'Unexpected path '+url.pathname);return new Response(pages[url.pathname]);
 }};
}
test('linked Dujiao SPA identifies the real blocked API without requesting it or redundant sitemap views',async()=>{
 const f=fixture();await assert.rejects(collectPublicHtml(authorizeMerchantTarget({id:'merchant-test',name:'测试',origin}),f),error=>classifyPreflightError(error).reasonCode==='robots_disallowed');
 assert.deepEqual(f.calls,['/robots.txt','/','/assets/index-abc.js','/assets/product-abc.js']);
});
test('allowed linked public catalog reuses Dujiao SKU parser, pagination and bounded reads',async()=>{
 const f=fixture(true),rows=await collectPublicHtml(authorizeMerchantTarget({id:'merchant-test',name:'测试',origin}),f);
 assert.deepEqual(rows.map(r=>r.price),[121,122]);assert.deepEqual(rows.map(r=>r.url),[origin+'/products/plus-1',origin+'/products/plus-2']);
 assert.equal(f.calls.length,6);assert.ok(f.calls.at(-1).includes('page=2'));
});
test('missing route proof and unlinked/foreign modules cannot establish a catalog API',()=>{
 assert.equal(linkedDujiaoProductModule('const file="./product-a.js"',origin+'/assets/index.js'),null);
 assert.equal(linkedDujiaoProductModule('const root="/api/v1";const url="https://elsewhere.com/assets/product-a.js"',origin+'/assets/index.js'),null);
 assert.equal(linkedDujiaoProductModule('const root="/api/v1";["product-a.js","product-b.js"]',origin+'/assets/index.js'),null);
});
