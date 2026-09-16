import { deliveryEvidence } from './delivery-evidence.mjs';
import { htmlFailure } from './public-catalog-html.mjs';

export const PUBLIC_STORE_ENDPOINT = '/api/store/products';
const invalid = () => { throw htmlFailure(); };
const plain = value => deliveryEvidence({ description: value }).description;

// Recognize a reusable storefront contract from its linked public module, without
// executing it. In particular, never assume an unlabelled integer means yuan:
// require the actual CNY formatter and its product-price call site.
export function recognizesPublicStoreScript(script) {
  if (typeof script !== 'string' || Buffer.byteLength(script) > 1024 * 1024) return false;
  const formatter = script.match(/function\s+(\w+)\((\w+)\)\{if\(!Number\.isFinite\(\2\)\)return"[^"]*";const\s+(\w+)=\2\/100;return`¥\$\{Number\.isInteger\(\3\)\?\3:\3\.toFixed\(2\)\}`\}/);
  return !!formatter && new RegExp(`price:${formatter[1]}\\(\\w+\\.price\\)`).test(script)
    && script.includes('products:"' + PUBLIC_STORE_ENDPOINT + '"')
    && /getProduct:\w+=>\w+\(`\$\{\w+\.products\}\/\$\{encodeURIComponent\(\w+\)\}`\)/.test(script)
    && /`\/store\/products\/\$\{encodeURIComponent\(\w+\.slug\|\|\w+\.id\)\}`/.test(script);
}

export function parsePublicStoreList(payload) {
  if (!payload || !Array.isArray(payload.products) || payload.products.length > 2000) invalid();
  if (payload.hasMore || payload.next || (payload.total != null && payload.total !== payload.products.length)) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
  const ids = new Set(), slugs = new Set();
  const active = [];
  for (const row of payload.products) {
    if (!row || typeof row.id !== 'string' || !/^[\w-]{1,100}$/.test(row.id) || typeof row.slug !== 'string' || !/^[\w-]{1,150}$/.test(row.slug)
      || ids.has(row.id) || slugs.has(row.slug) || !['ACTIVE','PAUSED','DRAFT','ARCHIVED'].includes(row.status)) invalid();
    ids.add(row.id); slugs.add(row.slug);
    if (row.status !== 'ACTIVE') continue;
    if (!plain(row.name) || !Number.isSafeInteger(row.price) || row.price <= 0 || row.price > 100000000
      || (row.stockQuantity != null && (!Number.isSafeInteger(row.stockQuantity) || row.stockQuantity < 0))
      || (row.isSoldOut != null && typeof row.isSoldOut !== 'boolean')) invalid();
    if ((row.stockQuantity > 0 && row.isSoldOut === true) || (row.stockQuantity === 0 && row.isSoldOut === false)) invalid();
    active.push(row);
  }
  if (active.length > 12) throw htmlFailure('公开目录请求达到上限', 'COLLECTOR_LIMIT');
  return active;
}

export function parsePublicStoreDetail(payload, listed, target, capturedAt) {
  const row = payload?.product;
  if (!row || ['id','slug','name','price','status','stockQuantity','isSoldOut'].some(key => row[key] !== listed[key])) invalid();
  let detail = {};
  if (row.detailContent) { try { detail = JSON.parse(row.detailContent); } catch { invalid(); } }
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) invalid();
  const evidence = deliveryEvidence({ productTitle: row.name, category: row.category,
    description: [row.description, detail.details].filter(v => typeof v === 'string').join('\n'), descriptionScope: 'product' });
  const stockCount = row.stockQuantity ?? null;
  const status = stockCount === 0 || row.isSoldOut === true ? 'out_of_stock' : stockCount > 0 ? 'in_stock' : 'unknown';
  return { offerId: `${target.id}:store:${row.id}`, sourceId: target.id, sourceName: target.name, storeName: target.name,
    title: evidence.productTitle, category: evidence.category, price: row.price / 100, listedPrice: row.price / 100, priceBasis: 'listed', currency: 'CNY',
    status, stockCount, url: `${target.origin}/store/products/${encodeURIComponent(row.slug)}`, capturedAt,
    extra: { deliveryEvidence: evidence, publicDescription: evidence.description,
      warrantyEvidence: plain([row.name, ...evidence.description.split(/(?<=[。；;])/)].filter(line => /质保|售后|保修|不退|不换|退款|warrant/i.test(line)).join('\n')),
      priceEvidence: '公开商品接口与详情接口价格一致；已核对前端人民币分转元显示规则',
      stockEvidence: '使用实时商品库存字段，未使用销量或上游快照', catalogFormat: 'public-store-api', collectionMethod: 'linked-public-module' } };
}
