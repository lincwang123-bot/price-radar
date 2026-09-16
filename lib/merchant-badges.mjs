import { merchantIdentityForOffer } from './merchant-identity.mjs';

// Public copy describes listing only; private ownership checks and approval gates stay unchanged.
export function merchantBadgeForOffer(offer, approved = []) {
  const identity = merchantIdentityForOffer(offer);
  if (!identity || !Array.isArray(approved) || !approved.some(row => row.identity === identity && row.identityVerifiedAt)) return '';
  return '<span class="merchant-verified" title="仅表示店铺信息已收录，不代表商家信用、商品质量或交易安全保证">店铺已收录</span>';
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
