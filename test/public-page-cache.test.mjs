import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPublicPageCache} from '../lib/public-page-cache.mjs';
import {publicCacheUrl} from '../lib/public-cache-key.mjs';
const request=(url='/prices/chatgpt-plus',headers={},method='GET')=>({url,method,headers:{host:'fixture.example',...headers}});
function response(){
 const res=new EventEmitter();res.statusCode=200;const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store'};
 res.setHeader=(key,value)=>headers[key.toLowerCase()]=value;res.getHeader=key=>headers[key.toLowerCase()];
 res.end=body=>{res.body=body;res.emit('finish');};return res;
}
const html='<!doctype html><html><body>quotes</body></html>';
function serve(cache,req=request(),change=()=>{}){const res=response();if(!cache.handle(req,res)){change(res);res.end(html);}return res;}
test('price cache collapses attribution but separates all filters, hosts, and sessions',()=>{
 const cache=createPublicPageCache();assert.equal(serve(cache).getHeader('x-price-radar-page-cache'),'MISS');
 for(const url of ['/prices/chatgpt-plus?utm_source=x&gclid=a','/prices/chatgpt-plus?fbclid=z']){
  const res=serve(cache,request(url));assert.equal(res.getHeader('x-price-radar-page-cache'),'HIT');assert.equal(res.getHeader('x-accel-expires'),'30');assert.equal(res.getHeader('cache-control'),'no-store');
 }
 for(const key of ['family','product','spec','delivery','channel','framework','page','unknown']){
  const url='/prices/chatgpt-plus?'+key+'=one';assert.equal(serve(cache,request(url)).getHeader('x-price-radar-page-cache'),'MISS');
  assert.equal(serve(cache,request(url+'&utm_source=x')).getHeader('x-price-radar-page-cache'),'HIT');
  assert.equal(serve(cache,request(url.replace('one','two'))).getHeader('x-price-radar-page-cache'),'MISS');
 }
 for(const headers of [{authorization:'fixture'},...['airadar_reader=a','airadar_admin=a','airadar_csrf=a','unknown=a'].map(cookie=>({cookie}))])assert.equal(serve(cache,request(undefined,headers)).getHeader('x-price-radar-page-cache'),undefined);
 for(const url of ['/advertise','/prices/chatgpt-plus?shop_q=x','/prices/chatgpt-plus?q=x'])assert.equal(serve(cache,request(url)).getHeader('x-price-radar-page-cache'),undefined);
 assert.equal(serve(cache,request(undefined,{host:'other.example'})).getHeader('x-price-radar-page-cache'),'MISS');
 assert.equal(publicCacheUrl('/product?id=a?b&utm_source=x'),'/product?id=a?b');
 assert.equal(publicCacheUrl('/?spec=a&spec=b&utm_source=x'), '/?spec=a&spec=b');
});
test('unsafe responses cannot advertise edge storage, zero TTL disables both caches',()=>{
 for(const change of [res=>res.setHeader('vary','Cookie'),res=>res.setHeader('set-cookie','fixture=a'),res=>{res.statusCode=500;},res=>res.setHeader('content-type','application/json')]){
  const cache=createPublicPageCache(),res=serve(cache,request(),change);assert.equal(res.getHeader('x-accel-expires'),'0');assert.equal(serve(cache).getHeader('x-price-radar-page-cache'),'MISS');
 }
 const cache=createPublicPageCache({maxAgeMs:0});const res=serve(cache);assert.equal(res.getHeader('x-accel-expires'),'0');assert.equal(res.getHeader('x-price-radar-page-cache'),undefined);
});
