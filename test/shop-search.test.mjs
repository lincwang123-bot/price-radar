import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {searchShops,normalizeShopQuery} from '../lib/shop-search.mjs';

const store=(id,name,url,aliases=[])=>({id,name,url,entries:aliases.map(name=>({offer:{store_name:name}}))});
test('shop search matches names, aliases and domains without case/width sensitivity, with exact matches first',()=>{
 const shops=[store('b','星链 AI 旗舰店','https://second.example.org/'),store('a','星链 AI','https://first.example.org/',['星链旧名']),store('c','其他店','https://third.example.org/')];
 assert.deepEqual(searchShops(shops,'星链 ＡＩ').shops.map(s=>s.id),['a','b']);
 assert.equal(searchShops(shops,'星链旧名').shops[0].id,'a');
 assert.equal(searchShops(shops,'HTTPS://FIRST.EXAMPLE.ORG/').shops[0].id,'a');
 assert.equal(searchShops(shops,'不存在').total,0);
 assert.equal(normalizeShopQuery('  '+'x'.repeat(200)+'  ').length,100);
 assert.equal(searchShops(shops,'   ').total,0);
});
test('shop search retains distinct stores on one marketplace and paginates only after matching',()=>{
 const shops=Array.from({length:25},(_,i)=>store(String(i),'测试店 '+String(i).padStart(2,'0'),'https://16688.com.cn/shop/S'+i));
 const result=searchShops(shops,'16688.com.cn',{page:2});
 assert.equal(result.total,25);assert.equal(result.pages,2);assert.equal(result.shops.length,5);
 assert.equal(searchShops(shops,'16688.com.cn/shop/S24').shops[0].id,'24');
 assert.equal(searchShops(shops,'测试店 24').total,1);
 for(const page of ['bad',-2,Infinity])assert.equal(searchShops(shops,'测试店',{page}).page,1);
 assert.equal(searchShops(shops,'测试店',{page:999}).page,2);
});

test('public search is global, groups quotes by shop, excludes blocked shops, and opens the existing shop page',async()=>{
 const db=openDb(':memory:');let server;
 try{
  const offer=(id,name,url,patch={})=>({offerId:id,storeName:name,title:'ChatGPT Plus 代充 1个月',price:99,currency:'CNY',status:'in_stock',url,...patch});
  storeSnapshot(db,{source:'direct-shops',snapshotId:'search-fixture',products:[
   {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[
    ...Array.from({length:24},(_,i)=>offer('other-'+i,'示例店 '+String(i).padStart(2,'0'),'https://shop-'+i+'.example.org/product')),
    offer('match','星链 AI','https://stellar.example.org/product'),
    offer('blocked','已屏蔽示例店','https://fk.10886.xyz/product'),
    offer('one','平台甲店','https://16688.com.cn/goods/G1',{extra:{shopUrl:'https://16688.com.cn/shop/S1',shopNo:'S1'}}),
    offer('two','平台乙店','https://16688.com.cn/goods/G2',{extra:{shopUrl:'https://16688.com.cn/shop/S2',shopNo:'S2'}})
   ]},
   {productId:'claude-pro-month',name:'Claude Pro',currency:'CNY',offers:[offer('claude','星链 AI','https://stellar.example.org/claude',{title:'Claude Pro 代充 1个月'})]}
  ]});
  server=createApp({db});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const get=async url=>await(await fetch(base+url)).text();
  const form=/<form[^>]*role="search"[\s\S]*?<\/form>/;
  for(const path of ['/','/?family=chatgpt','/?family=chatgpt&product=chatgpt-plus']){
   const html=await get(path);assert.match(html,form);
   assert.match(html.match(form)[0],/name="shop_q"/);assert.match(html.match(form)[0],/action="\/"/);
   assert.doesNotMatch(html.match(form)[0],/name="(?:product|family)"/);
  }
  const response=await fetch(base+'/?shop_q='+encodeURIComponent('星链')+'&family=gemini&product=wrong&page=99');
  const html=await response.text();assert.equal(response.status,200);
  assert.match(response.headers.get('x-robots-tag'),/noindex/);
  assert.match(html,/<title>.*搜索店铺/);assert.match(html,/<meta name="robots" content="noindex, follow">/);
  assert.equal([...html.matchAll(/data-shop-result="/g)].length,1);
  assert.match(html,/找到 1 家店铺/);assert.match(html,/ChatGPT Plus/);assert.match(html,/Claude Pro/);
  const href=html.match(/data-shop-result-link href="([^"]+)"/)[1];
  const shop=await get(href.replaceAll('&amp;','&'));assert.match(shop,/data-shop-id=/);assert.match(shop,/星链 AI/);assert.match(shop,/Claude Pro/);
  const domain=await get('/?shop_q=STELLAR.EXAMPLE.ORG');assert.equal([...domain.matchAll(/data-shop-result="/g)].length,1);
  const platform=await get('/?shop_q=16688.com.cn');assert.equal([...platform.matchAll(/data-shop-result="/g)].length,2);
  assert.match(await get('/?shop_q=fk.10886.xyz'),/没有找到相关店铺/);
  const second=await get('/?shop_q='+encodeURIComponent('示例店')+'&page=2');assert.equal([...second.matchAll(/data-shop-result="/g)].length,4);assert.match(second,/第 2 \/ 2 页/);
  const missing=await get('/?shop_q='+encodeURIComponent('<script>alert(1)</script>'));assert.match(missing,/没有找到相关店铺/);assert.doesNotMatch(missing,/<script>alert\(1\)<\/script>/);
  assert.match(await get('/?shop_q=%20%20'),/AI 订阅报价/);
 }finally{
  if(server){await new Promise(r=>server.close(r));await server.merchantWorkflowDone?.();await server.retentionWorkflowDone?.();}
  db.close();
 }
});
