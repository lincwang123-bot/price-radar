import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {probeMerchantCatalog,collectApprovedMerchants} from '../lib/merchant-collection.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';
import {directTargets,DEFAULT_DIRECT_TARGET_IDS} from '../collectors/direct/registry.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/aijiayou-public-products.json',import.meta.url)));
const {origin,products}=fixture;
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function pages(rows=products){
 const home='<main>'+rows.map(r=>`<article class="product-card"><h3>${esc(r.entry.name)}</h3><strong class="price">¥${r.entry.price}</strong><a href="${esc(r.entry.url)}">详情</a></article>`).join('')+'</main>';
 return {'/':home,...Object.fromEntries(rows.map(r=>[new URL(r.entry.url).pathname,
 `<link rel="canonical" href="${esc(r.canonical)}"><script type="application/ld+json">${JSON.stringify({'@type':'Product',...r.product})}</script><main><h1>${esc(r.visibleTitle)}</h1><p class="glass-subtitle">${esc(r.subtitle)}</p><div class="glass-price-block"><strong>¥${r.entry.price}</strong><small class="atelier-stock-label">${esc(r.stock)}</small></div><p class="glass-copy">${esc(r.product.description)}</p><div class="bb-order-flow__price">¥${r.entry.price}</div></main>`]))};
}
function probe(t,{rows=products,policy='User-agent: *\nAllow: /\nDisallow: /api/',challenge=false,detailFailure}={}){
 t.mock.timers.enable({apis:['Date'],now:10000});const html=pages(rows),calls=[];
 const promise=probeMerchantCatalog({id:'merchant-test',shopName:'Ai加油站',shopUrl:origin+'/',identity:'domain:aijiayou.win'},
 {sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:()=>async(url)=>{const path=new URL(url).pathname;calls.push({path,start:Date.now()});
  if(path==='/robots.txt')return new Response(challenge?'<title>Just a moment</title>':policy);
  if(path===detailFailure?.path)return new Response(detailFailure.body,{status:detailFailure.status||200});
  assert.ok(!path.startsWith('/api/')&&!path.startsWith('/user/'),'reviewed HTML adapter must not read the conflicting API');
  assert.ok(html[path]);return new Response(html[path]);}},new Date().toISOString(),Date.now()+60000);
 return {promise,calls};
}
test('Ai加油站 reads its public HTML catalog, preserves real stock and full titles, without enabling an unapproved source',async t=>{
 const f=probe(t);const r=await f.promise;
 assert.equal(r.offers.length,11);assert.equal(r.offers.filter(o=>o.status==='in_stock').length,9);
 assert.equal(r.offers.filter(o=>o.status==='out_of_stock').length,2);
 assert.equal(r.offers.find(o=>o.url.endsWith('/chatgpt-plus-two')).price,125);
 assert.equal(r.offers.find(o=>o.url.endsWith('/gptpro-5x')).price,690);
 assert.ok(r.offers.every(o=>o.stockCount===(o.status==='out_of_stock'?0:null)));
 assert.match(r.offers[0].title,/质保30天/);assert.ok(summarizeMerchantOffers(r.offers).validCount>=2);
 assert.equal(f.calls.length,13);for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].start-f.calls[i-1].start>=1100);
 assert.equal(DEFAULT_DIRECT_TARGET_IDS.includes('aijiayou'),false);assert.equal(directTargets(['aijiayou'])[0].kind,'aijiayou');
});
for(const [label,change] of Object.entries({
 wrongPlan:r=>{r.product.name=r.product.name.replace('Plus','Pro');},
 wrongPrice:r=>{r.product.offers.price='999';},
 wrongUrl:r=>{r.product.offers.url=origin+'/products/other';},
 soldOutConflict:r=>{r.stock='已售罄';},
 inStockConflict:r=>{r.product.offers.availability='https://schema.org/OutOfStock';r.stock='库存 即将售罄';},
 unknownTitleClause:r=>{r.visibleTitle+='【共享号】';r.entry.name=r.visibleTitle;},
}))test('Ai加油站 rejects inconsistent evidence: '+label,async t=>{
 const rows=structuredClone(products.slice(0,1));change(rows[0]);await assert.rejects(probe(t,{rows}).promise,{code:'INVALID_CATALOG'});
});
for(const policy of ['User-agent: *\nDisallow: /','User-agent: *\nDisallow: /products/'])test('Ai加油站 respects denied public paths '+policy,async t=>{
 await assert.rejects(probe(t,{policy}).promise,{code:'ROBOTS_DISALLOWED'});
});
test('Ai加油站 stops on a challenge',async t=>{const f=probe(t,{challenge:true});await assert.rejects(f.promise,{code:'ACCESS_DENIED'});assert.equal(f.calls.length,1);});
test('Ai加油站 obeys stricter crawl delay',async t=>{const f=probe(t,{rows:products.slice(0,2),policy:'User-agent: *\nAllow: /\nCrawl-delay: 3'});await f.promise;for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].start-f.calls[i-1].start>=3000);});

const updated=JSON.parse(readFileSync(new URL('./fixtures/aijiayou-public-products-updated.json',import.meta.url)));
test('Ai加油站 updated 20X title keeps eligibility while matching its repeated renewal phrase',async t=>{
 const {offers}=await probe(t,{rows:updated.products}).promise;
 assert.equal(offers.length,11);
 const renewal=offers.find(o=>o.url.endsWith('/chatgptpro-20x'));
 assert.equal(renewal.price,1160);assert.equal(renewal.status,'in_stock');
 assert.match(renewal.title,/订阅过20x均可/);assert.match(renewal.title,/续约或再次开启20x/);
 assert.equal(offers.find(o=>o.url.endsWith('/20xpro')).status,'out_of_stock');
});
for(const [label,change] of Object.entries({
 mismatchedPlan:r=>{r.product.name=r.product.name.replace(/plus/i,'Pro');},
 mismatchedPrice:r=>{r.product.offers.price='999';},
 mismatchedStock:r=>{r.stock='已售罄';},
 missingEligibility:r=>{r.visibleTitle+='【续约或再次开启20x】';r.entry.name=r.visibleTitle;},
}))test('Ai加油站 isolates one inconsistent product and keeps all other newly validated products: '+label,async t=>{
 const rows=structuredClone(products.slice(0,3));change(rows[1]);
 const {offers}=await probe(t,{rows}).promise;
 assert.deepEqual(offers.map(o=>o.url),[rows[0].entry.url,rows[2].entry.url]);
 assert.ok(offers.every(o=>o.extra.catalogValidation.rejectedCount===1));
 assert.deepEqual(offers[0].extra.catalogValidation,{listedCount:3,parsedCount:2,rejectedCount:1,rejections:[{url:rows[1].entry.url,reasonCode:'invalid_catalog'}]});
});
test('Ai加油站 does not normalize away conflicting 20X eligibility',async t=>{
 const row=structuredClone(updated.products.find(r=>r.entry.url.endsWith('/chatgptpro-20x')));
 row.product.name=row.product.name.replace('订阅过20x均可','任何号均可充值');
 await assert.rejects(probe(t,{rows:[row]}).promise,{code:'INVALID_CATALOG'});
});
for(const failure of [{status:403,body:'Forbidden'},{status:200,body:'<title>Just a moment</title>'},{status:500,body:'Server error'}])test('Ai加油站 never treats a blocked or failed read as isolated product data: '+failure.status+' '+failure.body,async t=>{
 await assert.rejects(probe(t,{rows:products.slice(0,2),detailFailure:{...failure,path:new URL(products[1].entry.url).pathname}}).promise);
});
test('Ai加油站 normal collection replaces old quotes with the validated subset and records rejected products',async t=>{
 t.mock.timers.enable({apis:['Date'],now:10000});
 const dataDir=mkdtempSync(path.join(tmpdir(),'aijiayou-collection-'));
 t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
 const rows=structuredClone(products.slice(0,3));let html=pages(rows),calls=0;
 const ctx={dataDir,sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:()=>async url=>{
  calls++;const pathname=new URL(url).pathname;
  return new Response(pathname==='/robots.txt'?'User-agent: *\nAllow: /':html[pathname]);
 }};
 const options=()=>({manifest:{merchants:[{id:'merchant-test',shopName:'Ai加油站',shopUrl:origin+'/',identity:'domain:aijiayou.win'}]},capturedAt:new Date().toISOString()});
 const first=await collectApprovedMerchants(ctx,options());assert.equal(first.offers.length,3);
 t.mock.timers.tick(31*60000);rows[1].product.offers.price='999';html=pages(rows);
 const second=await collectApprovedMerchants(ctx,options());
 assert.equal(second.health[0].status,'active');assert.equal(second.health[0].rejectedProductCount,1);
 assert.equal(second.offers.length,2);assert.equal(second.health[0].validCount,2);
 assert.ok(second.offers.every(o=>o.capturedAt!==first.offers[0].capturedAt));
 assert.ok(second.offers.every(o=>o.url!==rows[1].entry.url));
 const readCount=calls,cached=await collectApprovedMerchants(ctx,options());
 assert.equal(calls,readCount);assert.equal(cached.health[0].rejectedProductCount,1);assert.equal(cached.offers.length,2);
});
