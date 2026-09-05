import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
test('SEO canonical、sitemap、真实404、私密noindex及可信HTTPS重定向',async()=>{
 const db=openDb(':memory:');storeSnapshot(db,{source:'direct-shops',snapshotId:'seo-fixture',products:[{productId:'claude-pro-month',name:'Claude </script> Pro',platform:'Claude',currency:'CNY',offers:[{offerId:'1',price:100,status:'in_stock',stockCount:1,url:'https://morimm.com/products/1'}]}]});
 const app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.address().port}`;
 try{const get=(p,options={})=>fetch(origin+p,{redirect:'manual',...options});
 const home=await(await get('/')).text();assert.match(home,/<link rel="canonical" href="https:\/\/airadar.vip\/"/);assert.match(home,/name="description"/);assert.match(home,/application\/ld\+json/);
 const product=await(await get('/product?source=direct-shops&id=claude-pro-month&channel=16688&utm_source=x')).text();assert.match(product,/rel="canonical" href="https:\/\/airadar.vip\/product\?source=direct-shops&amp;id=claude-pro-month"/);for(const m of product.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs))assert.doesNotThrow(()=>JSON.parse(m[1]));
 assert.equal((await get('/product?id=missing')).status,404);assert.equal((await get('/index.html')).status,301);assert.equal((await get('/product/?id=x')).status,301);
 for(const p of ['/submit','/api/submissions','/missing'])assert.match((await get(p)).headers.get('x-robots-tag'),/noindex/);
 const map=await(await get('/sitemap.xml')).text();assert.match(map,/<loc>https:\/\/airadar.vip\/product\?source=direct-shops&amp;id=claude-pro-month<\/loc>/);assert.doesNotMatch(map,/utm_|channel=|admin|submit/);assert.doesNotMatch(map,/<lastmod>/);
 assert.match(await(await get('/robots.txt')).text(),/Sitemap: https:\/\/airadar.vip\/sitemap.xml/);
 const redirect=await get('/?x=1',{headers:{'x-forwarded-proto':'http'}});assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'https://airadar.vip/?x=1');
 }finally{await new Promise(r=>app.close(r));db.close();}
});
