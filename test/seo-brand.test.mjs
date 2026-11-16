import test from 'node:test';
import http from 'node:http';
const request=(url,options)=>new Promise((resolve,reject)=>{const q=http.request(url,options,r=>{r.resume();r.on('end',()=>resolve({status:r.statusCode,headers:{get:key=>r.headers[key]}}));});q.on('error',reject);q.end();});
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {canonicalHostRedirect} from '../lib/seo.mjs';

test('favicon serves the existing brand; article bylines resolve to matching author information',async()=>{
 const db=openDb(':memory:'),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 try{
  const home=await(await fetch(origin)).text();assert.match(home,/<link rel="icon" type="image\/png" sizes="512x512" href="\/assets\/brands\/airadar.png">/);
  const redirect=await fetch(origin+'/favicon.ico',{redirect:'manual'});assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/assets/brands/airadar.png');
  const icon=await fetch(origin+'/favicon.ico');assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await icon.arrayBuffer()),readFileSync(new URL('../assets/brands/airadar.png',import.meta.url)));
  const head=await fetch(origin+'/favicon.ico',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const post=await fetch(origin+'/favicon.ico',{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
  const article=await(await fetch(origin+'/guides/chatgpt-go-vs-plus')).text();assert.match(article,/<a href="\/about#editorial" rel="author">AI订阅雷达<\/a>/);
  const schema=JSON.parse(article.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(schema.find(x=>x['@type']==='Article').author.url,'https://airadar.vip/about#editorial');
  assert.match(await(await fetch(origin+'/about')).text(),/<section id="editorial">/);
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
});

test('trusted host redirects preserve clean price paths and parameters before internal routing',async()=>{
 const db=openDb(':memory:');storeSnapshot(db,{source:'direct-shops',snapshotId:'host-fixture',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'1',title:'ChatGPT Plus iOS代充 1个月',price:120,status:'in_stock',stockCount:1,currency:'CNY',url:'https://example.com/plus'}]}]});
 const app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 try{for(const path of ['/','/prices/chatgpt-plus?delivery=recharge&recharge=ios','/guides/chatgpt-go-vs-plus?utm_source=x','/assets/brands/airadar.png','/missing'])for(const method of ['GET','HEAD']){
   const response=await request(origin+path,{method,headers:{host:'www.airadar.vip','x-forwarded-proto':'https'}});assert.equal(response.status,301);assert.equal(response.headers.get('location'),'https://airadar.vip'+path);await response.body?.cancel();
  }
  const untrusted={socket:{remoteAddress:'203.0.113.1'},headers:{host:'www.airadar.vip','x-forwarded-proto':'http'},method:'GET'};
  assert.equal(canonicalHostRedirect(untrusted,{writeHead(){assert.fail('untrusted redirect');},setHeader(){assert.fail('untrusted HSTS');}},new URL(origin)),false);
  const http=await fetch(origin+'/prices/chatgpt-plus?delivery=recharge',{redirect:'manual',headers:{'x-forwarded-proto':'http'}});assert.equal(http.headers.get('location'),'https://airadar.vip/prices/chatgpt-plus?delivery=recharge');
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
});
