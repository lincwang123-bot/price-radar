import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, openSync, ftruncateSync, closeSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {backupFileDigest} from '../lib/backup-file.mjs';

test('backup checksum handles files over the 2 GiB readFile limit with bounded memory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'airadar-large-checksum-'));
  try {
    const file = path.join(root, 'large'), bytes = 2 ** 31 + 17;
    const fd = openSync(file, 'wx', 0o600);
    try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
    const result = await backupFileDigest(file);
    assert.deepEqual(result, {bytes, sha256: 'd9378e43c0e666027848e63668ba0a821b4726843e366626946e3823b477299e'});
    const controller = new AbortController(); controller.abort();
    await assert.rejects(backupFileDigest(file, {signal: controller.signal}), {name: 'AbortError'});
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('backup checksum refuses links and non-files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'airadar-checksum-links-'));
  try {
    writeFileSync(path.join(root, 'source'), 'fixture');
    symlinkSync(path.join(root, 'source'), path.join(root, 'link'));
    await assert.rejects(backupFileDigest(path.join(root, 'link')), /regular file/);
    await assert.rejects(backupFileDigest(root), /regular file/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
