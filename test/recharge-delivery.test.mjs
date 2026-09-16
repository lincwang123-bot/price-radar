import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';
test('own-account recharge evidence does not mean a delivered account', () => {
  for (const suffix of ['菲区卡冲 · 充到你自己的账号','为您现有账号充值','代充 · 充到自己的账号','卡充','直冲','直充']) {
    const offer={title:`GPT Plus ${suffix}`,currency:'CNY'};
    assert.equal(classifyDirectOffer(offer)?.id,'chatgpt-plus-recharge',suffix);
    assert.match(offerSpec(offer).label,/ · 代充/,suffix);
  }
});
test('delivered accounts, shared products and instructional extras retain their forms', () => {
  for (const suffix of ['成品账号附充值教程','账号附充值教程','成品号 · 可充值','独享号']) {
    const offer={title:`GPT Plus ${suffix}`,currency:'CNY'};
    assert.equal(classifyDirectOffer(offer)?.id,'chatgpt-plus');
    assert.match(offerSpec(offer).label,/ · 成品账号/);
  }
  const shared={title:'GPT Plus 共享账号 · 充值',currency:'CNY'};
  assert.equal(classifyDirectOffer(shared)?.id,'chatgpt-plus');
  assert.match(offerSpec(shared).label,/ · 共享/);
});
