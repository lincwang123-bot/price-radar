// Streams a consistent data-only archive to an authenticated SSH client.
// Never includes environment files, credentials, raw caches, or submission text in logs.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function exportBackup(appDir, output = process.stdout, { signal } = {}) {
  const staging = mkdtempSync(path.join(tmpdir(), 'airadar-export-'));
  chmodSync(staging, 0o700);
  let tar, finished;
  try {
    const sources = { 'radar.sqlite': 'data/radar.sqlite', 'submissions.sqlite': 'submissions/submissions.sqlite', 'analytics.sqlite': 'analytics/analytics.sqlite' };
    const manifest = { version: 1, createdAt: new Date().toISOString(), files: [] };
    for (const [name, relative] of Object.entries(sources)) {
      signal?.throwIfAborted();
      const dest = path.join(staging, name);
      const db = new DatabaseSync(path.join(appDir, relative), { readOnly: true });
      try { await backup(db, dest); } finally { db.close(); }
      signal?.throwIfAborted();
      chmodSync(dest, 0o600);
      const check = new DatabaseSync(dest, { readOnly: true });
      try {
        if (check.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw new Error('SQLite backup validation failed');
      } finally { check.close(); }
      const bytes = readFileSync(dest);
      manifest.files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    tar = spawn('/usr/bin/tar', ['-czf', '-', '-C', staging, 'manifest.json', ...Object.keys(sources)], { stdio: ['ignore', 'pipe', 'inherit'] });
    finished = new Promise(resolve => { tar.once('error', error => resolve({ error })); tar.once('close', code => resolve({ code })); });
    await pipeline(tar.stdout, output, { signal });
    const result = await finished;
    if (result.error || result.code !== 0) throw new Error('Archive export failed');
  } finally {
    if (tar && tar.exitCode === null && tar.signalCode === null) {
      tar.kill('SIGTERM');
      const force=setTimeout(()=>tar.kill('SIGKILL'),1000);
      try { await finished; } finally {clearTimeout(force);}
    }
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  process.once('SIGINT',cancel); process.once('SIGTERM',cancel); process.once('SIGHUP',cancel);
  exportBackup(appDir,process.stdout,{signal:controller.signal}).catch(() => { console.error('Data backup export failed; no archive should be retained.'); process.exitCode = 1; })
    .finally(()=>{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);process.removeListener('SIGHUP',cancel);});
}
