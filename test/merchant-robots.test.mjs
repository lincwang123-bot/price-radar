import test from 'node:test';
import assert from 'node:assert/strict';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
const origin='https://robots-fixture.com',merchant={id:'merchant-robots-fixture',shopName:'目录测试店',shopUrl:origin+'/',identity:'domain:robots-fixture.com',platform:'independent'};
const name='ChatGPT Plus 月卡充值';
const home=`<main><article class="product-card"><h3>${name}</h3><strong class="price">¥128</strong><a href="/products/one">详情</a></article><a href="/?category=gpt&type=card#products">筛选</a></main>`;
const detail=`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name,offers:{'@type':'Offer',price:'128.00',priceCurrency:'CNY',availability:'https://schema.org/InStock',url:origin+'/products/one'}})}</script><main><h1>${name}</h1><strong class="price">¥128</strong></main>`;
const response=(body,status=200,type='text/plain')=>new Response(body,{status,headers:{'content-type':type}});
function fixture(policy,{robotsStatus=200,api,sleep=async()=>{}}={}){
 const calls=[];
 const ctx={sleep,merchantFetchFactory:()=>async(url,init)=>{const path=new URL(url).pathname;calls.push({url,path,agent:new Headers(init.headers).get('user-agent')});
  if(path==='/robots.txt')return response(policy,robotsStatus);
  if(path.startsWith('/api/')||path.startsWith('/user/'))return api?api(url):response('',404);
  return response(path==='/'?home:detail,200,'text/html');
 }};
 return {calls,run:()=>probeMerchantCatalog(merchant,ctx,new Date().toISOString(),Date.now()+30000)};
}
test('robots is read before discovery; forbidden APIs and filter variants are never requested',async()=>{
 const f=fixture('User-agent: *\nDisallow: /api/\nDisallow: /user/api/\nDisallow: /checkout/');
 const r=await f.run();assert.equal(r.offers.length,1);
 assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt','/','/products/one']);assert.ok(f.calls.every(c=>c.agent.includes('AiradarBot')));
});
test('robots 404 permits bounded discovery, while denied robots or all-path prohibition stop before APIs',async()=>{
 const absent=fixture('',{robotsStatus:404});assert.equal((await absent.run()).offers.length,1);assert.equal(absent.calls.length,5);assert.equal(absent.calls[0].path,'/robots.txt');
 for(const f of [fixture('',{robotsStatus:403}),fixture('User-agent: *\nDisallow: /')]){
  await assert.rejects(f.run());assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt']);
 }
});
test('allowed public JSON discovery and later pages also follow the same robots policy',async()=>{
 const product={id:1,name,price:128,price_cents:12800,currency:'CNY',stock:2,status:'in_stock',product_url:origin+'/products/one'};
 const f=fixture('User-agent: *\nDisallow: /api/\nAllow: /api/v1/public/products?page=1&\n', {api:url=>response(JSON.stringify({page:1,page_size:1,total:2,count:1,items:[product]}),200,'application/json')});
 await assert.rejects(f.run(),e=>e.code==='ROBOTS_DISALLOWED');
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].path,'/robots.txt');assert.ok(f.calls[1].url.includes('page=1&'));
});

 test('specific bot policy and crawl delay apply to API retries within the shared budget',async t=>{
  t.mock.timers.enable({apis:['Date'],now:10000});
  const starts=[];let attempts=0;
  const product={id:1,name,price:128,currency:'CNY',stock:2,product_url:origin+'/products/one'};
  const f=fixture('User-agent: *\nDisallow: /\nUser-agent: AiradarBot\nAllow: /\nCrawl-delay: 3',{
   sleep:async ms=>t.mock.timers.tick(ms),
   api:()=>{starts.push(Date.now());return ++attempts===1?response('{}',500,'application/json'):response(JSON.stringify({page:1,page_size:100,total:1,count:1,items:[product]}),200,'application/json');}
  });
  assert.equal((await f.run()).offers.length,1);
  assert.deepEqual(starts,[13000,16000]);assert.equal(f.calls.length,3);
 });
