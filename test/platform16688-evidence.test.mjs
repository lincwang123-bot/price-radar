import test from 'node:test';
import assert from 'node:assert/strict';
import { collect16688, parse16688Goods, PLATFORM16688_SHOPS } from '../collectors/direct/platform16688.mjs';
import { classifyDirectOffer, directOfferExclusionReason, groupDirectOffers } from '../collectors/direct/catalog.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { deliveryEvidence } from '../lib/delivery-evidence.mjs';

const target=PLATFORM16688_SHOPS[0];
const warranty='质保30天不掉订阅，掉订阅按天退差价，封号99%的原因是由于3.5帐号本身的问题，无售后';
const goods=[
  {goods_no:'G82461501',name:'【正规秒充】Pro 20x 官方充值',price:1025,description:`<p>${warranty}</p>`,goods_category_no:'C127803',delivery_method:2,stock_available_quantity:-1,stock_available_status:''},
  {goods_no:'G41386021',name:'【正规秒充】Pro 5x 官方充值',price:630,description:`<p>${warranty}</p>`,goods_category_no:'C127803',delivery_method:2,stock_available_quantity:-1,stock_available_status:''},
  {goods_no:'G40326089',name:'【正规秒充】Plus 官方充值（须账号为Free状态）',price:111.5,description:'须会员到期后才可以续费，无需上号，卡密自助充值',goods_category_no:'C127803',delivery_method:1,stock_available_quantity:1,stock_available_status:'low'},
];
test('16688 abbreviated titles use the exact public category join and remain visible after storage',async()=>{
  const calls=[];
  const rows=await collect16688(target,{fetchImpl:async(url,init)=>{
    calls.push({url,body:JSON.parse(init.body)});
    assert.equal(init.method,'POST');assert.equal(init.headers.Cookie,undefined);
    return url.endsWith('/goods/list')?Response.json({code:1,data:{list:goods}}):Response.json({code:1,data:[{goods_category_no:'C127803',name:'GPT'}]});
  }});
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/shopApi/goods/list','/shopApi/goodsCategory/list']);
  assert.deepEqual(calls[1].body,{shop_no:target.shopNo});
  assert.deepEqual(rows.map(row=>row.title),goods.map(row=>row.name));
  assert.deepEqual(rows.map(row=>row.price),[1025,630,111.5]);
  assert.deepEqual(rows.map(row=>row.category),['GPT','GPT','GPT']);
  assert.deepEqual(rows.map(row=>row.stockCount),[null,null,1]);
  assert.deepEqual(rows.map(row=>classifyDirectOffer(row)?.id),['chatgpt-pro-20x','chatgpt-pro-5x','chatgpt-plus-recharge']);
  const stored=rows.map(({category,...row})=>({...row,extra:JSON.stringify(row.extra)}));
  assert.deepEqual(stored.map(row=>classifyDirectOffer(row)?.id),['chatgpt-pro-20x','chatgpt-pro-5x','chatgpt-plus-recharge']);
  assert.equal(groupDirectOffers(stored).length,3);
  const preview=summarizeMerchantOffers(rows);
  assert.equal(preview.rawCount,3);assert.equal(preview.validCount,3);
  assert.deepEqual(preview.samples.map(s=>s.url).sort(),goods.map(g=>target.origin+'/goods/'+g.goods_no).sort());
});
test('category evidence cannot supply a brand to another product, other brand or ambiguous bundle',()=>{
  const extra=title=>({deliveryEvidence:deliveryEvidence({productTitle:title,category:'GPT'})});
  for(const title of ['Plus 官方充值','Pro 20x 官方充值']) {
    assert.equal(classifyDirectOffer({title}),null);
    assert.equal(classifyDirectOffer({title,extra:extra('另一件商品')}),null);
    assert.equal(classifyDirectOffer({title,extra:{deliveryEvidence:{...extra(title).deliveryEvidence,skuTitle:'另一规格'}}}),null);
  }
  for(const title of ['UnknownBrand Pro 20x 官方充值','Adobe Pro 20x 官方充值','豆包 Plus 官方充值','Pro 5x / 20x 充值'])assert.equal(classifyDirectOffer({title,extra:extra(title)}),null,title);
  for(const title of ['Claude Pro 5x 官方充值','Gemini Pro 官方充值'])assert.notEqual(classifyDirectOffer({title,extra:extra(title)})?.platform,'ChatGPT');
  const title='Pro 20x 官方充值';assert.equal(classifyDirectOffer({title,category:'GPT / Claude'}),null);
});
test('manual -1 availability is limited to the documented fulfillment mode and sold-out still wins',()=>{
  const template={...goods[0],name:'ChatGPT Pro 20x 官方充值'};
  const rows=parse16688Goods({code:1,data:{list:[
    template,{...template,goods_no:'G2',stock_available_status:'out'},
    {...template,goods_no:'G3',stock_available_quantity:0},
    {...template,goods_no:'G4',delivery_method:1},
    {...template,goods_no:'G5',stock_available_quantity:-2},
    {...template,goods_no:'G6',stock_available_status:'disabled'},
  ]}},target);
  assert.deepEqual(rows.map(r=>r.status),['in_stock','out_of_stock','out_of_stock','unknown','unknown','unknown']);
  assert.deepEqual(rows.map(r=>r.stockCount),[null,0,0,null,null,null]);
  assert.equal(summarizeMerchantOffers(rows).validCount,1);
});
test('ban-reason exception does not swallow unconditional or separate no-warranty statements',()=>{
  const offer=description=>({title:'ChatGPT Pro 20x 官方充值',extra:{deliveryEvidence:deliveryEvidence({description,descriptionScope:'product'})}});
  for(const text of [warranty,'质保30天不掉订阅，封号无售后','質保30天，封號的原因為帳號本身的問題，無售後'])assert.equal(directOfferExclusionReason(offer(text)),null,text);
  for(const text of [warranty+'。本商品无售后',warranty+'；商品不质保','质保30天，所有商品无售后','封号风险请注意，所有商品无售后','封号、错充无售后','封号的原因是任何问题，一律无售后'])assert.equal(directOfferExclusionReason(offer(text)),'no_warranty',text);
});
test('category reads fail closed on access denial, invalid payload, duplicate IDs or another shop',async()=>{
  for(const categoryResponse of [new Response('blocked',{status:403}),Response.json({code:0,data:[]}),Response.json({code:1,data:[{goods_category_no:'C127803',name:'GPT'},{goods_category_no:'C127803',name:'Claude'}]}),Response.json({code:1,data:[{goods_category_no:'C127803',name:'GPT',shop_no:'S999'}]})]) {
    const calls=[];
    await assert.rejects(collect16688(target,{fetchImpl:async url=>{calls.push(url);return url.endsWith('/goods/list')?Response.json({code:1,data:{list:goods}}):categoryResponse;}}));
    assert.equal(calls.length,2);
  }
});
