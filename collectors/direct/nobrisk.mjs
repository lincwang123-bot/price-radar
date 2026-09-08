import { setTimeout as delay } from 'node:timers/promises';
import { collectKami } from './kami.mjs';
import { safeFetchText } from '../../lib/safe-fetch.mjs';
import { deliveryEvidence } from '../../lib/delivery-evidence.mjs';

const ORIGIN = 'https://shop.nobrisk.com';
const invalid = () => { throw new Error('BriskAI 商品详情与公开目录不一致'); };

export function enrichNobriskOffer(offer, html) {
  const title = deliveryEvidence({ productTitle: html.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] }).productTitle;
  let item;
  try { item = JSON.parse(html.match(/setVar\("_var_item",(\{[^\n]*?\})\);/)?.[1]); } catch { invalid(); }
  const description = html.match(/class="[^"]*\bitem-detail\b[^"]*">[\s\S]*?class="panel-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/main>/i)?.[1];
  if (title !== offer.title || String(item.id) !== offer.offerId.split(':')[1] || item.name !== title || !description) invalid();
  // This exact storefront paragraph lists causes of account bans. Its mention
  // of account sharing describes prohibited usage, not the delivered product.
  // Keep every other paragraph, including warranty and renewal conditions.
  const deliveryDescription = description.replace(/<p\b[^>]*>[^<]*常见封号原因[\s\S]*?<\/p>/gi, '');
  return { ...offer, price: offer.listedPrice,
    extra: { ...offer.extra, publicUserPrice: offer.price, priceEvidence: '公开目录 price 挂牌价；不使用会员 user_price 作为起价',
      publicDescription: deliveryEvidence({ description }).description,
      deliveryEvidence: deliveryEvidence({ productTitle: title, category: offer.category,
        description: deliveryDescription, descriptionScope: 'product' }) } };
}

export async function collectNobrisk(target, options = {}) {
  if (target?.id !== 'nobrisk' || target?.origin !== ORIGIN || target?.endpoint !== '/user/api/index/commodity') {
    throw new Error('BriskAI 目标未登记');
  }
  const offers = await collectKami(target, options);
  // Apple ID and virtual cards are not AI subscriptions even when their titles
  // mention GPT as a possible use. Do not publish them in an AI price group.
  const selected = offers.filter(offer => offer.category === 'AI工具');
  const active = selected.filter(offer => offer.status !== 'out_of_stock');
  if (active.length > 20) throw new Error('BriskAI 商品详情超过本轮读取上限');
  const result = [];
  for (const offer of selected) {
    if (offer.status === 'out_of_stock') { result.push(offer); continue; }
    await (options.sleep ?? delay)(Math.max(500, Math.min(60000, Number(options.requestDelayMs) || 500)));
    const html = await safeFetchText(offer.url, { allowedOrigins: [ORIGIN], fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs ?? 15000, maxBytes: 512 * 1024, maxRedirects: 0 });
    result.push(enrichNobriskOffer(offer, html));
  }
  return result;
}
