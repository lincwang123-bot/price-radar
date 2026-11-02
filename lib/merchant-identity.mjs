const blocked = new Set(['cardnav.xyz','goaihop.com','relaywatch.online']);

// Confirmed public ShopApi mirrors of wzyp.cn. /shop/<token> is the same storefront.
// Comments and docs name catfk.com; no other mirror host is confirmed in this repo.
const WZYP_MIRROR_HOSTS = new Set(['wzyp.cn', 'catfk.com']);
const LDXP_HOSTS = new Set(['ldxp.cn', 'pay.ldxp.cn']);
const PLATFORM_16688 = new Set(['16688.com.cn']);
const RESERVED_SHOP_TOKEN = /^(?:shop|goods|item|product|products|login|register|admin|api|shopApi|account|order|orders|user|search|category|about|help|favicon|robots|sitemap)$/i;

function bareHostname(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

// null: not a single shop path. {reserved:true}: a platform word, not a merchant.
// {token}: the public shop id used by ShopApi.
export function shopPathToken(pathname) {
  const match = String(pathname || '').match(/^\/(?:shop\/)?([A-Za-z0-9_-]{1,100})\/?$/);
  if (!match) return null;
  if (RESERVED_SHOP_TOKEN.test(match[1])) return { reserved: true };
  return { token: match[1] };
}

export function isWzypMirrorHost(host) {
  return WZYP_MIRROR_HOSTS.has(bareHostname(host));
}

function platformKind(host) {
  const bare = bareHostname(host);
  if (PLATFORM_16688.has(bare)) return '16688';
  if (WZYP_MIRROR_HOSTS.has(bare)) return 'wzyp';
  if (bare === 'pay.ldxp.cn') return 'ldxp-pay';
  if (LDXP_HOSTS.has(bare)) return 'ldxp';
  return null;
}

export function merchantIdentityForUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const kind = platformKind(host);
    if (kind === '16688') {
      const match = url.pathname.match(/^\/shop\/(S\d{1,20})\/?$/);
      return match ? `shop:16688:${match[1]}` : null;
    }
    if (kind) {
      const parsed = shopPathToken(url.pathname);
      return parsed?.token ? `shop:${kind}:${parsed.token}` : null;
    }
    return blocked.has(bareHostname(host)) ? null : `domain:${host}`;
  } catch { return null; }
}

// Shared-platform evidence must come from our own collector, never third-party
// payload extra. Independent domains retain exact hostname identity.
// wzyp mirrors may cite each other: collection canonicalizes the API origin to
// wzyp.cn while the application keeps the mirror shop URL.
export function merchantIdentityForOffer(offer = {}) {
  try {
    const url = new URL(offer.url);
    let extra = typeof offer.extra === 'string' ? JSON.parse(offer.extra) : offer.extra || {};
    const host = url.hostname.toLowerCase();
    const offerKind = platformKind(host);
    if (offerKind) {
      if (offer.source !== 'direct-shops') return null;
      const identity = merchantIdentityForUrl(extra.shopUrl);
      if (!identity) return null;
      const shopHost = bareHostname(new URL(extra.shopUrl).hostname);
      const offerHost = bareHostname(host);
      const sameWzypMirror = identity.startsWith('shop:wzyp:') && isWzypMirrorHost(shopHost) && isWzypMirrorHost(offerHost);
      if (shopHost !== offerHost && !sameWzypMirror) return null;
      if (identity.startsWith('shop:16688:') && identity !== `shop:16688:${extra.shopNo}`) return null;
      return identity;
    }
    return merchantIdentityForUrl(offer.url);
  } catch { return null; }
}
