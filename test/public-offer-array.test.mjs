import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicProduct } from '../lib/public-catalog-html.mjs';

const origin = 'https://store.example.test';
const target = { id: 'merchant-test', name: 'Example', origin, currency: 'CNY' };
const entry = { url: origin + '/products/demo' };

function page({ offers }) {
  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Demo Product',
    url: entry.url,
    offers,
  });
  return '<!doctype html><html><head><link rel="canonical" href="' + entry.url + '"><script type="application/ld+json">' + json + '</script></head><body><main><h1>Demo Product</h1><div class="detail-price">¥12.00</div></main></body></html>';
}

test('single Offer object still parses', () => {
  const offer = parsePublicProduct(page({
    offers: { '@type': 'Offer', price: '12.00', priceCurrency: 'CNY', url: entry.url, availability: 'https://schema.org/InStock' },
  }), entry, target, '2026-10-24T00:00:00.000Z');
  assert.equal(offer.price, 12);
  assert.equal(offer.status, 'in_stock');
});

test('single-element Offer array unwraps like Schema.org', () => {
  const offer = parsePublicProduct(page({
    offers: [{ '@type': 'Offer', price: '12.00', priceCurrency: 'CNY', url: entry.url, availability: 'https://schema.org/InStock' }],
  }), entry, target, '2026-10-24T00:00:00.000Z');
  assert.equal(offer.price, 12);
  assert.equal(offer.title, 'Demo Product');
});

test('multi-offer arrays stay rejected without a dedicated adapter', () => {
  assert.throws(() => parsePublicProduct(page({
    offers: [
      { '@type': 'Offer', price: '12.00', priceCurrency: 'CNY', url: entry.url, availability: 'https://schema.org/InStock' },
      { '@type': 'Offer', price: '20.00', priceCurrency: 'CNY', url: entry.url, availability: 'https://schema.org/InStock' },
    ],
  }), entry, target, '2026-10-24T00:00:00.000Z'), { code: 'INVALID_CATALOG' });
});
