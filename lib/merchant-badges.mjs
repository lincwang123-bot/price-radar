import { merchantIdentityForOffer } from './merchant-identity.mjs';

// Ownership is separate from price provenance, paid placement and transaction safety.
export function merchantBadgeForOffer(offer, approved = []) {
  const identity = merchantIdentityForOffer(offer);
  if (!identity || !Array.isArray(approved) || !approved.some(row => row.identity === identity && row.identityVerifiedAt)) return '';
  return '<span class="merchant-verified" title="站长已核验店铺经营身份和公开采集授权；不代表交易担保或商品质量保证">店主已核验</span>';
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

export const MERCHANT_BADGE_CSS = '.merchant-verified{display:inline-block;vertical-align:middle;margin:4px 0 4px 8px;padding:3px 8px;border:1px solid #bedacf;border-radius:6px;background:#f0f7f3;color:#28614c;font:600 12px/1.6 system-ui,sans-serif;white-space:nowrap}.directory-quote-main h2 .merchant-verified{letter-spacing:0}';
