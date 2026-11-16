import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDirectOffer, groupDirectOffers} from '../collectors/direct/catalog.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const samples = [
  ['【官方充值】菲区Gtp plus cdk24小时（质保30天）正规充值', 112, 'chatgpt-plus-recharge'],
  ['【官方充值】GTP PRO 5x 卡冲 一卡一账单（质保订阅）', 670, 'chatgpt-pro-5x'],
  ['【官方充值】印区Gtp go cdk24小时（质保30天）正规充值', 33, 'chatgpt-go'],
  ['【菲律宾区】GTP pro20x 到期续费卡密（质保订阅30天）', 1050, 'chatgpt-pro-20x'],
  ['【官方充值】GTP team母号代充+一个高级席位（质保30天）', 980, 'chatgpt-team-business'],
];
const offer = (title, price, i = 1) => ({offerId:`alias:${i}`, sourceId:'alias', title, price, currency:'CNY', status:'in_stock', stockCount:1, url:`https://www.16688.com.cn/goods/G${i}`, capturedAt:new Date().toISOString()});

test('GTP subscription titles survive public projection with original titles and prices', () => {
  const rows = samples.map(([title, price, id], i) => {
    assert.equal(classifyDirectOffer({title})?.id, id, title);
    return offer(title, price, i);
  });
  const before = JSON.stringify(rows);
  const summary = summarizeMerchantOffers(rows);
  assert.equal(summary.rawCount, 5);
  assert.equal(summary.validCount, 5);
  assert.deepEqual(new Map(summary.samples.map(x=>[x.title,x.price])), new Map(samples.map(([title,price])=>[title,price])));
  assert.equal(JSON.stringify(rows), before);
});

test('GTP alias stays within explicit subscription tiers and preserves exclusions', () => {
  for (const title of [
    'GTP 生化试剂', 'XGTP Plus 月卡', 'GTPase Plus 试剂', 'GTP Pro 15x', 'GTP Pro 1.5x',
    'GTP Pro 5x / 20x', 'GTP Plus 月卡/年卡', 'GTP Plus 50美元额度', 'GTP Plus API 中转',
    'GTP Plus + Claude Pro', 'GTP Plus + Gemini Pro', 'GTP Plus + X Premium',
    'GTP Plus + Canva', 'GTP Plus + Microsoft Copilot Pro',
    '【官方充值】Codex 250额度 （非api）',
  ]) assert.equal(classifyDirectOffer({title}), null, title);
  assert.equal(classifyDirectOffer({title:'GTP Pro 20x 月卡', sourceId:'another-merchant'})?.id,'chatgpt-pro-20x');
  assert.equal(classifyDirectOffer({title:'ＧＴＰ－Plus 月卡'})?.id,'chatgpt-plus-recharge');
  assert.equal(classifyDirectOffer({title:'GTP Plus 年卡'})?.id,'chatgpt-plus-recharge-12m');
  assert.equal(classifyDirectOffer({title:'GTP Plus 月卡 成品号'})?.id,'chatgpt-plus');
  assert.equal(groupDirectOffers([
    {...offer('GTP Plus 月卡',1),stockCount:0},
    offer('GTP Plus 月卡 无质保',1,2),
    offer('GTP Plus 月卡 无售后',1,3),
  ]).length,0);
});
