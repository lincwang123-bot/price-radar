import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDirectory } from '../lib/product-directory.mjs';

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
