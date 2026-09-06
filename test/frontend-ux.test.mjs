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
  const filtered=await(await fetch(base+'/?family=claude&channel=16688&q=Claude&purpose=recharge')).text();assert.match(filtered,/Claude Pro/);assert.doesNotMatch(filtered,/data-directory-product="chatgpt-go"/);assert.match(filtered,/href="\/\?[^\"]*family=chatgpt/);
  assert.doesNotMatch(filtered,/<form[^>]*channel-form/);assert.equal((filtered.match(/<article[^>]*data-directory-product="claude-pro"/g)||[]).length,1);
  const all=await(await fetch(base+'/')).text();assert.doesNotMatch(all,/<form[^>]*channel-form/);assert.equal((all.match(/data-category="(?:chatgpt|claude|gemini|grok|x|relay|mail)"/g)||[]).length,7);
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
  storeSnapshot(db,{source:'priceai',snapshotId:'state',products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',offers:Array.from({length:12},(_,i)=>({offerId:String(i),title:'Claude Pro 代充 1个月',price:100+i,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/'+i}))}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const home=await(await fetch(base+'/?family=claude&product=claude-pro')).text();
  const variantLink=[...home.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>h.includes('spec='));assert.ok(variantLink);
  const link=variantLink+'&channel=16688&q=Claude&purpose=recharge';
  const detail=await(await fetch(base+link)).text();const next=[...detail.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>h.includes('page=2'));assert.ok(next);for(const key of ['spec','family','channel','q','purpose'])assert.equal(new URL(next,base).searchParams.get(key),new URL(link,base).searchParams.get(key));
  const empty=await(await fetch(base+'/product?source=priceai&id=claude-pro-month&channel=ldxp')).text();assert.match(empty,/共 0 条公开报价/);assert.doesNotMatch(empty,/data-store-risk[^>]*href="https:\/\/16688/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
test('分类到产品到规格逐层展开，切换期限不会混价或覆盖目标规格',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  storeSnapshot(db,{source:'priceai',snapshotId:'directory-specs',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[{offerId:'year',title:'ChatGPT Plus 代充 12个月',price:90,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/year'},{offerId:'month',title:'ChatGPT Plus 代充 1个月',price:100,status:'in_stock',stockCount:1,url:'https://16688.com.cn/goods/month'}]}]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const home=await(await fetch(base+'/')).text();assert.doesNotMatch(home,/<table|data-directory-product=|name="q"|quote-provenance">/);assert.match(home,/<details class="category-more">/);assert.match(home,/data-family-filter="x"/);
  const category=await(await fetch(base+'/?family=chatgpt')).text();assert.equal((category.match(/<article[^>]*data-directory-product="chatgpt-plus"/g)||[]).length,1);assert.doesNotMatch(category,/>¥(?:100|90)</);
  const variants=await(await fetch(base+'/?family=chatgpt&product=chatgpt-plus')).text();assert.equal((variants.match(/data-product-variant/g)||[]).length,2);assert.match(variants,/¥100/);assert.match(variants,/¥90/);
  const detail=await(await fetch(base+'/product?source=priceai&id=chatgpt-plus-recharge')).text();assert.match(detail,/aria-label="选择规格"/);assert.match(detail,/price-display">¥100</);assert.match(detail,/共 1 条公开报价/);
  const links=[...detail.matchAll(/class="spec-choice" aria-current="false" href="([^\"]+)"/g)].map(match=>match[1].replaceAll('&amp;','&'));assert.equal(links.length,1);
  const year=await(await fetch(base+links[0])).text();assert.match(year,/price-display">¥90</);assert.match(year,/共 1 条公开报价/);assert.doesNotMatch(year,/quote-provenance">|原店采集|第三方采集/);
  const empty=await(await fetch(base+'/?family=microsoft')).text();assert.match(empty,/暂无可用报价/);assert.match(empty,/data-directory-family="microsoft"/);
  const alias=await(await fetch(base+'/?family=otp')).text();assert.match(alias,/data-directory-family="mail"/);
  const more=await(await fetch(base+'/?family=cursor')).text();assert.match(more,/<details class="category-more active">/);assert.doesNotMatch(more,/<details class="category-more[^\"]*"[^>]*\bopen\b/);assert.match(more,/data-family-filter="cursor" aria-current="page"/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
test('官方和API参考零价可从目录进入详情，不携带商店合成规格，缺价不造免费价',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  for(const [source,id,name,platform] of [['cardnav-official','claude-pro','Claude Pro','Claude'],['goaihop-relay','relay-demo','示例 API 套餐','API']]){
   storeSnapshot(db,{source,snapshotId:'references',products:[{productId:id,name,platform,currency:'CNY',lowestPrice:0,offers:[{offerId:'free',title:name,storeName:name,price:0,status:'online',stockCount:1,url:'https://example.com/plans'}]},{productId:source==='goaihop-relay'?'relay-missing':'claude-max-5x',name:'缺价套餐',platform,currency:'CNY',lowestPrice:null,offers:[{offerId:'missing',price:null,status:'online',url:'https://example.com/missing'}]}]});
  }
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  for(const [family,product,source,id,label] of [['claude','claude-pro','cardnav-official','claude-pro','官方参考'],['relay','relay-demo','goaihop-relay','relay-demo','API 服务商']]){
   const page=await(await fetch(base+'/?family='+family+'&product='+product)).text();assert.match(page,/>¥0</);assert.ok(page.includes(label));
   const link=[...page.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>new URL(h,base).searchParams.get('source')===source);assert.ok(link);assert.equal(new URL(link,base).searchParams.get('spec'),null);
   const detail=await(await fetch(base+link)).text();assert.match(detail,/price-display">¥0</);assert.match(detail,/共 1 条公开报价/);assert.match(detail,/data-store-risk/);
  }
  const missing=await(await fetch(base+'/?family=relay&product=relay-missing')).text();assert.doesNotMatch(missing,/>¥0</);assert.match(missing,/暂无可用报价/);assert.match(missing,/查看 缺价套餐 的报价记录/);
 }finally{if(app.listening)await new Promise(r=>app.close(r));db.close();}
});
