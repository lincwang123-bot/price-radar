import test from 'node:test';
import assert from 'node:assert/strict';
import {parse16688Goods, PLATFORM16688_SHOPS} from '../collectors/direct/platform16688.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const target=PLATFORM16688_SHOPS[0];
const capturedAt='2026-10-09T16:40:12.713Z';
// Minimal public shop/list fields verified against goods/detail on 2026-10-09.
// Neither reply text nor private fulfillment data supplies price or inventory.
const serviceGoods=[
  {goods_no:'G80266735',name:'X Premium 3个月｜会员订阅',price:38,delivery_method:3,stock_available_quantity:-1,stock_available_status:''},
  {goods_no:'G69794343',name:'X Premium 6个月｜会员订阅',price:76,delivery_method:3,stock_available_quantity:-1,stock_available_status:''},
];
const parse=list=>parse16688Goods({code:1,data:{list}},target,capturedAt);

test('16688 service fulfillment with the public -1 sentinel reaches the same directory as counted goods',()=>{
  const rows=parse(serviceGoods);
  assert.deepEqual(rows.map(row=>row.status),['in_stock','in_stock']);
  assert.deepEqual(rows.map(row=>row.stockCount),[null,null]);
  assert.deepEqual(rows.map(row=>({price:row.price,listedPrice:row.listedPrice,feeAmount:row.feeAmount})),[
    {price:38,listedPrice:38,feeAmount:null},{price:76,listedPrice:76,feeAmount:null},
  ]);
  const preview=summarizeMerchantOffers(rows,{now:Date.parse(capturedAt)});
  assert.equal(preview.rawCount,2);assert.equal(preview.validCount,2);
  assert.deepEqual(preview.samples.map(row=>row.url).sort(),serviceGoods.map(row=>`${target.origin}/goods/${row.goods_no}`).sort());
});

test('16688 service sentinel does not override sold-out, unknown modes, missing inventory or no-warranty policy',()=>{
  const base=serviceGoods[0];
  const overrides=[
    {stock_available_status:'out'}, {stock_available_quantity:0},
    {stock_available_quantity:-2}, {stock_available_quantity:null}, {stock_available_quantity:''},
    {stock_available_status:'disabled'}, {delivery_method:1}, {delivery_method:4}, {delivery_method:null},
    {delivery_method:'3'}, {stock_available_quantity:8,stock_available_status:'out'},
    {name:'X Premium 3个月 无质保无售后'},
  ];
  const rows=parse(overrides.map((over,index)=>({...base,...over,goods_no:`G${index+1}`})));
  assert.deepEqual(rows.map(row=>row.status),[
    'out_of_stock','out_of_stock','unknown','unknown','unknown','unknown','unknown','unknown','unknown','in_stock','out_of_stock','in_stock',
  ]);
  assert.equal(rows[9].stockCount,null);
  assert.equal(summarizeMerchantOffers(rows,{now:Date.parse(capturedAt)}).validCount,1);
  assert.equal(parse([{...base,description:'<p>本商品无质保，无售后</p>'}]).length,0);
});
