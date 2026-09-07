import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('homepage reserves delivery columns without inventing quotes and keeps other delivery links',async()=>{
 const db=openDb(':memory:'),app=createApp({db}),now=new Date().toISOString();
 const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',stockCount:1,status:'in_stock',url:'https://example.com/shop/'+id,capturedAt:now});
 try{
  storeSnapshot(db,{source:'priceai',snapshotId:'alignment',fetchedAt:now,products:[
   {productId:'chatgpt-go',name:'ChatGPT Go',currency:'CNY',offers:[offer('go','ChatGPT Go 代充 1个月',33)]},
   {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[offer('account','ChatGPT Plus 成品号 1个月',25)]},
   {productId:'chatgpt-pro-5x',name:'ChatGPT Pro 5x',currency:'CNY',offers:[offer('unknown','ChatGPT Pro 5x',590),offer('code','ChatGPT Pro 5x CDK',500)]},
   {productId:'gmail-account',name:'Gmail 邮箱',currency:'CNY',offers:[offer('gmail','Gmail 邮箱账号',5)]},
  ]});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.address().port,html=await(await fetch(base+'/')).text();
  const row=key=>html.match(new RegExp('<article class="directory-row" data-directory-product="'+key+'">[\\s\\S]*?</article>'))?.[0]||'';
  for(const key of ['chatgpt-go','chatgpt-plus','chatgpt-pro-5x']){
   const content=row(key);
   assert.equal((content.match(/data-delivery-slot="recharge"/g)||[]).length,1,key+' recharge slot');
   assert.equal((content.match(/data-delivery-slot="account"/g)||[]).length,1,key+' account slot');
   assert.ok(content.indexOf('data-delivery-slot="recharge"')<content.indexOf('data-delivery-slot="account"'));
   assert.match(content,/暂无报价/);
  }
  assert.match(row('chatgpt-go'),/data-delivery-link="recharge"/);
  assert.doesNotMatch(row('chatgpt-go'),/data-delivery-link="account"/);
  assert.match(row('chatgpt-plus'),/data-delivery-link="account"/);
  assert.doesNotMatch(row('chatgpt-plus'),/data-delivery-link="recharge"/);
  assert.doesNotMatch(row('chatgpt-pro-5x'),/data-directory-minimum|¥590|¥500/);
  assert.match(row('chatgpt-pro-5x'),/data-delivery-link="unknown"/);
  assert.match(row('chatgpt-pro-5x'),/data-delivery-link="code"/);
  assert.match(row('chatgpt-pro-5x'),/其他交付 · 2 条/);
  const links=[...row('chatgpt-pro-5x').matchAll(/<a\b[^>]*data-delivery-link="([^"]+)"[^>]*href="([^"]+)"/g)];
  for(const [,kind,href]of links){const route=new URL(href.replaceAll('&amp;','&'),base);assert.equal(route.searchParams.get('delivery'),kind);assert.equal(route.searchParams.get('product'),'chatgpt-pro-5x');}
  assert.equal(links.length,2);
  assert.doesNotMatch(row('gmail-account'),/data-delivery-slot/);
  assert.match(row('gmail-account'),/data-directory-minimum/);
 }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
