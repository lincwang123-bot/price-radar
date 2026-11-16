import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {INDEXNOW_KEY,INDEXNOW_KEY_PATH,INDEXNOW_ORIGIN,INDEXNOW_ENDPOINT,indexNowUrl,planIndexNow,verifyIndexNowKey,verifyIndexNowPage,notifyIndexNow} from '../lib/indexnow.mjs';
const now=Date.parse('2026-09-28T12:00:00Z');
const state=()=>({version:1,activatedAt:'2026-09-28T10:00:00Z',accepted:[],pending:[]});
const change=(extra={})=>({url:'https://airadar.vip/prices/chatgpt-plus',changedAt:'2026-09-28T11:00:00Z',revision:'a'.repeat(64),reason:'Published reviewed buying conditions',...extra});

test('verification proof is exact, public, read-only and absent from sitemap',async()=>{
 const db=openDb(':memory:'),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 try{
  const get=await fetch(origin+INDEXNOW_KEY_PATH);assert.equal(get.status,200);assert.equal(await get.text(),INDEXNOW_KEY);assert.match(get.headers.get('content-type'),/^text\/plain/);assert.match(get.headers.get('x-robots-tag'),/noindex/);assert.equal(get.headers.get('content-length'),String(Buffer.byteLength(INDEXNOW_KEY)));
  const head=await fetch(origin+INDEXNOW_KEY_PATH,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const method of ['POST','PUT','DELETE']){const r=await fetch(origin+INDEXNOW_KEY_PATH,{method});assert.equal(r.status,405);await r.body?.cancel();}
  for(const path of [INDEXNOW_KEY_PATH+'/',INDEXNOW_KEY_PATH+'?x=1','/indexnow-unknown.txt']){const r=await fetch(origin+path);assert.equal(r.status,404);await r.body?.cancel();}
  const sitemap=await(await fetch(origin+'/sitemap.xml')).text();assert.ok(!sitemap.includes(INDEXNOW_KEY));
 }finally{await new Promise(r=>app.close(r));db.close();}
});
test('only reviewed public canonical URLs can be notified',()=>{
 assert.equal(indexNowUrl('/guides/read-price-changes'),INDEXNOW_ORIGIN+'/guides/read-price-changes');
 assert.equal(indexNowUrl('/?family=gemini&product=gemini-claim-link'),INDEXNOW_ORIGIN+'/?family=gemini&product=gemini-claim-link');
 for(const path of ['/admin','/following','/login','/api/products','/product?id=123','/prices/chatgpt-plus?sort=price','/guides/missing','/#fragment','https://evil.example/','https://airadar.vip.evil.example/','https://user@airadar.vip/','http://airadar.vip/'])assert.throws(()=>indexNowUrl(path));
});
test('planning excludes history, duplicate releases, uncertain attempts and rapid repeats',()=>{
 const s=state();assert.equal(planIndexNow({changes:[change()]},s,now).selected.length,1);
 const cases=[['predates_activation',{...s},change({changedAt:'2026-09-27T12:00:00Z'})],['already_accepted',{...s,accepted:[{...change(),submittedAt:'2026-09-28T11:00:00Z'}]},change()],['previous_attempt_uncertain',{...s,pending:[change()]},change()],['five_minute_cooldown',{...s,accepted:[change({revision:'b'.repeat(64),submittedAt:'2026-09-28T11:59:00Z'})]},change()]];
 for(const [why,st,c] of cases){const p=planIndexNow({changes:[c]},st,now);assert.equal(p.selected.length,0);assert.equal(p.skipped[0].why,why);}
 assert.throws(()=>planIndexNow({changes:[change(),change()]},s,now));
 assert.throws(()=>planIndexNow({changes:[change({changedAt:'2026-09-29T12:00:00Z'})]},s,now));
 assert.throws(()=>planIndexNow({changes:[change({revision:'invented'})]},s,now));
 assert.throws(()=>planIndexNow({changes:Array(21).fill(change())},s,now));
});
test('live preflight rejects wrong proof, noindex, redirects and canonical mismatch',async()=>{
 await verifyIndexNowKey(async(url,opts)=>{assert.equal(url,INDEXNOW_ORIGIN+INDEXNOW_KEY_PATH);assert.equal(opts.redirect,'error');return new Response(INDEXNOW_KEY);});
 await assert.rejects(verifyIndexNowKey(async()=>new Response('wrong')));
 const url=change().url,html='<link href="'+url+'" rel="canonical"><meta content="index, follow" name="robots">';
 await verifyIndexNowPage(url,async()=>new Response(html,{headers:{'Content-Type':'text/html'}}));
 for(const body of [html.replace('index, follow','noindex'),html.replace('index, follow','none'),html.replace(url,INDEXNOW_ORIGIN+'/')])await assert.rejects(verifyIndexNowPage(url,async()=>new Response(body,{headers:{'Content-Type':'text/html'}})));
 await assert.rejects(verifyIndexNowPage(url,async()=>new Response(html,{headers:{'Content-Type':'text/html','X-Robots-Tag':'noindex'}})));
 await assert.rejects(verifyIndexNowPage(url,async()=>new Response(html,{status:301,headers:{'Content-Type':'text/html'}})));
});
test('notifications use only public URLs and distinguish received from key pending',async()=>{
 for(const status of [200,202,429]){
  const result=await notifyIndexNow([change()],async(url,options)=>{
   assert.equal(url,INDEXNOW_ENDPOINT);assert.equal(options.method,'POST');const data=JSON.parse(options.body);assert.deepEqual(Object.keys(data).sort(),['host','key','keyLocation','urlList']);assert.deepEqual(data.urlList,[change().url]);assert.equal(data.keyLocation,INDEXNOW_ORIGIN+INDEXNOW_KEY_PATH);
   return new Response('',{status,headers:{'Retry-After':'60'}});
  });assert.equal(result.accepted,[200,202].includes(status));assert.equal(result.keyValidationPending,status===202);
 }
 await assert.rejects(notifyIndexNow([],async()=>{throw new Error('must not send')}));
});
test('CLI defaults to dry run, leaves state unchanged and cleans its lock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'airadar-indexnow-'));try{
  const statePath=join(dir,'state.json'),manifest=join(dir,'changes.json');writeFileSync(statePath,JSON.stringify({...state(),activatedAt:new Date(Date.now()-3600000).toISOString()}));writeFileSync(manifest,JSON.stringify({changes:[]}));const before=readFileSync(statePath,'utf8');
  const result=JSON.parse(execFileSync(process.execPath,['scripts/indexnow.mjs','--state',statePath,'--manifest',manifest],{encoding:'utf8'}));assert.equal(result.dryRun,true);assert.equal(result.submitted,0);assert.equal(readFileSync(statePath,'utf8'),before);assert.equal(existsSync(statePath+'.lock'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('reviewed CLI --send verifies key and canonical then POSTs through a fake fetch',()=>{
 const dir=mkdtempSync(join(tmpdir(),'airadar-indexnow-send-'));
 try{
  const statePath=join(dir,'state.json'),manifest=join(dir,'changes.json'),capture=join(dir,'requests.json'),stub=join(dir,'fake-fetch.mjs');
  const release=change({changedAt:new Date(Date.now()-60000).toISOString()});
  writeFileSync(statePath,JSON.stringify({...state(),activatedAt:new Date(Date.now()-3600000).toISOString()}));
  writeFileSync(manifest,JSON.stringify({changes:[release]}));
  writeFileSync(stub,`
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {INDEXNOW_KEY,INDEXNOW_KEY_PATH,INDEXNOW_ORIGIN,INDEXNOW_ENDPOINT} from ${JSON.stringify(new URL('../lib/indexnow.mjs',import.meta.url).href)};
const calls=[];
globalThis.fetch=async(url,options)=>{
 calls.push({url,method:options.method||'GET'});
 writeFileSync(${JSON.stringify(capture)},JSON.stringify(calls));
 if(url===INDEXNOW_ORIGIN+INDEXNOW_KEY_PATH)return new Response(INDEXNOW_KEY);
 if(url===${JSON.stringify(release.url)})return new Response('<link rel="canonical" href="'+url+'">',{headers:{'Content-Type':'text/html'}});
 assert.equal(url,INDEXNOW_ENDPOINT);assert.equal(options.method,'POST');
 assert.deepEqual(JSON.parse(options.body).urlList,[${JSON.stringify(release.url)}]);
 return new Response('',{status:202});
};
`);
  const output=JSON.parse(execFileSync(process.execPath,['--import',stub,'scripts/indexnow.mjs','--state',statePath,'--manifest',manifest,'--send'],{encoding:'utf8'}));
  assert.equal(output.submitted,1);assert.equal(output.accepted,true);assert.equal(output.keyValidationPending,true);
  assert.deepEqual(JSON.parse(readFileSync(capture,'utf8')).map(call=>call.method),['GET','GET','POST']);
  const saved=JSON.parse(readFileSync(statePath,'utf8'));assert.equal(saved.pending.length,0);assert.equal(saved.accepted.length,1);assert.equal(existsSync(statePath+'.lock'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
