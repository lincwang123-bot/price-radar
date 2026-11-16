import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDirectOffer,directOfferExclusionReason} from '../collectors/direct/catalog.mjs';
import {offerSpec} from '../lib/offer-spec.mjs';
import {publicOfferAllowed} from '../lib/public-offers.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';

const spec=title=>offerSpec({title,currency:'CNY'},{product_id:'chatgpt-plus'});
const managementTools=[
  'GP Plus Codex 账户批量管理工具（日区 越南 日抛 UPI PIX MOMO ）',
  'GP Plus Codex 账户批量管理工具（日区 越南 泰国 菲区 日抛 UPI PIX MOMO 低价）',
  'ChatGPT Plus 账号管理软件 月卡',
  'ChatGPT Plus account management tool monthly license',
];

test('account management tools are not subscriptions, including already stored search-source rows',()=>{
  for(const title of managementTools){
    assert.equal(classifyDirectOffer({title}),null,title);
    assert.equal(directOfferExclusionReason({title}),'non_subscription_tool',title);
    for(const source of ['direct-shops','ldxp-goods']){
      const offer={offer_id:'tool',title,price:0.01,currency:'CNY',status:'in_stock',stock_count:1,url:'https://merchant.example.org/tool'};
      const product={product_id:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY'};
      assert.equal(publicOfferAllowed(source,offer,product),false,source+' '+title);
      const projected=projectProduct(null,source,{fetched_at:new Date().toISOString()},product,{offers:[offer],health:{}});
      assert.equal(projected.offers.length,0,source+' '+title);
      const directory=buildProductDirectory([{source,stale:false,products:[{...product,offers:[offer]}]}]);
      assert.equal(directory.flatMap(c=>c.products.flatMap(p=>directoryQuotes(p).entries)).length,0,source+' '+title);
    }
  }
  for(const title of ['ChatGPT Plus 月卡成品号','ChatGPT Plus 月卡代充 新开续费均可','ChatGPT Plus 月卡成品号，附赠账号管理工具']){
    assert.ok(classifyDirectOffer({title}),title);
    assert.equal(directOfferExclusionReason({title}),null,title);
  }
});

test('storage and redemption deadlines never become the subscription term',()=>{
  for(const window of ['只能囤5天','可囤五天','囤卡5天','兑换期限5天','5天内兑换','激活有效期四个月']){
    const missing=spec('ChatGPT Plus 代充 新开续费均可（'+window+'）');
    assert.equal(missing.purchase_conditions.subscriptionTerm,'unknown',window);
    assert.equal(missing.known,false,window);
    assert.equal(missing.comparison_eligible,false,window);
    const monthly=spec('ChatGPT Plus 月卡代充 新开续费均可（'+window+'）');
    assert.equal(monthly.purchase_conditions.subscriptionTerm,'1m',window);
    assert.equal(monthly.known,true,window);
  }
  const corrected=spec('ChatGPT Plus 代充 新开续费均可（只能囤5天）');
  assert.match(corrected.superseded_comparison_key,/^5d:/);
});

test('full Chinese duration numerals and half-years retain their actual term',()=>{
  for(const [duration,expected] of [['半年','6m'],['四个月','4m'],['十个月','10m'],['十八个月','18m'],['二十四个月','24m'],['十一天','11d'],['月卡','1m'],['年卡','12m'],['3天','3d']]){
    const result=spec('ChatGPT Plus '+duration+'成品号');
    assert.equal(result.purchase_conditions.subscriptionTerm,expected,duration);
    assert.equal(result.known,true,duration);
    assert.equal(result.comparison_eligible,true,duration);
  }
  assert.match(spec('ChatGPT Plus 半年成品号').superseded_comparison_key,/^12m:/);
  assert.equal(classifyDirectOffer({title:'ChatGPT Plus 半年代充'})?.id,'chatgpt-plus-recharge');
  assert.equal(classifyDirectOffer({title:'Suno Pro 十二个月成品号'})?.id,'suno-pro-12m');
});

test('partial numeric matches and unsupported fractional terms stay unverified',()=>{
  for(const duration of ['1.5个月','1.5年','1.5天','1.5 months','.5个月卡','.5 months','半月','一年半','0个月','零个月','壹个月卡']){
    const result=spec('ChatGPT Plus '+duration+'成品号');
    assert.ok(['unknown','ambiguous'].includes(result.purchase_conditions.subscriptionTerm),duration);
    assert.equal(result.known,false,duration);
    assert.equal(result.comparison_eligible,false,duration);
  }
  for(const duration of ['一至三个月','1-3个月','月卡/年卡']){
    assert.equal(spec('ChatGPT Plus '+duration+'成品号').purchase_conditions.subscriptionTerm,'ambiguous',duration);
  }
  for(const duration of ['1.5个月','四个月','半月','一年半','0个月']){
    assert.equal(classifyDirectOffer({title:'Suno Pro '+duration+'成品号'}),null,duration);
  }
});

test('live-catalog monthly and annual labels remain explicit while mixed billing periods are ambiguous',()=>{
  for(const [title,expected] of [
    ['GPT Plus 菲律宾区官充月费 未接码 成品号 质保','1m'],
    ['【质保】ChatGPT plus 菲区 自助卡密 月费 秒冲','1m'],
    ['【直冲】Claude Max X5 单月自动充值卡密','1m'],
    ['【直冲】Claude Pro 单月自动充值卡密','1m'],
    ['推特蓝V-Premium年度 |免登录开通（拍后联系客服）','12m'],
    ['ChatGPT Plus 年费成品号','12m'],
    ['ChatGPT Plus 月度代充 新开续费均可','1m'],
    ['Suno Pro 月度成品号','1m'],
    ['ChatGPT Plus 季度成品号','3m'],
    ['ChatGPT Plus 季卡成品号','3m'],
    ['grok-heavy成品号月费/季度/年费(质保首登）','ambiguous'],
    ['Plus 整月质保','unknown'],
  ])assert.equal(spec(title).purchase_conditions.subscriptionTerm,expected,title);
  assert.equal(classifyDirectOffer({title:'Suno Pro 季度成品号'})?.id,'suno-pro-3m');
  assert.equal(classifyDirectOffer({title:'Suno Pro 月度成品号'})?.id,'suno-pro-1m');
});

test('term corrections supersede the immediate previous key while retaining earlier ambiguity corrections',()=>{
  for(const title of ['ChatGPT Plus 半年成品号 非试用','ChatGPT Plus 半年成品账号 大约3天完成']){
    const result=spec(title);
    assert.equal(result.purchase_conditions.subscriptionTerm,'6m',title);
    assert.equal(result.superseded_comparison_key,'12m:plus:成品账号:常规:地区未注明:单位未注明:CNY',title);
  }
  // An unchanged monthly term still exposes the older negative-trial fix.
  const previousCorrection=spec('ChatGPT Plus 月卡成品号 非试用');
  assert.equal(previousCorrection.superseded_comparison_key,'1m:plus:成品账号:试用/短期:地区未注明:单位未注明:CNY');
});
