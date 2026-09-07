import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryEvidence } from '../lib/delivery-evidence.mjs';
import { openDb, storeSnapshot, offersOfProduct } from '../lib/db.mjs';
import { parseDujiaoProducts } from '../collectors/direct/dujiao.mjs';
import { parseKamiPage } from '../collectors/direct/kami.mjs';
import { parseShopApiGoods } from '../collectors/direct/shop-api.mjs';
import { parse16688Goods, PLATFORM16688_SHOPS } from '../collectors/direct/platform16688.mjs';
import { parseMooncakeCatalog } from '../collectors/direct/mooncake.mjs';
import { parseIkunLove } from '../collectors/direct/ikunlove.mjs';
import { parseAikaShop } from '../collectors/direct/aikashop.mjs';
import { parseAichong } from '../collectors/direct/aichong.mjs';
import { offerDelivery } from '../lib/offer-spec.mjs';
import { stableDirectSnapshotId } from '../collectors/direct/catalog.mjs';

const at='2026-09-07T04:00:00.000Z';
test('delivery evidence retains only bounded public text, strips HTML and excludes credentials and fulfillment payloads',()=>{
  const input={productTitle:'Claude <b>Pro</b>',skuTitle:'月卡',category:'成品号',description:'<script>代充</script><p>提供成<strong>品账号</strong> &amp; 邮箱。</p>',
    cardContent:'PRIVATE CARD',password:'PRIVATE PASSWORD',shopAnnouncement:'全店都支持代充',deliveryMode:'auto'};
  assert.deepEqual(deliveryEvidence(input),{productTitle:'Claude Pro',skuTitle:'月卡',category:'成品号',description:'提供成品账号 & 邮箱。'});
  assert.equal(deliveryEvidence({description:'&lt;script&gt;代充&lt;/script&gt;实际交付成品号'}).description,'实际交付成品号');
  assert.equal(deliveryEvidence({productTitle:'x'.repeat(501),description:'字'.repeat(4001)}).productTitle.length,500);
  assert.equal(deliveryEvidence({description:'字'.repeat(4001)}).description.length,4000);
  for(const description of ['api_key=private-token','卡密：PRIVATE-CARD','Bearer abcdefghijklmnopqrstuvwxyz','sk-abcdefghijklmnopqrstuvwxyz','&#112;assword=hidden'])
    assert.equal(deliveryEvidence({description}).description,'');
});
test('Dujiao preserves parent account evidence with generic month SKU and lets public SKU description stay specific',()=>{
  const target={id:'burstpro-ai',name:'BurstPro AI',origin:'https://burstpro-ai.online'};
  const payload=mode=>({data:[{id:1,title:'ChatGPT Plus 成品号',description:{'zh-CN':'提供已开通会员的账号',private_note:'NOT PUBLIC'},fulfillment_type:mode,category:{name:'ChatGPT'},skus:[
    {id:2,title:'月卡',price:100,auto_stock_available:2,manual_stock_available:2},
    {id:3,title:'本人账号充值',description:'<p>给您已有的账号开通会员，不提供账号</p>',price:120,auto_stock_available:2,manual_stock_available:2},
  ]}]});
  const a=parseDujiaoProducts(payload('auto'),target,at),b=parseDujiaoProducts(payload('manual'),target,at);
  assert.deepEqual(a[0].extra.deliveryEvidence,{productTitle:'ChatGPT Plus 成品号',skuTitle:'月卡',category:'ChatGPT',description:'提供已开通会员的账号',descriptionScope:'product_multi'});
  assert.equal(a[0].title,'ChatGPT 月卡');
  assert.equal(a[1].extra.deliveryEvidence.skuTitle,'本人账号充值');
  assert.equal(a[1].extra.deliveryEvidence.description,'给您已有的账号开通会员，不提供账号');
  assert.equal(a[1].extra.deliveryEvidence.descriptionScope,'sku');
  assert.deepEqual(a.map(o=>o.extra.deliveryEvidence),b.map(o=>o.extra.deliveryEvidence),'auto/manual never becomes delivery evidence');
  assert.equal(offerDelivery(a[0]).kind,'account');assert.equal(offerDelivery(a[1]).kind,'recharge');
});
test('description scope is bounded evidence and survives storage and snapshot fingerprints',()=>{
  for(const scope of ['sku','product','product_multi'])assert.equal(deliveryEvidence({descriptionScope:scope}).descriptionScope,scope);
  for(const scope of [undefined,'all','trusted',{},null])assert.equal(deliveryEvidence({descriptionScope:scope}).descriptionScope,undefined);
  const single=parseDujiaoProducts({data:[{id:1,title:'ChatGPT Plus',description:'充值自己的账号',skus:[{id:1,title:'月卡',price:100,auto_stock_available:1}]}]}, {id:'morimm',origin:'https://morimm.com'},at)[0];
  assert.equal(single.extra.deliveryEvidence.descriptionScope,'product');
  const changed={...single,extra:{deliveryEvidence:{...single.extra.deliveryEvidence,descriptionScope:'product_multi'}}};
  assert.notEqual(stableDirectSnapshotId([single]),stableDirectSnapshotId([changed]));
  const db=openDb(':memory:');
  try{
    storeSnapshot(db,{source:'direct-shops',snapshotId:'scoped',fetchedAt:at,products:[{productId:'chatgpt-plus',offers:[single]}]});
    const stored=JSON.parse(offersOfProduct(db,'direct-shops','scoped','chatgpt-plus')[0].extra);
    assert.equal(stored.deliveryEvidence.descriptionScope,'product');
  }finally{db.close();}
});
test('public catalog adapters retain only the selected product description and category',()=>{
  const description='<p>仅充值您已有的账号，不提供成品号</p>';
  const cases=[
    parseKamiPage({data:[{id:1,name:'Claude Pro 月卡',price:100,stock:1,description,private_note:'SECRET',category:{name:'Claude'}}]}, {id:'kami',origin:'https://kami.example'},at)[0],
    parseShopApiGoods({code:1,data:{list:[{id:1,name:'Claude Pro 月卡',price:100,description,card_list:['SECRET'],category:{name:'Claude'}}]}},{id:'shop',token:'public-shop',origin:'https://wzyp.cn'},at)[0],
    parse16688Goods({code:1,data:{list:[{goods_no:'G1',name:'Claude Pro 月卡',price:100,description,secret:'SECRET'}]}},PLATFORM16688_SHOPS[0],at)[0],
    parseMooncakeCatalog('window.MOONCAKE_CATALOG = '+JSON.stringify([{id:1,name:'Claude',notice:'全店成品号',items:[{id:1,name:'Claude Pro 月卡',price:100,description,secret:'SECRET'}]}])+';', {id:'moon',origin:'https://moon.example'},at)[0],
    parseIkunLove({success:true,data:{products:[{id:1,title:'Claude Pro 月卡',priceCents:10000,description,consolePassword:'SECRET',category:'Claude'}]}},{id:'ikun',origin:'https://ikunlove.best'},at)[0],
    parseAichong({self_pay:true,notice:'全店成品号',products:[{id:1,active:1,name:'Claude Pro 月卡',price:'100',desc:description,stock:'ok',secret:'SECRET'}]},{id:'aichong',origin:'https://aichong.xin'},at)[0],
  ];
  for(const offer of cases){assert.equal(offer.extra.deliveryEvidence.description,'仅充值您已有的账号，不提供成品号');assert.doesNotMatch(JSON.stringify(offer.extra.deliveryEvidence),/SECRET|全店/);assert.equal(offerDelivery(offer).kind,'recharge');}
});
test('AikaShop no longer fabricates recharge from a plain subscription SKU or whole-page marketing',()=>{
  const html='<p>全店代充、成品号、账号服务</p><script id="plansData" data-product="Suno">'+JSON.stringify([{name:'Pro 月卡',cny:50},{name:'Premier 月卡',cny:100,description:'仅充值本人已有账号'}])+'</script>';
  const offers=parseAikaShop(html,{id:'aikashop',origin:'https://aikashop.com'},at);
  assert.equal(offers[0].title,'Suno Pro 1个月');assert.doesNotMatch(offers[0].title,/代充/);
  assert.equal(offers[0].extra.deliveryEvidence.description,'');assert.equal(offers[1].extra.deliveryEvidence.description,'仅充值本人已有账号');
  assert.equal(offerDelivery(offers[0]).kind,'unknown');assert.equal(offerDelivery(offers[1]).kind,'recharge');
});
test('same product description change updates snapshot identity without inventing delivery from dispatch mode',()=>{
  const target={id:'kami',origin:'https://kami.example'};
  const parse=(description,delivery_way)=>parseKamiPage({data:[{id:1,name:'ChatGPT Plus 月卡',price:100,stock:1,description,delivery_way}]},target,at)[0];
  const account=parse('提供已开通会员的成品号',0),recharge=parse('充值本人已有账号',0);
  assert.notEqual(stableDirectSnapshotId([account]),stableDirectSnapshotId([recharge]));
  assert.equal(account.title,recharge.title);assert.equal(account.price,recharge.price);
  for(const mode of [0,1])assert.equal(offerDelivery(parse('',mode)).kind,'unknown');
});
test('SQLite persists sanitized delivery evidence with other extra metadata intact for object and JSON sources',()=>{
  const db=openDb(':memory:');
  try {
    for(const [n,extra]of [[1,{deliveryEvidence:{productTitle:'<b>成品号</b>',description:'api_key=SECRET'},quoteHealth:{status:'ok'}}],
      [2,JSON.stringify({deliveryEvidence:{productTitle:'代充',description:'充值本人已有账号'},quoteHealth:{status:'cached'}})]]){
      storeSnapshot(db,{source:'direct-shops',snapshotId:'evidence-'+n,fetchedAt:at,products:[{productId:'chatgpt-plus',offers:[{offerId:'o1',title:'ChatGPT Plus月卡',price:100,url:'https://shop.example/item/1',extra}]}]});
      const stored=JSON.parse(offersOfProduct(db,'direct-shops','evidence-'+n,'chatgpt-plus')[0].extra);
      assert.equal(stored.deliveryEvidence.productTitle,n===1?'成品号':'代充');assert.equal(stored.quoteHealth.status,n===1?'ok':'cached');assert.doesNotMatch(JSON.stringify(stored),/SECRET/);
    }
  }finally{db.close();}
});
