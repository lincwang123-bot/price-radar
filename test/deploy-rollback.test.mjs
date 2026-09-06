import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('web bridge access does not grant market writes or expose private stores to collector',()=>{
 const web=readFileSync('deploy/price-radar-web.service','utf8');
 const collect=readFileSync('deploy/price-radar-collect.service','utf8');
 assert.match(web,/^ReadWritePaths=\/opt\/linc\/apps\/price-radar\/merchant-bridge$/m);
 assert.ok(!/^ReadWritePaths=.*\/price-radar\/data\b/m.test(web));
 assert.match(collect,/^InaccessiblePaths=.*\/submissions .*\/analytics /m);
 assert.ok(!/^ReadWritePaths=.*merchant-bridge/m.test(collect));
 const deploy=readFileSync('deploy/deploy.sh','utf8');
 assert.ok(deploy.includes("--exclude='./merchant-bridge'"));
 assert.ok(deploy.includes("--exclude 'merchant-bridge/'"));
});

test('rollback removes newly deployed code but preserves private/runtime paths',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'radar-rollback-'));
 try{
  const old=path.join(root,'old'),app=path.join(root,'app'),archive=path.join(root,'old.tgz');mkdirSync(old);mkdirSync(app);
  writeFileSync(path.join(old,'web.mjs'),'old');writeFileSync(path.join(app,'new-code.mjs'),'new');writeFileSync(path.join(app,'web.mjs'),'new');
  for(const dir of ['data','submissions','analytics','merchant-bridge','backups','.git']){mkdirSync(path.join(app,dir));writeFileSync(path.join(app,dir,'fixture'),'keep');}
  for(const name of ['.env','config.json'])writeFileSync(path.join(app,name),'keep');
  execFileSync('tar',['-czf',archive,'-C',old,'.']);
  execFileSync('bash',['deploy/restore-code.sh',archive,app]);
  assert.equal(readFileSync(path.join(app,'web.mjs'),'utf8'),'old');assert.equal(existsSync(path.join(app,'new-code.mjs')),false);
  for(const dir of ['data','submissions','analytics','merchant-bridge','backups','.git'])assert.equal(readFileSync(path.join(app,dir,'fixture'),'utf8'),'keep');
  for(const name of ['.env','config.json'])assert.equal(readFileSync(path.join(app,name),'utf8'),'keep');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('unit rollback restores actual unit bytes including backup units and exposes failures',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'radar-units-'));
 try{
  const dir=path.join(root,'units'),bin=path.join(root,'bin'),snapshot=path.join(root,'snapshot');mkdirSync(dir);mkdirSync(bin);
  const names=['price-radar-web.service','price-radar-collect.service','price-radar-backup.service','price-radar-backup.timer','price-radar-named-tunnel.service'];
  for(const name of names)writeFileSync(path.join(dir,name),`actual-${name}`);
  writeFileSync(path.join(bin,'systemctl'),'#!/bin/sh\ncase "$1" in\nis-active) echo active;;\nis-enabled) echo enabled;;\n*) test "${FAIL_RESTORE:-0}" = 0;;\nesac\n',{mode:0o755});
  const env={...process.env,UNIT_DIR:dir,PATH:`${bin}:${process.env.PATH}`};
  execFileSync('bash',['deploy/rollback-units.sh','snapshot',snapshot],{env});
  for(const name of names)writeFileSync(path.join(dir,name),'replaced');
  execFileSync('bash',['deploy/rollback-units.sh','restore',snapshot],{env});
  for(const name of names)assert.equal(readFileSync(path.join(dir,name),'utf8'),`actual-${name}`);
  assert.throws(()=>execFileSync('bash',['deploy/rollback-units.sh','restore',snapshot],{env:{...env,FAIL_RESTORE:'1'},stdio:'pipe'}));
 }finally{rmSync(root,{recursive:true,force:true});}
});
