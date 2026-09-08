import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicHtml } from '../collectors/direct/public-html.mjs';
import { authorizeMerchantTarget } from '../lib/merchant-target-capability.mjs';
import { probeMerchantCatalog } from '../lib/merchant-collection.mjs';
import { collectorFor, directTargets } from '../collectors/direct/registry.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';
import { directOfferExclusionReason } from '../collectors/direct/catalog.mjs';

const origin = 'https://public-shop.com';
const target = () => authorizeMerchantTarget({ id: 'merchant-html', name: '公开店铺', origin });
const ld = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const name = 'ChatGPT Plus 月卡充值';
const home = (ids = ['one']) => `<main>${ids.map(id => `<article class="product-card"><h3>${name}</h3><strong class="price">¥125.00</strong><a href="/products/${id}">详情</a><a href="/checkout/${id}">购买</a></article>`).join('')}</main>`;
function detail({ id = 'one', title = name, price = '125.00', visiblePrice = price, description = '充值到自己账号', availability = 'https://schema.org/InStock', currency = 'CNY', extra = '', microdata = false } = {}) {
  const offer = { '@type': 'Offer', price, priceCurrency: currency, availability, url: `${origin}/products/${id}` };
  return (microdata ? '' : ld({ '@context': 'https://schema.org', '@type': 'Product', name: title, description, offers: offer })) +
    `<main ${microdata ? 'itemscope itemtype="https://schema.org/Product"' : ''}><h1 itemprop="name">${title}</h1><div class="price"><strong>¥${visiblePrice}</strong></div><p itemprop="description">${description}</p>${microdata ? `<div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="${price}"><meta itemprop="priceCurrency" content="${currency}"><link itemprop="availability" href="${availability}"></div>` : ''}${extra}</main>`;
}
const response = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
function fixture(pages = {}, policy = 'User-agent: *\nDisallow: /api/\nDisallow: /checkout/') {
  const calls = [];
  return { calls, sleep: async () => {}, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method });
    const path = new URL(url).pathname;
    if (path === '/robots.txt') return response(policy);
    return response(pages[path] ?? (path === '/' ? home() : path === '/products/one' ? detail() : ''), path.startsWith('/api/') || path.startsWith('/user/') ? 404 : 200);
  } };
}

test('domain-independent HTML collector reads cards and Product JSON-LD without executing scripts or checkout', async () => {
  const f = fixture({ '/': home() + '<script src="/api/private.js"></script><a href="https://other.com/products/foreign">外站</a>' });
  const rows = await collectPublicHtml(target(), f);
  assert.equal(rows.length, 1); assert.equal(rows[0].price, 125);
  assert.equal(offerSpec(rows[0]).delivery_kind, 'recharge');
  assert.equal(summarizeMerchantOffers(rows).validCount, 1);
  assert.deepEqual(f.calls.map(x => new URL(x.url).pathname), ['/robots.txt', '/', '/products/one']);
  assert.ok(f.calls.every(x => x.method === 'GET'));
});

test('another markup uses ItemList @graph, microdata and explicit unknown inventory', async () => {
  const listing = ld({ '@graph': [{ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { url: '/products/one', name } }], numberOfItems: 1 }] });
  const rows = await collectPublicHtml(target(), fixture({ '/': listing, '/products/one': detail({ microdata: true, availability: 'https://schema.org/PreOrder' }) }));
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'unknown');
});

test('product-specific warranty remains distinct from subscription term and sold counts', async () => {
  const rows = await collectPublicHtml(target(), fixture({ '/products/one': detail({ extra: '<section class="product-description"><p>质保规则：质保30天不掉订阅，不质保封号。按剩余天数退差价。</p><p>已售1084</p></section>' }) }));
  assert.equal(rows[0].stockCount, null);
  assert.match(rows[0].extra.warrantyEvidence, /不质保封号/);
  assert.equal(directOfferExclusionReason(rows[0]), null);
  const bare = await collectPublicHtml(target(), fixture());
  assert.equal(bare[0].extra.warrantyEvidence, '');
  const noWarranty = await collectPublicHtml(target(), fixture({ '/products/one': detail({ description: '充值到自己账号。本商品无质保，无售后。' }) }));
  assert.equal(directOfferExclusionReason(noWarranty[0]), 'no_warranty');
});

test('conflicting prices, names, currency and missing detail reject entire collection', async () => {
  for (const html of [detail({ visiblePrice: '120' }), detail({ title: 'Claude Pro 年卡' }), detail({ currency: 'USD' }), detail({ price: '0' }), detail().replace(origin + '/products/one', 'https://evil.com/products/one'), '<main>missing</main>']) {
    await assert.rejects(collectPublicHtml(target(), fixture({ '/products/one': html })), { code: 'INVALID_CATALOG' });
  }
  await assert.rejects(collectPublicHtml(target(), fixture({ '/': home(['one', 'two']), '/products/two': 'missing' })), { code: 'INVALID_CATALOG' });
});

test('robots supports wildcard rules and longest allow; forbidden pages and WAF stop immediately', async () => {
  for (const policy of ['User-agent: *\nDisallow: /', 'User-agent: *\nDisallow: /products/*', 'User-agent: AiradarBot\nDisallow: /\nUser-agent: *\nAllow: /']) {
    const f = fixture({}, policy);
    await assert.rejects(collectPublicHtml(target(), f), { code: 'ROBOTS_DISALLOWED' });
    assert.ok(f.calls.length <= 2);
  }
  assert.equal((await collectPublicHtml(target(), fixture({}, 'User-agent: *\nDisallow: /products/\nAllow: /products/one$'))).length, 1);
  assert.equal((await collectPublicHtml(target(), fixture({}, '<html>SPA fallback, no robots rules</html>'))).length, 1);
  await assert.rejects(collectPublicHtml(target(), fixture({}, 'invalid line\nUser-agent: *\nDisallow: /\nmore invalid lines')), { code: 'ROBOTS_DISALLOWED' });
  await assert.rejects(collectPublicHtml(target(), fixture({}, 'User-agent: *\nDisallow: /pr%6Fducts/*')), { code: 'ROBOTS_DISALLOWED' });
  const f = fixture({ '/': '<title>Just a moment</title>' });
  await assert.rejects(collectPublicHtml(target(), f), { code: 'ACCESS_DENIED' });
  assert.equal(f.calls.length, 2);
});

test('bounded discovery follows explicit catalog and sitemap links, rejects truncated lists and unsafe targets', async () => {
  const f = fixture({ '/': '<a href="/catalog">全部商品</a>', '/catalog': home() });
  assert.equal((await collectPublicHtml(target(), f)).length, 1);
  const s = fixture({ '/': '<main>shop</main>', '/sitemap.xml': `<urlset><url><loc>${origin}/products/one</loc></url></urlset>` }, `User-agent: *\nSitemap: ${origin}/sitemap.xml`);
  assert.equal((await collectPublicHtml(target(), s)).length, 1);
  const tooMany = fixture({ '/': home(Array.from({ length: 30 }, (_, i) => String(i))) });
  await assert.rejects(collectPublicHtml(target(), tooMany), { code: 'COLLECTOR_LIMIT' });
  assert.equal(tooMany.calls.length, 2);
  await assert.rejects(collectPublicHtml({ ...target() }, fixture()), { code: 'PREFLIGHT_INTERNAL_ERROR' });
  await assert.rejects(collectPublicHtml(authorizeMerchantTarget({ ...target(), shopNo: 'S1' }), fixture()), { code: 'PREFLIGHT_INTERNAL_ERROR' });
});

test('unknown merchant preflight falls back after API 404; denial never triggers extra paths', async () => {
  const merchant = { id: 'merchant-html', shopName: '公开店铺', shopUrl: origin + '/', identity: 'domain:public-shop.com', platform: 'independent' };
  const f = fixture();
  const result = await probeMerchantCatalog(merchant, { merchantFetchFactory: () => f.fetchImpl, sleep: f.sleep }, new Date().toISOString(), Date.now() + 30000);
  assert.equal(result.offers.length, 1); assert.equal(result.offers[0].extra.merchantIdentity, merchant.identity);
  let calls = 0;
  await assert.rejects(probeMerchantCatalog(merchant, { merchantFetchFactory: () => async () => { calls++; return response('denied', 403); } }, new Date().toISOString(), Date.now() + 30000));
  assert.equal(calls, 1);
});

test('existing independent collectors use same fallback, while valid API results retain original IDs', async () => {
  const t = directTargets(['aisou'])[0];
  const f = fixture({ '/products/one': detail().replaceAll(origin, t.origin) });
  const rows = await collectorFor(t)(t, { ...f, publicFetchFactory: () => f.fetchImpl });
  assert.equal(rows.length, 1); assert.equal(rows[0].sourceId, t.id);
  const api = await collectorFor(t)(t, { fetchImpl: async () => new Response(JSON.stringify({ code: 200, data: [{ id: 2, name, price: 120, stock: 2 }] }), { headers: { 'content-type': 'application/json' } }) });
  assert.equal(api[0].offerId, 'aisou:2');
});

test('marketing experience does not turn a monthly subscription into a trial', () => {
  assert.match(offerSpec({ title:'ChatGPT Pro 20X 1个月 iOS充值【顶尖体验】', currency:'CNY' }).key, /:常规:/);
  for (const title of ['ChatGPT Plus 1天体验卡充值', 'ChatGPT Plus 试用充值1天', 'ChatGPT Plus trial充值1天']) {
    assert.match(offerSpec({ title, currency:'CNY' }).key, /试用\/短期/);
  }
});

test('HTML-only prices require list/detail agreement; hidden prices and unrelated notices are not evidence', async () => {
  const visible = '<main><h1>'+name+'</h1><div class="price">¥125</div><span hidden class="price">¥1</span><aside>全站无售后</aside></main>';
  const rows = await collectPublicHtml(target(), fixture({ '/products/one': visible }));
  assert.equal(rows[0].price, 125); assert.equal(rows[0].status, 'unknown');
  assert.equal(rows[0].extra.warrantyEvidence, '');
  await assert.rejects(collectPublicHtml(target(), fixture({ '/products/one': visible.replace('¥125','¥120') })), { code:'INVALID_CATALOG' });
});
