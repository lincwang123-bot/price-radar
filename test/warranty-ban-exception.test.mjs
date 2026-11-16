import test from 'node:test';
import assert from 'node:assert/strict';
import { directOfferExclusionReason, groupDirectOffers } from '../collectors/direct/catalog.mjs';
import { parseProdClubOffers, PRODCLUB_ORIGIN } from '../collectors/direct/prodclub.mjs';
import { authorizeMerchantTarget } from '../lib/merchant-target-capability.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { publicOfferAllowed } from '../lib/public-offers.mjs';

const terms = '正规充值，不会掉订阅。掉订阅按天数退赔。破甲被封号除外不做售后。';
const capturedAt = '2026-10-10T00:00:00.000Z';
const offer = description => ({ title: 'ChatGPT Plus 原号直充 1个月', status: 'in_stock',
  extra: { deliveryEvidence: { descriptionScope: 'product', description } } });

test('explicit ban-only exception keeps real Plus warranty evidence and the eligible public quote', () => {
  const id = 'off_publicplusoffer01';
  const [row] = parseProdClubOffers({ data: { next_cursor: null, items: [{
    id, admin_only: false, status: 'active', orderable: true, unavailable_reason: null,
    currency: 'CNY', pay_currency: 'CNY', price_minor: 16800, price_tier: 'standard',
    product: { id: 'prd_publicchatgpt01', name: 'ChatGPT', status: 'active' },
    plan: { id: 'pln_publicplusplan01', product_id: 'prd_publicchatgpt01', name: 'GPT Plus', status: 'active',
      duration_value: 1, duration_unit: 'month', allowed_delivery_methods: ['own_account'] },
    delivery_method: 'own_account', after_sales_days: 30, after_sales_terms: terms,
    payment_options: [{ method: 'alipay', offer_id: id, price_minor: 16800, price_tier: 'standard', orderable: true }],
  }] } }, authorizeMerchantTarget({ id: 'merchant-prodclub', name: 'ProdClub', origin: PRODCLUB_ORIGIN }), capturedAt);
  const before = structuredClone(row);
  assert.equal(directOfferExclusionReason(row), null);
  assert.equal(publicOfferAllowed('direct-shops', row), true);
  assert.equal(groupDirectOffers([row])[0].productId, 'chatgpt-plus-recharge');
  assert.equal(summarizeMerchantOffers([row], { now: Date.parse(capturedAt) }).validCount, 1);
  assert.match(row.extra.warrantyEvidence, /售后期限：30天/);
  assert.ok(row.extra.warrantyEvidence.includes(terms));
  assert.deepEqual(row, before, 'classification must preserve the complete source terms');
});

test('only a complete ban-only sentence is ignored, including persisted and traditional evidence', () => {
  for (const text of [terms, '售后30天。封号除外不做售后。', '售後30天。破甲被封號除外不做售後。']) {
    for (const persisted of [false, true]) {
      const row = offer(text);
      if (persisted) row.extra = JSON.stringify(row.extra);
      const before = structuredClone(row);
      assert.equal(directOfferExclusionReason(row), null, text);
      assert.deepEqual(row, before);
    }
  }
});

test('ban exceptions do not hide blanket, mixed-risk or ambiguous warranty denials', () => {
  for (const text of [
    terms + '本商品无售后。', terms + '所有商品无质保。',
    '售后30天。封号除外，其他情况不做售后。',
    '售后30天。其他情况除外不做售后。',
    '售后30天。破甲被封号、错充除外不做售后。',
    '售后30天。任何问题包括破甲被封号除外不做售后。',
    '售后30天。破甲被封号除外不做售后，包括其他任何问题。',
    '售后30天。破甲被封号除外不做售后和补偿。',
    '售后30天。封号。除外不做售后。',
  ]) assert.equal(directOfferExclusionReason(offer(text)), 'no_warranty', text);
  assert.equal(directOfferExclusionReason({ ...offer(terms), title: 'ChatGPT Plus 原号直充 无质保' }), 'no_warranty');
  const otherSku = offer(terms);
  Object.assign(otherSku.extra.deliveryEvidence, { descriptionScope: 'product_multi', skuTitle: '本SKU无售后' });
  assert.equal(directOfferExclusionReason(otherSku), 'no_warranty');
  assert.equal(directOfferExclusionReason({ ...offer(terms), stockCount: 0 }), 'out_of_stock');
});
