// Data stays on this Mac; no cloud storage or paid service is involved.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, appendFileSync, chmodSync, copyFileSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {publishReceipt} from '../lib/offsite-backup.mjs';

const MAGIC = Buffer.from('AIRADAR1');
const DB_FILES = ['radar.sqlite', 'submissions.sqlite', 'analytics.sqlite'];
const ARCHIVE = /^airadar-\d{8}T\d{9}Z-[a-f0-9]{12}\.enc$/;
const DEFAULT_DIR = path.join(homedir(), 'Backups', 'Airadar');
const DEFAULT_KEY = path.join(homedir(), 'Library', 'Application Support', 'Airadar Backup', 'backup.key');

function privateDirectory(dir) {
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error('Backup directory must not be a symlink');
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
}

export function readBackupKey(keyPath, { create = false } = {}) {
  if (!existsSync(keyPath)) {
    if (!create) throw new Error('Backup key missing; existing archives cannot be recovered without it');
    privateDirectory(path.dirname(keyPath));
    writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
  }
  const info = lstatSync(keyPath);
  if (!info.isFile() || (info.mode & 0o077)) throw new Error('Backup key must be a private regular file (0600)');
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Backup key has invalid length');
  return key;
}

export async function encryptBackup(input, outputPath, key, { signal } = {}) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const sink = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  sink.write(Buffer.concat([MAGIC, iv]));
  await pipeline(input, cipher, sink, { signal });
  appendFileSync(outputPath, cipher.getAuthTag());
}

async function decryptBackup(archive, outputPath, key, signal) {
  const size = statSync(archive).size;
  if (size < 37) throw new Error('Invalid encrypted archive');
  // These small fixed-size reads never expose backup contents to logs.
  const { openSync, readSync, closeSync } = await import('node:fs');
  const fd = openSync(archive, 'r');
  const header = Buffer.alloc(20), tag = Buffer.alloc(16);
  try { readSync(fd, header, 0, 20, 0); readSync(fd, tag, 0, 16, size - 16); } finally { closeSync(fd); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid archive format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
  await pipeline(createReadStream(archive, { start: 20, end: size - 17 }), decipher, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),{signal});
}

// Restoration is isolated and never opens or overwrites any production database.
export async function verifyMacBackup(archive, key, directory, { restoreTo, signal, copyRestoredFile = copyFileSync } = {}) {
  privateDirectory(directory);
  const temp = mkdtempSync(path.join(directory, '.verify-')); chmodSync(temp, 0o700);
  let createdRestore=false;
  try {
    const compressed = path.join(temp, 'data.tar.gz');
    await decryptBackup(archive, compressed, key,signal); // Authenticate before extracting anything.
    signal?.throwIfAborted();
    const entries = execFileSync('/usr/bin/tar', ['-tzf', compressed], { encoding: 'utf8', timeout: 60000 }).trim().split('\n');
    const expected = ['manifest.json', ...DB_FILES];
    if (entries.length !== expected.length || new Set(entries).size !== expected.length || entries.some(e => !expected.includes(e))) throw new Error('Unexpected archive entry');
    execFileSync('/usr/bin/tar', ['-xzf', compressed, '-C', temp, ...expected], { timeout: 60000 });
    if(!lstatSync(path.join(temp,'manifest.json')).isFile()) throw new Error('Invalid manifest file');
    const manifest = JSON.parse(readFileSync(path.join(temp, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || manifest.files?.length !== DB_FILES.length || new Set(manifest.files.map(f => f.name)).size !== DB_FILES.length) throw new Error('Invalid backup manifest');
    for (const name of DB_FILES) {
      const declared = manifest.files.find(f => f.name === name), file = path.join(temp, name);
      if (!declared || !lstatSync(file).isFile()) throw new Error('Missing backup database');
      const bytes = readFileSync(file);
      if (bytes.length !== declared.bytes || createHash('sha256').update(bytes).digest('hex') !== declared.sha256) throw new Error('Backup checksum mismatch');
      const db = new DatabaseSync(file, { readOnly: true });
      try { if (db.prepare('PRAGMA quick_check').all().some(r => r.quick_check !== 'ok')) throw new Error('Database restore check failed'); } finally { db.close(); }
    }
    if (restoreTo) {
      if (existsSync(restoreTo)) throw new Error('Restore destination must not exist');
      mkdirSync(restoreTo, { recursive: true, mode: 0o700 });
      createdRestore=true;
      // Copy across filesystem boundaries; the isolated source is removed in finally.
      for (const name of expected) {
        signal?.throwIfAborted();
        copyRestoredFile(path.join(temp, name), path.join(restoreTo, name), constants.COPYFILE_EXCL);
        chmodSync(path.join(restoreTo, name), 0o600);
      }
    }
    return { createdAt: manifest.createdAt, databases: manifest.files.map(({ name, bytes }) => ({ name, bytes })), verified: true };
  } catch(error) {if(createdRestore) rmSync(restoreTo,{recursive:true,force:true});throw error;}
  finally { rmSync(temp, { recursive: true, force: true }); }
}

export const DEFAULT_BACKUP_TIMEOUT_MS=900000;
export async function pullMacBackup({ directory = DEFAULT_DIR, keyPath = DEFAULT_KEY, signal, spawnRemote = spawn, timeoutMs = DEFAULT_BACKUP_TIMEOUT_MS, sendReceipt=publishReceipt } = {}) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(keyPath)) throw new Error('Use absolute backup paths');
  privateDirectory(directory);
  // Do not silently create a different key when encrypted archives already exist.
  const archives = readdirSync(directory).filter(f => ARCHIVE.test(f));
  const key = readBackupKey(keyPath, { create: archives.length === 0 && !existsSync(path.join(directory,'status.json')) && !existsSync(path.join(directory,'.key-initialized')) });
  // Retain a key fingerprint even if archives are moved elsewhere or a first pull fails.
  const keyMarker=path.join(directory,'.key-initialized'), fingerprint=createHash('sha256').update(key).digest('hex');
  if(existsSync(keyMarker)) {
    if(readFileSync(keyMarker,'utf8')!==fingerprint) throw new Error('Backup key does not match the initialized key');
  } else writeFileSync(keyMarker,fingerprint,{flag:'wx',mode:0o600});
  const lock = path.join(directory, '.running');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); } catch { throw new Error('Another backup may be running; inspect the .running lock before retrying'); }
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const name = `airadar-${stamp}-${randomBytes(6).toString('hex')}.enc`;
  const pending = path.join(directory, name + '.pending'), file = path.join(directory, name);
  let remote, timeout, finished;
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  try {
    signal?.throwIfAborted();
    remote = spawnRemote('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'linc-vps', 'node --disable-warning=ExperimentalWarning /opt/linc/apps/price-radar/scripts/export-backup.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
    remote.stderr.resume(); // Do not log remote paths or data on error.
    finished = new Promise(resolve => { remote.once('error', error => resolve({ error })); remote.once('close', code => resolve({ code })); });
    timeout = setTimeout(abort, timeoutMs);
    const stop=()=>remote.kill('SIGTERM');
    controller.signal.addEventListener('abort',stop,{once:true});
    await encryptBackup(remote.stdout, pending, key,{signal:controller.signal});
    const result = await Promise.race([finished,new Promise((_,reject)=>{
      if(controller.signal.aborted) reject(new Error('Backup aborted'));
      else controller.signal.addEventListener('abort',()=>reject(new Error('Backup aborted')),{once:true});
    })]);
    if (result.error || result.code !== 0) throw new Error('Remote backup failed; previous good backups are retained');
    controller.signal.throwIfAborted();
    const verified = await verifyMacBackup(pending, key, directory,{signal:controller.signal});
    renameSync(pending, file);
    const status = { version: 1, ok: true, checkedAt: new Date().toISOString(), file: name, encryptedBytes: statSync(file).size, ...verified };
    const statusTemp = path.join(directory, `.status-${randomBytes(6).toString('hex')}`);
    writeFileSync(statusTemp, JSON.stringify(status, null, 2), { mode: 0o600 }); renameSync(statusTemp, path.join(directory, 'status.json'));
    clearTimeout(timeout);
    try{status.receipt=await sendReceipt(status,{signal});}
    catch{status.receipt={ok:false,warning:'本地备份已验证并保留，但服务器确认回执上传失败'};}
    try{writeFileSync(statusTemp,JSON.stringify(status,null,2),{mode:0o600});renameSync(statusTemp,path.join(directory,'status.json'));}
    finally{rmSync(statusTemp,{force:true});}
    return { ...status, directory };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort',abort);
    if (remote && remote.exitCode === null && remote.signalCode === null) {
      remote.kill('SIGTERM');
      const force=setTimeout(()=>remote.kill('SIGKILL'),1000);
      try {await finished;} finally {clearTimeout(force);}
    }
    rmSync(pending, { force: true }); rmSync(lock, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const [command = 'backup', archive, restoreTo] = process.argv.slice(2);
  const controller=new AbortController(), cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);process.once('SIGHUP',cancel);
  const run = async () => {
    if (command === 'backup') return pullMacBackup({signal:controller.signal});
    if (!['verify', 'restore'].includes(command) || !archive || (command === 'restore' && !restoreTo)) throw new Error('Usage: mac-backup.mjs backup | verify <archive> | restore <archive> <new-directory>');
    return verifyMacBackup(path.resolve(archive), readBackupKey(DEFAULT_KEY), DEFAULT_DIR, { restoreTo: command === 'restore' ? path.resolve(restoreTo) : undefined,signal:controller.signal });
  };
  run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(()=>{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);process.removeListener('SIGHUP',cancel);});
}
