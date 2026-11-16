import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteInsights,productInsights,PRODUCT_DECISIONS} from '../lib/product-insights.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
const entry=(price,patch={})=>({list:{source:'direct-shops'},product:{currency:'CNY'},delivery:{kind:'recharge'},offer:{price,currency:'CNY',comparison_known:true,comparison_eligible:true,comparison_key:'month',comparison_label:'1 个月 · 代充',captured_at:'2026-10-04T01:00:00Z',...patch}});
test('quote insights separate currency, conditions and delivery; exclude references, stale and incomplete entries',()=>{
 const rows=[entry(100),entry(120),entry(180),entry(200,{comparison_key:'year'}),entry(10,{currency:'USD'}),{...entry(30),delivery:{kind:'shared'}},entry(1,{comparison_eligible:false}),entry(2,{comparison_known:false}),entry(3,{purchase_conditions:{quality:'C'}}),entry(4,{quote_stale:true}),entry(5,{quote_retained:true}),{...entry(0),reference:true}];
 const before=JSON.stringify(rows),s=quoteInsights(rows);
 assert.deepEqual([s.total,s.eligible,s.unconfirmed,s.retained,s.groups.length],[11,6,3,2,4]);
 assert.deepEqual([s.groups[0].count,s.groups[0].min,s.groups[0].max,s.groups[0].median],[3,100,180,120]);
 assert.equal(JSON.stringify(rows),before,'Never alter the sorted directory entries');
 assert.equal(quoteInsights([entry(100),entry(160)]).groups[0].median,130);
 assert.equal(quoteInsights([{...entry(10),list:{stale:true}}]).retained,1);
 assert.equal(quoteInsights([{...entry(10,{quote_stale:false}),list:{stale:true}}]).eligible,1);
 assert.equal(quoteInsights([entry(10,{comparison_key:'mixed'}),entry(NaN),entry(0)]).groups.length,0);
});
test('a sample timestamp is never invented and original merchant text is escaped',()=>{
 const rows=[entry(100,{comparison_label:'<img src=x onerror=alert(1)>',captured_at:undefined}),entry(150)];
 const stats=quoteInsights(rows);assert.equal(stats.groups[0].missingTimes,1);
 const html=productInsights({key:'chatgpt-plus'},rows,{href:()=>'/prices/chatgpt-plus?spec=x&currency=CNY'});
 assert.match(html,/部分时间未注明/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&amp;currency/);
 const single=productInsights({key:'chatgpt-plus'},[entry(100)],{href:()=>'/'});assert.match(single,/单条记录/);
 assert.match(productInsights({key:'unknown'},[],{href:()=>'/'}),/当前筛选没有店铺报价/);
 assert.match(productInsights({key:'unknown'},[entry(100,{comparison_known:false})],{href:()=>'/'}),/暂不计算价格区间/);
 for(const value of Object.values(PRODUCT_DECISIONS)){assert.ok(value.zh&&value.en);}
});
test('full filtered samples survive pagination and group links preserve filters; English shares the data',async()=>{
 const db=openDb(':memory:');let app;
 try{
  const quote=(id,title,price,currency='CNY')=>({offerId:id,storeName:id,title,price,currency,status:'in_stock',stockCount:1,url:'https://'+id+'.example.org/product'});
  storeSnapshot(db,{source:'direct-shops',snapshotId:'insight-fixture',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[...Array.from({length:12},(_,i)=>quote('month-'+i,'ChatGPT Plus 代充 1个月 新开续费均可',100+i)),quote('missing','ChatGPT Plus 代充',50),quote('year','ChatGPT Plus 代充 12个月 新开续费均可',1000),quote('usd','ChatGPT Plus 代充 1个月 新开续费均可',20,'USD')]}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=async path=>{const res=await fetch(base+path);assert.equal(res.status,200,path);return res.text();};
  const path='/prices/chatgpt-plus?delivery=recharge&currency=CNY';
  const first=await get(path),second=await get(path+'&page=2');
  for(const html of [first,second]){assert.match(html,/data-insight-total>14</);assert.match(html,/data-insight-eligible>13</);assert.match(html,/data-insight-unconfirmed>1</);assert.match(html,/CNY 105\.50/);assert.ok(html.indexOf('data-quote-insights')<html.indexOf('id="quote-results"'));}
  assert.equal([...first.matchAll(/data-directory-quote data-price=/g)].length,10);assert.equal([...second.matchAll(/data-directory-quote data-price=/g)].length,4);
  const group=first.match(/href="([^"]+)">查看这组报价/)[1].replaceAll('&amp;','&'),u=new URL(group,base);
  assert.equal(u.searchParams.get('page'),null);assert.equal(u.searchParams.get('currency'),'CNY');assert.equal(u.searchParams.get('delivery'),'recharge');
  const grouped=await get(u.pathname+u.search);assert.match(grouped,/data-insight-total>12</);assert.match(grouped,/data-insight-unconfirmed>0</);assert.match(grouped,/noindex/);
  const english=await get('/en'+path+'&page=2');assert.match(english,/How to compare these quotes/);assert.match(english,/data-insight-total>14</);assert.match(english,/View these quotes/);assert.doesNotMatch(english.match(/<section class="product-insights"[\s\S]*?<\/section>/)[0],/这页报价|先看条件/);
  const guide=await get('/help/compare-prices');assert.match(guide,/id="price-summary"/);assert.match(guide,/演算示例（虚构金额）/);
  assert.match(await get('/guides/renewal-checklist'),/id="three-clocks"/);
  const map=await get('/sitemap.xml');assert.match(map,/<loc>https:\/\/airadar.vip\/help\/compare-prices<\/loc><lastmod>2026-10-04<\/lastmod>/);
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();}db.close();}
});
