import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePublicSinglePlan } from '../lib/public-single-plan.mjs';
import { collectPublicHtml } from '../collectors/direct/public-html.mjs';
import { probeMerchantCatalog } from '../lib/merchant-collection.mjs';
import { authorizeMerchantTarget } from '../lib/merchant-target-capability.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';

const html = readFileSync(new URL('./fixtures/public-single-plan.html', import.meta.url), 'utf8');
const target = { id: 'merchant-single', name: '测试商店', origin: 'https://single-plan.shop' };
const capturedAt = new Date().toISOString();
const parse = value => parsePublicSinglePlan(value, target, capturedAt);

test('public single-plan HTML yields the exact purchasable plan, excluding contact-only promotions', () => {
  const offers = parse(html);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 128);
  assert.equal(offers[0].title, 'ChatGPT Plus（1 个月）');
  assert.equal(offers[0].url, target.origin + '/');
  assert.equal(offers[0].status, 'available');
  assert.equal(offers[0].stockCount, null);
  assert.equal(offerSpec(offers[0]).delivery_kind, 'recharge');
  assert.equal(summarizeMerchantOffers(offers).validCount, 1);
  assert.equal(JSON.stringify(offers).includes('csrf'), false);
});

test('price, product and subscription-duration disagreements reject the page', () => {
  for (const changed of [
    html.replace('¥128.00', '¥118.00'),
    html.replace('<dd>ChatGPT Plus（1 个月）</dd>', '<dd>Claude Pro（1 个月）</dd>'),
    html.replace('有效期 1 个月', '有效期 1 年'),
    html.replaceAll('¥128.00', '¥128.001'),
    html.replaceAll('¥128.00', '¥0'),
    html.replace('class="price">¥128.00', 'class="price">¥128.00 起'),
  ]) assert.throws(() => parse(changed), { code: 'INVALID_CATALOG' });
});

test('personalized orders, ambiguous checkout controls and multiple plans are rejected', () => {
  for (const changed of [
    html.replace('data-order-no=""', 'data-order-no="EXISTING"'),
    html.replace('id="create-order"', 'disabled id="create-order"'),
    html.replace('id="create-order"', 'hidden id="create-order"'),
    html.replace('class="plan selected"', 'class="plan"'),
    html.replace('</h2><div class="plan selected"', '</h2><div class="plan">另一规格</div><div class="plan selected"'),
  ]) assert.throws(() => parse(changed), { code: 'INVALID_CATALOG' });
});

test('explicit sold-out state does not become a valid current quote', () => {
  const offers = parse(html.replace('id="create-order"', 'disabled id="create-order"').replace('创建订单，前往付款', '已售罄'));
  assert.equal(offers[0].status, 'out_of_stock');
  assert.equal(summarizeMerchantOffers(offers).validCount, 0);
});

test('unrelated pages do not opt in; hidden and script-only prices do not supply evidence', () => {
  assert.equal(parse('<main><h1>ChatGPT Plus</h1>¥128</main>'), null);
  assert.throws(() => parse(html.replace('class="price">¥128.00', 'hidden class="price">¥128.00')), { code: 'INVALID_CATALOG' });
  assert.throws(() => parse(html.replace('¥128.00', '<script>document.write("¥128.00")</script>')), { code: 'INVALID_CATALOG' });
});

test('shared HTML collector reads only robots and public page, never an order API or script', async () => {
  const calls = [];
  const rows = await collectPublicHtml(authorizeMerchantTarget({ ...target }), { sleep: async () => {}, capturedAt,
    fetchImpl: async url => { calls.push(new URL(url).pathname); return new Response(calls.at(-1) === '/robots.txt' ? 'User-agent: *\nDisallow: /api/' : html, { headers: { 'content-type': 'text/html' } }); } });
  assert.equal(rows.length, 1);
  assert.deepEqual(calls, ['/robots.txt', '/']);
});

test('merchant preflight discovers the same single plan after standard catalog endpoints return 404', async () => {
  const calls = [];
  const merchant = { id: target.id, shopName: target.name, shopUrl: target.origin + '/', identity: 'domain:single-plan.shop', platform: 'independent' };
  const result = await probeMerchantCatalog(merchant, { sleep: async () => {}, merchantFetchFactory: () => async url => {
    const path = new URL(url).pathname; calls.push(path);
    return new Response(path === '/robots.txt' ? 'User-agent: *\nAllow: /' : path === '/' ? html : 'missing', { status: path === '/' || path === '/robots.txt' ? 200 : 404, headers: { 'content-type': 'text/html' } });
  } }, capturedAt, Date.now() + 30000);
  assert.equal(summarizeMerchantOffers(result.offers).validCount, 1);
  assert.deepEqual(calls, ['/robots.txt', '/']);
});
