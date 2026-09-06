import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';

const classify = title => classifyDirectOffer({ title })?.id ?? null;
test('真实镜像站与余额报价归开发服务，不冒充原厂订阅', () => {
  for (const title of [
    'G PLUS 镜像站(天卡)',
    '10刀 | 余额 | 1:1充值 | 0.1x G | 1.5x Claude Max',
    'Claude Pro 镜像站 月卡',
    'GPT Pro 中转余额 5x',
    'api G plus月订阅',
    'api Gplus月订阅',
    'G plus 日卡50刀额度',
    'Claude Pro 额度10美元',
    'Gplus 20 USD 额度',
  ]) assert.equal(classify(title), 'api-cdk-credits', title);
});
test('小数倍率和更长倍率不冒充5x或20x订阅', () => {
  for (const brand of ['Claude Max', 'ChatGPT Pro']) {
    for (const tier of ['1.5x', '1.20x', '15x', '120x', 'x5.5', 'x20.5']) {
      assert.equal(classify(`${brand} ${tier} 月卡`), null, `${brand} ${tier}`);
    }
  }
});
test('保留真实Max5x20x及Plus原订阅和CDK交付', () => {
  for (const [title, id] of [
    ['Claude Max 5x 代充月卡', 'claude-max-5x'],
    ['Claude Max 5x 代充月卡 Max 5x额度', 'claude-max-5x'],
    ['Claude Max 20x 代充月卡', 'claude-max-20x'],
    ['Claude Max x5 代充月卡', 'claude-max-5x'],
    ['ChatGPT Pro 20x 月卡', 'chatgpt-pro-20x'],
    ['ChatGPT Plus 官方代充 月卡', 'chatgpt-plus-recharge'],
    ['G PLUS CDK 自助直充 月卡', 'chatgpt-plus-recharge'],
    ['Claude Pro CDK 代充 月卡', 'claude-pro-month'],
    ['ChatGPT Plus 官方月订阅代充（余额不足请联系客服）', 'chatgpt-plus-recharge'],
    ['Claude Pro 原厂月订阅代充 支持余额支付', 'claude-pro-month'],
    ['ChatGPT Plus 官方月订阅充值 账户余额支付', 'chatgpt-plus-recharge'],
    ['ChatGPT Plus 官方月订阅代充 需先余额充值后付款', 'chatgpt-plus-recharge'],
  ]) assert.equal(classify(title), id, title);
});
test('金额余额组合或明确余额充值对象归额度，单独小数Max不推断订阅', () => {
  for (const title of ['Claude 10刀余额充值', 'Claude 余额充值 10美元', 'Claude 余额 10 USD', '10刀 | 余额 | 1:1充值 | 0.1x G | 1.5x Claude Max']) {
    assert.equal(classify(title), 'api-cdk-credits', title);
  }
  assert.equal(classify('Claude1.5x Max'), null);
});
