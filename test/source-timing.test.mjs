import test from "node:test";
import assert from "node:assert/strict";

import { openDb } from "../lib/db.mjs";
import { claimSourceAttempt } from "../lib/source-timing.mjs";

test("节流按真实尝试时间推进，而不是依赖是否产生新快照", () => {
  const db = openDb(":memory:");
  try {
    const first = claimSourceAttempt(db, "fixture", 30, Date.parse("2026-09-05T00:00:00Z"));
    const throttled = claimSourceAttempt(db, "fixture", 30, Date.parse("2026-09-05T00:05:00Z"));
    const next = claimSourceAttempt(db, "fixture", 30, Date.parse("2026-09-05T00:31:00Z"));
    assert.equal(first.allowed, true);
    assert.equal(first.elapsedMinutes, null);
    assert.equal(throttled.allowed, false);
    assert.equal(throttled.elapsedMinutes, 5);
    assert.equal(next.allowed, true);
    assert.equal(next.elapsedMinutes, 31);
  } finally {
    db.close();
  }
});
