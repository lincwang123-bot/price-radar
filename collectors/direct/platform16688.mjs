import { safeFetchJson } from '../../lib/safe-fetch.mjs';
import { directOfferExclusionReason } from './catalog.mjs';

// Verified 2026-09-06 from existing public /goods/G… links, then the public
// goods/detail response. No shop-number enumeration or authenticated APIs.
export const PLATFORM16688_SHOPS = Object.freeze([
  ['S937885', '52XUEAI', 'G29719488'],
  ['S134923', '66AI小铺', 'G85815217'],
  ['S159512', '91TOPGO', 'G65106678'],
  ['S799620', 'A1gmail', 'G39427834'],
  ['S166169', 'AI咕咕嘎嘎【直充源头】', 'G10064336'],
  ['S205325', 'AI奥特曼|代充源头招代理', 'G13465107'],
  ['S526627', 'AI批发', 'G42991898'],
  ['S686646', 'AI源头', 'G48579114'],
  ['S943903', 'AI练习生', 'G23269024'],
  ['S909910', 'CodexTool', 'G88018639'],
  ['S848708', 'GiPiTa 菲区源头', 'G42128095'],
  ['S790246', 'Jin AI', 'G95299070'],
  ['S311799', 'KFC卡网', 'G44611111'],
  ['S366907', 'QX店铺', 'G79957618'],
  ['S500101', 'gmd', 'G62011389'],
  ['S104052', '一梦AI货源', 'G15302520'],
  ['S424005', '冷热lab', 'G48647801'],
  ['S605033', '北橘号铺', 'G37854191'],
  ['S358780', '千羽ai批发', 'G22076118'],
  ['S552918', '华润ai', 'G36253221'],
  ['S677698', '大个儿', 'G96216428'],
  ['S620172', '奥特曼直营', 'G50346588'],
  ['S802470', '奥特曼直销', 'G59316673'],
  ['S551641', '星穹铁路', 'G14120763'],
  ['S158155', '格洛克Ai', 'G59334544'],
  ['S343514', '派大星', 'G28696469'],
  ['S301156', '浅梦杂货铺', 'G76621552'],
  ['S231625', '皮特小铺', 'G11162208'],
  ['S428748', '萃选ai', 'G88462961'],
  ['S301515', '蜡笔小新', 'G57094210'],
  // Additional seeds from the original platform's public /source directory,
  // validated through retail goods/detail and shop/detail, not wholesale price.
  ['S686505', '安安 对接：ANANHT', 'G33156626', 'https://www.16688.com.cn/source'],
  ['S542868', '一苇的ai小铺', 'G63667678', 'https://www.16688.com.cn/source'],
  ['S995876', '鹰鹰小铺', 'G13677689', 'https://www.16688.com.cn/source'],
  ['S763680', '小高老板娘的店', 'G78548110', 'https://www.16688.com.cn/source'],
  ['S513295', '源头AI - Bot | 对接：team', 'G95118424', 'https://www.16688.com.cn/source'],
  ['S888822', '带鱼ai', 'G69292311', 'https://www.16688.com.cn/source'],
  ['S361816', 'AI充值', 'G70554833', 'https://www.16688.com.cn/source'],
].map(([shopNo, name, seed, discoveryUrl]) => Object.freeze({
  id: `16688-${shopNo.toLowerCase()}`, kind: 'platform16688', name, shopNo,
  origin: 'https://www.16688.com.cn', currency: 'CNY',
  seedUrl: `https://16688.com.cn/goods/${seed}`,
  ...(discoveryUrl ? { discoveryUrl } : {}),
})));

function sourceFor(target) {
  const source = PLATFORM16688_SHOPS.find(s => s.id === target?.id && s.shopNo === target?.shopNo);
  if (!source || target.origin !== source.origin) throw new Error('16688 未登记店铺');
  return source;
}

function timestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error('16688 capturedAt 无效');
  return value;
}

export function parse16688Goods(payload, target, capturedAt = new Date().toISOString()) {
  const source = sourceFor(target);
  timestamp(capturedAt);
  if (Number(payload?.code) !== 1 || !Array.isArray(payload?.data?.list)) {
    throw new Error(`16688 目录失败: ${String(payload?.msg ?? '缺少 data.list').slice(0,120)}`);
  }
  // The public shop frontend retrieves one unpaginated list. Never publish an
  // oversized or explicitly incomplete response as a complete snapshot.
  const list = payload.data.list;
  if (list.length > 1000 || (payload.data.total != null && Number(payload.data.total) > list.length)) {
    throw new Error('16688 目录超限或不完整');
  }
  const seen = new Set();
  return list.flatMap(item => {
    if (!/^G\d+$/.test(item?.goods_no ?? '') || seen.has(item.goods_no)) return [];
    const title = String(item.name ?? '').replace(/\s+/g, ' ').trim();
    const price = item.price === '' || item.price == null ? NaN : Number(item.price);
    if (!title || !Number.isFinite(price) || price <= 0) return [];
    const description = String(item.description ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (directOfferExclusionReason({ title: description }) === 'no_warranty') return [];
    if (item.shop_no && item.shop_no !== source.shopNo) throw new Error('16688 店铺身份不匹配');
    seen.add(item.goods_no);
    const rawCount = item.stock_available_quantity;
    const number = rawCount == null || rawCount === '' ? NaN : Number(rawCount);
    const count = Number.isSafeInteger(number) && number >= 0 ? number : null;
    const state = String(item.stock_available_status ?? '').toLowerCase();
    // Explicit sold-out takes precedence even when upstream quantities conflict.
    const status = state === 'out' || count === 0 ? 'out_of_stock'
      : state === 'low' ? 'low_stock'
      : count > 0 || ['normal', 'high'].includes(state) ? 'in_stock' : 'unknown';
    return [{
      offerId: `${source.id}:${item.goods_no}`, sourceId: source.id,
      sourceName: '16688', storeName: String(target.name || source.name), title,
      price, listedPrice: price, feeAmount: null, priceBasis: 'listed', currency: 'CNY',
      status, stockCount: status === 'out_of_stock' ? 0 : count,
      url: `${source.origin}/goods/${item.goods_no}`, capturedAt, expiresAt: null,
      extra: { shopNo: source.shopNo, shopUrl: `${source.origin}/shop/${source.shopNo}` },
    }];
  });
}

export async function collect16688(target, options = {}) {
  const source = sourceFor(target);
  const payload = await safeFetchJson(`${source.origin}/shopApi/goods/list`, {
    allowedOrigins: [source.origin], allowedMethods: ['POST'], method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_no: source.shopNo, goods_category_no: '', keywords: '', sort: 'default' }),
    fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? 15000,
    maxBytes: options.maxBytes ?? 4 * 1024 * 1024, maxRedirects: 0,
  });
  return parse16688Goods(payload, target, options.capturedAt ?? new Date().toISOString());
}
