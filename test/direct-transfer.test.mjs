import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,symlinkSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collectDirectTransfer,importDirectTransfer,readDirectImports,validateDirectTransfer,DIRECT_TRANSFER_TARGET_IDS} from '../lib/direct-transfer.mjs';
import {openDb} from '../lib/db.mjs';
import {pull} from '../sources/direct-shops.mjs';
const now=Date.parse('2026-09-06T12:00:00Z'),at=new Date(now).toISOString();
const offer={offerId:'wzyp-harvey:abc123',sourceId:'wzyp-harvey',title:'Claude Pro 代充 1个月',price:100,currency:'CNY',status:'in_stock',stockCount:2,url:'https://wzyp.cn/item/abc123',capturedAt:at};
const batch=()=>({version:1,checkedAt:at,targets:[{targetId:'wzyp-harvey',status:'ok',checkedAt:at,offers:[{...offer}]}]});
test('import strips provenance, preserves observation time, and replay is unchanged',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'direct-transfer-'));
 try{const p=batch();p.targets[0].offers[0].extra={quoteHealth:{status:'ok',maxAgeMinutes:99999},credentials:'secret'};p.targets[0].offers[0].source_type='official';
  const result=importDirectTransfer(p,{dataDir:dir,now});assert.equal(result.written.length,1);
  const file=path.join(dir,'direct-imports/wzyp-harvey.json'),first=readFileSync(file,'utf8'),stamp=statSync(file).mtimeMs;
  assert.equal(statSync(file).mode&0o777,0o600);assert.doesNotMatch(first,/secret|source_type|99999/);
  assert.equal(importDirectTransfer(p,{dataDir:dir,now}).unchanged.length,1);assert.equal(statSync(file).mtimeMs,stamp);
  const records=readDirectImports(dir,{now});assert.equal(records[0].offers[0].capturedAt,at);assert.equal(records[0].offers[0].extra.quoteHealth.maxAgeMinutes,240);
  assert.throws(()=>importDirectTransfer({...p,checkedAt:new Date(now-1000).toISOString(),targets:[{...p.targets[0],checkedAt:new Date(now-1000).toISOString(),offers:[]}]},{dataDir:dir,now}),/旧|顺序/);
  const failed={version:1,checkedAt:new Date(now+1000).toISOString(),targets:[{targetId:'wzyp-harvey',status:'failed',checkedAt:new Date(now+1000).toISOString(),offers:[]}]};
  importDirectTransfer(failed,{dataDir:dir,now});assert.equal(readDirectImports(dir,{now})[0].status,'failed');assert.deepEqual(readDirectImports(dir,{now})[0].offers,[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('rejects untrusted identities, URLs, invalid bounds and old/future observations',()=>{
 for(const mutation of [p=>p.version=2,p=>p.targets[0].targetId='../escape',p=>p.targets[0].targetId='aisou',p=>p.targets[0].offers[0].sourceId='another',p=>p.targets[0].offers[0].url='https://evil.test/item/a',p=>p.targets[0].offers[0].url='https://wzyp.cn/admin',p=>p.targets[0].offers[0].price=0,p=>p.targets[0].offers[0].currency='USD',p=>p.targets[0].offers[0].stockCount=-1,p=>p.targets[0].offers[0].status='official',p=>p.targets[0].offers[0].capturedAt='2020-01-01T00:00:00Z',p=>p.targets[0].offers[0].capturedAt=new Date(now+180000).toISOString(),p=>p.targets[0].status='failed',p=>p.targets.push(p.targets[0]),p=>p.targets[0].offers=Array(2001).fill(offer)]){const p=batch();mutation(p);assert.throws(()=>validateDirectTransfer(p,{now}));}
 const p=batch();p.targets[0].offers=[];assert.equal(validateDirectTransfer(p,{now}).targets[0].status,'ok');
 const mismatch=batch();mismatch.targets[0].offers[0].url='https://wzyp.cn/item/different';assert.throws(()=>validateDirectTransfer(mismatch,{now}),/ID 不匹配/);
});
test('symlinks are refused; corrupt and expired imports expose failure without offers',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'direct-transfer-'));
 try{mkdirSync(path.join(dir,'direct-imports'));const file=path.join(dir,'direct-imports/wzyp-harvey.json');symlinkSync('/tmp/not-owned',file);assert.throws(()=>importDirectTransfer(batch(),{dataDir:dir,now}),/符号链接|symlink/);rmSync(file);
  importDirectTransfer(batch(),{dataDir:dir,now});assert.equal(readDirectImports(dir,{now:now+4*3600000+1})[0].status,'failed');
  writeFileSync(file,'{broken');assert.equal(readDirectImports(dir,{now})[0].offers.length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('export uses only registry shops and stops same-origin requests on denial',async()=>{
 let count=0;const result=await collectDirectTransfer({targetIds:['wzyp-harvey','wzyp-paimon'],now:()=>now,sleep:async()=>{},fetchImpl:async()=>{count++;return new Response('Access denied',{status:403});}});
 assert.equal(count,1);assert.deepEqual(result.targets.map(x=>x.status),['failed','failed']);
 await assert.rejects(collectDirectTransfer({targetIds:['aisou']}));
});
test('export covers all eight registered stores with 117 paced public requests',async()=>{
 let count=0,category=0;const waits=[],counts=[41,4,3,9,26,6,19,1];
 const result=await collectDirectTransfer({now:()=>now,sleep:async ms=>waits.push(ms),fetchImpl:async url=>{count++;return new Response(JSON.stringify(String(url).endsWith('/categoryList')?{code:1,data:Array.from({length:counts[category++]},(_,i)=>({id:i+1,goods_count:1}))}:{code:1,data:{list:[],total:0}}),{headers:{'Content-Type':'application/json'}});}});
 assert.equal(count,117);assert.equal(waits.length,116);assert.ok(waits.every(ms=>ms>=1000));assert.equal(result.targets.length,DIRECT_TRANSFER_TARGET_IDS.length);assert.ok(result.targets.every(t=>t.status==='ok'));
});
test('passive imports merge without requests, then failed reports remove their old minimum',async(t)=>{
 const dir=mkdtempSync(path.join(tmpdir(),'direct-transfer-pull-')),db=openDb(':memory:');
 t.mock.timers.enable({apis:['Date'],now});let requests=0;
 const ctx={db,dataDir:dir,config:{sources:{'direct-shops':{targets:['aisou'],min_interval_minutes:30}}},fetchImpl:async url=>{requests++;assert.equal(new URL(url).origin,'https://aisou.pro');return new Response(JSON.stringify({code:200,total:1,data:[{id:1,name:'Claude Pro 代充 1个月',price:150,stock:1,status:1}]}),{headers:{'Content-Type':'application/json'}});}};
 try{
  importDirectTransfer(batch(),{dataDir:dir,now});
  const first=await pull(ctx);assert.equal(requests,1);const offers=first.snapshot.products.flatMap(p=>p.offers);assert.equal(offers.length,2);assert.equal(offers.find(o=>o.offerId===offer.offerId).capturedAt,at);
  t.mock.timers.tick(31*60000);const checkedAt=new Date().toISOString();
  importDirectTransfer({version:1,checkedAt,targets:[{targetId:'wzyp-harvey',status:'failed',checkedAt,offers:[]}]},{dataDir:dir});
  const second=await pull(ctx);assert.equal(requests,2);assert.equal(second.snapshot.products.flatMap(p=>p.offers).length,1);assert.equal(second.snapshot.products.flatMap(p=>p.offers)[0].extra.quoteHealth.status,'ok');
 }finally{db.close();t.mock.timers.reset();rmSync(dir,{recursive:true,force:true});}
});
test('active target evidence takes priority over a passive import without duplicate offers',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'direct-transfer-active-')),db=openDb(':memory:'),at=new Date().toISOString();
 try{
  importDirectTransfer({version:1,checkedAt:at,targets:[{targetId:'wzyp-harvey',checkedAt:at,status:'ok',offers:[{...offer,capturedAt:at}]}]},{dataDir:dir});
  mkdirSync(path.join(dir,'direct-shops-cache'));writeFileSync(path.join(dir,'direct-shops-cache/wzyp-harvey.json'),JSON.stringify({targetId:'wzyp-harvey',fetchedAt:at,offers:[{...offer,price:200,capturedAt:at}]}));
  const result=await pull({db,dataDir:dir,config:{sources:{'direct-shops':{targets:['wzyp-harvey']}}},fetchImpl:async()=>assert.fail('fresh active cache must not fetch')});
  const offers=result.snapshot.products.flatMap(p=>p.offers);assert.equal(offers.length,1);assert.equal(offers[0].price,200);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('CLI stdin import is bounded and writes only a normalized target record',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'direct-transfer-cli-')),checkedAt=new Date().toISOString();
 try{
  const input=JSON.stringify({version:1,checkedAt,targets:[{targetId:'wzyp-harvey',status:'ok',checkedAt,offers:[{...offer,capturedAt:checkedAt}]}]});
  const cli=fileURLToPath(new URL('../scripts/direct-transfer.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[cli,'import','--data-dir',dir],{input,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout).written,['wzyp-harvey']);
  const invalid=spawnSync(process.execPath,[cli,'import','--data-dir',dir],{input:'{secret-token-invalid',encoding:'utf8'});
  assert.equal(invalid.status,1);assert.doesNotMatch(invalid.stderr,/secret-token/);
  assert.throws(()=>validateDirectTransfer(' '.repeat(8*1024*1024+1)),/8MB/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
