import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDb, openDbReadOnly } from "../lib/db.mjs";

test("Web 可用只读连接查询行情库且不能写入", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "price-radar-readonly-"));
  const dbPath = path.join(dir, "radar.sqlite");
  const writable = openDb(dbPath);
  writable.close();

  const readonly = openDbReadOnly(dbPath);
  try {
    assert.equal(readonly.prepare("SELECT COUNT(*) count FROM snapshots").get().count, 0);
    assert.throws(() => readonly.exec("CREATE TABLE should_not_exist (id INTEGER)"), /readonly|read-only/i);
  } finally {
    readonly.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
