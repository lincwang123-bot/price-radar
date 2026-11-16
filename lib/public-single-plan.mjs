import { readHtml, htmlText, htmlFailure } from './public-catalog-html.mjs';
import { deliveryEvidence } from './delivery-evidence.mjs';

const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const text = node => node ? htmlText(node.parts.map(part => typeof part === 'string' ? part : text(part)).join(' ')) : '';
const hasClass = (node, name) => (node.attrs.class || '').split(/\s+/).includes(name);
const compact = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const one = nodes => { if (nodes.length !== 1) throw htmlFailure(); return nodes[0]; };
const money = node => {
  const match = text(node).match(/^[¥￥]\s*((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)$/);
  const value = match ? Number(match[1].replaceAll(',', '')) : NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 1000000) throw htmlFailure();
  return value;
};

// A public single-product checkout can carry complete price evidence without
// a separate detail URL. Read only the selected plan and the matching order
// summary; contact-only promotions, order APIs and payment data are not offers.
export function parsePublicSinglePlan(html, target, capturedAt) {
  const doc = readHtml(html);
  const bodies = doc.all.filter(node => node.tag === 'body' && node.attrs['data-page'] === 'shop' && node.attrs['data-product-id']);
  if (!bodies.length || !doc.all.some(node => node.attrs.id === 'plans' && hasClass(node, 'plan-panel'))) return null;
  const body = one(bodies), id = body.attrs['data-product-id'];
  if (!/^[1-9]\d{0,9}$/.test(id) || body.attrs['data-order-no'] !== '') throw htmlFailure();
  const plans = one(doc.all.filter(node => node.attrs.id === 'plans' && hasClass(node, 'plan-panel')));
  const plan = one(descendants(plans).filter(node => hasClass(node, 'plan')));
  if (!hasClass(plan, 'selected')) throw htmlFailure();
  const copy = one(descendants(plan).filter(node => hasClass(node, 'plan-copy')));
  const heading = one(descendants(copy).filter(node => node.tag === 'h3'));
  const stem = htmlText(heading.parts.filter(part => typeof part === 'string' || !hasClass(part, 'pill')).map(part => typeof part === 'string' ? part : text(part)).join(' '));
  const duration = text(one(descendants(copy).filter(node => hasClass(node, 'plan-duration')))).replace(/^有效期\s*/, '');
  if (!stem || !/^\d+\s*(?:天|周|个月|月|年)$/.test(duration)) throw htmlFailure();
  const price = money(one(descendants(plan).filter(node => hasClass(node, 'price'))));
  const summary = one(doc.all.filter(node => node.tag === 'dl' && hasClass(node, 'order-details')));
  const fields = new Map();
  for (const row of summary.children) {
    const labels = descendants(row).filter(node => node.tag === 'dt');
    const values = descendants(row).filter(node => node.tag === 'dd');
    if (labels.length !== 1 || values.length !== 1 || fields.has(text(labels[0]))) throw htmlFailure();
    fields.set(text(labels[0]), values[0]);
  }
  const name = text(fields.get('商品名称'));
  if (compact(name) !== compact(stem + '(' + duration + ')') || !fields.has('应付金额') || money(fields.get('应付金额')) !== price) throw htmlFailure();
  const button = one(doc.all.filter(node => node.tag === 'button' && node.attrs.id === 'create-order'));
  const soldOut = /售罄|缺货|无货/.test(text(button));
  if ('disabled' in button.attrs && !soldOut) throw htmlFailure();
  if (!soldOut && !/创建订单/.test(text(button))) throw htmlFailure();
  const notes = doc.all.filter(node => hasClass(node, 'payment-footnote') || node.attrs.id === 'notices');
  const description = [text(copy), ...notes.map(text)].join('\n');
  const evidence = deliveryEvidence({ productTitle: name, description, descriptionScope: 'product' });
  return [{ offerId: `${target.id}:single-plan:${id}`, sourceId: target.id, sourceName: target.name, storeName: target.name,
    title: name, price, listedPrice: price, priceBasis: 'listed', currency: 'CNY', url: target.origin + '/', capturedAt,
    status: soldOut ? 'out_of_stock' : 'available', stockCount: soldOut ? 0 : null,
    extra: { deliveryEvidence: evidence, publicDescription: description,
      priceEvidence: '公开套餐标价与同页订单应付金额一致', stockEvidence: soldOut ? '购买按钮标明售罄或缺货' : '公开页面提供可用下单按钮；未声明库存数量',
      catalogFormat: 'public-single-plan', collectionMethod: 'visible-product' } }];
}
