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

export const MERCHANT_BADGE_CSS = '.merchant-verified{display:inline-block;vertical-align:middle;margin:4px 0 4px 8px;padding:3px 8px;border:1px solid #d7e0e5;border-radius:6px;background:#f5f7f8;color:#566670;font:500 12px/1.6 system-ui,sans-serif;white-space:nowrap}.directory-quote-main h2 .merchant-verified{letter-spacing:0}';
