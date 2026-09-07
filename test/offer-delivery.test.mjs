import test from 'node:test';
import assert from 'node:assert/strict';
import { offerDelivery, offerSpec, deliveryForm } from '../lib/offer-spec.mjs';
import { classifyDirectOffer, groupDirectOffers, stableDirectSnapshotId } from '../collectors/direct/catalog.mjs';

test('实际歧义标题、否定与账号归属按交付证据分类，价格绝不作为证据', () => {
  const cases = [
    ['gemini pro充值订阅（非成品号）', 'recharge'],
    ['Gemini Pro 12个月个人账号充值', 'recharge'],
    ['GPT Pro 20x 正价代充 一个月 一个账号一张信用卡', 'recharge'],
    ['ChatGPT Plus 自有账号充值 月卡', 'recharge'],
    ['ChatGPT Plus 本人账户充值 月卡', 'recharge'],
    ['ChatGPT Plus 代充，不提供成品号 月卡', 'recharge'],
    ['ChatGPT Plus 账户代充 月卡', 'recharge'],
    ['ChatGPT Plus 成品账号附充值教程 月卡', 'account'],
    ['ChatGPT Plus 正规充值成品号 月卡', 'account'],
    ['ChatGPT Plus 不共享 独享账号 月卡', 'account'],
    ['ChatGPT Plus 独享账户 月卡', 'account'],
    ['ChatGPT Plus 不提供共享账号，成品号 月卡', 'account'],
    ['Claude Pro shared account monthly', 'shared'],
    ['Claude Pro pre-made account monthly', 'account'],
    ['Claude Pro recharge your existing account monthly', 'recharge'],
    ['Claude Pro account top-up monthly', 'recharge'],
    ['Claude Pro 您已有的账号充值 月卡', 'recharge'],
    ['Claude Pro not shared, dedicated account monthly', 'account'],
    ['Claude Pro recharge monthly, not a pre-made account', 'recharge'],
    ['Claude Pro Team 席位账号 月卡', 'seat'],
    ['ChatGPT Plus 充值卡密 月卡', 'recharge'],
    ['Claude Pro 账号附充值教程 月卡', 'account'],
  ];
  for (const [title, kind] of cases) for (const price of [0.01, 100, 99999]) {
    const delivery = offerDelivery({ title, price });
    assert.equal(delivery.kind, kind, title); assert.equal(delivery.known, true, title); assert.equal(delivery.conflict, false, title);
  }
});
test('多交付同一报价、缺证据与裸卡密不冒充代充或可比规格', () => {
  for (const title of ['G Plus 成品/菲区卡密代充', 'Claude Max 5x 正规代充/成品+50（有质保）',
    'ChatGPT Plus 成品号或代充 月卡', 'Claude Pro shared account or recharge monthly']) {
    assert.deepEqual(offerDelivery(title), { kind: 'unknown', label: '交付待确认', known: false, conflict: true }, title);
  }
  for (const title of ['Claude Pro 月卡', 'ChatGPT Plus 独享 月卡', 'Claude Pro 一个账号一张信用卡 月卡', 'Claude Pro 月卡 赠送free账号']) {
    assert.equal(offerDelivery(title).kind, 'unknown', title); assert.equal(offerSpec({ title }).known, false, title);
  }
  for (const title of ['Claude Pro monthly no account required', 'Claude Pro 账号使用须知 月卡', 'Claude Pro 月卡 账号要求：一个账号一张信用卡',
    'ChatGPT Plus 自带账号 1个月', 'Claude Pro 请提供账号 1个月', 'Claude Pro account upgrade monthly']) {
    assert.equal(offerDelivery(title).kind, 'unknown', title);
  }
  for (const title of ['Claude Pro 月卡 卡密', 'ChatGPT Plus CDK 月卡', 'Gemini Pro redemption code monthly']) {
    assert.equal(offerDelivery(title).kind, 'code'); assert.equal(offerDelivery(title).known, false);
    assert.equal(offerSpec({ title }).known, false);
  }
  assert.equal(offerDelivery({ title: 'Claude Pro 月卡', deliveryMode: 'auto', sourceId: 'recharge', price: 500 }).kind, 'unknown');
});
test('同SKU证据补齐标题丢失的交付，SKU明确选项优先父商品混合文案，矛盾则待确认', () => {
  const title = 'ChatGPT Plus 月卡';
  for (const wrap of [value => value, JSON.stringify]) {
    assert.equal(offerDelivery({ title, extra: wrap({ deliveryEvidence: { productTitle: 'ChatGPT Plus 成品账号', skuTitle: 'Plus 月卡' } }) }).kind, 'account');
    assert.equal(offerDelivery({ title, extra: wrap({ deliveryEvidence: { productTitle: 'ChatGPT Plus 成品/代充', skuTitle: 'Plus 代充月卡' } }) }).kind, 'recharge');
    const conflict = offerDelivery({ title, extra: wrap({ deliveryEvidence: { skuTitle: 'Plus 代充月卡', description: '本商品交付成品账号，不是代充' } }) });
    assert.equal(conflict.kind, 'unknown'); assert.equal(conflict.conflict, true);
    assert.equal(offerDelivery({ title, extra: wrap({ deliveryEvidence: { description: '本商品交付账号密码，为成品账号' } }) }).kind, 'account');
  }
  assert.equal(offerDelivery({ title, category: '成品账号' }).kind, 'account');
  assert.equal(offerDelivery({ title, category: '自有账号代充' }).kind, 'recharge');
  assert.notEqual(offerSpec({ title, category: '成品账号' }).key, offerSpec({ title, category: '代充' }).key);
  for (const description of ['本店主营代充、成品账号、共享会员等业务', 'FAQ：什么是代充？如何购买账号？', '常见问题：本店账号均支持充值']) {
    assert.equal(offerDelivery({ title, extra: { deliveryEvidence: { description } } }).kind, 'unknown', description);
  }
  for (const description of ['请提供账号密码，我们会处理订单', '需要您填写您的账号密码', '本店所有账号支持充值']) {
    assert.equal(offerDelivery({ title, extra: { deliveryEvidence: { description } } }).kind, 'unknown', description);
  }
  assert.equal(offerDelivery({ title, extra: { deliveryEvidence: { skuTitle: '本人账号充值', description: '给您已有的账号开通会员，不提供账号' } } }).kind, 'recharge');
  assert.equal(offerDelivery({ title, extra: { deliveryEvidence: { skuTitle: '本人账号充值', description: '请提供账号密码，我们完成充值' } } }).kind, 'recharge');
});
test('旧comparison标签兼容，新字段明确交付；产品名称中性且不根据历史ID确认交付', () => {
  const spec = offerSpec({ title: 'Claude Pro 成品账号 月卡' });
  assert.equal(spec.delivery_kind, 'account'); assert.equal(spec.delivery_label, '成品号');
  assert.equal(spec.delivery_known, true); assert.equal(spec.delivery_conflict, false);
  assert.match(spec.key, /:成品账号:/); assert.equal(deliveryForm('Claude Pro 合租月卡'), '共享');
  assert.equal(offerSpec({ title: 'Claude Pro 月卡' }, { id: 'claude-pro-recharge' }).delivery_kind, 'unknown');
  assert.equal(offerSpec({ title: 'API 100额度' }, { id: 'api-cdk-credits' }).known, true);
  const classified = classifyDirectOffer({ title: 'ChatGPT Plus 月卡' });
  assert.equal(classified.id, 'chatgpt-plus-recharge'); assert.equal(classified.name, 'ChatGPT Plus');
  assert.equal(classifyDirectOffer({ title: 'ChatGPT Plus 年卡' }).name, 'ChatGPT Plus · 12 个月');
  assert.equal(classifyDirectOffer({ title: 'ChatGPT Plus 月卡', category: '成品账号' }).id, 'chatgpt-plus');
  assert.equal(classifyDirectOffer({ title: 'ChatGPT Plus 月卡 成品账号' }).name, 'ChatGPT Plus');
});
test('未知及不同交付不合算最低价，仅安全交付说明变化也使快照更新', () => {
  const base = { title: 'Claude Pro 月卡', price: 10, currency: 'CNY', status: 'in_stock', url: 'https://shop.example/item/1' };
  assert.equal(groupDirectOffers([{ ...base, offerId: 'a' }])[0].lowestPrice, null);
  assert.equal(groupDirectOffers([{ ...base, offerId: 'a', category: '成品账号' }, { ...base, offerId: 'b', price: 100, category: '代充' }])[0].lowestPrice, null);
  const row = description => ({ ...base, offerId: 'a', extra: { deliveryEvidence: { description } } });
  assert.notEqual(stableDirectSnapshotId([row('本商品交付成品账号')]), stableDirectSnapshotId([row('本商品充值到自己的账号')]));
  assert.notEqual(stableDirectSnapshotId([{ ...base, offerId: 'a', category: '成品账号' }]), stableDirectSnapshotId([{ ...base, offerId: 'a', category: '代充' }]));
});
