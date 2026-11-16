import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as submissions from '../lib/submissions.mjs';
import { backupSubmissions, backupStatus } from '../lib/backup.mjs';
import { notify } from '../lib/notify.mjs';

test('submission lock fails promptly and exposes a recognizable busy error', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'radar-lock-'));
  const file = path.join(root, 'test.sqlite');
  const db = submissions.openSubmissionsDb(file), blocker = new DatabaseSync(file);
  try {
    blocker.exec('BEGIN IMMEDIATE');
    const start = performance.now();
    let caught;
    try { submissions.createSubmission(db, {kind:'feedback',topic:'suggestion',details:'fixture'}); } catch(e) { caught=e; }
    assert.ok(performance.now()-start < 200, 'synchronous lock wait must not stall HTTP');
    assert.ok(submissions.isSubmissionBusy(caught));
  } finally { blocker.exec('ROLLBACK'); blocker.close(); db.close(); rmSync(root,{recursive:true,force:true}); }
});

test('backup status checks real file, size, digest and basename, labels legacy digest absence', async () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'radar-status-')), file=path.join(root,'live.sqlite'), dir=path.join(root,'backups');
  const db=submissions.openSubmissionsDb(file);
  try {
    const status=await backupSubmissions(file,dir), statusFile=path.join(dir,'status.json'), backupFile=path.join(dir,status.file);
    assert.equal(backupStatus(dir).integrity,'sha256');
    const original=readFileSync(backupFile); const damaged=Buffer.from(original); damaged[100]^=1; writeFileSync(backupFile,damaged);
    assert.equal(backupStatus(dir).ok,false);
    writeFileSync(backupFile,original);
    const legacy={...status}; delete legacy.sha256; writeFileSync(statusFile,JSON.stringify(legacy));
    assert.equal(backupStatus(dir).integrity,'size-only');
    writeFileSync(statusFile,JSON.stringify({...status,file:'../live.sqlite'})); assert.equal(backupStatus(dir).ok,false);
    writeFileSync(statusFile,JSON.stringify(status)); rmSync(backupFile); assert.equal(backupStatus(dir).ok,false);
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});

test('hung webhooks ignoring AbortSignal cannot exceed notification total budget', async () => {
  const saved=globalThis.fetch; let signal;
  globalThis.fetch=async (_url,options)=>{signal=options.signal;return new Promise(()=>{});};
  try {
    const start=performance.now();
    const result=await notify([{message:'fixture'}],{console:false,logFile:false,timeoutMs:20,totalTimeoutMs:35,webhooks:[{url:'https://fixture.invalid'},{url:'https://fixture.invalid'}]});
    assert.equal(result.sent,0); assert.ok(performance.now()-start<200); assert.equal(signal.aborted,true);
  } finally {globalThis.fetch=saved;}
});
