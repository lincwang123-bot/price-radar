import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODCLUB_ORIGIN, collectProdClub, parseProdClubOffers } from '../collectors/direct/prodclub.mjs';
import { authorizeMerchantTarget } from '../lib/merchant-target-capability.mjs';
import { robotsPolicy } from '../collectors/direct/public-html.mjs';
import { classifyDirectOffer, directOfferExclusionReason } from '../collectors/direct/catalog.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';

const now = Date.now(), capturedAt = new Date(now).toISOString();
const target = () => authorizeMerchantTarget({ id: 'merchant-prodclub', name: 'ProdClub', origin: PRODCLUB_ORIGIN });
const item = (changes = {}) => ({
  id: 'off_pmfxenbsaiazh6y3xoik', admin_only: false, status: 'active', orderable: true, unavailable_reason: null,
  currency: 'CNY', pay_currency: 'CNY', price_minor: 16800, list_price_minor: 16800, price_tier: 'standard',
  product: { id: 'prd_teuz37tc6yp7t6syua4h', name: 'ChatGPT', status: 'active' },
  plan: { id: 'pln_jlwugj2swl2usz5lgddv', product_id: 'prd_teuz37tc6yp7t6syua4h', name: 'GPT Plus', status: 'active',
    duration_value: 1, duration_unit: 'month', region: '菲律宾', allowed_delivery_methods: ['own_account'], benefits: '' },
  delivery_method: 'own_account', after_sales_days: 30, after_sales_terms: '30 天质保掉订阅，封号不质保。',
  payment_options: [{ method: 'alipay', offer_id: 'off_pmfxenbsaiazh6y3xoik', price_minor: 16800, list_price_minor: 16800, price_tier: 'standard', orderable: true }],
  ...changes,
});
const page = (items = [item()], next_cursor = null) => ({ data: { items, next_cursor }, request_id: 'public-response' });
const parse = value => parseProdClubOffers(value, target(), capturedAt);
function fixture(pages = [page()], policy = 'User-agent: *\nAllow: /') {
  const calls = []; let clock = now, n = 0;
  return { calls, now: () => clock, sleep: async ms => { clock += ms; }, fetchImpl: async (url, init) => {
    calls.push({ url, init, time: clock });
    if (new URL(url).pathname === '/robots.txt') return new Response(policy);
    const result = pages[n++];
    return result instanceof Response ? result : new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  } };
}

test('public minor-unit retail prices and exact offer links, with no promotion or alternate-payment substitution', () => {
  const raw = item({ promo_price_minor: 13500, buyer_requirements: 'password: do-not-copy',
    payment_options: [...item().payment_options, { method: 'usdt_trc20', offer_id: 'off_otherpaymentoffer01', price_minor: 14000 }] });
  const [offer] = parse(page([raw]));
  assert.equal(offer.price, 168); assert.equal(offer.listedPrice, 168); assert.equal(offer.currency, 'CNY');
  assert.equal(offer.url, PRODCLUB_ORIGIN + '/offers/' + raw.id);
  assert.equal(offer.extra.catalogUrl, PRODCLUB_ORIGIN + '/api/v1/offers?limit=20');
  assert.equal(offer.status, 'in_stock'); assert.equal(offer.stockCount, null);
  assert.equal(offerSpec(offer).delivery_kind, 'recharge');
  assert.ok(!JSON.stringify(offer).includes('do-not-copy')); assert.ok(!JSON.stringify(offer).includes('13500'));
  assert.equal(summarizeMerchantOffers([offer], { now }).validCount, 1);
  const fractional = item({ price_minor: 16801, payment_options: [{ ...item().payment_options[0], price_minor: 16801 }] });
  assert.equal(parse(page([fractional]))[0].price, 168.01);
});

test('uses named product and exact plan, leaves unsupported tiers and SMS outside existing classification', () => {
  for (const [name, expected] of [['GPT Plus', 'chatgpt-plus-recharge'], ['GPT Pro5x', 'chatgpt-pro-5x'], ['GPT Pro20x', 'chatgpt-pro-20x'], ['GPT Pro50x', null]]) {
    const offer = parse(page([item({ plan: { ...item().plan, name } })]))[0];
    assert.equal(classifyDirectOffer(offer)?.id ?? null, expected);
  }
  assert.deepEqual(parse(page([item({ delivery_method: 'sms_code', plan: { ...item().plan, name: 'ChatGPT/Codex 接码', duration_unit: 'day', duration_value: 0, allowed_delivery_methods: ['sms_code'] } })])), []);
  assert.throws(() => parse(page([item({ plan: { ...item().plan, product_id: 'prd_wrongproductidentity' } })])), { code: 'INVALID_CATALOG' });
});

test('current public product-specific warranty evidence survives without broadening warranty policy', () => {
  const terms = [
    '正规充值，不会掉订阅。掉订阅按天数退赔。破甲被封号除外不做售后。',
    '30 天质保掉订阅，正规渠道不会掉订阅！但破甲封号不质保',
    '会有各别黑号拒付，如遇到可重试，多次重试失败后，请更换账号充值\n\n30 天质保掉订阅，破甲封号不质保不售后',
  ];
  const rows = terms.flatMap((after_sales_terms, index) => {
    const id = ['off_pmfxenbsaiazh6y3xoik', 'off_onwpisxhlkrpf3xstst2', 'off_vx7ahnzymsncm6zjsvzf'][index];
    const price_minor = [16800, 80000, 158800][index];
    return parse(page([item({ id, price_minor, after_sales_terms,
      plan: { ...item().plan, name: ['GPT Plus', 'GPT Pro5x', 'GPT Pro20x'][index] },
      payment_options: [{ ...item().payment_options[0], offer_id: id, price_minor }] })]));
  });
  for (let i = 0; i < rows.length; i++) assert.ok(rows[i].extra.warrantyEvidence.includes(terms[i].replace(/\s+/g, ' ').trim()));
  assert.deepEqual(rows.map(x => x.price), [168, 800, 1588]);
  // Preserve the exact account-ban exception while distinguishing it from a
  // whole-product disclaimer. A separate blanket disclaimer still excludes.
  assert.equal(directOfferExclusionReason(rows[0]), null);
  assert.equal(summarizeMerchantOffers(rows, { now }).validCount, 3);
});

test('availability is explicit, sold out wins and no-warranty remains excluded', () => {
  for (const changes of [{ status: 'sold_out' }, { unavailable_reason: 'STOCK_INSUFFICIENT' }]) {
    const offer = parse(page([item(changes)]))[0];
    assert.equal(offer.status, 'out_of_stock'); assert.equal(summarizeMerchantOffers([offer], { now }).validCount, 0);
  }
  for (const changes of [{ orderable: false }, { orderable: undefined }, { status: 'paused' }, { unavailable_reason: 'SUPPLIER_INACTIVE' }]) {
    const offer = parse(page([item(changes)]))[0];
    assert.notEqual(offer.status, 'in_stock'); assert.equal(summarizeMerchantOffers([offer], { now }).validCount, 0);
  }
  assert.equal(directOfferExclusionReason(parse(page([item({ after_sales_terms: '本商品无质保，无售后。', after_sales_days: 0 })]))[0]), 'no_warranty');
});

test('invalid, private, discounted-tier and ambiguous CNY prices cannot become public quotes', () => {
  for (const changes of [{ price_minor: 0 }, { price_minor: -1 }, { price_minor: null }, { price_minor: '16800' }, { price_minor: 1.5 },
    { admin_only: true }, { admin_only: undefined }, { currency: 'USD' }, { pay_currency: 'USDT' }, { price_tier: 'cost' },
    { payment_options: [{ ...item().payment_options[0], offer_id: 'off_otherpaymentoffer01' }] },
    { payment_options: [{ ...item().payment_options[0], price_minor: 13000 }] }]) assert.deepEqual(parse(page([item(changes)])), []);
});

test('business errors and incomplete or duplicate catalogs never become successful empty catalogs', () => {
  for (const bad of [{ error: { code: 'LOGIN_REQUIRED' }, data: { items: [], next_cursor: null } }, { success: false, ...page([]) }, {},
    { data: { items: [] } }, page([item(), item()]), page([], 'bad\ncursor')]) assert.throws(() => parse(bad), { code: 'INVALID_CATALOG' });
  assert.deepEqual(parse(page([])), []);
});

test('collector uses robots then bounded same-origin GETs with at least 1.1s between starts', async () => {
  const second = item({ id: 'off_secondpublicoffer01', payment_options: [{ ...item().payment_options[0], offer_id: 'off_secondpublicoffer01' }] });
  const f = fixture([page([item()], 'next_page'), page([second])], 'User-agent: *\nCrawl-delay: 2');
  const offers = await collectProdClub(target(), { ...f, capturedAt });
  assert.equal(offers.length, 2); assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map(c => new URL(c.url).pathname), ['/robots.txt', '/api/v1/offers', '/api/v1/offers']);
  assert.equal(new URL(f.calls[2].url).searchParams.get('cursor'), 'next_page');
  for (const c of f.calls) { assert.equal(new URL(c.url).origin, PRODCLUB_ORIGIN); assert.equal(c.init.method, 'GET'); assert.equal(c.init.redirect, 'manual'); assert.equal(c.init.credentials, 'omit'); assert.ok(!c.init.headers.authorization); assert.ok(!c.init.headers.cookie); }
  assert.ok(f.calls[1].time - f.calls[0].time >= 2000); assert.ok(f.calls[2].time - f.calls[1].time >= 2000);
  const reused = fixture(); await collectProdClub(target(), { ...reused, robotsPolicy: robotsPolicy(''), capturedAt });
  assert.equal(reused.calls.length, 1); assert.ok(reused.calls[0].time - now >= 1100);
});

test('robots, denied responses, redirect, business error and pagination budgets stop without fallback', async () => {
  for (const [f, expected] of [[fixture([], 'User-agent: *\nDisallow: /api/'), { code: 'ROBOTS_DISALLOWED' }],
    [fixture([new Response('denied', { status: 403 })]), { code: 'ACCESS_DENIED' }],
    [fixture([new Response('', { status: 302, headers: { location: 'https://other.com/' } })]), /重定向/],
    [fixture([{ error: { code: 'BUSINESS_ERROR' } }]), { code: 'INVALID_CATALOG' }]]) {
    await assert.rejects(collectProdClub(target(), f), expected); assert.ok(f.calls.length <= 2);
  }
  const endless = fixture([page([], 'one'), page([], 'two'), page([], 'three')]);
  await assert.rejects(collectProdClub(target(), endless), { code: 'COLLECTOR_LIMIT' }); assert.equal(endless.calls.length, 4);
  const duplicate = fixture([page([item()], 'one'), page([item()])]);
  await assert.rejects(collectProdClub(target(), duplicate), { code: 'INVALID_CATALOG' });
  const f = fixture(); await assert.rejects(collectProdClub(target(), { ...f, deadline: now + 500, robotsPolicy: robotsPolicy('') }), /超时/); assert.equal(f.calls.length, 0);
});

test('requires process-local capability, exact origin and safe injected fetch', async () => {
  for (const source of [{ id: 'merchant-prodclub', origin: PRODCLUB_ORIGIN }, authorizeMerchantTarget({ ...target(), origin: 'https://other.com' }), authorizeMerchantTarget({ ...target(), token: 'x' })]) {
    await assert.rejects(collectProdClub(source, fixture()), { code: 'PREFLIGHT_INTERNAL_ERROR' });
  }
  await assert.rejects(collectProdClub(target()), { code: 'PREFLIGHT_INTERNAL_ERROR' });
});

test('a delayed rate-limit sleep cannot begin a request after the deadline', async () => {
  const f = fixture();
  await assert.rejects(collectProdClub(target(), { ...f, deadline: now + 2000, robotsPolicy: robotsPolicy(''),
    sleep: async () => f.sleep(3000) }), /超时/);
  assert.equal(f.calls.length, 0);
});
