// 只读辅助：报价走势在明细还在时走原快照，明细被清掉后改读 K 线。
// 不导入 quote-policy，避免和投影逻辑循环依赖。

const FLAGS_SQL = "SELECT key, value FROM meta WHERE key IN ('offer_detail_before','offer_dedupe_active','offer_candle_hours')";

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  } catch {
    return false;
  }
}

export function retentionFlags(db) {
  try {
    const rows = db.prepare(FLAGS_SQL).all();
    const map = Object.fromEntries(rows.map(row => [row.key, row.value]));
    const hours = Math.floor(Number(map.offer_candle_hours) || 4);
    return {
      cutoff: map.offer_detail_before || null,
      dedupe: map.offer_dedupe_active === '1' && tableExists(db, 'offer_compacted'),
      candleHours: [1, 2, 3, 4, 6, 8, 12, 24].includes(hours) ? hours : 4,
      candles: tableExists(db, 'offer_candle'),
      points: tableExists(db, 'offer_snapshot_point'),
    };
  } catch {
    return { cutoff: null, dedupe: false, candleHours: 4, candles: false, points: false };
  }
}

export function isPartialSnapshot(db, source, snapshotId) {
  try {
    return !!db.prepare('SELECT 1 FROM offer_compacted WHERE source=? AND snapshot_id=? AND partial=1').get(source, snapshotId);
  } catch {
    return false;
  }
}

export function snapshotHasDetail(db, source, snapshotId) {
  try {
    if (db.prepare('SELECT 1 FROM offers WHERE source=? AND snapshot_id=? LIMIT 1').get(source, snapshotId)) return true;
    if (tableExists(db, 'offer_snapshot_point') && db.prepare('SELECT 1 FROM offer_snapshot_point WHERE source=? AND snapshot_id=? LIMIT 1').get(source, snapshotId)) return true;
  } catch { /* 旧库没有这些表时，调用方继续走原始报价。 */ }
  return false;
}

export function productLevelPoint(db, source, snapshotId, productId) {
  try {
    const row = db.prepare("SELECT * FROM offer_snapshot_point WHERE source=? AND snapshot_id=? AND product_id=? AND comparison_key=''").get(source, snapshotId, productId);
    if (!row) return null;
    return {
      lowest_price: row.lowest_price,
      currency: row.currency,
      comparable: !!row.comparable,
      comparison_key: row.series_key || row.comparison_key,
      in_stock_count: row.in_stock_count,
      offer_count: row.offer_count,
      granularity: 'snapshot',
    };
  } catch {
    return null;
  }
}

export function snapshotSeriesPoint(db, source, snapshot, productId, comparisonKey) {
  const key = comparisonKey || '';
  try {
    const row = db.prepare('SELECT * FROM offer_snapshot_point WHERE source=? AND snapshot_id=? AND product_id=? AND comparison_key=?').get(source, snapshot.snapshot_id, productId, key);
    if (!row) {
      return {
        ...snapshot,
        lowest_price: null,
        comparable: false,
        comparison_key: comparisonKey || null,
        in_stock_count: 0,
        offer_count: 0,
        granularity: 'snapshot',
      };
    }
    return {
      ...snapshot,
      lowest_price: row.lowest_price,
      currency: row.currency ?? snapshot.currency ?? null,
      comparable: !!row.comparable,
      comparison_key: row.series_key || row.comparison_key || comparisonKey || null,
      in_stock_count: row.in_stock_count,
      offer_count: row.offer_count,
      granularity: 'snapshot',
    };
  } catch {
    return null;
  }
}

export function candleSeriesPoints(db, { source, productId, comparisonKey, since, before, hours = 4 }) {
  if (!tableExists(db, 'offer_candle')) return [];
  const key = comparisonKey || '';
  const span = Math.floor(Number(hours) || 4);
  const rows = db.prepare(
    `SELECT * FROM offer_candle
     WHERE source=? AND product_id=? AND comparison_key=? AND hours=?
       AND (? IS NULL OR last_at>=?)
       AND (? IS NULL OR last_at<?)
     ORDER BY bucket_start ASC`
  ).all(source, productId, key, span, since || null, since || null, before || null, before || null);
  return rows.map(row => ({
    fetched_at: row.last_at,
    generated_at: null,
    snapshot_id: null,
    bucket_start: row.bucket_start,
    lowest_price: row.price_close,
    price_open: row.price_open,
    price_low: row.price_low,
    price_high: row.price_high,
    price_close: row.price_close,
    currency: row.currency,
    comparable: !!row.comparable,
    comparison_key: row.series_key || row.comparison_key || null,
    in_stock_count: row.in_stock_close,
    offer_count: row.offer_count_close,
    stock_status: row.stock_status,
    granularity: `${row.hours}h`,
    observations: row.observations,
  }));
}
