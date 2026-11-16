import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';
import {sponsorItems} from '../lib/sponsor-service.mjs';
import {sponsorBlock} from '../lib/sponsor-ui.mjs';
import {loadSponsorReferencePrice,sponsorReferenceFromOffers} from '../lib/sponsor-reference-price.mjs';
import {handleOutbound} from '../lib/outbound.mjs';

function fixture(){
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','reference-price-fixture-secret-long-enough'),now=new Date();
 const c={id:'SP-20X',source:'direct-shops',product_id:'chatgpt-pro-20x',offer_id:'old-ios-sku',merchant_id:'domain:merchant.example.test',label:'Fictional sponsor',placement:'sponsored_product',page_key:'chatgpt-pro-20x',page_label:'ChatGPT Pro 20X',destination_url:'https://merchant.example.test/store/products/chatgpt-pro-20x-card',start_at:new Date(now.getTime()-60000).toISOString(),end_at:new Date(now.getTime()+86400000).toISOString(),theme:'blue',headline:'ChatGPT Pro 20X 月卡',tagline:'仅限曾用过 20X 且订阅已到期的账号 · 人工核验办理'};
 analytics.outbound.saveCampaign(c,{approve:true,now});
 const snapshot=(id='current',price=1190)=>storeSnapshot(db,{source:'direct-shops',snapshotId:id,products:[{productId:c.product_id,name:'ChatGPT Pro 20X',currency:'CNY',offers:[
  {offerId:'old-ios-sku',title:'ChatGPT Pro 20X 订阅 1个月',price:1860,currency:'CNY',status:'in_stock',stockCount:1,url:'https://merchant.example.test/store/products/chatgpt-pro-20x-ios'},
  {offerId:'new-card-sku',title:'ChatGPT Pro 20X 月卡',price,currency:'CNY',status:'in_stock',stockCount:3,url:c.destination_url}
 ]}]});snapshot();
 const items=()=>sponsorItems([],analytics,{placement:c.placement,pageKey:c.page_key,db});
 return {db,analytics,c,now,snapshot,items,close(){analytics.close();db.close();}};
}

test('reference price matches the pinned destination, not the old accounting SKU, and leaves the outbound identity intact',()=>{
 const f=fixture();try{
  const [item]=f.items();assert.equal(item.referencePrice.price,1190);assert.equal(item.referencePrice.period,'／月');
  assert.equal(item.offer.offer_id,'old-ios-sku');assert.match(item.href,/offer=old-ios-sku/);
  const html=sponsorBlock([item]);assert.match(html,/参考价/);assert.match(html,/¥1,190/);assert.doesNotMatch(html,/1,860|在售/);assert.match(html,/核对时间.*datetime=/);assert.match(html,/订阅已到期/);
  const res={setHeader(k,v){this[k]=v},end(){}};handleOutbound({method:'HEAD'},res,new URL(item.href+'&ack=1','https://airadar.example.test'),{db:f.db,analytics:f.analytics});assert.equal(res.statusCode,302);assert.equal(res.Location,f.c.destination_url);
  assert.equal(f.analytics.outbound.reportCampaigns(7).length,0,'reference render and HEAD do not create clicks');
 }finally{f.close()}
});

test('new snapshots update the reference price without editing campaign dates, versions or accounting',()=>{
 const f=fixture();try{
  const before=f.analytics.outbound.listCampaigns();f.snapshot('new-price',1090);
  assert.equal(f.items()[0].referencePrice.price,1090);assert.deepEqual(f.analytics.outbound.listCampaigns(),before);
  f.db.prepare("UPDATE offers SET url='https://merchant.example.test/store/products/different' WHERE snapshot_id='new-price' AND offer_id='new-card-sku'").run();
  const [item]=f.items();assert.equal(item.referencePrice,null);assert.match(sponsorBlock([item]),/查看最新价格/);assert.ok(item.href);
 }finally{f.close()}
});

test('stale, missing, sold-out or failed price data hides only the price; pause and expiry still control the ad',()=>{
 for(const change of [
  db=>db.prepare("UPDATE offers SET captured_at='2000-01-01T00:00:00Z',last_verified_at='2000-01-01T00:00:00Z'").run(),
  db=>db.prepare("UPDATE offers SET expires_at='2000-01-01T00:00:00Z'").run(),
  db=>db.prepare("UPDATE offers SET status='out_of_stock',stock_count=0").run(),
  db=>db.exec('DELETE FROM offers; DELETE FROM products; DELETE FROM snapshots'),
 ]){
  const f=fixture();try{
   change(f.db);const [item]=f.items();assert.ok(item);assert.equal(item.referencePrice,null);assert.match(sponsorBlock([item]),/查看最新价格/);assert.doesNotMatch(sponsorBlock([item]),/class="money"/);
   const current=f.analytics.outbound.listCampaigns()[0];assert.equal(sponsorItems([],f.analytics,{db:f.db,placement:f.c.placement,pageKey:f.c.page_key,date:new Date(current.end_at)}).length,0);
   f.analytics.outbound.setCampaignStatus(f.c.id,'paused',{version:current.version});assert.equal(f.items().length,0);
  }finally{f.close()}
 }
 const f=fixture();try{assert.equal(loadSponsorReferencePrice({prepare(){throw Error('lookup unavailable')}},f.c),null)}finally{f.close()}
});

test('price validation rejects unknown, conflicting, expired and future observations',()=>{
 const now=Date.now(),c={source:'direct-shops',destination_url:'https://merchant.example.test/store/products/item',merchant_id:'domain:merchant.example.test'};
 const good={source:c.source,merchant_id:c.merchant_id,url:c.destination_url,price:690,currency:'CNY',status:'in_stock',stock_count:1,title:'ChatGPT Pro 5X 月卡',captured_at:new Date(now-60000).toISOString()};
 assert.equal(sponsorReferenceFromOffers(c,[good],{now}).price,690);
 for(const changes of [{price:null},{price:0},{price:-1},{price:'bad'},{currency:''},{captured_at:''},{captured_at:new Date(now+3600000).toISOString()},{captured_at:new Date(now-86400000).toISOString()},{expires_at:new Date(now).toISOString()},{quote_stale:true},{merchant_id:'domain:other.example.test'},{extra:JSON.stringify({quoteHealth:{status:'failed'}})}])assert.equal(sponsorReferenceFromOffers(c,[{...good,...changes}],{now}),null,JSON.stringify(changes));
 assert.equal(sponsorReferenceFromOffers(c,[good,{...good,price:100}],{now}),null);
 assert.equal(sponsorReferenceFromOffers({...c,source:'sponsor-websites'},[good],{now}),null);
});

test('canonical first and second pages show fresh prices and keep cards when prices become stale',async()=>{
 const f=fixture();let app;try{
  app=createApp({db:f.db,analytics:f.analytics});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  for(const suffix of ['', '?page=2']){const r=await fetch('http://127.0.0.1:'+app.address().port+'/prices/chatgpt-pro-20x'+suffix);assert.equal(r.status,200);const html=await r.text();assert.match(html,/参考价 <strong class="money">¥1,190/);assert.match(html,/SP-20X/);}
  f.db.prepare("UPDATE offers SET last_verified_at='2000-01-01T00:00:00Z'").run();
  const html=await(await fetch('http://127.0.0.1:'+app.address().port+'/prices/chatgpt-pro-20x?page=2',{headers:{cookie:'airadar_nocache=1'}})).text();assert.match(html,/sponsor-price-fallback/);assert.match(html,/SP-20X/);
 }finally{if(app?.listening)await new Promise(r=>app.close(r));f.close()}
});
