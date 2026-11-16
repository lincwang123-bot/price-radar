import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { projectProduct, productQuoteGroups, quoteSeries } from './quote-policy.mjs';
import { retentionFlags } from './offer-history-read.mjs';
import { offerChannel, filterFramework } from './channels.mjs';

const snapshotSql = 'SELECT p.*,s.fetched_at,s.generated_at,s.published_at,s.stale FROM products p JOIN snapshots s ON s.source=p.source AND s.snapshot_id=p.snapshot_id WHERE p.source=? AND p.product_id=? AND (? IS NULL OR s.fetched_at>=?) ORDER BY s.fetched_at DESC,s.rowid DESC LIMIT ?';

// Only public pricing tables are copied. For file databases this runs entirely
// inside the worker; in-memory databases can supply the same bounded input.
function* historyInputRows(db, params, { maxOffers = 50000, maxInputBytes = 64 * 1024 * 1024 } = {}) {
  const snapshots = db.prepare(snapshotSql).all(params.source, params.productId, params.since || null, params.since || null, params.limit).reverse();
  let offersRead = 0, bytes = 0;
  const measure = value => {
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > maxInputBytes) throw new Error('History input exceeds its byte budget');
  };
  const statement = db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? AND product_id=? ORDER BY price ASC LIMIT ?');
  for (const snapshot of snapshots) {
    measure(snapshot);
    const offers = [];
    for (const offer of statement.iterate(params.source, snapshot.snapshot_id, params.productId, Math.max(1, maxOffers - offersRead + 1))) {
      if (++offersRead > maxOffers) throw new Error('History input exceeds its offer budget');
      measure(offer);
      offers.push(offer);
    }
    yield { snapshot, offers };
  }
}

export function readQuoteHistoryInput(db, params, limits) {
  return [...historyInputRows(db, params, limits)];
}

export function projectQuoteHistoryInput(input, params) {
  return input.map(({ snapshot, offers: raw }) => {
    const offers = filterFramework(raw.filter(offer => !params.channel || params.channel === 'all' || offerChannel(offer).id === params.channel), params.framework);
    // historical:true and provided offers keep this projection independent of
    // live health/private databases while preserving quoteSeries semantics.
    const product = projectProduct(null, params.source, snapshot, snapshot, { historical: true, offers });
    const selected = params.comparisonKey ? productQuoteGroups(product).find(group => group.comparison_key === params.comparisonKey) : product;
    const point = selected || { lowest_price: null, in_stock_count: 0, offer_count: 0, comparable: false };
    return {
      snapshot_id: snapshot.snapshot_id,
      fetched_at: snapshot.fetched_at,
      lowest_price: point.lowest_price ?? null,
      currency: selected ? selected.currency ?? null : snapshot.currency ?? null,
      comparable: point.comparable,
      comparison_key: point.comparison_key,
      in_stock_count: point.in_stock_count,
      offer_count: point.offer_count,
    };
  });
}

if (parentPort && workerData?.quoteHistoryWorker) {
  let db;
  try {
    if (workerData?.dbPath) {
      db = new DatabaseSync(workerData.dbPath, { readOnly: true });
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
    }
    parentPort.on('message', ({ id, params, input, limits }) => {
      try {
        let rows;
        if (db) {
          const flags = retentionFlags(db);
          if (flags.cutoff || flags.dedupe) {
            // 瘦身打开后与 quoteSeries 同一条路径，窗口外改接 K 线。
            rows = quoteSeries(db, params).slice(-params.limit).map(point => ({
              snapshot_id: point.snapshot_id ?? null,
              fetched_at: point.fetched_at,
              lowest_price: point.lowest_price ?? null,
              currency: point.currency ?? null,
              comparable: point.comparable,
              comparison_key: point.comparison_key,
              in_stock_count: point.in_stock_count,
              offer_count: point.offer_count,
            }));
          } else {
            rows = [];
            // 未瘦身时仍逐个快照投影，避免一次拿住整段原始报价。
            for (const value of historyInputRows(db, params, limits)) rows.push(...projectQuoteHistoryInput([value], params));
          }
        } else rows = projectQuoteHistoryInput(input, params);
        parentPort.postMessage({ id, status: 'ready', rows });
      } catch {
        parentPort.postMessage({ id, status: 'unavailable', rows: [] });
      }
    });
    parentPort.on('close', () => { try { db?.close(); } catch {} });
  } catch {
    try { db?.close(); } catch {}
    parentPort.close();
  }
}
