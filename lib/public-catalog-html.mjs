import { createHash } from 'node:crypto';
import { deliveryEvidence } from './delivery-evidence.mjs';

export const htmlFailure = (message = '公开商品页面信息不完整或不一致', code = 'INVALID_CATALOG') => Object.assign(new Error(message), { code });
const invalid = () => { throw htmlFailure(); };
export const htmlText = value => deliveryEvidence({ description: value }).description;
const nameText = value => deliveryEvidence({ productTitle: value }).productTitle;
const equalName = (a, b) => a.normalize('NFKC').replace(/\s+/g, '').toLowerCase() === b.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const attr = text => Object.fromEntries([...text.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(m => [m[1].toLowerCase(), htmlText(m[2] ?? m[3] ?? m[4] ?? '')]));
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const content = node => node ? htmlText(node.parts.map(p => typeof p === 'string' ? p : content(p)).join(' ')) : '';
const prop = (node, key) => descendants(node).filter(n => n.attrs.itemprop?.split(/\s+/).includes(key));
const value = node => node?.attrs.content || node?.attrs.href || content(node);

// Bounded, inert HTML reader: scripts are parsed only as JSON-LD, never executed.
// This is not a browser DOM and deliberately accepts only explicit price evidence.
export function readHtml(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 1024 * 1024) throw htmlFailure('公开目录响应超过限制', 'COLLECTOR_LIMIT');
  const data = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|template)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi, (_, tag, attrs, body) => {
    if (tag.toLowerCase() === 'script' && attr(attrs).type?.toLowerCase() === 'application/ld+json') {
      try { data.push(JSON.parse(body)); } catch { invalid(); }
    }
    return '';
  });
  const root = { tag: 'root', attrs: {}, children: [], parts: [] }, stack = [root];
  let count = 0;
  for (const match of clean.matchAll(/<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+/g)) {
    const token = match[0];
    if (!token.startsWith('<')) { stack.at(-1).parts.push(token); continue; }
    const tag = token.match(/^<\/?([\w:-]+)/)?.[1].toLowerCase();
    if (token.startsWith('</')) {
      const index = stack.findLastIndex(n => n.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    if (++count > 20000 || stack.length > 100) throw htmlFailure('公开目录响应超过限制', 'COLLECTOR_LIMIT');
    const attrs = attr(token.slice(tag.length + 1, -1));
    const node = { tag, attrs, parent: stack.at(-1), children: [], parts: [] };
    node.hidden = node.parent.hidden || 'hidden' in attrs || attrs['aria-hidden'] === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style || '');
    if (!node.hidden) { node.parent.children.push(node); node.parent.parts.push(node); }
    if (!VOID.has(tag) && !token.endsWith('/>')) stack.push(node);
  }
  const all = descendants(root);
  const graph = [];
  function visit(v, depth = 0) {
    if (depth > 20 || graph.length > 2000) throw htmlFailure('公开目录响应超过限制', 'COLLECTOR_LIMIT');
    if (Array.isArray(v)) v.forEach(x => visit(x, depth + 1));
    else if (v && typeof v === 'object') { graph.push(v); if (v['@graph']) visit(v['@graph'], depth + 1); }
  }
  data.forEach(v => visit(v));
  return { root, all, graph };
}
const hasType = (node, type) => [node?.['@type']].flat().some(v => v === type || v === `https://schema.org/${type}` || v === `http://schema.org/${type}`);

export function publicPageUrl(value, origin, kind = 'product') {
  if (typeof value !== 'string' || value.length > 500 || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const url = new URL(value, origin + '/');
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) return null;
    if (kind === 'sitemap') return !url.search && /\/(?:[\w-]*sitemap[\w-]*|sitemap[\w/-]*)\.xml$/.test(url.pathname) ? url.href : null;
    if (kind === 'script') return !url.search && /^\/(?:assets|_next\/static)\/[\w./-]+\.js$/.test(url.pathname) ? url.href : null;
    if (kind === 'catalog') return /^\/(?:products?|catalog|shop|collections)(?:\/[\w-]+)?\/?$/.test(url.pathname) && (!url.search || /^\?page=[1-9]\d?$/.test(url.search)) ? url.href : null;
    return /^\/(?:products?|goods|items?|commodity|p)\/(?:[\w-]+\/)*[\w-]+\/?$/.test(url.pathname) && !url.search ? url.href : null;
  } catch { return null; }
}

function amount(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text.replaceAll(',', ''));
  return n > 0 && n <= 1000000 ? n : null;
}
function visiblePrices(node) {
  const candidates = descendants(node).filter(n => n.tag !== 'del' && n.tag !== 's' && !['meta', 'link'].includes(n.tag)
    && !/(?:old|original|compare|market|list)[-_ ]?price|price[-_ ]?(?:old|original|compare)/i.test(n.attrs.class || '')
    && (/price|价格|售价/.test(n.attrs.class || '') || ['strong', 'b'].includes(n.tag) || n.attrs.itemprop === 'price'));
  const prices = candidates.flatMap(n => {
    if (n.parent?.tag === 'del' || n.parent?.tag === 's') return [];
    const t = content(n);
    if (t.length > 100 || /起|低至|到手|优惠券|from|starting|~|～|\d\s*[-–]\s*\d/i.test(t)) return [];
    return [...t.matchAll(/(?:[¥￥]|CNY\s*|RMB\s*)([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*元/g)].map(m => amount(m[1] || m[2])).filter(n => n !== null);
  });
  return [...new Set(prices)];
}

export function discoverCatalog(html, origin) {
  const doc = readHtml(html), entries = new Map(), catalogLinks = new Set();
  const add = (url, hint = {}) => {
    const canonical = publicPageUrl(url, origin);
    if (!canonical) return;
    const prior = entries.get(canonical);
    if (prior && ((prior.name && hint.name && !equalName(prior.name, hint.name)) || (prior.price && hint.price && prior.price !== hint.price))) invalid();
    entries.set(canonical, { ...hint, ...prior, url: canonical });
  };
  for (const list of doc.graph.filter(row => hasType(row, 'ItemList'))) {
    if (!Array.isArray(list.itemListElement)) invalid();
    if (list.numberOfItems != null && Number(list.numberOfItems) !== list.itemListElement.length) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
    for (const row of list.itemListElement) {
      const item = row.item || row;
      const url = typeof item === 'string' ? item : item.url || item['@id'] || row.url;
      if (!publicPageUrl(url, origin)) invalid();
      add(url, { name: nameText(item.name || row.name) });
    }
  }
  for (const product of doc.graph.filter(row => hasType(row, 'Product'))) add(product.url || product.offers?.url, { name: nameText(product.name) });
  for (const link of doc.all.filter(n => n.tag === 'a' && n.attrs.href)) {
    const url = publicPageUrl(link.attrs.href, origin);
    if (!url) { const catalog = publicPageUrl(link.attrs.href, origin, 'catalog'); if (catalog) catalogLinks.add(catalog); continue; }
    let card = link.parent;
    while (card.parent && card.tag !== 'article' && !/(?:^|[-_ ])product[-_](?:card|item)(?:$|[-_ ])/i.test(card.attrs.class || '')) card = card.parent;
    const heading = descendants(card).find(n => /^h[23]$/.test(n.tag));
    const prices = card.tag === 'root' ? [] : visiblePrices(card);
    add(url, { name: card.tag === 'root' ? '' : nameText(content(heading)), ...(prices.length === 1 ? { price: prices[0] } : {}) });
  }
  const text = content(doc.root);
  const declared = [...text.matchAll(/上架商品\s*(\d+)|共\s*(\d+)\s*(?:件商品|个商品)/g)].map(m => Number(m[1] || m[2]));
  if (declared.some(n => n !== entries.size)) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
  const next = doc.all.filter(n => n.tag === 'a' && (n.attrs.rel === 'next' || /^(?:下一页|next)$/i.test(content(n))));
  for (const n of next) { const url = publicPageUrl(n.attrs.href, origin, 'catalog'); if (!url) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT'); catalogLinks.add(url); }
  const scriptUrls = [...html.matchAll(/<script\b([^>]*)>/gi)].map(m => publicPageUrl(attr(m[1]).src, origin, 'script')).filter(Boolean);
  return { entries: [...entries.values()], catalogLinks: [...catalogLinks], scriptUrls: [...new Set(scriptUrls)] };
}

export function parsePublicProduct(html, entry, target, capturedAt) {
  const doc = readHtml(html), products = doc.graph.filter(p => hasType(p, 'Product'));
  if (products.length > 1) invalid(); // Product variants/range prices need their own exact SKU adapter.
  const main = doc.all.find(n => n.tag === 'main') || doc.root;
  const h1s = descendants(main).filter(n => n.tag === 'h1');
  if (h1s.length !== 1) invalid();
  const visibleName = nameText(content(h1s[0]));
  const scope = doc.all.find(n => /(?:^|\s)https?:\/\/schema.org\/Product(?:\s|$)/.test(n.attrs.itemtype || '')) || main;
  const microOffer = prop(scope, 'offers')[0];
  const structured = products[0] || (microOffer ? { name: value(prop(scope, 'name')[0]), description: value(prop(scope, 'description')[0]),
    offers: { '@type': 'Offer', price: value(prop(microOffer, 'price')[0]), priceCurrency: value(prop(microOffer, 'priceCurrency')[0]), availability: value(prop(microOffer, 'availability')[0]) } } : null);
  const product = structured || { name: visibleName };
  const name = nameText(product.name), offer = product.offers;
  if (!name || !equalName(name, visibleName) || (entry.name && !equalName(name, entry.name))) invalid();
  for (const url of [product.url, offer?.url, ...doc.all.filter(n => n.tag === 'link' && n.attrs.rel === 'canonical').map(n => n.attrs.href)].filter(Boolean)) {
    if (publicPageUrl(url, target.origin) !== entry.url) invalid();
  }
  // Price scope excludes recommendation/side cards whenever the heading has a local product section.
  let priceScope = h1s[0].parent;
  while (priceScope.parent && priceScope !== main && !/product[-_]detail/.test(priceScope.attrs.class || '')) priceScope = priceScope.parent;
  const prices = visiblePrices(priceScope);
  if (prices.length !== 1) invalid();
  const price = structured ? amount(offer?.price) : entry.price;
  if (structured && (!hasType(offer, 'Offer') || offer.priceCurrency !== 'CNY' || Array.isArray(offer))) invalid();
  if (!price || price !== prices[0] || (entry.price && entry.price !== price)) invalid();
  const category = nameText(typeof product.category === 'string' ? product.category : '');
  const descriptions = descendants(priceScope).filter(n => /(?:^|[-_ ])(?:description|rich-detail-line|subtitle|copy)(?:$|[-_ ])/i.test(n.attrs.class || '') || n.attrs.itemprop === 'description');
  const description = htmlText([product.description, ...descriptions.map(content)].filter(Boolean).join('\n'));
  const warranty = htmlText([name, ...description.split(/(?<=[。；;\n])/)].filter(line => /质保|售后|保修|不退|不换|退[款差]|warrant/i.test(line)).join('\n'));
  const evidence = deliveryEvidence({ productTitle: name, category, description: description || product.description, descriptionScope: 'product' });
  const availability = offer?.availability;
  const status = { 'https://schema.org/InStock': 'in_stock', 'http://schema.org/InStock': 'in_stock', 'https://schema.org/OutOfStock': 'out_of_stock', 'https://schema.org/SoldOut': 'out_of_stock' }[availability] || 'unknown';
  const stockNodes = descendants(priceScope).filter(n => /stock|availability/.test(n.attrs.class || '') || n.attrs.itemprop === 'availability');
  const stockText = stockNodes.map(content).join(' ');
  if ((status === 'in_stock' && /售罄|缺货|无货|out of stock|sold out/i.test(stockText)) || (status === 'out_of_stock' && /库存充足|现货|in stock/i.test(stockText))) invalid();
  return { offerId: `${target.id}:html:${createHash('sha256').update(entry.url).digest('hex').slice(0, 16)}`, sourceId: target.id,
    sourceName: target.name, storeName: target.name, title: name, category, price, listedPrice: price, priceBasis: 'listed', currency: 'CNY',
    status, stockCount: status === 'out_of_stock' ? 0 : null, url: entry.url, capturedAt,
    extra: { deliveryEvidence: evidence, publicDescription: description, warrantyEvidence: warranty,
      priceEvidence: structured ? '公开详情标价与商品结构化价格一致' : '公开列表标价与详情标价一致',
      stockEvidence: availability ? `商品页声明：${nameText(availability)}` : '未取得明确库存声明', catalogFormat: 'public-html', collectionMethod: structured ? 'structured-product' : 'visible-product' } };
}
