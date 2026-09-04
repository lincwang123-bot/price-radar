import test from "node:test";
import assert from "node:assert/strict";

import { metaGet, openDb, storeSnapshot } from "../lib/db.mjs";
import { runWatch } from "../lib/watch.mjs";

function snapshot(snapshotId, fetchedAt, { stale = false, offerId = "stable-offer" } = {}) {
  return {
    source: "fixture",
    snapshotId,
    fetchedAt,
    stale,
    products: [{
      productId: "fixture-product",
      name: "Fixture product",
      lowestPrice: 100,
      currency: "CNY",
      offerCount: 1,
      inStockCount: 1,
      offers: [{
        offerId,
        price: 100,
        currency: "CNY",
        status: "in_stock",
        url: `https://example.com/${offerId}`,
      }],
    }],
  };
}

test("stale 快照不求值、不推进 watermark，恢复后跳过 stale 与上次健康快照比较", () => {
  const db = openDb(":memory:");
  const config = {
    rules: [{ id: "fixture-cheapest", kind: "cheapest_changed", source: "fixture", product: "fixture-product" }],
  };
  try {
    storeSnapshot(db, snapshot("healthy-1", "2026-09-05T00:00:00.000Z"));
    assert.deepEqual(runWatch(db, config), []);
    assert.equal(metaGet(db, "watch_wm_fixture"), "healthy-1");

    storeSnapshot(db, snapshot("stale-1", "2026-09-05T00:05:00.000Z", { stale: true, offerId: "partial-offer" }));
    assert.deepEqual(runWatch(db, config), []);
    assert.equal(metaGet(db, "watch_wm_fixture"), "healthy-1");

    storeSnapshot(db, snapshot("healthy-2", "2026-09-05T00:10:00.000Z"));
    assert.deepEqual(runWatch(db, config), []);
    assert.equal(metaGet(db, "watch_wm_fixture"), "healthy-2");
  } finally {
    db.close();
  }
});
