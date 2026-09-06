import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirectOffer, groupDirectOffers } from '../collectors/direct/catalog.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';

test('verified dotted GPT spelling preserves subscription, credit, account and term boundaries', () => {
  const cases = [
    ['【美区IOS】GP.T Pro 5X 官方正规充值 质保30天 可以开发票（付款后秒发CDK直充自己号）', 'chatgpt-pro-5x'],
    ['GP.T Pro 20X 官方正规充值', 'chatgpt-pro-20x'],
    ['GP.T plus 1年会员官方正规充值', 'chatgpt-plus-recharge-12m'],
    ['GP.T plus 月卡 成品号', 'chatgpt-plus'],
    ['GP.T plus 日抛体验号', 'chatgpt-plus'],
    ['GP.T Plus 日卡50刀额度', 'api-cdk-credits'],
    ['GP.T Pro 5x API 中转余额充值', 'api-cdk-credits'],
  ];
  for (const [title, id] of cases) assert.equal(classifyDirectOffer({ title })?.id, id, title);
  for (const title of ['GP.T Free 普号', 'XGP.T Pro 5X', 'G Pro X20', 'CDK Gro Super 1个月充值', 'GP.T Pro 1.5x']) {
    assert.equal(classifyDirectOffer({ title }), null, title);
  }
  for (const title of ['GP.T Plus + Claude Pro', 'GP.T Plus + Gemini Pro', 'GP.T Plus + Canva']) {
    assert.equal(classifyDirectOffer({ title }), null, title);
  }
  const rows = ['GP.T Plus 月卡 官方充值 无质保', 'GP.T Plus 月卡 官方充值 无售后'].map((title, i) => ({ offerId: `${i}`, title, price: 10, currency: 'CNY', status: 'in_stock', stockCount: 1, url: `https://www.16688.com.cn/goods/G${i}` }));
  assert.equal(groupDirectOffers(rows).length, 0);
  const title = 'GP.T Plus 7天 日抛 成品号';
  const spec = offerSpec({ title, currency: 'CNY' }, classifyDirectOffer({ title }));
  assert.match(spec.key, /^7d:plus:成品账号:试用\/短期:/);
  assert.equal(offerSpec({ title: 'GP.T Pro5x 官方充值 质保30天' }, { id: 'chatgpt-pro-5x' }).known, false);
});
