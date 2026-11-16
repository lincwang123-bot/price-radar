import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDirectOffer,groupDirectOffers} from '../collectors/direct/catalog.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

function offer(title,extra={},overrides={}){
 return {offerId:'retail:1',sourceId:'retail',title,price:770.5,currency:'CNY',status:'in_stock',stockCount:4,
  url:'https://www.16688.com.cn/goods/G51618587',capturedAt:new Date().toISOString(),extra,...overrides};
}
const jpt='【pro 5x】G JPT 【菲区】 CDK 24小时充值 质保订阅';
const jptEvidence={productTitle:jpt,descriptionScope:'product',description:'OpenAI 官方充值，质保订阅。'};

test('retail G JPT uses only matching product evidence and survives public projection unchanged',()=>{
 const row=offer(jpt,{deliveryEvidence:jptEvidence}),before=JSON.stringify(row);
 assert.equal(classifyDirectOffer(row)?.id,'chatgpt-pro-5x');
 assert.deepEqual(summarizeMerchantOffers([row]).samples,[{title:jpt,price:770.5,currency:'CNY',url:row.url}]);
 assert.equal(JSON.stringify(row),before);
 for(const patch of [{description:''},{productTitle:'Another GPT product'},{descriptionScope:'product_multi'},{skuTitle:'Other SKU'}]){
  assert.equal(classifyDirectOffer(offer(jpt,{deliveryEvidence:{...jptEvidence,...patch}})),null);
 }
 for(const title of [jpt+' + Claude Pro',jpt+' + Gemini Pro',jpt+' + Canva',jpt+' API 中转',jpt+' / 20x']){
  assert.equal(classifyDirectOffer(offer(title,{deliveryEvidence:{...jptEvidence,productTitle:title}})),null,title);
 }
 assert.equal(groupDirectOffers([{...row,stockCount:0}]).length,0);
 assert.equal(groupDirectOffers([{...row,extra:{deliveryEvidence:{...jptEvidence,description:'OpenAI 官方充值，无售后'}}}]).length,0);
});

test('Pro iOS codes require an agreeing single-SKU parent and cannot invent stock or another tier',()=>{
 for(const tier of [5,20]){
  const title=`ChatGPT PRO${tier}_IOS`,evidence={productTitle:`ChatGPT Pro ${tier}X 月卡｜iOS 官方充值`,skuTitle:`PRO${tier}_IOS`,descriptionScope:'product'};
  const row=offer(title,{deliveryEvidence:evidence},{status:'unknown',stockCount:null});
  assert.equal(classifyDirectOffer(row)?.id,`chatgpt-pro-${tier}x`);
  assert.equal(summarizeMerchantOffers([row]).validCount,0);
  assert.equal(summarizeMerchantOffers([{...row,status:'in_stock'}]).validCount,1);
  for(const patch of [{productTitle:'ChatGPT Pro 5x / 20x 月卡'},{productTitle:`Claude Pro ${tier}X 月卡`},{productTitle:`ChatGPT Pro ${tier===5?20:5}x 月卡`},{descriptionScope:'product_multi'},{skuTitle:'Another SKU'}]){
   assert.equal(classifyDirectOffer({...row,extra:{deliveryEvidence:{...evidence,...patch}}}),null,JSON.stringify(patch));
  }
 }
});

test('Gemini Ultra retail typo and reviewed bare Plus remain bounded and retain original wording',()=>{
 const title='Gemini ulrta家庭组席位（可用反重力）',row=offer(title,{}, {url:'https://xiaocaiyu.vip/item/27',price:222});
 assert.equal(classifyDirectOffer(row)?.id,'gemini-ultra');
 assert.equal(summarizeMerchantOffers([row]).samples[0]?.title,title);
 assert.equal(classifyDirectOffer({title:'ulrta 家庭组席位'}),null);
 const plus=offer('plus官方充值月卡（质保30天）直冲个人账号 自动发货-(24h全自动充值)----限时优惠',
  {shopNo:'S704668',shopUrl:'https://www.16688.com.cn/shop/S704668'},{url:'https://www.16688.com.cn/goods/G71033192',price:132.26});
 assert.equal(summarizeMerchantOffers([plus]).validCount,1);
 // 人工确认名单仍只绑定精确 SKU；但无品牌规格归类可覆盖同文案标题。
 assert.equal(classifyDirectOffer({...plus,url:'https://www.16688.com.cn/goods/G71033193'})?.id,'chatgpt-plus-recharge');
 assert.equal(classifyDirectOffer({...plus,extra:{...plus.extra,shopNo:'S678924'}})?.id,'chatgpt-plus-recharge');
});
