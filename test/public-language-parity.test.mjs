import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

async function fixture(run){
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'direct-shops',snapshotId:'locale-parity',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:Array.from({length:13},(_,i)=>({offerId:'o'+i,storeName:i===0?'搜索':'示例商家 '+i,title:i===0?'ChatGPT Plus 代充 1个月 <script>bad</script>':'ChatGPT Plus iOS 代充 1个月 新开续费均可',price:100+i,currency:'CNY',status:'in_stock',stockCount:1,url:'https://locale'+i+'.example.test/item'}))}]});
 const app=createApp({db});
 try{await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;await run(async path=>{const r=await fetch(origin+path);return {status:r.status,html:await r.text()};});}
 finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
}
const classes=html=>[...html.matchAll(/class="([^"]+)"/g)].map(m=>m[1]);
test('English and Chinese home use the same shell, stylesheet, product rows and navigation entries',()=>fixture(async get=>{
 const zh=(await get('/')).html,en=(await get('/en/')).html;
 for(const name of ['app-header','app-nav','product-nav','shop-search','growth-hero','growth-paths','growth-catalog-title','directory-row','site-footer'])assert.ok(classes(en).some(c=>c.split(' ').includes(name)),name);
 assert.equal(en.match(/href="(\/assets\/site.css\?v=[^"]+)"/)[1],zh.match(/href="(\/assets\/site.css\?v=[^"]+)"/)[1]);
 assert.equal((en.match(/class="nav-link/g)||[]).length,(zh.match(/class="nav-link/g)||[]).length);
 assert.equal((en.match(/data-directory-product="/g)||[]).length,(zh.match(/data-directory-product="/g)||[]).length);
 assert.doesNotMatch(en,/en-header|en-grid|en-product|<style>:root/);
 assert.match(en,/Find a shop/);assert.match(en,/Current quotes for popular products/);assert.match(en,/href="\/en\/catalog"/);
 assert.match(en,/hreflang="zh-CN" href="https:\/\/airadar.vip\/"/);
}));
test('Quote filters, merchant identity, public reviews and original claims survive shared localization',()=>fixture(async get=>{
 const zh=(await get('/prices/chatgpt-plus')).html,en=(await get('/en/prices/chatgpt-plus')).html;
 assert.equal((en.match(/data-directory-quote /g)||[]).length,10);
 assert.equal((zh.match(/data-directory-quote /g)||[]).length,10);
 for(const name of ['delivery-selector','recharge-options','detail-filters','directory-quote-buy','directory-review-button','offer-pagination'])assert.ok(classes(en).some(c=>c.split(' ').includes(name)),name);
 const last=(await get('/en/prices/chatgpt-plus?page=2')).html;
 assert.match(en+last,/>搜索(?:<|$)/);assert.match(en+last,/ChatGPT Plus 代充 1个月 &lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(en+last,/<script>bad/);
 assert.match(en,/href="\/en\/prices\/chatgpt-plus\?[^"\n]*recharge=ios/);
 const filtered=(await get('/en/prices/chatgpt-plus?delivery=recharge&recharge=ios&page=2')).html;
 assert.match(filtered,/data-recharge-choice="ios" aria-current="true"/);assert.match(filtered,/data-language-switch href="\/prices\/chatgpt-plus\?[^"\n]*recharge=ios/);
 const link=en.match(/href="(\/en\/shop\?id=[a-f0-9]{24})#reviews"/)[1];
 const detail=(await get(link)).html;assert.match(detail,/class="shop-reviews"/);assert.match(detail,/class="review-heading"/);assert.match(detail,/Reviews <span>0/);
 assert.match(detail,/class="x-list-row"/);assert.doesNotMatch(detail,/data-review-form/);assert.match(detail,/Write a review \(Chinese\)/);
}));
test('Official references, about, sources and catalogue reuse their Chinese components',()=>fixture(async get=>{
 for(const [path,marker] of [['official-prices','official-page'],['about','guide-article'],['sources','surface'],['catalog','directory-list']]){
  const en=await get('/en/'+path);assert.equal(en.status,200);assert.ok(classes(en.html).some(c=>c.split(' ').includes(marker)),path);assert.match(en.html,/class="app-header"/);
 }
 const search=(await get('/en/?shop_q=locale0.example.test')).html;assert.match(search,/class="shop-search-results"/);assert.match(search,/class="shop-search-result"/);assert.match(search,/1 shops/);
 const catalogue=(await get('/catalog')).html;assert.match(catalogue,/hreflang="en" href="https:\/\/airadar.vip\/en\/catalog"/);
}));
test('English separates official references from the ten merchant quotes on each page',async()=>{
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'direct-shops',snapshotId:'parity-quotes',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:Array.from({length:12},(_,i)=>({offerId:'o'+i,storeName:'Shop '+i,title:'ChatGPT Plus iOS 代充 1个月 新开续费均可',price:100+i,currency:'CNY',status:'in_stock',url:'https://reference'+i+'.example.test/item'}))}]});
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'parity-reference',products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[{offerId:'reference',storeName:'Official reference',price:140,currency:'CNY',status:'official',url:'https://cardnav.xyz/official-price/chatgpt-plus'}]}]});
 const app=createApp({db});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  for(const path of ['/prices/chatgpt-plus','/en/prices/chatgpt-plus']){
   const h=await(await fetch('http://127.0.0.1:'+app.address().port+path)).text();
   const merchants=h.split('<div class="directory-quotes">')[1].split(/<\/div><p class="note">(?:第 |Page )/)[0];
   assert.equal((merchants.match(/data-directory-quote /g)||[]).length,10);
   assert.match(h,/class="directory-references"/);assert.equal((h.match(/data-directory-quote /g)||[]).length,11);
  }
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
});
