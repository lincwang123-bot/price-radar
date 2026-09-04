import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

// 零依赖 SQLite（Node >= 22 内置 node:sqlite）。实验特性会打一行 stderr 警告，可接受；
// 也可用 node --disable-warning=ExperimentalWarning 运行来消除。

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 每个源每次成功拉取的快照登记（快照本身做产品/报价明细落库）
CREATE TABLE IF NOT EXISTS snapshots (
  source        TEXT NOT NULL,
  snapshot_id   TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,   -- 本地抓取时间 ISO
  generated_at  TEXT,            -- 源侧生成时间
  published_at  TEXT,
  stale         INTEGER NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  offer_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, snapshot_id)
);

-- 每个快照下的产品维度（含该产品全局最低价）
CREATE TABLE IF NOT EXISTS products (
  source         TEXT NOT NULL,
  snapshot_id    TEXT NOT NULL,
  product_id     TEXT NOT NULL,
  name           TEXT,
  platform       TEXT,
  product_type   TEXT,
  spec           TEXT,
  lowest_price   REAL,
  currency       TEXT,
  offer_count    INTEGER NOT NULL DEFAULT 0,
  in_stock_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, snapshot_id, product_id)
);

-- 每个快照下的报价明细（offer 展开）
CREATE TABLE IF NOT EXISTS offers (
  source       TEXT NOT NULL,
  snapshot_id  TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  offer_id     TEXT NOT NULL,
  source_id    TEXT,
  source_name  TEXT,
  store_name   TEXT,
  title        TEXT,
  price        REAL,
  currency     TEXT,
  status       TEXT,        -- 源侧原始状态
  stock_count  REAL,
  url          TEXT,
  captured_at  TEXT,
  expires_at   TEXT,
  extra        TEXT,        -- JSON：源特有字段（如可用性指标）
  PRIMARY KEY (source, snapshot_id, product_id, offer_id)
);

CREATE INDEX IF NOT EXISTS idx_products_time
  ON products (source, product_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_offers_prod
  ON offers (source, product_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_offers_snap
  ON offers (source, snapshot_id);

-- 盯盘规则的去重状态
CREATE TABLE IF NOT EXISTS rule_state (
  rule_key   TEXT PRIMARY KEY,
  state      TEXT,          -- JSON
  updated_at TEXT
);

-- 告警历史
CREATE TABLE IF NOT EXISTS alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  source       TEXT,
  product_id   TEXT,
  product_name TEXT,
  rule_id      TEXT,
  kind         TEXT,
  message      TEXT
);
`;

export function openDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  // 兼容旧库：offers.extra 列（供 goaihop 等源的可用性指标）
  try {
    db.exec("ALTER TABLE offers ADD COLUMN extra TEXT");
  } catch { /* 已存在则忽略 */ }
  return db;
}

/** Web 查询专用连接：文件和 SQLite 两层都禁止写入。 */
export function openDbReadOnly(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

export function metaGet(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}
export function metaSet(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

/**
 * 把一次规范化的源快照写入库（幂等：同 source+snapshot_id 跳过）。
 * snapshot = {
 *   source, snapshotId, fetchedAt, generatedAt?, publishedAt?, stale?,
 *   products: [{ productId, name?, platform?, productType?, spec?,
 *                lowestPrice?, currency?, offerCount?, inStockCount?,
 *                offers: [{ offerId, sourceId?, sourceName?, storeName?,
 *                           title?, price?, currency?, status?, stockCount?,
 *                           url?, capturedAt?, expiresAt? }] }]
 * }
 * @returns {{inserted: boolean, productCount: number, offerCount: number}}
 */
export function storeSnapshot(db, snapshot) {
  const { source, snapshotId } = snapshot;
  const exists = db
    .prepare("SELECT 1 FROM snapshots WHERE source = ? AND snapshot_id = ?")
    .get(source, snapshotId);
  if (exists) {
    return { inserted: false, productCount: 0, offerCount: 0 };
  }

  const products = snapshot.products || [];
  let offerTotal = 0;

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO snapshots
         (source, snapshot_id, fetched_at, generated_at, published_at, stale, product_count, offer_count)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(
      source, snapshotId,
      snapshot.fetchedAt ?? new Date().toISOString(),
      snapshot.generatedAt ?? null,
      snapshot.publishedAt ?? null,
      snapshot.stale ? 1 : 0
    );

    const insProduct = db.prepare(
      `INSERT INTO products
         (source, snapshot_id, product_id, name, platform, product_type, spec,
          lowest_price, currency, offer_count, in_stock_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insOffer = db.prepare(
      `INSERT INTO offers
         (source, snapshot_id, product_id, offer_id, source_id, source_name, store_name,
          title, price, currency, status, stock_count, url, captured_at, expires_at, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const p of products) {
      const offers = p.offers || [];
      insProduct.run(
        source, snapshotId, p.productId,
        p.name ?? null, p.platform ?? null, p.productType ?? null, p.spec ?? null,
        p.lowestPrice ?? null, p.currency ?? null,
        p.offerCount ?? offers.length, p.inStockCount ?? 0
      );
      for (const o of offers) {
        insOffer.run(
          source, snapshotId, p.productId, o.offerId,
          o.sourceId ?? null, o.sourceName ?? null, o.storeName ?? null,
          o.title ?? null, o.price ?? null, o.currency ?? null,
          o.status ?? null, o.stockCount ?? null, o.url ?? null,
          o.capturedAt ?? null, o.expiresAt ?? null,
          o.extra != null ? JSON.stringify(o.extra) : null
        );
      }
      offerTotal += offers.length;
    }

    db.prepare(
      "UPDATE snapshots SET product_count = ?, offer_count = ? WHERE source = ? AND snapshot_id = ?"
    ).run(products.length, offerTotal, source, snapshotId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { inserted: true, productCount: products.length, offerCount: offerTotal };
}

/** 某源最近一次成功落库的快照 id */
export function lastSnapshotId(db, source) {
  const row = db
    .prepare(
      "SELECT snapshot_id FROM snapshots WHERE source = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1"
    )
    .get(source);
  return row ? row.snapshot_id : null;
}

/** 某产品的时间序列：跨快照的最低价（用于盯盘/画走势） */
export function priceSeries(db, { source, productId, since }) {
  let rows;
  if (since) {
    rows = db.prepare(
      `SELECT s.fetched_at, s.generated_at, p.lowest_price, p.currency, p.in_stock_count, p.offer_count
       FROM products p JOIN snapshots s
         ON s.source = p.source AND s.snapshot_id = p.snapshot_id
       WHERE p.source = ? AND p.product_id = ? AND s.fetched_at >= ?
       ORDER BY s.fetched_at ASC`
    ).all(source, productId, since);
  } else {
    rows = db.prepare(
      `SELECT s.fetched_at, s.generated_at, p.lowest_price, p.currency, p.in_stock_count, p.offer_count
       FROM products p JOIN snapshots s
         ON s.source = p.source AND s.snapshot_id = p.snapshot_id
       WHERE p.source = ? AND p.product_id = ?
       ORDER BY s.fetched_at ASC`
    ).all(source, productId);
  }
  return rows;
}

/** 返回最近 N 个快照（按源，从新到旧） */
export function recentSnapshots(db, source, n) {
  return db.prepare(
    `SELECT * FROM snapshots WHERE source = ? ORDER BY fetched_at DESC, rowid DESC LIMIT ?`
  ).all(source, n);
}

/** 某源某快照的全部产品行 */
export function productsOfSnapshot(db, source, snapshotId) {
  return db.prepare(
    "SELECT * FROM products WHERE source = ? AND snapshot_id = ?"
  ).all(source, snapshotId);
}

/** 某源某快照某产品的全部报价 */
export function offersOfProduct(db, source, snapshotId, productId) {
  return db.prepare(
    `SELECT * FROM offers
     WHERE source = ? AND snapshot_id = ? AND product_id = ?
     ORDER BY price ASC`
  ).all(source, snapshotId, productId);
}

export function allProductsLatest(db, source) {
  const last = lastSnapshotId(db, source);
  if (!last) return [];
  return productsOfSnapshot(db, source, last);
}
