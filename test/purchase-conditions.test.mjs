import test from 'node:test';
import assert from 'node:assert/strict';
import {offerSpec} from '../lib/offer-spec.mjs';
import {purchaseConditions} from '../lib/purchase-conditions.mjs';

test('subscription, redemption and warranty windows have independent evidence',()=>{
 const o={title:'ChatGPT Plus 代充 1个月 新开续费均可 卡密兑换有效期7天 质保3天',currency:'CNY'};
 const s=offerSpec(o);assert.equal(s.key.split(':')[0],'1m');assert.equal(s.known,true);
 assert.equal(s.purchase_conditions.redemptionWindow,'7天');
 assert.equal(s.purchase_conditions.warrantyWindow,'3天');
 assert.equal(s.purchase_conditions.accountState,'both');
 assert.equal(s.purchase_conditions.subscriptionTerm,'1m');
 assert.equal(s.purchase_conditions.platformVerified,false);
});
test('renewal, new subscription and membership requirements cannot share a comparison key',()=>{
 const spec=t=>offerSpec({title:'ChatGPT Plus 代充 1个月 '+t,currency:'CNY'});
 const newPlan=spec('仅限新开'),renew=spec('仅限续费 已有会员 剩余3天内到期'),plain=spec('');
 assert.equal(renew.purchase_conditions.accountState,'renewal');assert.equal(renew.purchase_conditions.quality,'B');
 assert.notEqual(newPlan.key,renew.key);assert.notEqual(plain.key,renew.key);
 assert.equal(renew.key.split(':')[0],'1m');
 assert.equal(plain.purchase_conditions.quality,'C');assert.equal(plain.comparison_eligible,false);
});
test('account products do not inherit restrictions from other SKUs or shared parent descriptions',()=>{
 const o={title:'ChatGPT Plus 成品账号 1个月',currency:'CNY',extra:{deliveryEvidence:{descriptionScope:'product_multi',description:'另一个SKU仅限续费，需要已有会员，质保7天'}}};
 const s=offerSpec(o);assert.equal(s.purchase_conditions.quality,'A');assert.equal(s.purchase_conditions.warrantyWindow,'');assert.equal(s.known,true);
});
test('unknown period, mixed delivery and vague prerequisites stay unconfirmed',()=>{
 for(const title of ['ChatGPT Plus 成品账号 卡密兑换有效期7天','ChatGPT Plus 代充或成品账号1个月','ChatGPT Plus 代充1个月 新开续费均可 指定账号状态'])assert.equal(offerSpec({title}).purchase_conditions.quality,'C',title);
 const c=purchaseConditions({title:'ChatGPT Plus 代充1个月 无需已有会员 新开续费均可'}, {term:'1m',delivery:{kind:'recharge',known:true}});
 assert.equal(c.requiresMembership,false);
});

test('currency omissions and contradictory qualification never become complete quotes',()=>{
 for(const offer of [{title:'ChatGPT Plus 成品账号1个月'}, {title:'ChatGPT Plus 代充1个月 新开续费均可 不支持续费',currency:'CNY'}])assert.equal(offerSpec(offer).purchase_conditions.quality,'C');
 const regional=offerSpec({title:'ChatGPT Plus 美区 成品账号1个月',currency:'CNY'});assert.equal(regional.purchase_conditions.quality,'B');assert.ok(regional.purchase_conditions.restrictions.includes('标注地区：美国'));
});

test('payment fees and negative new-subscription statements do not imply renewal eligibility',()=>{
 const spec=(title,description='')=>offerSpec({title,currency:'CNY',extra:{deliveryEvidence:{description,descriptionScope:'product'}}});
 assert.equal(spec('ChatGPT Plus 代充1个月','可用支付宝，有手续费').purchase_conditions.accountState,'unknown');
 assert.equal(spec('ChatGPT Plus 代充1个月','详情 https://example.com/续费').purchase_conditions.accountState,'unknown');
 assert.equal(spec('ChatGPT Pro 20x 代充1个月 续费专用','官方限制新开通，还能正常续费').purchase_conditions.accountState,'renewal');
 assert.equal(spec('ChatGPT Plus 代充1个月 不支持续费').purchase_conditions.accountState,'unknown','no inferred new-only permission');
});
test('explicit renewal timing and replacement must separate otherwise identical prices',()=>{
 const spec=description=>offerSpec({title:'ChatGPT Plus 代充1个月',currency:'CNY',extra:{deliveryEvidence:{description,descriptionScope:'product'}}});
 const after=spec('需等当前会员到期后，才可以进行续费。');
 const before=spec('可以提前续费，无需会员到期，会覆盖时间并非累计！');
 assert.equal(after.purchase_conditions.renewalTiming,'after_expiry');
 assert.equal(after.purchase_conditions.accountState,'renewal');
 assert.equal(after.purchase_conditions.quality,'B');
 assert.equal(before.purchase_conditions.renewalTiming,'before_expiry');
 assert.equal(before.purchase_conditions.renewalEffect,'replace');
 assert.ok(before.label.includes('覆盖原有时间'));
 assert.notEqual(before.key,after.key);
 assert.equal(spec('支持续费，不会覆盖原有时间，时间可以累加').purchase_conditions.renewalEffect,'extend');
 const conflict=spec('需等当前会员到期后才可以续费。支持提前续费。');
 assert.equal(conflict.purchase_conditions.quality,'C');
 const multi=offerSpec({title:'ChatGPT Plus 代充1个月',currency:'CNY',extra:{deliveryEvidence:{description:'支持提前续费，会覆盖时间',descriptionScope:'product_multi'}}});
 assert.equal(multi.purchase_conditions.renewalEffect,'unknown');assert.equal(multi.purchase_conditions.quality,'C');
});

test('subscription warranty wording must not become a second subscription period',()=>{
 const s=offerSpec({title:'【IOS渠道】Claude Pro 官充 月卡【质保订阅30天】',currency:'CNY',extra:{deliveryEvidence:{descriptionScope:'product',description:'IOS正规充值，支持续费，须会员到期后才可以续费！账号封禁常见原因包括：批量注册账号、账号共享、频繁更换IP。'}}});
 assert.equal(s.purchase_conditions.subscriptionTerm,'1m');assert.equal(s.purchase_conditions.warrantyWindow,'30天');assert.equal(s.delivery_kind,'recharge');assert.equal(s.purchase_conditions.quality,'B');
});
