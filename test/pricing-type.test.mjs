import test from 'node:test';
import assert from 'node:assert/strict';
import { offerPricingType, matchesPricingType, normalizePricingType } from '../lib/pricing-type.mjs';
import { directoryQuotes, buildProductDirectory } from '../lib/product-directory.mjs';
import { openDb, storeSnapshot } from '../lib/db.mjs';
import { createApp } from '../lib/web.mjs';

test('offerPricingType tags promo keywords without treating carpool or PH region alone as promo', () => {
  assert.equal(offerPricingType({ title: 'ChatGPT Plus 月卡代充 新开续费均可' }), 'regular');
  assert.equal(offerPricingType({ title: 'G Plus 半价 成品号' }), 'promo');
  assert.equal(offerPricingType({ title: 'ChatGPT Plus 成品账号｜菲区半价月卡' }), 'promo');
  assert.equal(offerPricingType({ title: 'openai-plus月卡会员拼车-2人团' }), 'regular');
  assert.equal(offerPricingType({ title: 'G PLUS 月 菲区手动卡充' }), 'regular');
  assert.equal(offerPricingType({ title: 'ChatGPT Plus 半价资格号' }), 'promo');
  assert.equal(offerPricingType({ title: '百分百0元优惠-开通plus专用' }), 'promo');
  assert.equal(offerPricingType({ title: 'Plus 首月特价代充' }), 'promo');
  assert.equal(offerPricingType({ title: '' }), 'unknown');
  assert.equal(normalizePricingType('promo'), 'promo');
  assert.equal(normalizePricingType('weird'), 'all');
  assert.equal(matchesPricingType('unknown', 'regular'), true);
  assert.equal(matchesPricingType('promo', 'regular'), false);
  assert.equal(matchesPricingType('promo', 'promo'), true);
});

test('directoryQuotes defaults to regular so homepage minima exclude promo; all keeps mixed order', () => {
  const entry = (id, title, price) => ({
    list: { source: 'direct-shops' },
    product: { currency: 'CNY' },
    channel: { id: 'independent' },
    offer: {
      offer_id: id,
      title,
      price,
      currency: 'CNY',
      status: 'in_stock',
      stock_count: 2,
      url: 'https://' + id + '.example.org/product',
    },
  });
  const product = {
    quoteEntries: [
      entry('promo', 'ChatGPT Plus 半价 成品号', 85),
      entry('regular', 'ChatGPT Plus 代充 1个月 新开续费均可', 140),
      entry('region', 'ChatGPT Plus 菲区卡充 月卡', 128),
      entry('carpool', 'ChatGPT Plus 拼车三人车', 50),
    ],
  };
  assert.deepEqual(directoryQuotes(product).entries.map(e => e.offer.offer_id), ['carpool', 'region', 'regular']);
  assert.deepEqual(directoryQuotes(product, { pricing_type: 'all' }).entries.map(e => e.offer.offer_id), ['carpool', 'promo', 'region', 'regular']);
  assert.deepEqual(directoryQuotes(product, { pricing_type: 'promo' }).entries.map(e => e.offer.offer_id), ['promo']);
  const counts = Object.fromEntries(directoryQuotes(product, { pricing_type: 'regular' }).pricingTypes.map(g => [g.kind, g.count]));
  assert.deepEqual(counts, { regular: 3, promo: 1, all: 4 });
});

test('ChatGPT Plus directory defaults to regular pricing_type and can switch to promo', async () => {
  const db = openDb(':memory:');
  let app;
  try {
    const offers = [
      { offerId: 'half', title: 'ChatGPT Plus 半价 成品号', price: 85, currency: 'CNY', status: 'in_stock', stockCount: 1, url: 'https://half.example.org/p' },
      { offerId: 'full', title: 'ChatGPT Plus 代充 1个月 新开续费均可', price: 140, currency: 'CNY', status: 'in_stock', stockCount: 1, url: 'https://full.example.org/p' },
      { offerId: 'ph', title: 'ChatGPT Plus 菲区官方卡充 月卡', price: 125, currency: 'CNY', status: 'in_stock', stockCount: 1, url: 'https://ph.example.org/p' },
    ];
    storeSnapshot(db, {
      source: 'direct-shops',
      snapshotId: 'pricing-type-fixture',
      products: [{ productId: 'chatgpt-plus-recharge', name: 'ChatGPT Plus', currency: 'CNY', offers }],
    });
    app = createApp({ db });
    await new Promise(r => app.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + app.address().port;
    const get = async p => (await fetch(base + p)).text();
    const titles = html => [...html.matchAll(/class="directory-quote-title">([^<]+)</g)].map(m => m[1]);
    const prices = html => [...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m => Number(m[1]));

    const regular = await get('/prices/chatgpt-plus');
    assert.match(regular, /data-pricing-type-choice="regular" aria-current="true"/);
    assert.match(regular, /data-pricing-type-note/);
    assert.deepEqual(prices(regular), [125, 140]);
    assert.ok(titles(regular).every(t => !/半价/.test(t)));

    const promo = await get('/prices/chatgpt-plus?pricing_type=promo');
    assert.match(promo, /data-pricing-type-choice="promo" aria-current="true"/);
    assert.deepEqual(prices(promo), [85]);
    assert.match(promo, /半价/);

    const all = await get('/prices/chatgpt-plus?pricing_type=all');
    assert.match(all, /data-pricing-type-choice="all" aria-current="true"/);
    assert.deepEqual(prices(all), [85, 125, 140]);

    const en = await get('/en/prices/chatgpt-plus');
    assert.match(en, /Price type/);
    assert.match(en, /Regular price/);
    assert.match(en, /Promo \/ half-price/);
  } finally {
    if (app?.listening) {
      app.closeAllConnections();
      await new Promise(r => app.close(r));
    }
    db.close();
  }
});

test('a price ending in 0 before 元 is not a zero-yuan promo (S557522 G54457093)', () => {
  assert.equal(offerPricingType({ title: '【可续费且随时上车】Business独立席位｜100元/月｜全程质保·售后无忧' }), 'regular');
  for (const title of ['Plus 月卡 120元', 'Team 席位 30 元/月', '1.50元 体验']) assert.equal(offerPricingType({ title }), 'regular', title);
  for (const title of ['0元购 Plus', '首单 0 元', '限时0元试用']) assert.equal(offerPricingType({ title }), 'promo', title);
});
