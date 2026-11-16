import { merchantIdentityForOffer } from './merchant-identity.mjs';

// Public verification reflects SMS records, never legacy identity review.
export function merchantBadgeForOffer(offer, approved = []) {
  const identity = merchantIdentityForOffer(offer);
  const merchant = identity && Array.isArray(approved) && approved.find(row => row.identity === identity && row.approvedAt);
  if (!merchant) return '';
  if (merchant.phoneVerifiedAt && Number.isFinite(Date.parse(merchant.phoneVerifiedAt))) return '<span class="merchant-verified" title="仅表示当时能接收已保存中国大陆手机号的短信，便于联系核对；不代表官方授权、信誉背书、商品质量保证或交易担保">已验证商家</span>';
  return '<span class="merchant-verified" title="仅表示店铺信息已收录，不代表官方授权、信誉背书、商品质量保证或交易担保">店铺已收录</span>';
}

export function merchantApplicationHref(offer = {}) {
  const identity = merchantIdentityForOffer(offer);
  let shopUrl = '';
  if (identity) {
    const extra = typeof offer.extra === 'string' ? JSON.parse(offer.extra) : offer.extra || {};
    shopUrl = identity.startsWith('domain:') ? new URL(offer.url).origin : extra.shopUrl || '';
  }
  return '/submit-shop?' + new URLSearchParams({shop:offer.store_name || '',url:shopUrl});
}

export const MERCHANT_BADGE_CSS = '.merchant-verified,.offer-title .merchant-verified{display:inline-block;vertical-align:middle;margin:0 0 0 7px;padding:2px 7px;border:1px solid #bfe6cc;border-radius:999px;background:#ecfdf3;color:#16713a;font:500 12px/1.5 system-ui,sans-serif;white-space:nowrap;letter-spacing:0}.offer-title>strong{overflow-wrap:anywhere}';
