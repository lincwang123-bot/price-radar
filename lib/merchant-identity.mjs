const blocked = new Set(['priceai.cc','data.priceai.cc','cardnav.xyz','goaihop.com','relaywatch.online']);
export function merchantIdentityForUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (['16688.com.cn','www.16688.com.cn'].includes(host)) {
      const match = url.pathname.match(/^\/shop\/(S\d{1,20})\/?$/);
      return match ? `shop:16688:${match[1]}` : null;
    }
    if (['wzyp.cn','www.wzyp.cn','ldxp.cn','www.ldxp.cn'].includes(host)) {
      const match = url.pathname.match(/^\/(?:shop\/)?([a-zA-Z0-9_-]{1,100})\/?$/);
      return match && !/^(?:shop|goods|item|product|products|login|register|admin|api|shopApi|account|order|orders|user|search|category|about|help|favicon|robots|sitemap)$/i.test(match[1]) ? `shop:${host.includes('wzyp')?'wzyp':'ldxp'}:${match[1]}` : null;
    }
    return blocked.has(host.replace(/^www\./,'')) ? null : `domain:${host}`;
  } catch { return null; }
}

// Shared-platform evidence must come from our own collector, never third-party
// payload extra. Independent domains retain exact hostname identity.
export function merchantIdentityForOffer(offer = {}) {
  try {
    const url = new URL(offer.url);
    let extra = typeof offer.extra === 'string' ? JSON.parse(offer.extra) : offer.extra || {};
    const host = url.hostname.toLowerCase();
    if (['16688.com.cn','www.16688.com.cn','wzyp.cn','www.wzyp.cn','ldxp.cn','www.ldxp.cn'].includes(host)) {
      if (offer.source !== 'direct-shops') return null;
      const identity = merchantIdentityForUrl(extra.shopUrl);
      if (!identity) return null;
      const shopHost = new URL(extra.shopUrl).hostname.replace(/^www\./,'');
      if (shopHost !== host.replace(/^www\./,'')) return null;
      if (identity.startsWith('shop:16688:') && identity !== `shop:16688:${extra.shopNo}`) return null;
      return identity;
    }
    return merchantIdentityForUrl(offer.url);
  } catch { return null; }
}
