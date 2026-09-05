import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openSubmissionsDb, createSubmission } from "../lib/submissions.mjs";
import { backupSubmissions, verifyBackup } from "../lib/backup.mjs";

test("在线备份包含已提交 WAL，隔离恢复且保护原库", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radar-backup-test-"));
  const dbPath = path.join(root, "live.sqlite"), directory = path.join(root, "backups");
  const db = openSubmissionsDb(dbPath);
  try {
    createSubmission(db, { kind: "feedback", topic: "suggestion", details: "fixture-only" });
    const result = await backupSubmissions(dbPath, directory);
    assert.equal(result.counts.feedback_submissions, 1);
    assert.equal(statSync(path.join(directory, result.file)).mode & 0o777, 0o600);
    assert.deepEqual(verifyBackup(path.join(directory, result.file)).counts, result.counts);
    assert.equal(db.prepare("select count(*) n from feedback_submissions").get().n, 1);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
