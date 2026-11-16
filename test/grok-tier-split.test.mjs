import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';
const id = (title) => classifyDirectOffer({ title })?.id ?? null;

test('新版 Grok 档位归入对应 X 融合订阅档，不混进旧版 Super Grok', () => {
  assert.equal(id('【卡冲官方充值】美区 Gork Plus CDK'), 'x-subscription-plus');
  assert.equal(id('【官方充值】美区 超级格洛克 Plus CDK'), 'x-subscription-plus');
  assert.equal(id('Grok Premium 新版充值卡密（美区质保1月）'), 'x-subscription-premium');
  assert.equal(id('【15x卡冲官方充值】Gork super CDK｜半价月付代充，需自有账号有50%优惠'), 'x-subscription-super');
  assert.equal(id('Super Grok 新版订阅-ultra -卡付-美区'), 'x-subscription-ultra');
  assert.equal(id('【美区官冲】Grok UItra 月卡代充｜质保30天'), 'x-subscription-ultra');
});

test('多档、多月、年付不进入月付档位', () => {
  assert.equal(id('Grok plus 一年会员'), null);
  assert.equal(id('Grok plus 年费成品账号（官方正规充值）'), null);
  assert.equal(id('Grok Super 季卡｜三个月套餐'), null);
  assert.equal(id('Grok Premium / Super 任选'), null);
});

test('旧版 SuperGrok 与 Heavy 不受影响', () => {
  assert.equal(id('Super Grok 1个月 · 质保30天'), 'super-grok');
  assert.equal(id('SuperGrok 独享'), 'super-grok');
  assert.equal(id('SuperGrok Heavy月卡｜官网正规充值'), 'super-grok-heavy');
});

test('跨品牌：格洛克不进 ChatGPT，GPT Plus 不进 Grok', () => {
  assert.notEqual(id('超级格洛克 Plus CDK'), 'chatgpt-plus-recharge');
  assert.notEqual(id('ChatGPT Plus 官方充值月卡'), 'x-subscription-plus');
});
