import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHomeResponseCache} from '../lib/home-response-cache.mjs';

function request(url='/',headers={},method='GET') {return {url,method,headers:{host:'airadar.vip',...headers}};}
function response() {
 const res=new EventEmitter();res.statusCode=200;res.headers={'cache-control':'no-store'};
 res.setHeader=(key,value)=>res.headers[key.toLowerCase()]=value;
 res.getHeader=key=>res.headers[key.toLowerCase()];
 res.end=body=>{res.body=body;res.emit('finish');};
 return res;
}

test('homepage cache expires and invalidates immediately on public/private/campaign revisions',()=>{
 let time=0,revision='a',builds=0;
 const cache=createHomeResponseCache({revision:()=>revision,now:()=>time});
 const serve=()=>{const res=response();if(!cache.handle(request(),res)){builds++;res.setHeader('content-type','text/html');res.end('page-'+builds);}return res;};
 assert.equal(serve().body,'page-1');assert.equal(serve().body,'page-1');assert.equal(builds,1);
 revision='changed';assert.equal(serve().body,'page-2');
 time=30000;assert.equal(serve().body,'page-3');
 time=100;assert.equal(serve().body,'page-4');
});

test('sessions, auth, query variants, APIs and writes never share cached HTML',()=>{
 const cache=createHomeResponseCache({revision:()=>1});const seed=response();cache.handle(request(),seed);seed.end('anonymous');
 for(const req of [request('/',{cookie:'airadar_reader=secret'}),request('/',{cookie:'airadar_admin=secret'}),request('/',{cookie:'other=1'}),request('/',{authorization:'Bearer token'}),request('/?family=chatgpt'),request('/prices/chatgpt-plus'),request('/admin'),request('/api/retention/state'),request('/',{},'POST')]){
  const res=response();assert.equal(cache.handle(req,res),false,req.url);assert.equal(res.body,undefined);res.end('private');
 }
 const hit=response();assert.equal(cache.handle(request('/',{cookie:'cf_clearance=ok; __cf_bm=ok'}),hit),true);assert.equal(hit.body,'anonymous');assert.equal(hit.getHeader('cache-control'),'no-store');
});

test('cached responses keep per-request sponsor impressions, HEAD semantics and safe response headers',()=>{
 const events=[];const cache=createHomeResponseCache({revision:()=>1,onImpressions:(req,res,items)=>{if(req.method==='GET')res.once('finish',()=>events.push([req.headers.host,items]));}});
 const miss=response();assert.equal(cache.handle(request(),miss),false);miss.homeCacheImpressions.push({id:'campaign'});miss.setHeader('content-type','text/html');miss.setHeader('content-language','zh');miss.end('home');
 const hit=response();assert.equal(cache.handle(request(),hit),true);assert.equal(hit.body,'home');assert.equal(hit.getHeader('content-language'),'zh');assert.deepEqual(events,[['airadar.vip',[{id:'campaign'}]]]);
 const head=response();assert.equal(cache.handle(request('/',{},'HEAD'),head),true);assert.equal(head.body,undefined);assert.equal(events.length,1);
 const otherHost=response();assert.equal(cache.handle(request('/',{host:'other.test'}),otherHost),false);
});

test('Set-Cookie, error, oversized, streaming and concurrently changed responses are not cached',()=>{
 for(const kind of ['cookie','error','large','stream','revision']){
  let revision=1;const cache=createHomeResponseCache({revision:()=>revision,maxBytes:20});const res=response();res.write=()=>{};
  cache.handle(request(),res);
  if(kind==='cookie')res.setHeader('set-cookie','session=secret');
  if(kind==='error')res.statusCode=500;
  if(kind==='stream')res.headersSent=true;
  if(kind==='revision')revision++;
  res.end(kind==='large'?'x'.repeat(21):'page');
  assert.equal(cache.handle(request(),response()),false,kind);
 }
});

test('tracking-only queries reuse home HTML, meaningful and unknown queries still bypass',()=>{
 const cache=createHomeResponseCache({revision:()=>1});
 const seed=response();cache.handle(request('/?utm_source=first&gclid=a'),seed);seed.end('home');
 for(const url of ['/','/?utm_source=second','/?fbclid=b&msclkid=c','/?utm_campaign=x&wbraid=a&gbraid=b&dclid=c']){
  const res=response();assert.equal(cache.handle(request(url),res),true,url);assert.equal(res.body,'home');assert.equal(res.getHeader('x-accel-expires'),'30');
 }
 for(const url of ['/?family=chatgpt&utm_source=x','/?product=chatgpt-plus','/?unknown=value','/?q=a?utm_source=x'])assert.equal(cache.handle(request(url),response()),false,url);
 const disabled=createHomeResponseCache({revision:()=>1,maxAgeMs:0}),res=response();
 assert.equal(disabled.handle(request(),res),false);assert.equal(res.getHeader('x-accel-expires'),'0');assert.equal(res.getHeader('x-price-radar-home-cache'),undefined);
});
