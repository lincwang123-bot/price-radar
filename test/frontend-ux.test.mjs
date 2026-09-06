import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, storeSnapshot } from '../lib/db.mjs';
import { createApp, fmtPrice } from '../lib/web.mjs';
import { filterFramework } from '../lib/channels.mjs';
test('独立站框架只使用登记证据',()=>{
 const offers=[{url:'https://morimm.com/products/1'},{url:'https://16688.com.cn/goods/1'},{url:'https://unknown.test/kami'}];
 assert.equal(filterFramework(offers,'dujiao').length,1);assert.equal(filterFramework(offers,'kami').length,0);
 assert.equal(fmtPrice(40),'¥40');assert.equal(fmtPrice(40,'CNY'),'¥40');assert.equal(fmtPrice(40,null),'币种待确认 40');assert.equal(fmtPrice(40,''),'币种待确认 40');
});
test('详情历史走势遵守独立站框架筛选',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  for(let i=0;i<2;i++)storeSnapshot(db,{source:'priceai',snapshotId:'framework-'+i,fetchedAt:new Date(Date.now()-(1-i)*3600000).toISOString(),products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',offers:[{offerId:'dujiao',title:'Claude Pro 代充 1个月',price:100+i,status:'in_stock',stockCount:1,url:'https://morimm.com/products/1'},{offerId:'platform',title:'Claude Pro 代充 1个月',price:1+i,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/1'}]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const h=await(await fetch(base+'/product?source=priceai&id=claude-pro-month&framework=dujiao')).text();assert.match(h,/最低价走势：[^\"]*¥100[^\"]*¥101/);assert.match(h,/共 1 条公开报价/);assert.match(h,/price-display">¥101</);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
test('公开表单安全退化、方法说明及SSR组合筛选', async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try {
  storeSnapshot(db,{source:'priceai',snapshotId:'ux',products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',offers:[{offerId:'a',title:'Claude Pro 代充 1个月',price:100,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/a'}]},{productId:'chatgpt-go',name:'ChatGPT Go',platform:'ChatGPT',offers:[{offerId:'b',title:'ChatGPT Go 代充 1个月',price:40,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/b'}]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const form=await(await fetch(base+'/submit?type=cooperation')).text();
  assert.match(form,/<form[^>]*method="post"[^>]*action="\/api\/submissions"/);assert.match(form,/<noscript>/);
  for(const field of ['productArea','scale','assurance','settlement'])assert.match(form,new RegExp('name="'+field+'"[^>]*><option value=""[^>]*>请选择'));
  const methods=await(await fetch(base+'/sources')).text();assert.match(methods,/价格与库存/);assert.doesNotMatch(methods,/快照|产品记录|报价记录|PriceAI/);
  const filtered=await(await fetch(base+'/?family=claude&channel=16688&q=Claude&purpose=recharge')).text();assert.match(filtered,/Claude Pro/);assert.doesNotMatch(filtered,/catalog-name"><strong>ChatGPT Go/);assert.match(filtered,/name="q"[^>]*value="Claude"/);assert.match(filtered,/href="\/\?[^\"]*family=chatgpt/);
  assert.match(filtered,/id="filter-more" aria-label="更多筛选" checked/);assert.equal((filtered.match(/name="purpose"/g)||[]).length,1);assert.equal((filtered.match(/name="framework"/g)||[]).length,1);
  const all=await(await fetch(base+'/')).text();assert.match(all,/id="filter-more" aria-label="更多筛选">/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
test('提醒新到旧分页，保留当时价格',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  const insert=db.prepare('INSERT INTO alerts(ts,source,product_id,product_name,kind,message) VALUES(?,?,?,?,?,?)');
  for(let i=0;i<32;i++)insert.run(new Date(Date.UTC(2026,8,1,0,i)).toISOString(),'priceai','claude-pro-month','Claude Pro','drop_pct','历史价格 ¥'+i);
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const h=await(await fetch(base+'/alerts')).text();assert.ok(h.indexOf('历史价格 ¥31')<h.indexOf('历史价格 ¥30'));assert.match(h,/第 1 \/ 2 页/);assert.doesNotMatch(h,/历史价格 ¥0</);assert.match(h,/历史提醒保留当时价格/);
  const second=await(await fetch(base+'/alerts?page=2')).text();assert.match(second,/历史价格 ¥0</);assert.doesNotMatch(second,/历史价格 ¥31/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
test('详情规格与筛选贯穿翻页，无匹配渠道不泄漏全部报价',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  storeSnapshot(db,{source:'priceai',snapshotId:'state',products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',offers:Array.from({length:12},(_,i)=>({offerId:String(i),title:'Claude Pro 代充 1个月',price:100+i,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/'+i}))}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const home=await(await fetch(base+'/?family=claude&channel=16688&q=Claude&purpose=recharge')).text();
  const link=[...home.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>h.includes('spec='));assert.ok(link);
  const detail=await(await fetch(base+link)).text();const next=[...detail.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>h.includes('page=2'));assert.ok(next);for(const key of ['spec','family','channel','q','purpose'])assert.equal(new URL(next,base).searchParams.get(key),new URL(link,base).searchParams.get(key));
  const empty=await(await fetch(base+'/product?source=priceai&id=claude-pro-month&channel=ldxp')).text();assert.match(empty,/共 0 条公开报价/);assert.doesNotMatch(empty,/data-store-risk[^>]*href="https:\/\/16688/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
