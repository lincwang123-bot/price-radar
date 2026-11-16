import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sharedMerchantReadRate} from '../lib/merchant-public-read-rate.mjs';
function setup(t){
 const dataDir=mkdtempSync(path.join(tmpdir(),'merchant-rate-test-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
 t.mock.timers.enable({apis:['Date'],now:100000});
 const options={dataDir,origin:'https://rate.example.org',minimumMs:10000,deadline:200000,sleep:async ms=>t.mock.timers.tick(ms)};
 return {options,dir:path.join(dataDir,'merchant-preflights','.public-read-rate')};
}
test('independent workers cannot start overlapping requests; completed and failed attempts both retain cooldown',async t=>{
 const {options}=setup(t);let resolve;const starts=[];
 const first=sharedMerchantReadRate(()=>{starts.push(Date.now());return new Promise(r=>{resolve=r;});},options);
 const second=sharedMerchantReadRate(async()=>{starts.push(Date.now());throw new Error('network failed');},options);
 const running=first('https://rate.example.org/');await Promise.resolve();
 const child=execFileSync(process.execPath,['--input-type=module','-e',`import {sharedMerchantReadRate} from './lib/merchant-public-read-rate.mjs';try{await sharedMerchantReadRate(()=>{throw Error('request must not start')},{dataDir:process.argv[1],origin:'https://rate.example.org',minimumMs:10000,deadline:Date.now()+20000})('https://rate.example.org/');process.exitCode=1;}catch(e){if(e.code!=='PREFLIGHT_INTERNAL_ERROR')throw e;console.log('blocked');}`,options.dataDir],{encoding:'utf8',timeout:5000});
 assert.equal(child.trim(),'blocked');
 await assert.rejects(second('https://rate.example.org/'),/锁被占用/);assert.equal(starts.length,1);
 t.mock.timers.tick(5000);resolve(new Response('ok'));await running;
 await assert.rejects(second('https://rate.example.org/'),/network failed/);assert.equal(starts[1],115000);
 const third=sharedMerchantReadRate(async()=>{starts.push(Date.now());return new Response('ok');},options);
 await third('https://rate.example.org/');assert.equal(starts[2],125000);
});
test('insufficient time, corrupt state and a crash lock fail closed with zero additional requests',async t=>{
 const {options,dir}=setup(t);let calls=0;const fn=async()=>{calls++;return new Response('ok');};
 await sharedMerchantReadRate(fn,options)('https://rate.example.org/');
 await assert.rejects(sharedMerchantReadRate(fn,{...options,deadline:Date.now()+5000})('https://rate.example.org/'),/超时/);
 const file=path.join(dir,readdirSync(dir).find(f=>f.endsWith('.json')));writeFileSync(file,'{}');
 await assert.rejects(sharedMerchantReadRate(fn,options)('https://rate.example.org/'),/状态无效/);
 writeFileSync(file+'.lock','previous process crashed');
 await assert.rejects(sharedMerchantReadRate(fn,options)('https://rate.example.org/'),/锁被占用/);assert.equal(calls,1);
});
