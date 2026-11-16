import { openDb, storeSnapshot, productsOfSnapshot } from './db.mjs';
import { groupDirectOffers, directOfferExclusionReason, classifyDirectOffer } from '../collectors/direct/catalog.mjs';
import { projectProduct } from './quote-policy.mjs';
import { buildProductDirectory, directoryQuotes } from './product-directory.mjs';
import { isListed } from './market-view.mjs';
import { safeMerchantUrl } from './outbound.mjs';
import { MAX_MERCHANT_QUOTE_DIAGNOSTIC_ITEMS, normalizeMerchantQuoteDiagnostics } from './merchant-quote-diagnostics.mjs';

function diagnoseOffers(offers, products, entries, list) {
  const seen = new Set();
  const projected = new Map(products.flatMap(product => product.offers.map(offer => [offer.offer_id, {product, offer}])));
  const published = new Set(entries.map(entry => entry.offer.offer_id));
  const items = offers.slice(0, MAX_MERCHANT_QUOTE_DIAGNOSTIC_ITEMS).map((raw, index) => {
    // Follow the actual grouping order. A rejected earlier row does not consume
    // its ID; in particular an out-of-stock duplicate cannot hide a valid row.
    let code = directOfferExclusionReason(raw);
    if (!code && !raw?.offerId) code = 'invalid_offer_id';
    if (!code && seen.has(raw.offerId)) code = 'duplicate_offer';
    if (!code && (!Number.isFinite(Number(raw?.price)) || Number(raw.price) <= 0)) code = 'invalid_price';
    if (!code) {
      try { if (!['http:', 'https:'].includes(new URL(String(raw.url)).protocol)) code = 'invalid_url'; }
      catch { code = 'invalid_url'; }
    }
    if (!code && !classifyDirectOffer(raw)) code = 'classification_unmatched';
    // Run the real grouping function as well: a future grouping rule must not
    // silently acquire a guessed explanation from this bounded diagnostic path.
    if (!code && !groupDirectOffers([raw]).length) code = 'grouping_rejected';
    if (!code) {
      seen.add(raw.offerId);
      const row = projected.get(String(raw.offerId));
      if (!row) code = 'projection_rejected';
      else if (row.offer.quote_stale && !row.offer.quote_retained) code = 'quote_stale';
      else if (!isListed(row.offer)) code = 'inventory_unconfirmed';
      else if (!safeMerchantUrl(row.offer.url)) code = 'unsafe_url';
      else {
        // Single-row directory projection distinguishes a real directory rule
        // failure from cross-row deduplication, without cloning those rules.
        const single = buildProductDirectory([{...list, products: [{...row.product, offers: [row.offer]}]}]);
        const eligible = single.some(category => category.products.some(product => directoryQuotes(product,{pricing_type:'all'}).entries.some(entry => !entry.reference)));
        if (!eligible) code = 'directory_rule_rejected';
        else if (!published.has(row.offer.offer_id)) code = 'duplicate_quote';
      }
    }
    return {index, reasonCodes: code ? [code] : []};
  });
  return normalizeMerchantQuoteDiagnostics({schemaVersion: 1, rawCount: offers.length, validCount: entries.length,
    items, truncated: offers.length > MAX_MERCHANT_QUOTE_DIAGNOSTIC_ITEMS});
}

// Use the same inventory, warranty, classification, freshness and deduplication
// rules as the public directory, in an isolated database that is never published.
export function summarizeMerchantOffers(offers, { now = Date.now() } = {}) {
  const db = openDb(':memory:');
  try {
    const fetchedAt = new Date(now).toISOString();
    const snapshot = { source: 'direct-shops', snapshotId: 'merchant-preview', fetchedAt, products: groupDirectOffers(offers) };
    storeSnapshot(db, snapshot);
    const row = { snapshot_id: snapshot.snapshotId, fetched_at: fetchedAt, stale: 0 };
    const products = productsOfSnapshot(db, snapshot.source, snapshot.snapshotId).map(product => projectProduct(db, snapshot.source, row, product, { now }));
    const list = { source: snapshot.source, snapshotId: snapshot.snapshotId, fetchedAt, products };
    const directory = buildProductDirectory([list]);
    const entries = directory.flatMap(category => category.products.flatMap(product => directoryQuotes(product,{pricing_type:'all'}).entries.filter(entry => !entry.reference)));
    const samples = entries.slice(0, 5).map(({ offer, product }) => ({
      title: String(offer.title || product.name || '商品').slice(0, 300),
      price: Number(offer.price), currency: offer.currency || product.currency,
      url: String(offer.url),
    }));
    return { rawCount: offers.length, validCount: entries.length, samples, diagnostics: diagnoseOffers(offers, products, entries, list) };
  } finally { db.close(); }
}
