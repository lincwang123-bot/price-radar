import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
test('百度验证只响应精确公开文件，GET字节一致、HEAD无正文、其他方法405',async()=>{
 const db=openDb(':memory:'),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.address().port}`,path='/baidu_verify_codeva-5RkS1i3vOP.html';
 try{const get=await fetch(origin+path);assert.equal(get.status,200);assert.deepEqual(Buffer.from(await get.arrayBuffer()),Buffer.from('67e45203694e31d32e7dec268a770435'));assert.equal(get.headers.get('content-type'),'text/html; charset=utf-8');assert.equal(get.headers.get('content-length'),'32');
 const head=await fetch(origin+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'32');assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const method of ['POST','PUT','DELETE','OPTIONS']){const r=await fetch(origin+path,{method});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET, HEAD');await r.body?.cancel();}
 for(const p of ['/baidu_verify_codeva-unknown.html',path+'/','/baidu_verify_codeva-../.env']){const r=await fetch(origin+p);assert.equal(r.status,404);await r.body?.cancel();}
 assert.doesNotMatch(await(await fetch(origin+'/sitemap.xml')).text(),/baidu_verify/);
 }finally{await new Promise(r=>app.close(r));db.close();}
});
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
