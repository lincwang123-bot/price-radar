import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {writeReceipt,offsiteReceiptStatus,receiptFromStatus,publishReceipt} from '../lib/offsite-backup.mjs';
import {backupEvidenceLabel,macReceiptContent} from '../lib/admin.mjs';
const valid=()=>receiptFromStatus({version:1,ok:true,verified:true,checkedAt:new Date().toISOString(),createdAt:new Date(Date.now()-1000).toISOString(),encryptedBytes:12345});

test('receipt is minimal, private, fresh/stale/missing distinguished and path fields ignored',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'radar-receipt-'));
 try{
  assert.equal(offsiteReceiptStatus(dir).state,'unconfigured');
  writeReceipt({...valid(),file:'../../fixture-secret',key:'must-not-save'},dir);
  const file=path.join(dir,'mac-receipt.json'),text=readFileSync(file,'utf8');
  assert.ok(!text.includes('fixture-secret'));assert.ok(!text.includes('must-not-save'));
  assert.equal(statSync(file).mode&0o777,0o600);assert.equal(offsiteReceiptStatus(dir).state,'recent');
  const before=readFileSync(file,'utf8');
  assert.throws(()=>writeReceipt({...valid(),checkedAt:new Date(Date.now()-100000).toISOString(),createdAt:new Date(Date.now()-200000).toISOString()},dir),/downgrade/);
  assert.equal(readFileSync(file,'utf8'),before);
  assert.equal(offsiteReceiptStatus(dir,Date.now()+37*3600000).state,'stale');
  rmSync(file);symlinkSync(path.join(dir,'not-real'),file);assert.equal(offsiteReceiptStatus(dir).state,'invalid');
  rmSync(file);writeFileSync(file,'x'.repeat(2049));assert.equal(offsiteReceiptStatus(dir).state,'invalid');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('receipt read and write reject a symlink directory',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'radar-receipt-link-')),target=path.join(root,'target'),link=path.join(root,'link');
 try{
  writeReceipt(valid(),target);symlinkSync(target,link);
  assert.equal(offsiteReceiptStatus(link).state,'invalid');
  assert.throws(()=>writeReceipt(valid(),link),/regular/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('admin labels do not claim digest or complete disaster recovery without evidence',()=>{
 assert.match(backupEvidenceLabel({ok:true,integrity:'size-only'}),/仅核对/);
 assert.match(backupEvidenceLabel({ok:true,integrity:'sha256'}),/SHA-256/);
 assert.match(macReceiptContent({...valid(),state:'recent'}),/不表示已验证整机灾难恢复/);
 assert.match(macReceiptContent({state:'unconfigured'}),/尚无 Mac 回执/);
});
test('receipt upload timeout kills and waits for fixture process without real SSH',async()=>{
 let child;
 await assert.rejects(publishReceipt({version:1,ok:true,verified:true,createdAt:new Date().toISOString(),checkedAt:new Date().toISOString(),encryptedBytes:12345},{timeoutMs:40,spawnRemote:()=>child=spawn(process.execPath,['-e','process.stdin.resume();setInterval(()=>{},1000)'],{stdio:['pipe','ignore','pipe']})}),/upload failed/);
 assert.equal(child.signalCode,'SIGKILL');
});
