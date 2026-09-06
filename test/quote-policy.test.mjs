import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb,storeSnapshot,metaSet,productsOfSnapshot,recentSnapshots } from '../lib/db.mjs';
import { projectProduct,productQuoteGroups,quoteSeries } from '../lib/quote-policy.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';
import { runWatch } from '../lib/watch.mjs';
import { collectShopApi } from '../collectors/direct/shop-api.mjs';
import { marketEntries } from '../lib/market-view.mjs';
import { directTargets } from '../collectors/direct/registry.mjs';

const now=Date.now();
function setup(offers,{stale=false}={}) { const db=openDb(':memory:'); storeSnapshot(db,{source:'direct-shops',snapshotId:'s',fetchedAt:new Date(now).toISOString(),stale,products:[{productId:'claude-pro-month',name:'Claude Pro',productType:'订阅/会员',currency:'CNY',lowestPrice:1,offers:offers.map((o,i)=>({offerId:String(i),title:'Claude Pro 代充月卡',status:'in_stock',price:100,currency:'CNY',capturedAt:new Date(now).toISOString(),...o}))}]}); return db; }
function project(db){return projectProduct(db,'direct-shops',recentSnapshots(db,'direct-shops',1)[0],productsOfSnapshot(db,'direct-shops','s')[0],{now});}
test('全部订阅族明示期限分组，质保不能变成订阅周期，旧ID不删除',()=>{
 for(const brand of ['ChatGPT Plus','Claude Pro','Gemini Pro','Super Grok','X Premium']) {
   assert.notEqual(offerSpec({title:`${brand} 代充1个月`}).key,offerSpec({title:`${brand} 代充3个月`}).key);
   assert.notEqual(offerSpec({title:`${brand} 月卡`}).key,offerSpec({title:`${brand} 年卡`}).key);
   assert.equal(offerSpec({title:`${brand} 质保12个月`}).known,false);
 }
 const db=setup([{title:'Claude Pro 代充月卡'},{title:'Claude Pro 代充年卡',price:900}]);
 try {const p=project(db);assert.equal(p.lowest_price,null);assert.equal(p.comparable,false);assert.equal(productQuoteGroups(p).length,2);assert.equal(quoteSeries(db,{source:'direct-shops',productId:'claude-pro-month'})[0].lowest_price,null);assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,2);}finally{db.close();}
});
test('单店失败保留健康店，整体pull失败及过期报价无法在售',()=>{
 const db=setup([{price:10,extra:{quoteHealth:{status:'stale'}}},{price:100,extra:{quoteHealth:{status:'ok'}}}],{stale:true});
 try {const p=project(db);assert.equal(p.lowest_price,100);assert.equal(p.offers[0].quote_stale,false);assert.equal(p.stale,false);metaSet(db,'health:direct-shops',JSON.stringify({status:'failed',checkedAt:new Date(now+1).toISOString()}));assert.equal(project(db).lowest_price,null);}finally{db.close();}
 const old=setup([{capturedAt:new Date(now-25*3600000).toISOString()}]);try{assert.equal(project(old).lowest_price,null);}finally{old.close();}
});
test('watch从有效报价重算最低价，过滤售罄无保障及混周期，失败不误报',()=>{
 for(const offers of [[{price:100},{price:1,status:'sold_out'}],[{price:100},{price:1,title:'Claude Pro 月卡 无质保'}],[{price:1},{price:100,title:'Claude Pro 年卡'}]]) {
   const db=setup(offers);try{assert.deepEqual(runWatch(db,{rules:[{id:'min',source:'direct-shops',kind:'min_below',term:offers.some(o=>o.title?.includes('年卡'))?'12m':'1m',threshold:10}]}),[]);}finally{db.close();}
 }
 const db=setup([{price:1}]);try{metaSet(db,'health:direct-shops',JSON.stringify({status:'failed',checkedAt:new Date(now+1).toISOString()}));assert.deepEqual(runWatch(db,{rules:[{id:'min',source:'direct-shops',kind:'min_below',threshold:10}]}),[]);}finally{db.close();}
});
test('ShopApi在maxPages或错误total导致目录未完整时拒绝发布',async()=>{
 for(const total of [2,100]) {
 let call=0;
 await assert.rejects(collectShopApi({id:'test',name:'test',origin:'https://shop.example',token:'test'},{pageSize:1,maxPages:1,fetchImpl:async()=>new Response(JSON.stringify(++call===1?{code:1,data:[{id:1,name:'AI'}]}:{code:1,data:{total,list:[{id:1,name:'Claude Pro 月卡',price:10}]}}),{headers:{'content-type':'application/json'}})}),/分页未完整/);
 }
});
test('market即使调用者未投影也不合并同ID月卡年卡，期限分组历史不串线',()=>{
 const p={product_id:'claude-pro-month',name:'Claude Pro',currency:'CNY',product_type:'订阅/会员'};
 assert.equal(marketEntries(['月卡','年卡'].map((term,i)=>({source:i?'priceai':'direct-shops',products:[{...p,selected_offer:{title:`Claude Pro ${term}`,status:'in_stock',price:100+i}}]}))).length,2);
 const db=setup([{title:'Claude Pro 代充月卡',price:100},{title:'Claude Pro 代充年卡',price:900}]);
 try { const groups=productQuoteGroups(project(db));for(const group of groups){assert.equal(quoteSeries(db,{source:'direct-shops',productId:p.product_id,comparisonKey:group.comparison_key})[0].lowest_price,group.lowest_price);} } finally{db.close();}
});
test('旧历史中的API误分类仅在查询排除，不修改数据库',()=>{
 const db=setup([{price:100},{price:1,title:'Claude API 中转额度'}]);
 try {assert.equal(project(db).lowest_price,100);assert.equal(project(db).offers.length,1);assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,2);}finally{db.close();}
});
test('日本日区不产生一天期限，中文质保与辅助服务不冒充订阅',()=>{
 assert.equal(offerSpec({title:'Claude Pro 日本日区 月卡'}).key.split(':')[0],'1m');
 assert.equal(offerSpec({title:'Claude Pro 日常使用'}).known,false);
 for(const title of ['Claude Pro 三个月质保','Claude Pro 质保三个月','Claude Pro 一年售后'])assert.equal(offerSpec({title}).known,false,title);
 assert.equal(offerSpec({title:'Gemini Pro 权限激活'},{product_id:'gemini-activation-service',product_type:'辅助服务'}).known,true);
 assert.equal(offerSpec({title:'ChatGPT 免费账号'},{product_id:'chatgpt-free'}).known,true);
});
test('分组不会重新启用店铺零价；历史渠道过滤使用渠道id且不改变历史范围',()=>{
 const db=setup([{price:0},{price:100}]);
 try {
   const p=project(db);assert.equal(p.lowest_price,100);assert.equal(productQuoteGroups(p)[0].lowest_price,100);
   assert.equal(quoteSeries(db,{source:'direct-shops',productId:'claude-pro-month',channel:'unknown'})[0].lowest_price,100);
   assert.equal(quoteSeries(db,{source:'direct-shops',productId:'claude-pro-month',channel:'independent'})[0].lowest_price,null);
   assert.equal(quoteSeries(db,{source:'direct-shops',productId:'claude-pro-month',since:new Date(now+1000).toISOString()}).length,0);
 } finally {db.close();}
});
test('永久、组合权益不生成可比订阅价，赠送免费品不把付费订阅变成免费账号',()=>{
 for(const title of ['Claude Pro 永久 月卡','ChatGPT Plus 组合套餐1个月','Gemini Pro 月卡 买1送1','ChatGPT Plus 1/3个月','Claude Pro 1-12个月']) assert.equal(offerSpec({title}).known,false,title);
 assert.equal(offerSpec({title:'ChatGPT Plus 月卡 赠送free账号'}).key.startsWith('other:'),false);
 assert.notEqual(offerSpec({title:'Claude Pro 月卡 1个账号'}).key,offerSpec({title:'Claude Pro 月卡 5个账号'}).key);
 assert.notEqual(offerSpec({title:'Claude Pro 月卡'}).key,offerSpec({title:'Claude Max 月卡'}).key);
 assert.notEqual(offerSpec({title:'Gemini Pro 月卡 2TB'}).key,offerSpec({title:'Gemini Pro 月卡 5TB'}).key);
 assert.equal(offerSpec({title:'Claude Pro 美区月卡'}).key,offerSpec({title:'Claude Pro 美国月卡'}).key);
 assert.equal(offerSpec({title:'Claude Pro 美国美区月卡'}).key,offerSpec({title:'Claude Pro 美国月卡'}).key);
 assert.equal(offerSpec({title:'Claude Pro 美区/印度 月卡'}).known,false);
});
test('产品币种缺失时从一致的报价恢复币种，未知币种不会默认为人民币或与CNY合并',()=>{
 const db=setup([{price:40,currency:'CNY'}]);
 try {
   db.prepare('UPDATE products SET currency=NULL').run();
   assert.equal(project(db).currency,'CNY');assert.equal(productQuoteGroups(project(db))[0].currency,'CNY');
   db.prepare('UPDATE offers SET currency=NULL').run();
   assert.equal(project(db).currency,null);assert.equal(productQuoteGroups(project(db))[0].currency,null);
   assert.notEqual(offerSpec({title:'Claude Pro 月卡'}).key,offerSpec({title:'Claude Pro 月卡',currency:'CNY'}).key);
 } finally {db.close();}
});
test('历史LIMIT先取最近观察再正序，不限制CLI默认全部历史；框架过滤一致',()=>{
 const db=openDb(':memory:');
 const target=directTargets().find(t=>t.kind==='kami');
 try {
   for(let i=1;i<=5;i++) storeSnapshot(db,{source:'direct-shops',snapshotId:`s${i}`,fetchedAt:new Date(now+i*1000).toISOString(),products:[{productId:'claude-pro-month',name:'Claude Pro',offers:[{offerId:'o',title:'Claude Pro 月卡',price:i,status:'in_stock',url:`${target.origin}/buy/1`}]}]});
   const options={source:'direct-shops',productId:'claude-pro-month'};
   assert.equal(quoteSeries(db,options).length,5);
   assert.deepEqual(quoteSeries(db,{...options,limit:2}).map(p=>p.lowest_price),[4,5]);
   assert.deepEqual(quoteSeries(db,{...options,limit:2,framework:'kami'}).map(p=>p.lowest_price),[4,5]);
   assert.deepEqual(quoteSeries(db,{...options,limit:2,framework:'dujiao'}).map(p=>p.lowest_price),[null,null]);
 } finally {db.close();}
});
