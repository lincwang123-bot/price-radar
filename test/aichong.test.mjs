import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAichong, parseAichong } from '../collectors/direct/aichong.mjs';
const target = {id:'aichong',name:'AI补给站',origin:'https://aichong.xin'};
const row = {id:10,active:1,name:'Gemini Pro 会员一年',desc:'下单全自动开通',chips:['一年时长'],price:'20',stock:'ok',was_price:'1740'};
test('original catalogue preserves listed price, actual duration and explicit stock', () => {
  const offers = parseAichong({self_pay:true,products:[row,{...row,id:11,stock:'out'},{...row,id:12,stock:'low'}]},target);
  assert.equal(offers[0].price,20);
  assert.match(offers[0].title,/一年时长/);
  assert.equal(offers[0].url,'https://aichong.xin/buy.html?id=10');
  assert.deepEqual(offers.map(o=>o.status),['in_stock','out_of_stock','low_stock']);
  assert.deepEqual(offers.map(o=>o.stockCount),[null,0,null]);
});
test('rejects unsafe, duplicated, inactive, malformed or externally fulfilled catalogues', () => {
  assert.throws(()=>parseAichong({self_pay:false,products:[row]},target));
  assert.throws(()=>parseAichong({self_pay:true,products:[row,row]},target));
  assert.throws(()=>parseAichong({self_pay:true,products:Array(101).fill(row)},target));
  assert.throws(()=>parseAichong({self_pay:true,products:[row]},{...target,origin:'https://evil.test'}));
  assert.equal(parseAichong({self_pay:true,products:[{...row,active:0},{...row,price:'20起'}]},target).length,0);
});
test('collector requests only robots and the single public unpaginated catalogue', async () => {
  const calls=[];
  const fetchImpl=async url=>{calls.push(String(url));return new Response(calls.length===1?'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n':JSON.stringify({self_pay:true,products:[row]}),{headers:{'Content-Type':calls.length===1?'text/plain':'application/json'}});};
  assert.equal((await collectAichong(target,{fetchImpl})).length,1);
  assert.deepEqual(calls,['https://aichong.xin/robots.txt','https://aichong.xin/api/products']);
  await assert.rejects(collectAichong(target,{fetchImpl:async()=>new Response('User-agent: *\nDisallow: /api/\nAllow: /\n')}),/robots/);
});
