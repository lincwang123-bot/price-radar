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

test('生产公开标题的充自己号是充值对象，不被兑换字眼或号字遮蔽', () => {
  for (const title of [
    'GPT plus充你自己号一个月.质保不掉订阅囤卡超3天未兑换不退',
    'GPT GO充你自己号一个月',
    'GPT Pro 5x充你自己号一个月',
    'GPT Pro 20x充你自己号一个月',
    'Gemini pro 一年会员充自己的号',
  ]) {
    for (const price of [0.01, 100, 99999]) assert.equal(offerDelivery({ title, price, extra: { deliveryEvidence: { productTitle: title } } }).kind, 'recharge', title);
  }
  for (const title of ['ChatGPT Plus 成品号/充你自己号 一个月', 'Claude Pro 共享账号 或 充自己的号 一个月']) {
    assert.deepEqual(offerDelivery(title), { kind: 'unknown', label: '交付待确认', known: false, conflict: true }, title);
  }
});

test('使用警告不得被当作共享交付，实际共享和混合套餐保持独立', () => {
  const title = 'G Plus [官方直充] CDK 全自动充值 直充自己账号';
  const description = '商品描述 Plus 月卡，菲区官方卡充渠道，仅支持feer账号（无订阅状态）。交付与使用 付款后请留意订单状态和联系通知。请使用干净、稳定的网络环境，避免频繁切换地区或多人共享账号。实际交付与售后以本站订单说明和客服确认为准。';
  assert.deepEqual(offerDelivery({ title, extra: { deliveryEvidence: { productTitle: title, description } } }), { kind: 'recharge', label: '代充', known: true, conflict: false });
  for (const warning of ['避免多人共享账号', '请勿与他人共享账号', '禁止共享账号']) {
    assert.equal(offerDelivery({ title, extra: { deliveryEvidence: { description: `本商品直充自己的账号，${warning}。` } } }).kind, 'recharge', warning);
  }
  assert.equal(offerDelivery('Claude Pro 多人共享账号月卡').kind, 'shared');
  assert.equal(offerDelivery({ title, extra: { deliveryEvidence: { description: '本商品交付多人共享账号' } } }).conflict, true);
  assert.equal(offerDelivery('G Plus 成品/菲区卡密代充').conflict, true);
  assert.equal(offerDelivery('独享成品账号，禁止多人共享账号').kind, 'account');
});

test('生产描述中的账号适用条件不与明示直充冲突，也不能独立证明交付账号', () => {
  const description = '国区谷歌账号不可用！ 国区谷歌账号不可用！ 拍之前先去 https://policies.google.com/country-association-form 看看账号属地，如果是国区改成功了再拍，不然不接受任何售后！ 卡密长期有效可囤，质保可用。';
  assert.equal(offerDelivery({ title: 'Gemini Pro 18个月直充', extra: { deliveryEvidence: { productTitle: 'Gemini Pro 18个月直充', description } } }).kind, 'recharge');
  for (const description of ['请确认账号地区符合要求', '需自备账号', '请使用自己注册的账号', '买家提供账号密码', '账号地区需符合要求']) {
    assert.equal(offerDelivery({ title: 'Gemini Pro 月卡', extra: { deliveryEvidence: { description } } }).kind, 'unknown', description);
    assert.equal(offerDelivery(`Gemini Pro 月卡 ${description}`).kind, 'unknown', description);
  }
});

test('限定词否定和SKU明确排除交付阻止父标题回填，描述否定也不能被SKU压过', () => {
  for (const suffix of ['不提供独享账号', 'not a dedicated account', '不含成品账号']) {
    assert.equal(offerDelivery(`Claude Pro 月卡 ${suffix}`).kind, 'unknown', suffix);
  }
  for (const extra of [
    { deliveryEvidence: { productTitle: 'Gemini Pro 成品账号', skuTitle: '不含账号' } },
    { deliveryEvidence: { productTitle: 'Gemini Pro 成品账号', skuTitle: '不提供独享账号' } },
    { deliveryEvidence: { productTitle: '不提供独立账号' } },
    { deliveryEvidence: { productTitle: 'Gemini Pro 成品账号', skuTitle: '需自备账号' } },
    { deliveryEvidence: { productTitle: 'Gemini Pro 成品账号', skuTitle: '请提供您的账号' } },
  ]) assert.equal(offerDelivery({ title: 'Gemini Pro 月卡', extra }).kind, 'unknown');
  for (const description of ['不含账号', '仅为买家现有账号开通会员，不提供成品号']) {
    const value = offerDelivery({ title: 'Claude Pro 成品账号月卡', extra: { deliveryEvidence: { skuTitle: '成品账号月卡', description } } });
    assert.equal(value.kind, 'unknown', description); assert.equal(value.conflict, true, description);
  }
});

test('成品与共享或席位多选保持冲突，多SKU父描述不替代当前SKU交付证据', () => {
  for (const title of ['ChatGPT Plus 成品账号或共享账号 月卡', 'Claude Pro 成品账号或席位 月卡', 'Claude Pro 成品账号/合租 月卡']) {
    assert.equal(offerDelivery(title).conflict, true, title); assert.equal(offerDelivery(title).known, false, title);
  }
  const mixed = { productTitle: 'Claude Pro 成品账号或代充', description: '成品账号无售后；代充质保一个月', descriptionScope: 'product_multi' };
  assert.equal(offerDelivery({ title: 'Claude Pro 代充月卡', extra: { deliveryEvidence: { ...mixed, skuTitle: '代充月卡' } } }).kind, 'recharge');
  assert.equal(offerDelivery({ title: 'Claude Pro 月卡', extra: { deliveryEvidence: { ...mixed, skuTitle: '月卡' } } }).kind, 'unknown');
  assert.equal(offerDelivery({ title: 'Claude Pro 月卡', extra: { deliveryEvidence: { skuTitle: '月卡', description: '交付成品账号', descriptionScope: 'product_multi' } } }).kind, 'unknown');
});

test('否定售后问题或买方条件不等于否定商品交付', () => {
  assert.equal(offerDelivery({ title: 'Claude pro 官方直充秒到账【美区IOS 质保订阅30天】', extra: { deliveryEvidence: { description: '支持充值到您自己的账号，并不是充值有问题，而是封锁区域用户导致封号，只能保证充值渠道正规' } } }).kind, 'recharge');
  for (const title of ['Claude Pro 成品账号，无需自备账号', '卖家注册并开通会员后交付全新账号，买家无需提供账号']) assert.equal(offerDelivery(title).kind, 'account', title);
  for (const description of ['不提供充值', '本商品并非代充商品']) assert.equal(offerDelivery({ title: 'Claude Pro 代充', extra: { deliveryEvidence: { description } } }).kind, 'unknown', description);
});
