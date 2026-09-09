import test from 'node:test';import assert from 'node:assert/strict';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
const quote=(title,price,id)=>({title,price,offer_id:id,status:'in_stock',stock_count:2,currency:'CNY',url:'https://merchant-'+id+'.com/product',comparison_known:false});
const products=()=>buildProductDirectory([{source:'priceai',products:[{product_id:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[quote('ChatGPT Plus 成品号 1个月',30,'account'),quote('ChatGPT Plus 代充 1个月',120,'recharge'),quote('ChatGPT Plus 1个月',1,'unknown'),quote('ChatGPT Plus CDK 1个月',2,'code'),quote('ChatGPT Plus 共享 1个月',10,'shared')]}]}]).find(c=>c.key==='chatgpt').products[0];
test('one product preserves all delivery groups and filters before ranking and statistics',()=>{
 const product=products();assert.equal(product.deliveryEnabled,true);const all=directoryQuotes(product);assert.equal(all.total,5);assert.equal(all.deliveries.length,5);
 assert.deepEqual(directoryQuotes(product,{delivery:'recharge'}).entries.map(e=>e.offer.price),[120]);
 assert.deepEqual(directoryQuotes(product,{delivery:'account'}).entries.map(e=>e.offer.price),[30]);
 assert.deepEqual(directoryQuotes(product,{delivery:'unknown'}).entries.map(e=>e.offer.price),[1]);
 assert.deepEqual(directoryQuotes(product,{delivery:'code'}).entries.map(e=>e.offer.price),[2]);
 assert.equal(directoryQuotes(product,{delivery:'recharge'}).shopCount,1);
});
test('non subscription service categories are not forced into account versus recharge',()=>{
 const directory=buildProductDirectory([{source:'goaihop-relay',products:[{product_id:'relay-example',name:'API 服务',currency:'CNY',offers:[quote('API 额度',10,'api')]}]},{source:'priceai',products:[{product_id:'gmail-account',name:'Gmail 邮箱',currency:'CNY',offers:[quote('Gmail 邮箱账号',5,'mail')]}]}]);
 assert.equal(directory.some(c=>c.key==='relay'),false);
 for(const key of ['mail'])for(const product of directory.find(c=>c.key===key).products)assert.equal(product.deliveryEnabled,false);
});
