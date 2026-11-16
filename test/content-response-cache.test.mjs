import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {CONTENT_PATHS} from '../lib/guides.mjs';
import {createContentResponseCache} from '../lib/content-response-cache.mjs';

const html=(body='guide')=>'<!DOCTYPE html><html><head></head><body>'+body+'</body></html>';
const request=(url='/guides',headers={},method='GET')=>({url,method,headers:{host:'airadar.vip',...headers}});
function response(){
 const res=new EventEmitter();res.statusCode=200;res.headers={'cache-control':'no-store','content-type':'text/html; charset=utf-8'};
 res.setHeader=(key,value)=>res.headers[key.toLowerCase()]=value;
 res.getHeader=key=>res.headers[key.toLowerCase()];
 res.end=body=>{res.body=body;res.emit('finish');};return res;
}
function render(cache,req=request(),body=html()){
 const res=response();if(!cache.handle(req,res))res.end(body);return res;
}

test('anonymous content cache retains no-store and every request still finishes for analytics',()=>{
 const cache=createContentResponseCache();let visits=0;
 for(const label of ['MISS','HIT']){
  const res=response();res.once('finish',()=>visits++);
  if(!cache.handle(request(),res))res.end(html());
  assert.equal(res.getHeader('x-price-radar-content-cache'),label);
  assert.equal(res.getHeader('cache-control'),'no-store');assert.equal(res.body,html());
 }
 assert.equal(visits,2);
});

test('only exact published content paths are cached; queries, redirects, errors and APIs bypass',()=>{
 const cache=createContentResponseCache();
 for(const path of CONTENT_PATHS){assert.equal(render(cache,request(path)).getHeader('x-price-radar-content-cache'),'MISS');assert.equal(render(cache,request(path)).getHeader('x-price-radar-content-cache'),'HIT');}
 for(const path of ['/','/guides/','/guides/missing','/guides?utm_source=test','/help?','/help#anchor','/en/guides','/api/retention/state','/account','/following','/submit','/unsubscribe','/go']){
  const res=response();assert.equal(cache.handle(request(path),res),false,path);assert.equal(res.getHeader('x-price-radar-content-cache'),undefined);
 }
 assert.equal(cache.handle(request('/guides',{},'POST'),response()),false);
});

test('authorization and business cookies bypass without poisoning anonymous HTML',()=>{
 const cache=createContentResponseCache();render(cache);
 for(const headers of [{authorization:'Bearer private'},...['airadar_reader=private','airadar_admin=private','airadar_csrf=private','airadar_reader_csrf=private','unknown=1','cf_clearance=ok; airadar_reader=private'].map(cookie=>({cookie}))]){
  const res=render(cache,request('/guides',headers),html('private'));
  assert.equal(res.getHeader('x-price-radar-content-cache'),undefined);assert.equal(res.body,html('private'));
 }
 const hit=render(cache,request('/guides',{cookie:'cf_clearance=ok; __cf_bm=ok; _cfuvid=ok'}));
 assert.equal(hit.getHeader('x-price-radar-content-cache'),'HIT');assert.equal(hit.body,html());
});

test('cache separates hosts and paths, and HEAD hits never send a body or populate misses',()=>{
 const cache=createContentResponseCache();render(cache,request('/guides'),html('guides'));
 assert.equal(render(cache,request('/help'),html('help')).getHeader('x-price-radar-content-cache'),'MISS');
 assert.equal(render(cache,request('/guides',{host:'preview.example'}),html('preview')).getHeader('x-price-radar-content-cache'),'MISS');
 assert.equal(render(cache,request('/guides')).body,html('guides'));
 const head=response();assert.equal(cache.handle(request('/guides',{},'HEAD'),head),true);assert.equal(head.body,undefined);assert.equal(head.getHeader('content-type'),'text/html; charset=utf-8');
 const miss=response();assert.equal(cache.handle(request('/help/price-alerts',{},'HEAD'),miss),false);miss.end(html('must not seed HEAD'));
 assert.equal(render(cache,request('/help/price-alerts')).getHeader('x-price-radar-content-cache'),'MISS');
 assert.equal(cache.handle(request('/guides',{host:'x'.repeat(257)}),response()),false);
});

test('entries expire after five minutes, reject clock rollback, and support explicit invalidation',()=>{
 let time=0;const cache=createContentResponseCache({now:()=>time});render(cache);
 time=299999;assert.equal(render(cache).getHeader('x-price-radar-content-cache'),'HIT');
 time=300000;assert.equal(render(cache).getHeader('x-price-radar-content-cache'),'MISS');
 time=1;assert.equal(render(cache).getHeader('x-price-radar-content-cache'),'MISS');
 cache.clear();assert.equal(render(cache).getHeader('x-price-radar-content-cache'),'MISS');
});

test('the default 32-entry bound evicts old HTML and copies buffered bodies',()=>{
 const cache=createContentResponseCache();
 for(let n=0;n<33;n++)render(cache,request('/guides',{host:`preview${n}.example`}));
 assert.equal(render(cache,request('/guides',{host:'preview32.example'})).getHeader('x-price-radar-content-cache'),'HIT');
 assert.equal(render(cache,request('/guides',{host:'preview0.example'})).getHeader('x-price-radar-content-cache'),'MISS');
 const bytes=Buffer.from(html('buffered'));render(cache,request('/help'),bytes);bytes.fill(120);
 assert.equal(render(cache,request('/help')).body.toString(),html('buffered'));
});

test('private, token-bearing, partial, varied, error and oversized responses never enter the cache',()=>{
 const cases=[
  ['cookie',res=>res.setHeader('set-cookie','session=private')],
  ['error',res=>{res.statusCode=500;}],['redirect',res=>{res.statusCode=301;}],
  ['streaming',res=>{res.headersSent=true;}],['vary',res=>res.setHeader('vary','Cookie')],
  ['not-html',res=>res.setHeader('content-type','application/json')],
  ['partial',()=>{},'<html><body>unfinished'],['oversize',()=>{},html('x'.repeat(300000))],
  ['csrf',()=>{},html('<meta name="csrf-token" content="secret">')],
  ['account-nav',()=>{},html('<a href="/account" class="nav-link" data-reader-nav>我的账号</a>')],
  ['account-page',()=>{},html('<section data-account-page>private</section>')],
  ['auth-page',()=>{},html('<section data-auth-page>private</section>')],
  ['following',()=>{},html('<section data-following-page>private</section>')],
  ['unsubscribe',()=>{},html('<form data-unsubscribe-form>private</form>')],
  ['sponsor-token',()=>{},html('<article data-sponsor-token="expiring">ad</article>')],
  ['sponsor-id',()=>{},html('<article data-sponsor-id="campaign">ad</article>')],
  ['nonce',()=>{},html('<script nonce="per-request">code</script>')],
 ];
 for(const [name,change,body=html()] of cases){
  const cache=createContentResponseCache(),res=response();cache.handle(request(),res);change(res);res.end(body);
  assert.equal(render(cache).getHeader('x-price-radar-content-cache'),'MISS',name);
 }
});
