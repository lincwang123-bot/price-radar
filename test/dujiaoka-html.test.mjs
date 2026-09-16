import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDujiaokaHtml,parseDujiaokaProduct,parseDujiaokaCatalog} from '../collectors/direct/dujiaoka-html.mjs';
import {deliveryForm} from '../lib/offer-spec.mjs';
const target={id:'fufaka',name:'桑丘自动发货资源店',origin:'https://fufaka.shop'};
const home='<div id="group-all"><a href="https://fufaka.shop/buy/9">商品</a><a href="https://fufaka.shop/buy/16">商品</a></div><a href="https://fufaka.shop/buy/9">重复分类</a>Powered by @独角数卡';
const product=(id,name,price=205,stock=3)=>`<meta property="og:title" content="${name}"><form id="buy-form" method="post" action="/create-order"><input name="_token" value="do-not-read"><h3>${name}</h3><span>库存(${stock})</span><span class="buy-price">¥ ${price}</span><input type="hidden" name="gid" value="${id}"></form><div class="card card-body buy-product"><h5>商品详情</h5><p>${name}</p></div></div><div class="modal fade" id="buy_prompt">`;
test('legacy HTML extracts retail price, actual inventory and separate delivery from original detail',()=>{
  assert.deepEqual(parseDujiaokaCatalog(home,target),['https://fufaka.shop/buy/9','https://fufaka.shop/buy/16']);
  const account=parseDujiaokaProduct(product(9,'chatGPT-PLUS官网 成品账号一个月'),'https://fufaka.shop/buy/9',target);
  const recharge=parseDujiaokaProduct(product(16,'chatGPT-PLUS 代充值一个月',198,88459),'https://fufaka.shop/buy/16',target);
  assert.equal(account.price,205);assert.equal(account.stockCount,3);assert.equal(deliveryForm(account),'成品账号');
  assert.equal(recharge.price,198);assert.equal(deliveryForm(recharge),'代充');
  assert.equal(parseDujiaokaProduct(product(9,'ChatGPT Plus 月卡',205,0),'https://fufaka.shop/buy/9',target).status,'out_of_stock');
  assert.ok(!JSON.stringify(account).includes('do-not-read'));
  assert.throws(()=>parseDujiaokaProduct(product(9,'ChatGPT Plus 月卡'),'https://fufaka.shop/buy/16',target));
  assert.throws(()=>parseDujiaokaProduct(product(9,'ChatGPT Plus 月卡').replace('¥ 205','价格面议'),'https://fufaka.shop/buy/9',target));
  assert.throws(()=>parseDujiaokaCatalog(home.replace('https://fufaka.shop/buy/16','https://foreign.com/buy/16'),target));
  for(const title of ['新模式chatGPT-PLUS 免翻墙版一个月+克劳德AI+MJ画图三合一','代充值【谷歌gemini pro】【克劳德claude pro】会员']) {
    assert.equal(parseDujiaokaProduct(product(9,title),'https://fufaka.shop/buy/9',target),null,'one listing with several services is not one subscription quote');
  }
});
test('legacy collector GETs only robots, listed home/detail pages; any missing detail fails whole catalogue',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push(url);assert.equal(init.method,'GET');return new Response(url.endsWith('/robots.txt')?'User-agent: *\nDisallow:':url.endsWith('/')?home:product(url.endsWith('16')?16:9,'ChatGPT Plus 月卡代充'));};
  const rows=await collectDujiaokaHtml(target,{fetchImpl,sleep:async()=>{}});assert.equal(rows.length,2);assert.equal(calls.length,4);
  assert.ok(calls.every(url=>!/(?:create-order|captcha|login|api\/)/.test(url)));
  let n=0;await assert.rejects(collectDujiaokaHtml(target,{sleep:async()=>{},fetchImpl:async()=>{n++;return new Response('User-agent: *\nDisallow: /buy/');}}),{code:'ROBOTS_DISALLOWED'});assert.equal(n,1);
  await assert.rejects(collectDujiaokaHtml(target,{sleep:async()=>{},fetchImpl:async(url,init)=>url.endsWith('16')?new Response('gone',{status:404}):fetchImpl(url,init)}));
});
