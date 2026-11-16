import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, storeSnapshot, lastSnapshotId } from "../lib/db.mjs";
import { pull } from "../sources/direct-shops.mjs";
import {projectProduct} from '../lib/quote-policy.mjs';

test("直采每轮观察独立记录：A→B→A、不变与失败恢复均保留当前状态", async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "direct-observations-"));
  const db = openDb(":memory:");
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T00:00:00Z") });
  let price = 100;
  let fail = false;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (fail) throw new Error("fixture unavailable");
    return new Response(JSON.stringify({code: 200, total: 1, data: [
      {id: 1, name: "ChatGPT Plus 月卡代充", price, status: 1, stock: 3},
    ]}), {headers: {"content-type": "application/json"}});
  });
  const ctx = {db, dataDir, config: {sources: {"direct-shops": {targets: ["aisou"], min_interval_minutes: 30}}}};
  try {
    const snapshots = [];
    for (const state of [100, 110, 100, 100, "failure", 100]) {
      price = typeof state === "number" ? state : price;
      fail = state === "failure";
      const result = await pull(ctx);
      assert.equal(storeSnapshot(db, result.snapshot).inserted, true, `observation ${state}`);
      const current = db.prepare("SELECT lowest_price FROM products WHERE source='direct-shops' AND snapshot_id=?").get(lastSnapshotId(db, "direct-shops"));
      assert.equal(current.lowest_price, price);
      snapshots.push(result.snapshot);
      const before = calls;
      assert.equal((await pull(ctx)).skipped, true);
      assert.equal(calls, before, "throttled request must not fetch");
      t.mock.timers.tick(31 * 60_000);
    }
    assert.equal(new Set(snapshots.map(s => s.snapshotId)).size, 6);
    assert.deepEqual(snapshots.map(s => s.stale), [false, false, false, false, true, false]);
    assert.ok(snapshots[3].fetchedAt > snapshots[2].fetchedAt);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM snapshots").get().n, 6);
    fail=true;t.mock.timers.tick(25*60*60_000);
    const expired=await pull(ctx);assert.equal(expired.snapshot.stale,true);
    assert.equal(expired.snapshot.products.length,1,"failed collection keeps the last observed price");
    storeSnapshot(db,expired.snapshot);
    const snapshot=db.prepare("SELECT * FROM snapshots WHERE snapshot_id=?").get(lastSnapshotId(db,'direct-shops'));
    const product=db.prepare("SELECT * FROM products WHERE snapshot_id=?").get(snapshot.snapshot_id);
    const projected=projectProduct(db,'direct-shops',snapshot,product);
    assert.equal(projected.lowest_price,null);assert.equal(projected.offers[0].quote_retained,true);assert.equal(projected.offers[0].price,100);
    assert.equal(projected.offers[0].captured_at,snapshots[5].products[0].offers[0].capturedAt);
    const health=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='health:direct-targets'").get().value);
    assert.equal(health.targets[0].status,"stale");assert.equal(health.targets[0].target,"aisou");
  } finally {
    db.close();
    t.mock.restoreAll();
    t.mock.timers.reset();
    rmSync(dataDir, {recursive: true, force: true});
  }
});
