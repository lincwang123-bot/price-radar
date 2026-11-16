import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot,metaSet} from '../lib/db.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {buildShopCatalog} from '../lib/merchant-x.mjs';
import {quoteInsights} from '../lib/product-insights.mjs';
import {sitemap} from '../lib/seo.mjs';
import {createPublicDirectoryCache} from '../lib/public-directory-cache.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';

const now=Date.parse('2026-11-12T12:00:00Z'),hour=3600000;
function fixture(source='direct-shops') {
 const db=openDb(':memory:');
 storeSnapshot(db,{source,snapshotId:'test',fetchedAt:new Date(now).toISOString(),products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[]}]});
 const snapshot=db.prepare('SELECT * FROM snapshots').get(),product=db.prepare('SELECT * FROM products').get();
 const project=(age,status='stale',options={})=>projectProduct(db,source,snapshot,product,{now,offers:[{offer_id:'qa',title:'ChatGPT Plus 月卡代充 新开续费均可',price:100,currency:'CNY',status:'in_stock',stock_count:1,url:'https://retained-qa.example.org/product',captured_at:new Date(now-age).toISOString(),extra:JSON.stringify({quoteHealth:{status,maxAgeMinutes:1440}})}],...options});
 const quotes=projected=>buildProductDirectory([{source,products:[projected]}]).flatMap(c=>c.products.flatMap(p=>directoryQuotes(p).entries));
 return {db,project,quotes};
}

test('failed retained quotes obey the inclusive 72 hour boundary in public directory and cache expiry',()=>{
 const {db,project,quotes}=fixture();
 try {
  for(const age of [hour,72*hour,72*hour+1,100*hour]) {
   let until=Infinity;
   const p=project(age,'stale',{onValidUntil:at=>{until=Math.min(until,at);}}),visible=age<=72*hour;
   assert.equal(p.offers[0].quote_stale,true);
   assert.equal(p.offers[0].quote_retained,visible);
   assert.equal(quotes(p).length,visible?1:0);
   if(visible)assert.equal(until,now-age+72*hour+1);
  }
 } finally {db.close();}
});

test('successful stable prices and recovered collection appear; historical projection is unchanged',()=>{
 const {db,project,quotes}=fixture();
 try {
  assert.equal(quotes(project(100*hour)).length,0);
  for(const status of ['ok','cached']) {
   const p=project(hour,status);assert.equal(p.offers[0].quote_stale,false);assert.equal(quotes(p).length,1);
  }
  const historical=project(100*hour,'stale',{historical:true});
  assert.equal(historical.offers[0].quote_stale,true);assert.equal(historical.offers[0].quote_retained,false);assert.equal(historical.offers.length,1);
 } finally {db.close();}
});

test('source-wide failed health uses the same limit for ldxp-goods',()=>{
 const {db,project,quotes}=fixture('ldxp-goods');
 try {
  metaSet(db,'health:ldxp-goods',JSON.stringify({status:'failed',checkedAt:new Date(now).toISOString()}));
  for(const age of [hour,73*hour]) {
   const p=project(age,'ok');assert.equal(p.offers[0].quote_stale,true);assert.equal(p.offers[0].quote_retained,age<=72*hour);assert.equal(quotes(p).length,age<=72*hour?1:0);
  }
 } finally {db.close();}
});

test('environment override, rollback and invalid defaults',()=>{
 const previous=process.env.AIRADAR_RETAINED_QUOTE_MAX_HOURS;
 const {db,project,quotes}=fixture();
 try {
  for(const [value,age,visible] of [['24',25*hour,false],['24',24*hour,true],['-1',1000*hour,true],['off',1000*hour,true],['0',73*hour,false],['garbage',73*hour,false],['-2',73*hour,false],['Infinity',73*hour,false],['',73*hour,false]]) {
   process.env.AIRADAR_RETAINED_QUOTE_MAX_HOURS=value;
   const p=project(age);assert.equal(p.offers[0].quote_retained,visible,value);assert.equal(quotes(p).length,visible?1:0,value);
  }
 } finally {if(previous===undefined)delete process.env.AIRADAR_RETAINED_QUOTE_MAX_HOURS;else process.env.AIRADAR_RETAINED_QUOTE_MAX_HOURS=previous;db.close();}
});


test('public projection, shop counts, insights and sitemap agree before and after expiry',()=>{
 const {db,project}=fixture();
 try {
  db.prepare('UPDATE products SET offer_count=1').run();
  for(const age of [71*hour,73*hour]) {
   const visible=age<72*hour,p=project(age,'stale',{publicOnly:true});
   assert.equal(p.offer_count,visible?1:0);
   assert.equal(p.offers.length,visible?1:0);
   assert.equal(p.selected_offer!==null,visible);
   const directory=buildProductDirectory([{source:'direct-shops',products:[p]}]);
   const entries=directory.flatMap(c=>c.products.flatMap(p=>directoryQuotes(p).entries));
   assert.equal(quoteInsights(entries).retained,visible?1:0);
   assert.equal([...buildShopCatalog(directory).values()].reduce((n,s)=>n+s.entries.length,0),visible?1:0);
   const map=sitemap(db,directory);
   assert.equal(map.includes('/prices/chatgpt-plus</loc>'),visible);
   assert.equal(map.includes('/product?source=direct-shops&amp;id=chatgpt-plus-recharge'),false);
  }
 } finally {db.close();}
});

test('cached public projection expires one millisecond after the retention boundary',()=>{
 const {db,project}=fixture();let time=now;
 const read=createPublicDirectoryCache(()=>{
  let validUntil=Infinity;
  const value=project(72*hour,'stale',{now:time,publicOnly:true,onValidUntil:at=>{validUntil=Math.min(validUntil,at);}});
  return {value,validUntil};
 },{now:()=>time});
 try {
  const first=read(db);assert.equal(first.offers.length,1);assert.strictEqual(read(db),first);
  time++;assert.equal(read(db).offers.length,0);
 } finally {db.close();}
});
