import test from 'node:test';import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';import {createApp} from '../lib/web.mjs';
import {PRICE_PRODUCTS,compactPriceParams} from '../lib/price-routes.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
test('stable product routes, old shares, pagination, filtered canonicals and unknown URLs',async()=>{
 const db=openDb(':memory:');let app;
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'routes',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:Array.from({length:25},(_,i)=>({offerId:'o'+i,title:'ChatGPT Plus 代充 1个月 新开续费均可',price:120+i,currency:'CNY',status:'in_stock',stockCount:1,url:'https://shop'+i+'.example.com/product'}))}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
  const get=(path,options)=>fetch(origin+path,options);
  const old=await get('/?family=chatgpt&product=chatgpt-plus',{redirect:'manual'});assert.equal(old.status,301);assert.equal(old.headers.get('location'),'/prices/chatgpt-plus');
  for(const [from,to] of [
   ['/prices/chatgpt-plus?delivery=all&purchase=all&sort=price_asc&channel=all&page=1','/prices/chatgpt-plus'],
   ['/prices/chatgpt-plus?delivery=all&sort=comprehensive&page=1','/prices/chatgpt-plus?sort=comprehensive'],
   ['/prices/chatgpt-plus/?delivery=all&channel=all&page=2&utm_source=google','/prices/chatgpt-plus?page=2&utm_source=google'],
   ['/prices/chatgpt-plus?delivery=recharge&recharge=ios&purchase=all&sort=price_asc&channel=all&page=2','/prices/chatgpt-plus?delivery=recharge&recharge=ios&page=2'],
   ['/?family=chatgpt&product=chatgpt-plus&delivery=all&sort=price_asc&channel=all&utm_source=google','/prices/chatgpt-plus?utm_source=google'],
  ])for(const method of ['GET','HEAD']){const response=await get(from,{method,redirect:'manual'});assert.equal(response.status,301,from);assert.equal(response.headers.get('location'),to);assert.equal((await get(to,{method,redirect:'manual'})).status,200,'one-hop destination '+to);}
  for(const path of ['/catalog','/?family=chatgpt']){const html=await(await get(path)).text();assert.match(html,/<a class="directory-product-title" href="\/prices\/chatgpt-plus">ChatGPT Plus<\/a>/);}
  const full=await(await get('/prices/chatgpt-plus')).text();
  const links=[...full.matchAll(/href="(\/prices\/chatgpt-plus[^\"]*)"/g)].map(m=>new URL(m[1].replaceAll('&amp;','&'),origin));
  assert.ok(links.some(u=>u.searchParams.get('page')==='2'));assert.ok(links.some(u=>u.searchParams.get('sort')==='comprehensive'));
  for(const link of links)for(const [key,value] of Object.entries({delivery:'all',recharge:'all',purchase:'all',channel:'all',sort:'price_asc',page:'1'}))assert.notEqual(link.searchParams.get(key),value,link.href);
  for(const path of ['/prices/chatgpt-plus','/prices/chatgpt-plus?page=2']){const r=await get(path),body=await r.text();assert.equal(r.status,200);assert.match(body,/aria-label="充值类型"/);assert.doesNotMatch(body,/选择适合你的完整规格/);assert.ok(body.includes('rel="canonical" href="https://airadar.vip'+path+'"'));assert.match(body,/<meta name="robots" content="index, follow/);assert.equal((body.match(/<h1\b/g)||[]).length,1);}
  for(const path of ['/prices/chatgpt-plus?delivery=recharge','/?family=chatgpt&product=chatgpt-plus&delivery=recharge','/prices/chatgpt-plus?sort=comprehensive','/?family=chatgpt&product=chatgpt-plus&sort=comprehensive']){const r=await get(path),body=await r.text();assert.equal(r.status,200);assert.match(body,/<meta name="robots" content="noindex, follow/);assert.match(body,/rel="canonical" href="https:\/\/airadar.vip\/prices\/chatgpt-plus"/);if(path.includes('sort=comprehensive'))assert.match(body,/data-sort-choice="comprehensive" aria-current="true"/);}
  for(const path of ['/prices/not-real','/prices/chatgpt-plus/not-real','/?family=chatgpt&product=not-real'])assert.equal((await get(path)).status,404);
  const slash=await get('/prices/chatgpt-plus/?utm_source=x',{redirect:'manual'});assert.equal(slash.status,301);assert.equal(slash.headers.get('location'),'/prices/chatgpt-plus?utm_source=x');
  assert.equal((await get('/prices/chatgpt-plus',{method:'HEAD'})).status,200);
  const xml=await(await get('/sitemap.xml')).text();assert.match(xml,/<loc>https:\/\/airadar.vip\/prices\/chatgpt-plus<\/loc>/);assert.doesNotMatch(xml,/<loc>[^<]*family=chatgpt&amp;product=chatgpt-plus/);
  assert.equal((await get('/following')).status,200);
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
test('compacting default quote parameters preserves real filters, attribution and ambiguous duplicate values',()=>{
 const query='delivery=recharge&recharge=ios&purchase=new&sort=price_desc&channel=16688&currency=CNY&spec=30d%3Apro&page=2&utm_source=google';
 assert.equal(compactPriceParams(query).toString(),new URLSearchParams(query).toString());
 assert.deepEqual(compactPriceParams('channel=all&channel=16688&sort=comprehensive&page=1').getAll('channel'),['all','16688']);
 assert.equal(compactPriceParams('sort=comprehensive&page=1').toString(),'sort=comprehensive');
 assert.equal(compactPriceParams('sort=price_asc&page=1').toString(),'');
 assert.equal(compactPriceParams('delivery=unknown&sort=invalid&page=01').toString(),'delivery=unknown&sort=invalid&page=01');
});
test('unconfirmed cheap recharge sets the observed headline but not same-spec prices; outbound search buckets use the actual product',async()=>{
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','growth-integration-0000000000000000000000');let app;
 try{
  const offers=[['unknown','ChatGPT Plus 代充1个月',1],['new','ChatGPT Plus 代充1个月 仅限新开',100],['renew','ChatGPT Plus 代充1个月 仅限续费 剩余3天内到期',80]].map(([offerId,title,price])=>({offerId,title,price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://shop.example.com/'+offerId}));
  storeSnapshot(db,{source:'ldxp-goods',snapshotId:'conditions',products:[{productId:'gpt-plus',name:'ChatGPT Plus',currency:'CNY',offers}]});
  app=createApp({db,analytics});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.text();};
  const homepage=await get('/'),card=homepage.match(/<article class="directory-row" data-directory-product="chatgpt-plus">[\s\S]*?<\/article>/)[0];assert.match(card,/data-directory-minimum>¥1 /);assert.match(card,/商家标价 · 条件待确认/);assert.doesNotMatch(card,/¥80/);
  const ascending=await get('/prices/chatgpt-plus?sort=price_asc');assert.match(ascending,/data-price="1"/);assert.doesNotMatch(ascending,/data-comparable-summary/);
  const fresh=await get('/prices/chatgpt-plus?delivery=recharge&purchase=new');assert.match(fresh,/data-price="100"/);assert.doesNotMatch(fresh,/data-price="(?:1|80)"/);
  const history=[...fresh.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>h.startsWith('/product?')&&h.includes('spec='));assert.ok(history);
  const spec=new URL(history,base).searchParams.get('spec');
  const selected=await get('/prices/chatgpt-plus?delivery=recharge&spec='+encodeURIComponent(spec));assert.match(selected,/data-comparable-summary/);assert.match(selected,/当前同规格已记录起价 ¥100/);assert.doesNotMatch(selected,/data-price="(?:1|80)"/);assert.match(selected,/取消规格筛选/);
  assert.doesNotMatch(await get('/prices/chatgpt-plus?purchase=not-real'),/data-directory-quote /);
  const path='/go?'+new URLSearchParams({source:'ldxp-goods',snapshot:'conditions',product:'gpt-plus',offer:'new',ack:'1'});
  const redirect=await fetch(base+path,{redirect:'manual',headers:{'user-agent':'Mozilla/5.0 Chrome/150','cf-connecting-ip':'203.0.113.8'}});assert.equal(redirect.status,302);
  await new Promise(setImmediate);assert.equal(analytics.growth.report().products.find(p=>p.key==='chatgpt-plus').outbound,1);
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}analytics.close();db.close();}
});
