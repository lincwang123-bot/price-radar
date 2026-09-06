import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,cpSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// Execute the real deployment shell with fixture-only command adapters.
// No adapter invokes SSH, sudo, systemctl or a production HTTP endpoint.
const adapter=String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const tool=path.basename(process.argv[1]),args=process.argv.slice(2),root=process.env.DRILL_ROOT;
const statePath=path.join(root,'state.json');
function done(r){if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status??1);}
function mapped(s){return s.replaceAll('/etc/systemd/system/',root+'/units/').replace(/\/tmp\/(price-radar-[a-z-]+\.(service|timer))/g,root+'/temp/$1');}
if(tool==='ssh'){
 let command=mapped(args.at(-1)).replaceAll('sudo install -o root -g root','install');
 const result=cp.spawnSync('/bin/bash',['-c',command],{env:process.env,encoding:'utf8'});
 if(command.includes('mktemp -d /tmp/price-radar-deploy.')){const state=JSON.parse(fs.readFileSync(statePath));state.remoteTemp=result.stdout.trim();fs.writeFileSync(statePath,JSON.stringify(state));}
 done(result);
}
if(tool==='scp'){
 const filtered=args.filter(a=>a!=='-q'),dest=mapped(filtered.pop().replace(/^linc-vps:/,''));
 for(const source of filtered)fs.copyFileSync(source,fs.statSync(path.dirname(dest)).isDirectory()&&dest.endsWith('/')?path.join(dest,path.basename(source)):dest);
 process.exit(0);
}
if(tool==='sudo'){
 if(args[0]==='chown')process.exit(0);
 if(args[0]==='-u')args.splice(0,2);
 done(cp.spawnSync(args.shift(),args,{env:process.env,encoding:'utf8'}));
}
if(tool==='npm')process.exit(0);
if(tool==='git'){if(args[0]==='rev-parse')console.log('fixture-revision');process.exit(0);}
if(tool==='curl'){
 const state=JSON.parse(fs.readFileSync(statePath));state.curls=(state.curls||0)+1;fs.writeFileSync(statePath,JSON.stringify(state));
 process.exit(process.env.DRILL_FAILURE==='smoke'&&state.curls===1?22:0);
}
if(tool==='rsync'){
 const forwarding=args.some(a=>a.startsWith('linc-vps:'));
 const clean=args.map(a=>a.replace(/^linc-vps:/,''));const r=cp.spawnSync('/usr/bin/rsync',clean,{env:{...process.env,PATH:'/usr/bin:/bin'},encoding:'utf8'});
 if(forwarding&&r.status===0){for(const dir of ['data','submissions','analytics']){const db=new (require('node:sqlite').DatabaseSync)(path.join(root,'app',dir,'fixture.sqlite'));db.exec("UPDATE fixture SET value='post-deploy fixture retained'");db.close();}}
 if(forwarding&&r.status===0&&process.env.DRILL_FAILURE==='rsync')process.exit(23);done(r);
}
if(tool==='node'){
 // Deployment pre-upgrade online backup is independently tested; avoid creating databases here.
 if(args.includes('--input-type=module'))process.exit(0);
 done(cp.spawnSync(process.env.REAL_NODE,args,{env:process.env,encoding:'utf8'}));
}
if(tool==='systemctl'){
 const state=JSON.parse(fs.readFileSync(statePath)),verb=args.shift();
 const names=args.filter(a=>!a.startsWith('-')).map(n=>n.endsWith('.service')||n.endsWith('.timer')?n:n+'.service');
 if(verb==='is-active'||verb==='is-enabled'){
  const values=names.map(n=>state.units[n][verb==='is-active'?'active':'enabled']);if(!args.includes('--quiet'))console.log(values.join('\n'));
  process.exit(values.every(v=>v==='active'||v==='enabled')?0:1);
 }
 for(const name of names){const u=state.units[name];if(!u)continue;if(verb==='stop')u.active='inactive';if(verb==='start'||verb==='restart')u.active='active';if(verb==='enable'){u.enabled='enabled';if(args.includes('--now'))u.active='active';}if(verb==='disable')u.enabled='disabled';}
 fs.writeFileSync(statePath,JSON.stringify(state));process.exit(0);
}
throw new Error('Unexpected fixture tool '+tool);
`;

for(const failure of ['rsync','smoke'])test(`real deploy EXIT trap restores fixture after ${failure} failure`,()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'radar-deploy-drill-'));
 const checkout=path.join(root,'checkout'),app=path.join(root,'app'),units=path.join(root,'units'),bin=path.join(root,'bin');
 try{
  for(const dir of [checkout,app,units,bin,path.join(root,'temp')])mkdirSync(dir);
  mkdirSync(path.join(root,'etc'));writeFileSync(path.join(root,'etc','web.env'),'ADMIN_TEST_TOKEN=private-fixture\n');
  cpSync('deploy',path.join(checkout,'deploy'),{recursive:true});mkdirSync(path.join(checkout,'lib'));writeFileSync(path.join(checkout,'lib','backup.mjs'),'// fixture');
  const source=readFileSync('deploy/deploy.sh','utf8').replace('APP_DIR=/opt/linc/apps/price-radar',`APP_DIR=${app}`).replace('BACKUP_DIR=/opt/linc/backups/price-radar',`BACKUP_DIR=${root}/backups`).replace('WEB_ENV=/etc/price-radar/web.env',`WEB_ENV=${root}/etc/web.env`);
  writeFileSync(path.join(checkout,'deploy','deploy.sh'),source);
  writeFileSync(path.join(checkout,'web.mjs'),'new');writeFileSync(path.join(checkout,'introduced.mjs'),'new');writeFileSync(path.join(app,'web.mjs'),'old');
  for(const dir of ['data','submissions','analytics','merchant-bridge','backups','.git']){
   mkdirSync(path.join(app,dir));const file=path.join(app,dir,'fixture.sqlite');
   if(['data','submissions','analytics'].includes(dir)){const db=new DatabaseSync(file);db.exec("CREATE TABLE fixture(value TEXT);INSERT INTO fixture VALUES('pre-deploy fixture')");db.close();}
   else writeFileSync(file,'private fixture retained');
  }
  writeFileSync(path.join(app,'config.json'),'fixture config retained');
  const envText=['PUBLIC_ORIGIN','SUBMISSIONS_DB_PATH','SUBMISSIONS_BACKUP_DIR','ANALYTICS_DB_PATH','ANALYTICS_BACKUP_DIR','SUBMISSION_HASH_SECRET'].map(k=>k+'=fixture').join('\n');writeFileSync(path.join(app,'.env'),envText);
  const names=['price-radar-web.service','price-radar-collect.service','price-radar-backup.service','price-radar-backup.timer','price-radar-named-tunnel.service'];
  const original=Object.fromEntries(names.map((name,i)=>[name,{active:i===2?'inactive':'active',enabled:i===2?'disabled':'enabled'}]));
  for(const name of names)writeFileSync(path.join(units,name),'old actual '+name);
  writeFileSync(path.join(root,'state.json'),JSON.stringify({units:original}));
  const shim=path.join(bin,'adapter.cjs');writeFileSync(shim,`#!${process.execPath}\n${adapter}`,{mode:0o755});
  for(const name of ['ssh','scp','sudo','npm','git','curl','rsync','systemctl','node'])symlinkSync(shim,path.join(bin,name));
  const result=spawnSync('/bin/bash',[path.join(checkout,'deploy','deploy.sh')],{env:{...process.env,DRILL_ROOT:root,DRILL_FAILURE:failure,REAL_NODE:process.execPath,UNIT_DIR:units,PATH:bin+':'+process.env.PATH},encoding:'utf8',timeout:20000});
  assert.notEqual(result.status,0);assert.notEqual(result.status,70,result.stderr);assert.match(result.stderr,/restoring previous code/);
  assert.equal(readFileSync(path.join(app,'web.mjs'),'utf8'),'old');assert.equal(existsSync(path.join(app,'introduced.mjs')),false);
  for(const name of names)assert.equal(readFileSync(path.join(units,name),'utf8'),'old actual '+name);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root,'state.json'))).units,original);
  for(const dir of ['data','submissions','analytics']){const db=new DatabaseSync(path.join(app,dir,'fixture.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT value FROM fixture').get().value,'post-deploy fixture retained');assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');}finally{db.close();}}
  for(const dir of ['merchant-bridge','backups','.git'])assert.equal(readFileSync(path.join(app,dir,'fixture.sqlite'),'utf8'),'private fixture retained');
  assert.equal(readFileSync(path.join(app,'.env'),'utf8'),envText+(failure==='smoke'?`\nMERCHANT_BRIDGE_DIR=${app}/merchant-bridge\n`:''));assert.equal(readFileSync(path.join(app,'config.json'),'utf8'),'fixture config retained');
  assert.equal(readFileSync(path.join(root,'etc','web.env'),'utf8'),'ADMIN_TEST_TOKEN=private-fixture\n'+(failure==='smoke'?`\nMERCHANT_BRIDGE_DIR=${app}/merchant-bridge\n`:''));
  assert.ok(!result.stdout.includes('private-fixture'));assert.ok(!result.stderr.includes('private-fixture'));
 }finally{
  if(existsSync(path.join(root,'state.json'))){const temp=JSON.parse(readFileSync(path.join(root,'state.json'))).remoteTemp;if(/^\/tmp\/price-radar-deploy\.[A-Za-z0-9]+$/.test(temp||''))rmSync(temp,{recursive:true,force:true});}
  rmSync(root,{recursive:true,force:true});
 }
});
