import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDirectory, directoryQuotes } from '../lib/product-directory.mjs';

const quote = (title, patch = {}) => ({ title, offer_id: title, price: 100, currency: 'CNY', status: 'in_stock', stock_count: 2, quote_stale: false, comparison_known: true, comparison_key: 'month:recharge:CNY', url: 'https://16688.com.cn/goods/1', ...patch });
const list = (source, product_id, offers, name = product_id) => ({ source, stale: false, products: [{ product_id, name, currency: 'CNY', offers }] });
const category = (lists, key) => buildProductDirectory(lists).find(row => row.key === key);

test('seven primary categories plus more retain known extra products', () => {
  const directory = buildProductDirectory([list('direct-shops', 'suno-pro-1m', [quote('Suno Pro 1个月')])]);
  assert.deepEqual(directory.filter(row => row.primary).map(row => row.label), ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'X', 'API / 中转', '邮箱 / 接码']);
  assert.equal(directory.find(row => row.key === 'suno').products[0].name, 'Suno Pro');
  assert.equal(directory.find(row => row.key === 'other').products.length, 0);
});

test('Plus folds into one product but keeps source, delivery, currency and duration variants', () => {
  const lists = [list('direct-shops', 'chatgpt-plus-recharge', [quote('ChatGPT Plus 月卡代充'), quote('ChatGPT Plus 月卡代充', { price: 80, offer_id: 'cheaper' }), quote('ChatGPT Plus 年卡代充', { comparison_key: 'year:recharge:CNY' })]), list('priceai', 'chatgpt-plus', [quote('ChatGPT Plus 月卡成品号', { comparison_key: 'month:account:CNY' })]), list('ldxp-goods', 'search-plus', [quote('ChatGPT Plus 月卡代充')])];
  const before = JSON.stringify(lists);
  const products = category(lists, 'chatgpt').products;
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'ChatGPT Plus');
  assert.equal(products[0].variants.length, 4);
  assert.equal(products[0].entries.length, 5);
  assert.equal(products[0].variants[0].offer.price, 80);
  assert.equal(products[0].variants[0].product.product_id, 'chatgpt-plus-recharge');
  assert.equal(products[0].variants[0].product.offers.length, 2);
  assert.equal(JSON.stringify(lists), before);
});

test('LDXP uses actual title and skips generic search matches and ordinary accounts', () => {
  const products = category([list('ldxp-goods', 'chatgpt-plus', [quote('普通账号'), quote('Plus 一个月'), quote('ChatGPT Free 普号'), quote('Claude Pro 月卡')], 'LDXP 搜索「Plus」')], 'claude').products;
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Claude Pro');
  assert.equal(products[0].entries.length, 1);
  assert.equal(category([list('priceai', 'chatgpt-plus', [quote('普通账号')])], 'chatgpt').products[0].variants.length, 0);
});

test('Pro and Max multipliers stay separate and X has its own category', () => {
  const lists = [list('direct-shops', 'mixed', ['ChatGPT Pro 5x', 'ChatGPT Pro 20x', 'Claude Max 5x', 'Claude Max 20x', 'X Premium', 'X Premium+', 'Super Grok Heavy'].map(title => quote(title)))];
  assert.deepEqual(category(lists, 'chatgpt').products.map(p => p.key), ['chatgpt-pro-5x', 'chatgpt-pro-20x']);
  assert.deepEqual(category(lists, 'claude').products.map(p => p.key), ['claude-max-5x', 'claude-max-20x']);
  assert.equal(category(lists, 'grok').products.length, 1);
  assert.equal(category(lists, 'x').products.length, 2);
});

test('only fresh available positive known-currency known-spec quotes enter directory', () => {
  const invalid = [{ quote_stale: true }, { status: 'unknown' }, { stock_count: 0 }, { price: 0 }, { price: null }, { price: -1 }, { price: Infinity }, { currency: '???' }, { comparison_known: false }, { comparison_key: 'mixed' }, { comparison_key: null }];
  const offers = invalid.map(patch => quote('Claude Pro 月卡', patch));
  offers.push(quote('Claude Pro 月卡', { offer_id: 'valid' }));
  const product = category([list('priceai', 'claude-pro-month', offers)], 'claude').products[0];
  assert.deepEqual(product.entries.map(entry => entry.offer.offer_id), ['valid']);
});

test('trusted direct and PriceAI IDs support missing titles but search IDs never do', () => {
  const lists = ['direct-shops', 'priceai', 'ldxp-goods'].map(source => list(source, 'claude-pro-month', [quote(null)]));
  assert.equal(category(lists, 'claude').products[0].entries.length, 2);
});

test('mixed LDXP search bucket cannot leak another product through legacy spec detail URL', () => {
  const lists = [list('ldxp-goods', 'search-plus', [quote('ChatGPT Plus 月卡'), quote('Claude Pro 月卡')])];
  for (const key of ['chatgpt', 'claude']) {
    const product = category(lists, key).products[0];
    assert.equal(product.variants.length, 0);
    assert.equal(product.references.length, 0);
  }
});

test('official/API references permit explicit zero, retain identities and distinguish reference quotes', () => {
  const lists = [list('cardnav-official', 'copilot-pro', [quote('Pro', { price: 0, status: 'official' })]), list('goaihop-relay', 'relay-code-proxy', [quote('入门套餐', { price: 0, status: 'active' })], '中转 CodeProxy')];
  assert.equal(category(lists, 'microsoft').products[0].variants[0].reference, true);
  assert.equal(category(lists, 'relay').products[0].variants[0].offer.price, 0);
  assert.equal(category([list('goaihop-relay', 'relay-code-proxy', [quote('套餐', { price: null })])], 'relay').products[0].variants.length, 0);
});

test('ordinary accounts keep their own identity and unknown specs retain safe product references', () => {
  const lists = [list('priceai', 'chatgpt-free-account', [quote('普通账号', { comparison_known: false })]), list('priceai', 'education-email', [])];
  const product = category(lists, 'chatgpt').products[0];
  assert.equal(product.key, 'chatgpt-free-account');
  assert.equal(product.variants.length, 0);
  assert.equal(product.references[0].product.product_id, 'chatgpt-free-account');
  assert.equal(category(lists, 'mail').products[0].key, 'education-email');
});

test('trusted canonical product keeps reference when every offer title lacks brand evidence', () => {
  const products = category([list('priceai', 'chatgpt-plus-recharge', [quote('【自营】Plus 已接码')])], 'chatgpt').products;
  assert.equal(products.length, 1);
  assert.equal(products[0].key, 'chatgpt-plus');
  assert.equal(products[0].references[0].product.product_id, 'chatgpt-plus-recharge');
  assert.equal(products[0].references[0].offer, null);
  assert.equal(products[0].entries.length, 0);
  assert.equal(products[0].variants.length, 0);
  assert.equal(category([list('ldxp-goods', 'chatgpt-plus-recharge', [quote('【自营】Plus 已接码')])], 'chatgpt').products.length, 0);
});

test('complete directory quotes combine all sources and retain unknown specifications', () => {
  const lists = [
    list('direct-shops', 'chatgpt-plus-recharge', [quote('ChatGPT Plus 月卡', { offer_id: 'd1', url: 'https://a.example/goods/1' }), quote('ChatGPT Plus 年卡', { offer_id: 'd2', url: 'https://b.example/goods/1', comparison_key: 'year' })]),
    list('priceai', 'chatgpt-plus', [quote('【自营】Plus 已接码', { offer_id: 'p1', url: 'https://c.example/goods/1', comparison_known: false, comparison_key: 'mixed' })]),
    list('ldxp-goods', 'search-plus', [quote('ChatGPT Plus 月卡', { offer_id: 'l1', url: 'https://wzyp.cn/goods/1' }), quote('Claude Pro 月卡', { offer_id: 'other', url: 'https://wzyp.cn/goods/2' })]),
  ];
  const before = JSON.stringify(lists);
  const product = category(lists, 'chatgpt').products[0];
  const quotes = directoryQuotes(product);
  assert.equal(quotes.total, 4);
  assert.equal(quotes.shopCount, 3);
  assert.equal(quotes.unresolvedQuoteCount, 1);
  assert.equal(quotes.entries.find(entry => entry.offer.offer_id === 'p1').offer.comparison_known, false);
  assert.equal(quotes.entries.find(entry => entry.offer.offer_id === 'l1').product.product_id, 'search-plus');
  assert.equal(directoryQuotes(product, { spec: 'year' }).total, 1);
  assert.equal(directoryQuotes(product, { channel: 'ldxp' }).total, 1);
  assert.equal(JSON.stringify(lists), before);
});

test('deduplication retains different shops and products while preferring original source', () => {
  const canonical = quote('ChatGPT Plus 月卡', { url: 'https://shop.example/goods/1', offer_id: 'direct', price: 120 });
  const product = category([
    list('priceai', 'chatgpt-plus', [quote('ChatGPT Plus 月卡', { url: 'https://shop.example/goods/1?utm_source=mirror', offer_id: 'mirror', price: 99 }), quote('ChatGPT Plus 月卡', { url: 'https://shop.example/goods/2', offer_id: 'other-product', price: 120 })]),
    list('direct-shops', 'chatgpt-plus-recharge', [canonical]),
    list('ldxp-goods', 'search-plus', [quote('ChatGPT Plus 月卡', { url: 'https://16688.com.cn/goods/1', offer_id: 'shop1' }), quote('ChatGPT Plus 月卡', { url: 'https://16688.com.cn/goods/2', offer_id: 'shop2' })]),
  ], 'chatgpt').products[0];
  const result = directoryQuotes(product);
  assert.equal(result.total, 4);
  assert.equal(result.shopCount, 1);
  assert.equal(result.unresolvedQuoteCount, 2);
  assert.equal(result.entries.some(entry => entry.offer.offer_id === 'mirror'), false);
  assert.equal(result.entries.find(entry => entry.offer.offer_id === 'direct').offer, canonical);
});

test('complete quotes exclude unsafe destinations, no warranty, stale and unavailable offers', () => {
  const invalid = [{ url: 'http://a.example/1' }, { url: 'https://127.0.0.1/1' }, { url: 'javascript:alert(1)' }, { title: 'ChatGPT Plus 无质保' }, { quote_stale: true }, { status: 'sold_out' }, { stock_count: '0' }, { price: 0 }, { currency: 'ZZZ' }];
  const product = category([list('priceai', 'chatgpt-plus', [...invalid.map(patch => quote('ChatGPT Plus 月卡', patch)), quote('ChatGPT Plus 月卡', { offer_id: 'valid', comparison_known: false })])], 'chatgpt').products[0];
  assert.deepEqual(directoryQuotes(product).entries.map(entry => entry.offer.offer_id), ['valid']);
});

test('currencies stay in fixed groups for both sorts and references do not count as shops', () => {
  const product = category([
    list('direct-shops', 'chatgpt-plus', [quote('ChatGPT Plus 月卡', { offer_id: 'c1', price: 100, url: 'https://a.example/1' }), quote('ChatGPT Plus 月卡', { offer_id: 'c2', price: 200, url: 'https://b.example/1' }), quote('ChatGPT Plus 月卡', { offer_id: 'u1', price: 5, currency: 'USD', url: 'https://c.example/1' }), quote('ChatGPT Plus 月卡', { offer_id: 'u2', price: 20, currency: 'USD', url: 'https://d.example/1' })]),
    list('cardnav-official', 'chatgpt-plus', [quote('Plus', { offer_id: 'reference', price: 0, currency: 'USD', status: 'official', url: 'https://openai.com/chatgpt' })]),
  ], 'chatgpt').products[0];
  assert.deepEqual(directoryQuotes(product).entries.map(entry => entry.offer.price), [100, 200, 0, 5, 20]);
  assert.deepEqual(directoryQuotes(product, { sort: 'price_desc' }).entries.map(entry => entry.offer.price), [200, 100, 20, 5, 0]);
  assert.deepEqual(directoryQuotes(product).currencies, ['CNY', 'USD']);
  assert.equal(directoryQuotes(product).shopCount, 4);
  assert.equal(directoryQuotes(product, { currency: 'USD' }).total, 3);
});

test('trusted fallback never assigns an explicit different brand to Plus', () => {
  const product = category([list('priceai', 'chatgpt-plus', [quote('Gemini Plus 月卡'), quote('Claude Pro 月卡'), quote('Plus 月卡', { offer_id: 'bare-plus' })])], 'chatgpt').products[0];
  assert.deepEqual(directoryQuotes(product).entries.map(entry => entry.offer.offer_id), ['bare-plus']);
});

test('unverified shop names never affect shared-platform deduplication or merchant counts', () => {
  const product = category([
    { ...list('priceai', 'chatgpt-plus', [quote('ChatGPT Plus 月卡', { offer_id: 'old', store_name: '名字一' })]), fetchedAt: '2026-09-01T00:00:00Z' },
    { ...list('ldxp-goods', 'search-plus', [quote('ChatGPT Plus 月卡', { offer_id: 'new', store_name: '名字二' }), quote('ChatGPT Plus 月卡', { offer_id: 'different', store_name: '名字二', url: 'https://16688.com.cn/goods/2' })]), fetchedAt: '2026-09-02T00:00:00Z' },
  ], 'chatgpt').products[0];
  const result = directoryQuotes(product);
  assert.equal(result.total, 2);
  assert.equal(result.shopCount, 0);
  assert.equal(result.unresolvedQuoteCount, 2);
  assert.equal(result.entries.some(entry => entry.offer.offer_id === 'new'), true);
  assert.equal(result.entries.some(entry => entry.offer.offer_id === 'old'), false);
});

test('mixed subscription brands and unknown-brand tier fallbacks are excluded', () => {
  const directory = buildProductDirectory([list('priceai', 'chatgpt-plus', [
    quote('Plus / Midjourney'), quote('Plus Canva'), quote('Plus UnknownBrand'),
    quote('Claude Pro + Gemini Pro'), quote('ChatGPT Plus + Claude Pro'),
    quote('ChatGPT Plus 月卡 Google邮箱登录', { offer_id: 'valid', url: 'https://a.example/1' }),
  ])]);
  const entries = directory.flatMap(category => category.products.flatMap(product => directoryQuotes(product).entries));
  assert.deepEqual(entries.map(entry => entry.offer.offer_id), ['valid']);
});

test('trusted bare Plus retains actual CDK and app delivery terms without allowing foreign brands', () => {
  const titles = ['【自营】Plus 已接码 仅反代，发CDK 不可网页 不可回', 'Plus iOS Android App 月卡', 'Plus CDKey web code key recharge account'];
  const product = category([list('priceai', 'chatgpt-plus', [
    ...titles.map((title, index) => quote(title, { offer_id: `valid-${index}`, url: `https://shop.example/goods/${index}`, comparison_known: false })),
    quote('Plus Canva CDK'), quote('Plus Midjourney iOS'), quote('Plus API 额度'),
  ])], 'chatgpt').products[0];
  assert.deepEqual(directoryQuotes(product).entries.map(entry => entry.offer.offer_id), ['valid-0', 'valid-1', 'valid-2']);
});
