import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {normalizeReceipt,writeReceipt,offsiteReceiptStatus,receiptFromStatus,publishReceipt} from '../lib/offsite-backup.mjs';
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
test('weekly source checks are validated and whitelisted without changing real archive timestamps',()=>{
 const now=Date.now(),day=24*3600000;
 const archive={...valid(),createdAt:new Date(now-10*day-1000).toISOString(),checkedAt:new Date(now-10*day).toISOString()};
 const sourceCheck={checkedAt:new Date(now).toISOString(),unchanged:true,intervalDays:7};
 const receipt=receiptFromStatus({...archive,ok:true,verified:true,sourceCheck:{...sourceCheck,file:'private-path'},databases:[{sha256:'not-receipt-data'}]});
 assert.deepEqual(receipt,{...archive,sourceCheck});
 assert.equal(receipt.createdAt,archive.createdAt);assert.equal(receipt.checkedAt,archive.checkedAt);
 for(const check of [null,[],{...sourceCheck,intervalDays:1},{...sourceCheck,intervalDays:'7'},{...sourceCheck,unchanged:'true'},{...sourceCheck,unchanged:undefined},{...sourceCheck,checkedAt:new Date(now-10*day-1).toISOString()},{...sourceCheck,checkedAt:new Date(now+300001).toISOString()},{...sourceCheck,checkedAt:'invalid'}]) {
  assert.throws(()=>normalizeReceipt({...archive,sourceCheck:check},now),/source check/);
 }
 assert.deepEqual(normalizeReceipt({...archive,sourceCheck:{...sourceCheck,unchanged:false}},now).sourceCheck,{...sourceCheck,unchanged:false});
 assert.deepEqual(normalizeReceipt(archive,now),archive);
});
test('weekly policy migrates a legacy receipt without inventing a source check or new verification time',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'radar-receipt-policy-')),now=Date.now(),day=24*3600000;
 try {
  const archive={...valid(),createdAt:new Date(now-2*day-1000).toISOString(),checkedAt:new Date(now-2*day).toISOString()};
  const receipt=receiptFromStatus({...archive,ok:true,verified:true,checkIntervalDays:7});
  assert.deepEqual(receipt,{...archive,checkIntervalDays:7});assert.equal(Object.hasOwn(receipt,'sourceCheck'),false);
  for(const checkIntervalDays of [null,1,8,'7',true])assert.throws(()=>normalizeReceipt({...archive,checkIntervalDays},now),/check interval/);
  writeReceipt(receipt,dir);
  const current=offsiteReceiptStatus(dir,now);
  assert.equal(current.state,'recent');assert.equal(current.checkIntervalDays,7);assert.equal(Object.hasOwn(current,'sourceCheck'),false);
  assert.equal(current.createdAt,archive.createdAt);assert.equal(current.checkedAt,archive.checkedAt);
  const checked=Date.parse(archive.checkedAt);
  assert.equal(offsiteReceiptStatus(dir,checked+8*day).state,'recent');assert.equal(offsiteReceiptStatus(dir,checked+8*day+1).state,'stale');
  const content=macReceiptContent(current);
  assert.match(content,/最近备份同步已确认/);assert.match(content,/最近完整恢复验证/);
  assert.doesNotMatch(content,/最近变化检查|检测到变化|无变化，沿用现有档案/);
  assert.match(macReceiptContent({...current,state:'stale'}),/超过 8 天未确认检查/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('weekly freshness uses an eight-day check window while preserving the real backup age',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'radar-receipt-weekly-')),now=Date.now(),day=24*3600000;
 try {
  const receipt={...valid(),createdAt:new Date(now-30*day-1000).toISOString(),checkedAt:new Date(now-30*day).toISOString(),sourceCheck:{checkedAt:new Date(now).toISOString(),unchanged:true,intervalDays:7}};
  writeReceipt(receipt,dir);
  const current=offsiteReceiptStatus(dir,now+8*day);
  assert.equal(current.state,'recent');assert.equal(current.ok,true);
  assert.equal(current.createdAt,receipt.createdAt);assert.equal(current.checkedAt,receipt.checkedAt);assert.deepEqual(current.sourceCheck,receipt.sourceCheck);
  assert.equal(offsiteReceiptStatus(dir,now+8*day+1).state,'stale');
  assert.ok(statSync(path.join(dir,'mac-receipt.json')).size<=2048);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('receipt upgrades legacy checks and rejects older backups or out-of-order checks of the same archive',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'radar-receipt-order-')),now=Date.now(),day=24*3600000;
 try {
  const archive={...valid(),createdAt:new Date(now-10*day-1000).toISOString(),checkedAt:new Date(now-10*day).toISOString()};
  writeReceipt(archive,dir);
  assert.equal(offsiteReceiptStatus(dir,now).state,'stale');
  const current={...archive,sourceCheck:{checkedAt:new Date(now-1000).toISOString(),unchanged:true,intervalDays:7}};
  writeReceipt(current,dir);assert.equal(offsiteReceiptStatus(dir,now).state,'recent');
  const file=path.join(dir,'mac-receipt.json'),before=readFileSync(file,'utf8');
  const rejected=[archive,{...current,sourceCheck:{...current.sourceCheck,checkedAt:new Date(now-2000).toISOString()}},{...current,createdAt:new Date(now-11*day-1000).toISOString(),checkedAt:new Date(now-11*day).toISOString(),sourceCheck:{...current.sourceCheck,checkedAt:new Date(now).toISOString()}},{...current,createdAt:new Date(now-11*day).toISOString(),checkedAt:new Date(now-9*day).toISOString()}];
  for(const receipt of rejected){assert.throws(()=>writeReceipt(receipt,dir),/downgrade/);assert.equal(readFileSync(file,'utf8'),before);}
  const latest={...current,sourceCheck:{...current.sourceCheck,checkedAt:new Date(now).toISOString()}};
  writeReceipt(latest,dir);writeReceipt(latest,dir);
  assert.deepEqual(offsiteReceiptStatus(dir,now).sourceCheck,latest.sourceCheck);
  const newerArchive={...valid(),createdAt:new Date(now-500).toISOString(),checkedAt:new Date(now).toISOString()};
  writeReceipt(newerArchive,dir);assert.equal(offsiteReceiptStatus(dir,now).createdAt,newerArchive.createdAt);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('admin labels do not claim digest or complete disaster recovery without evidence',()=>{
 assert.match(backupEvidenceLabel({ok:true,integrity:'size-only'}),/仅核对/);
 assert.match(backupEvidenceLabel({ok:true,integrity:'sha256'}),/SHA-256/);
 assert.match(macReceiptContent({...valid(),state:'recent'}),/不表示已验证整机灾难恢复/);
 assert.match(macReceiptContent({state:'unconfigured'}),/尚无 Mac 回执/);
 const receipt={...valid(),sourceCheck:{checkedAt:new Date().toISOString(),unchanged:true,intervalDays:7}};
 const content=macReceiptContent({...receipt,state:'recent'});
 assert.match(content,/最近完整恢复验证/);assert.match(content,/最近变化检查/);assert.match(content,/无变化，沿用现有档案/);
 assert.match(content,/不代表旧档案重新通过恢复验证/);assert.match(content,/Mac 独立加密版本保留最近 3 份/);assert.match(content,/每周检查数据变化，无变化不新增档案/);
 assert.match(content,/服务器投稿与统计备份各保留最多 3 份/);
 assert.match(macReceiptContent({...receipt,state:'stale'}),/超过 8 天/);
 assert.match(macReceiptContent({...valid(),state:'stale'}),/超过 36 小时/);
});
test('receipt upload timeout kills and waits for fixture process without real SSH',async()=>{
 let child;
 await assert.rejects(publishReceipt({version:1,ok:true,verified:true,createdAt:new Date().toISOString(),checkedAt:new Date().toISOString(),encryptedBytes:12345},{timeoutMs:40,spawnRemote:()=>child=spawn(process.execPath,['-e','process.stdin.resume();setInterval(()=>{},1000)'],{stdio:['pipe','ignore','pipe']})}),/upload failed/);
 assert.equal(child.signalCode,'SIGKILL');
});
