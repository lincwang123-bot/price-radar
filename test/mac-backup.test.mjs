import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync, existsSync, copyFileSync, constants } from 'node:fs';
import {spawn} from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportBackup } from '../scripts/export-backup.mjs';
import { readBackupKey, encryptBackup, verifyMacBackup, pullMacBackup } from '../scripts/mac-backup.mjs';

test('Mac backup encrypts, authenticates and restores three databases without exposing plaintext', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'airadar-mac-test-'));
  const live=[];
  try {
    for (const [dir, name] of [['data', 'radar'], ['submissions', 'submissions'], ['analytics', 'analytics']]) {
      mkdirSync(path.join(root, dir));
      const db = new DatabaseSync(path.join(root, dir, name + '.sqlite'));
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('private-fixture-not-for-logs')"); live.push(db);
    }
    const tar = path.join(root, 'input.tar.gz');
    await exportBackup(root, createWriteStream(tar, { mode: 0o600 }));
    const keyPath = path.join(root, 'keydir', 'backup.key'), key = readBackupKey(keyPath, { create: true });
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    const enc = path.join(root, 'backup.enc');
    await encryptBackup(createReadStream(tar), enc, key);
    assert.equal(readFileSync(enc).includes(Buffer.from('private-fixture-not-for-logs')), false);
    const restored = path.join(root, 'restored');
    const result = await verifyMacBackup(enc, key, root, { restoreTo: restored });
    assert.equal(result.verified, true); assert.equal(result.databases.length, 3);
    for(const name of ['radar','submissions','analytics']) {
      const db = new DatabaseSync(path.join(restored, name+'.sqlite'), { readOnly: true });
      assert.equal(db.prepare('SELECT value FROM fixture').get().value, 'private-fixture-not-for-logs'); db.close();
    }
    await assert.rejects(verifyMacBackup(enc, key, root, { restoreTo: restored }), /must not exist/);
    // Simulate a target on another filesystem: only copy operations are permitted.
    const external=path.join(root,'external-restored');let copied=0;
    await verifyMacBackup(enc,key,root,{restoreTo:external,copyRestoredFile:(source,dest,flags)=>{
      assert.equal(flags,constants.COPYFILE_EXCL);copied++;copyFileSync(source,dest,flags);
    }});
    assert.equal(copied,4);
    for(const name of ['manifest.json','radar.sqlite','submissions.sqlite','analytics.sqlite'])assert.equal(statSync(path.join(external,name)).mode&0o777,0o600);
    const failedRestore=path.join(root,'failed-restore');let attempts=0;
    await assert.rejects(verifyMacBackup(enc,key,root,{restoreTo:failedRestore,copyRestoredFile:(source,dest,flags)=>{
      if(++attempts===2)throw Object.assign(new Error('fixture target disk full'),{code:'ENOSPC'});
      copyFileSync(source,dest,flags);
    }}),/disk full/);
    assert.equal(existsSync(failedRestore),false);
    assert.equal(readdirSync(root).some(name=>name.startsWith('.verify-')),false);
    const damaged = readFileSync(enc); damaged[30] ^= 1; writeFileSync(path.join(root, 'damaged.enc'), damaged);
    await assert.rejects(verifyMacBackup(path.join(root, 'damaged.enc'), key, root));
    await assert.rejects(verifyMacBackup(enc, Buffer.alloc(32), root));
    assert.equal(readdirSync(root).some(name=>name.startsWith('.verify-')),false);
    assert.throws(() => readBackupKey(path.join(root, 'missing.key')), /key missing/);
  } finally { for(const db of live)db.close();rmSync(root, { recursive: true, force: true }); }
});

test('failed and interrupted SSH fixture processes leave no pending file or lock, lost key fails closed',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'airadar-pull-test-')),directory=path.join(root,'backups'),keyPath=path.join(root,'keys','backup.key');
 let child;
 const spawnRemote=()=>child=spawn(process.execPath,['-e',"process.stdout.write('incomplete fixture');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
 try{
  await assert.rejects(pullMacBackup({directory,keyPath,spawnRemote,timeoutMs:30}));
  assert.ok(child.exitCode!==null||child.signalCode!==null);
  assert.equal(readdirSync(directory).some(n=>n.endsWith('.pending')||n==='.running'),false);
  await assert.rejects(pullMacBackup({directory,keyPath,spawnRemote:()=>child=spawn(process.execPath,['-e',"process.exit(23)"],{stdio:['ignore','pipe','pipe']})}),/Remote backup failed/);
  assert.equal(readdirSync(directory).some(n=>n.endsWith('.pending')||n==='.running'),false);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30);
  try{await assert.rejects(pullMacBackup({directory,keyPath,spawnRemote,signal:controller.signal}));}finally{clearTimeout(timer);}
  assert.ok(child.exitCode!==null||child.signalCode!==null);
  assert.equal(existsSync(path.join(directory,'.running')),false);
  const lock=path.join(directory,'.running');writeFileSync(lock,'fixture-lock');
  await assert.rejects(pullMacBackup({directory,keyPath,spawnRemote}),/Another backup/);
  assert.equal(readFileSync(lock,'utf8'),'fixture-lock');rmSync(lock);
  rmSync(keyPath);
  await assert.rejects(pullMacBackup({directory,keyPath,spawnRemote}),/key missing/);
  assert.equal(existsSync(keyPath),false);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');rmSync(root,{recursive:true,force:true});}
});

test('SSH fixture ignoring TERM after EOF is force-stopped and awaited',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'airadar-force-stop-'));let child;
 try{
  await assert.rejects(pullMacBackup({directory:path.join(root,'backups'),keyPath:path.join(root,'key'),timeoutMs:100,
   spawnRemote:()=>child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.end();setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']})}));
  assert.equal(child.signalCode,'SIGKILL');
  assert.equal(existsSync(path.join(root,'backups','.running')),false);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');rmSync(root,{recursive:true,force:true});}
});
