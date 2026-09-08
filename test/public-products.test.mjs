import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPublicProducts} from '../collectors/direct/public-products.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const target=()=>authorizeMerchantTarget({id:'fixture',name:'目录测试',origin:'https://catalog-store.com'});
const product=(id=1,extra={})=>({id,name:'ChatGPT Plus 月卡 自助充值 官方售后',price:116,price_cents:11600,currency:'CNY',stock:2,status:'in_stock',product_url:'https://catalog-store.com/products/'+id,description:'充值到自己的账号，订阅一个月',...extra});
const page=(items,extra={})=>({ok:true,page:1,page_size:100,total:items.length,count:items.length,items,...extra});
const response=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const read=body=>collectPublicProducts(target(),{fetchImpl:async()=>response(body)});

test('公开平铺目录只读一个兼容数组，保留实时价格、币种与库存',async()=>{
 const items=[product(),product(2,{price:135,price_cents:13500,stock:0})];
 const offers=await read({...page(items),products:items,data:{items,list:items,total:2,page:1,page_size:100}});
 assert.equal(offers.length,2);assert.deepEqual(offers.map(o=>o.price),[116,135]);assert.deepEqual(offers.map(o=>o.status),['in_stock','out_of_stock']);
 assert.equal(summarizeMerchantOffers(offers).validCount,1);
 for(const alias of ['products','items','list']){
  const payload=page(items);delete payload.items;
  if(alias==='products')payload.products=items;else payload.data={[alias]:items};
  assert.equal((await read(payload)).length,2);
 }
});
test('按声明的分页逐页读取，遇到重复、漏页、变动或超限不发布部分目录',async()=>{
 let calls=[];
 const offers=await collectPublicProducts(target(),{fetchImpl:async url=>{const u=new URL(url),p=Number(u.searchParams.get('page'));calls.push(u);return response(page([product(p)],{page:p,page_size:1,total:2}));}});
 assert.equal(offers.length,2);assert.equal(calls.length,2);assert.ok(calls.every(u=>u.pathname==='/api/v1/public/products'&&u.searchParams.get('page_size')==='100'));
 for(const invalid of [page([product()],{page:2}),page([product()],{total:2}),page([product()],{count:3}),page([product()],{total:501}),page([product()],{page_size:1,total:6}),page([product(),product()]),{...page([product()]),data:{total:9}},page([product()],{success:false})])await assert.rejects(read(invalid),e=>e.code==='INVALID_CATALOG');
 for(const mode of ['repeat','change','short']){
  let n=0;
  await assert.rejects(collectPublicProducts(target(),{fetchImpl:async()=>{n++;return response(page(mode==='short'&&n===2?[]:[product(mode==='repeat'?1:n)],{page:n,page_size:1,total:mode==='change'&&n===2?3:2}));}}),e=>e.code==='INVALID_CATALOG');
 }
});
test('多规格不能冒用父价格，拒绝矛盾价格库存、跨源链接和伪造授权',async()=>{
 for(const change of [{skus:[{id:1,price:999}]},{variants:[{name:'Pro'}]},{options:{}},{price_cents:1},{price:true},{currency:'元'},{stock:-1},{stock_count:9},{product_url:'https://other.com/products/1'},{product_url:'https://user:pass@catalog-store.com/products/1'}])await assert.rejects(read(page([product(1,change)])),e=>e.code==='INVALID_CATALOG');
 assert.equal((await read(page([product(1,{is_available:false})])))[0].status,'out_of_stock');
 await assert.rejects(collectPublicProducts({...target(),approved:true},{fetchImpl:async()=>assert.fail('must not fetch')}),/未授权/);
});
test('未知商家自动识别平铺目录，复用第一次响应且不再探测主页',async()=>{
 const calls=[];
 const result=await probeMerchantCatalog({id:'fixture',shopName:'目录测试',shopUrl:'https://catalog-store.com/',identity:'domain:catalog-store.com'},
  {merchantFetchFactory:()=>async url=>{calls.push(url);return response(page([product()]));}},new Date().toISOString(),Date.now()+30000);
 assert.equal(result.offers.length,1);assert.equal(calls.length,1);assert.ok(calls[0].includes('/api/v1/public/products?'));
 assert.equal(result.offers[0].extra.merchantIdentity,'domain:catalog-store.com');
});
