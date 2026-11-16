import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDirectOffer,groupDirectOffers} from '../collectors/direct/catalog.mjs';
import {offerSpec} from '../lib/offer-spec.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
import {officialBaseline,officialWebsite} from '../lib/official-baselines.mjs';
import {priceProduct} from '../lib/price-routes.mjs';
import {publicProductName} from '../lib/market-view.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

const key='chatgpt-pro-25x';
const titles=['ChatGPT Pro 25x','ChatGPT Pro25X','GPT Pro 25倍','ChatGPT Pro x25','ChatGPT Pro 25×','Codex Pro 25x','ChatGPT Pro 500','ChatGPT Pro500','ChatGPT Pro $500','ChatGPT Pro 500美元档','ChatGPT Pro 500 USD','ChatGPT Pro 500刀','ChatGPT 25x'];
test('retail Pro 500 spellings need explicit tier evidence, not selling price or a bare 50x label',()=>{
 for(const title of ['Codex ProMax 500刀 1个月 正价代充','GPT PRO MAX 500$ 官方充值月卡','ChatGPT Pro 50X 500刀月卡','最新ChatGPT 50X 500 美刀官方充值'])assert.equal(classifyDirectOffer({title})?.id,key,title);
 assert.equal(classifyDirectOffer({title:'PRO MAX 25X 500$ 官方充值一个月',category:'G codex系列'})?.id,key);
 assert.equal(classifyDirectOffer({title:'PRO MAX 500$ 官方充值月卡',category:'gtp正规代充'})?.id,key);
 for(const title of ['ChatGPT Pro 50x 月卡','ChatGPT Pro Max 500积分','Codex ProMax 500刀额度','Codex ProMax 500$额度','ChatGPT Pro 50x 售价500元','ChatGPT Pro 50x 500刀余额'])assert.notEqual(classifyDirectOffer({title,price:500})?.id,key,title);
 assert.equal(classifyDirectOffer({title:'PRO MAX 25X 500$ 官方充值一个月',category:'订阅/会员'})?.id,key);
 const title='【智利区官充】ChatGPT Pro50x 月卡',description='ChatGPT Pro25x 月卡代充，智利区官方正规渠道充值到自己账号';
 const extra={deliveryEvidence:{productTitle:title,description,descriptionScope:'product'}};
 assert.equal(classifyDirectOffer({title,extra})?.id,key);
 for(const description of ['ios美区 加区 500刀 订阅 可覆盖','GP.T Pro 500美元版【菲区卡充CDK】 正价订阅；以前用过 google pay 的账号请核对资格'])assert.equal(classifyDirectOffer({title,extra:{deliveryEvidence:{...extra.deliveryEvidence,description}}})?.id,key);
 assert.equal(classifyDirectOffer({title,extra:{deliveryEvidence:{...extra.deliveryEvidence,description:'售价500元，可联系店主'}}}),null);
 assert.equal(classifyDirectOffer({title,extra:{deliveryEvidence:{...extra.deliveryEvidence,descriptionScope:'product_multi'}}}),null);
 assert.equal(classifyDirectOffer({title,extra:{deliveryEvidence:{...extra.deliveryEvidence,productTitle:'另一个商品'}}}),null);
});
test('Pro 500 is a tier name, never a 500-month subscription duration',()=>{
 for(const title of ['ChatGPT Pro 500 月卡 代充','ChatGPT Pro500月卡 代充','ChatGPT Pro $500 月卡 代充']){
  const s=offerSpec({title,currency:'CNY'},{product_id:key});assert.match(s.key,/^1m:25x:/,title);assert.doesNotMatch(s.label,/500 个月/);assert.match(offerSpec({title,currency:'CNY'},{product_id:key},{legacyAmbiguity:true}).key,/^500m:/);
 }
 assert.match(offerSpec({title:'ChatGPT Pro500 年卡 代充',currency:'CNY'},{product_id:key}).key,/^12m:25x:/);
 assert.match(offerSpec({title:'ChatGPT Pro500 3个月 代充',currency:'CNY'},{product_id:key}).key,/^3m:25x:/);
 assert.match(offerSpec({title:'ChatGPT Pro500 代充',currency:'CNY'},{product_id:key}).key,/^unknown:25x:/);
});
test('Pro 500/25x is distinct from 5x/20x and never inferred from a quote price',()=>{
 for(const title of titles){
  const product=classifyDirectOffer({title});
  assert.equal(product?.id,key,title);
  assert.match(offerSpec({title:title+' 代充 1个月',currency:'CNY'},product).key,/:25x:/,title);
 }
 for(const title of ['ChatGPT Pro 5x','ChatGPT Pro 20x'])assert.notEqual(classifyDirectOffer({title})?.id,key);
 for(const title of ['ChatGPT Pro','ChatGPT Pro 500元','ChatGPT Pro 售价500美元','ChatGPT Pro 5000美元','ChatGPT Pro 125x','ChatGPT Pro 2.5x','ChatGPT Pro x25.5','ChatGPT Pro 500积分','ChatGPT Pro 25x API 500美元额度','ChatGPT Pro 25x / 20x','ChatGPT Pro 25x / 5x','ChatGPT Pro 25x 200刀','ChatGPT Plus Pro 25x','Claude Max 25x']){
  assert.notEqual(classifyDirectOffer({title,price:500,currency:'USD'})?.id,key,title);
 }
 assert.equal(classifyDirectOffer({title:'Pro 25x 月卡',category:'ChatGPT Pro'})?.id,key);
 assert.equal(classifyDirectOffer({title:'Pro 25x 月卡',category:'未知分类'})?.id,key);
});
test('25x ingestion and mixed search projections preserve tier and delivery identity',()=>{
 const offers=['ChatGPT Pro 5x 代充 1个月','ChatGPT Pro 20x 代充 1个月','ChatGPT Pro 25x 代充 1个月','ChatGPT Pro 500 成品号 1个月'].map((title,i)=>({offerId:'tier'+i,offer_id:'tier'+i,title,price:100+i,currency:'CNY',status:'in_stock',stockCount:1,url:'https://example.com/item/'+i}));
 const groups=groupDirectOffers(offers);assert.equal(groups.find(p=>p.productId===key).offers.length,2);
 const products=buildProductDirectory([{source:'ldxp-goods',products:[{product_id:'search-pro',offers}]}]).flatMap(c=>c.products);
 assert.deepEqual(products.map(p=>p.key),['chatgpt-pro-5x','chatgpt-pro-20x',key]);
 const quotes=directoryQuotes(products.find(p=>p.key===key));
 assert.equal(quotes.total,2);assert.deepEqual(quotes.deliveries.map(d=>d.kind),['recharge','account']);
});
test('Pro 25x is navigable in both languages with official-only data, then displays real quotes',async()=>{
 const baseline=officialBaseline(key);
 assert.ok(baseline);assert.equal(baseline.amount,500);assert.equal(baseline.currency,'USD');assert.equal(baseline.period,'month');assert.equal(baseline.checkedAt,'2026-10-28');
 assert.equal(officialWebsite(key),'https://chatgpt.com/pricing/');
 const db=openDb(':memory:'),app=createApp({db});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 const get=async path=>{const r=await fetch(origin+path,{headers:{cookie:'airadar_nocache=1'}});assert.equal(r.status,200,path);return r.text();};
 try{
  for(const prefix of ['','/en']){
   const html=await get(prefix+'/prices/'+key);
   assert.match(html,/data-directory-product-name="ChatGPT Pro 500"/);assert.match(html,/USD 500/);assert.match(html,/data-official-baseline="chatgpt-pro-25x"/);
   assert.match(html,/data-official-website="chatgpt-pro-25x"/);assert.doesNotMatch(html,/data-directory-quote /);
   assert.ok(html.includes('rel="canonical" href="https://airadar.vip'+prefix+'/prices/'+key+'"'));
   const family=await get(prefix+'/?family=chatgpt');
   assert.match(family,new RegExp('href="'+prefix+'/prices/'+key+'"'));
   assert.match(family,/data-directory-product="chatgpt-pro-25x"/);
   assert.match(await get(prefix+'/official-prices?q=Pro%2025x'),/USD 500/);
   if(prefix){assert.doesNotMatch(html,/暂无有效报价/);assert.match(html,/No current merchant quotes/);assert.doesNotMatch(html.match(/<aside class="official-baseline"[\s\S]*?<\/aside>/)?.[0]||'',/[\u4e00-\u9fff]{6}/);}
  }
  const sitemap=await get('/sitemap.xml');assert.match(sitemap,/<loc>https:\/\/airadar.vip\/prices\/chatgpt-pro-25x<\/loc>/);assert.match(sitemap,/<loc>https:\/\/airadar.vip\/en\/prices\/chatgpt-pro-25x<\/loc>/);
  for(const table of ['products','offers','snapshots'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  storeSnapshot(db,{source:'direct-shops',snapshotId:'pro25-test',products:groupDirectOffers([{offerId:'pro500',title:'ChatGPT Pro 500 代充 1个月',price:3500,currency:'CNY',status:'in_stock',stockCount:1,url:'https://example.com/buy/pro500'}])});
  for(const prefix of ['','/en']){const html=await get(prefix+'/prices/'+key);assert.match(html,/data-directory-quote /);assert.match(html,/data-price="3500"/);assert.match(html,/USD 500/);}
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();}
});
test('public ChatGPT Pro names follow the official tiers while collector labels and old merchant titles stay classified',()=>{
 const names={
  'chatgpt-pro-5x':'ChatGPT Pro 100',
  'chatgpt-pro-20x':'ChatGPT Pro 200',
  'chatgpt-pro-25x':'ChatGPT Pro 500',
 };
 for(const [id,name] of Object.entries(names)){
  assert.equal(priceProduct(id).name,name);
  assert.equal(priceProduct(id).path,'/prices/'+id);
  assert.equal(officialBaseline(id).name,name);
  assert.equal(publicProductName({product_id:id,name:'ChatGPT Pro 5x'}),name);
 }
 const listed=buildProductDirectory([{source:'direct-shops',products:[{product_id:'mixed',offers:['ChatGPT Pro 5x','ChatGPT Pro 20x','ChatGPT Pro 25x','ChatGPT Pro 100','ChatGPT Pro 200','ChatGPT Pro 500','pro100 月卡 官方充值','ChatGPT Pro $200 月卡'].map((title,i)=>({title,offer_id:'n'+i,price:100,currency:'CNY',status:'in_stock',stock_count:1,quote_stale:false,comparison_known:true,comparison_key:'month:recharge:CNY',url:'https://shop.example/item/'+i}))}]}]).find(row=>row.key==='chatgpt').products;
 const byKey=Object.fromEntries(listed.map(product=>[product.key,product.name]));
 assert.deepEqual(byKey,names);
 assert.equal(classifyDirectOffer({title:'ChatGPT Pro 5x'}).name,'ChatGPT Pro 5x');
 assert.equal(classifyDirectOffer({title:'ChatGPT Pro 20x'}).name,'ChatGPT Pro 20x');
 assert.equal(classifyDirectOffer({title:'ChatGPT Pro 25x'}).name,'ChatGPT Pro 25x / Pro 500');
 assert.equal(classifyDirectOffer({title:'ChatGPT Pro 100'}).id,'chatgpt-pro-5x');
 assert.equal(classifyDirectOffer({title:'ChatGPT Pro 200'}).id,'chatgpt-pro-20x');
 assert.equal(classifyDirectOffer({title:'pro100 月卡 官方充值'}).id,'chatgpt-pro-5x');
});
