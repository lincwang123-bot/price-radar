import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {articleForPath,faqEntities} from '../lib/guides.mjs';

test('FAQ guide exposes visible Q&A and FAQPage JSON-LD',async()=>{
 const article=articleForPath('/guides/ai-subscription-faq');
 assert.equal(article.faq,true);
 const faqs=faqEntities(article);
 assert.ok(faqs.length>=5);
 assert.ok(faqs.every(q=>q['@type']==='Question'&&q.name&&q.acceptedAnswer?.text));
 const db=openDb(':memory:');
 const app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${app.address().port}`;
 try{
  const html=await(await fetch(origin+'/guides/ai-subscription-faq')).text();
  assert.match(html,/<h2>AIradar 是卖账号的吗？<\/h2>/);
  const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const faq=schema.find(s=>s['@type']==='FAQPage');
  assert.ok(faq);assert.equal(faq.mainEntity.length,faqs.length);
  assert.match(html,/summary_large_image/);
  assert.match(html,/og-share\.png/);
 }finally{await new Promise(r=>app.close(r));db.close();}
});

test('llms.txt, about definition, robots filter disallow, OG asset',async()=>{
 const db=openDb(':memory:');
 const app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${app.address().port}`;
 try{
  const llms=await(await fetch(origin+'/llms.txt')).text();
  assert.match(llms,/AIradar/);assert.match(llms,/\/about/);assert.match(llms,/\/prices\/chatgpt-plus/);
  assert.match(await(await fetch(origin+'/llms-full.txt')).text(),/\/guides\/ai-subscription-faq/);
  assert.match(await(await fetch(origin+'/about')).text(),/一句话定义（可引用）/);
  assert.match(await(await fetch(origin+'/sources')).text(),/可引用定义/);
  const robots=await(await fetch(origin+'/robots.txt')).text();
  assert.match(robots,/Disallow: \/\*\?\*delivery=/);
  assert.match(robots,/Sitemap: https:\/\/airadar.vip\/sitemap.xml/);
  const og=await fetch(origin+'/assets/brands/og-share.png');
  assert.equal(og.status,200);
  assert.equal(og.headers.get('content-type'),'image/png');
  await og.body?.cancel();
 }finally{await new Promise(r=>app.close(r));db.close();}
});

test('Product AggregateOffer on schema pilots matches visible prices',async()=>{
 const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://example.com/'+id});
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'direct-shops',snapshotId:'schema-pilot',products:[
  {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[offer('a','ChatGPT Plus 1个月代充',88),offer('b','ChatGPT Plus 1个月代充',120)]},
  {productId:'claude-pro-month',name:'Claude Pro',currency:'CNY',offers:[offer('c','Claude Pro 1个月代充',150),offer('d','Claude Pro 1个月代充',190)]},
  {productId:'gemini-pro-recharge',name:'Google AI Pro',currency:'CNY',offers:[offer('e','Google AI Pro 1个月代充',99)]},
 ]});
 const app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${app.address().port}`;
 try{
  for(const [path,name] of [['/prices/chatgpt-plus','ChatGPT Plus'],['/prices/claude-pro','Claude Pro'],['/prices/gemini-pro','Gemini / Google AI Pro']]){
   const html=await(await fetch(origin+path)).text();
   const prices=[...html.matchAll(/<article\b[^>]*\bdata-directory-quote\b[^>]*\bdata-price="([^"]+)"[^>]*\bdata-currency="([^"]+)"/g)].filter(m=>m[2]==='CNY').map(m=>Number(m[1]));
   assert.ok(prices.length>=1,path+' should show visible quotes');
   const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
   const product=schema.find(s=>s['@type']==='Product');
   if(path==='/prices/gemini-pro'){assert.equal(product,undefined,'unconfirmed delivery is not a comparable recharge');continue;}
   assert.ok(product,path);assert.equal(product.name,name);
   assert.equal(product.offers['@type'],'AggregateOffer');
   assert.equal(product.offers.priceCurrency,'CNY');
   assert.equal(product.offers.lowPrice,Math.min(...prices));
   assert.equal(product.offers.highPrice,Math.max(...prices));
   assert.equal(product.offers.offerCount,prices.length);
  }
 }finally{await new Promise(r=>app.close(r));db.close();}
});
