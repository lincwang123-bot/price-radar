import { openDb, storeSnapshot, productsOfSnapshot } from './db.mjs';
import { groupDirectOffers } from '../collectors/direct/catalog.mjs';
import { projectProduct } from './quote-policy.mjs';
import { buildProductDirectory, directoryQuotes } from './product-directory.mjs';

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
    const directory = buildProductDirectory([{ source: snapshot.source, snapshotId: snapshot.snapshotId, fetchedAt, products }]);
    const entries = directory.flatMap(category => category.products.flatMap(product => directoryQuotes(product).entries.filter(entry => !entry.reference)));
    const samples = entries.slice(0, 5).map(({ offer, product }) => ({
      title: String(offer.title || product.name || '商品').slice(0, 300),
      price: Number(offer.price), currency: offer.currency || product.currency,
      url: String(offer.url),
    }));
    return { rawCount: offers.length, validCount: entries.length, samples };
  } finally { db.close(); }
}
