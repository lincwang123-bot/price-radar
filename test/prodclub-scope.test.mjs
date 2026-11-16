import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';

const origin='https://prodclub.xyz';
const merchant={id:'merchant-prodclub',identity:'domain:prodclub.xyz',shopName:'ProdClub',shopUrl:origin+'/r/KRXMTA',platform:'independent'};
function fixture(t,robots,html='<div id="app"></div><script src="/assets/app.js"></script>',catalog=null){
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const dataDir=mkdtempSync(path.join(tmpdir(),'prodclub-scope-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
 const calls=[],limits=[];
 const ctx={dataDir,sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:(_origin,networkOptions)=>{limits.push(networkOptions.maxRequests);return async(value,init)=>{
  const url=String(value);calls.push({url,method:init.method||'GET',agent:new Headers(init.headers).get('user-agent'),at:Date.now()});
  if(url.endsWith('/robots.txt'))return new Response(robots,{headers:{'content-type':'text/plain'}});
  if(catalog&&url===origin+'/api/v1/offers?limit=20')return new Response(JSON.stringify(catalog),{headers:{'content-type':'application/json'}});
  if(url===merchant.shopUrl)return new Response(html,{headers:{'content-type':'text/html'}});
  return new Response('missing',{status:404});
 }}};
 return {calls,limits,run:(input=merchant)=>probeMerchantCatalog(input,ctx,new Date().toISOString(),Date.now()+30000)};
}
test('the verified referral entrance reads the default public catalogue without promotion or conventional endpoint guesses',async t=>{
 const f=fixture(t,'User-agent: *\nAllow: /',undefined,{data:{items:[],next_cursor:null}});
 assert.deepEqual((await f.run()).offers,[]);
 assert.deepEqual(f.limits,[4]);
 assert.deepEqual(f.calls.map(c=>c.url),[origin+'/robots.txt',origin+'/api/v1/offers?limit=20']);
 assert.ok(f.calls[1].at-f.calls[0].at>=1100);
});
test('ProdClub public API adapter obeys robots before making an API request',async t=>{
 const f=fixture(t,'User-agent: *\nDisallow: /api/');
 await assert.rejects(f.run(),error=>error.code==='ROBOTS_DISALLOWED');
 assert.deepEqual(f.calls.map(c=>c.url),[origin+'/robots.txt']);
});
test('explicit page-only merchant permission takes priority over the ProdClub API adapter',async t=>{
 const f=fixture(t,'User-agent: *\nAllow: /\nCrawl-delay: 3');
 await assert.rejects(f.run({...merchant,collectionAccess:{mode:'public_pages_only',replyId:20,publicUrls:[merchant.shopUrl],minimumIntervalMs:1100,permissionScope:'ongoing'}}),error=>error.code==='PAGE_REQUIRES_RENDERING');
 assert.deepEqual(f.calls.map(c=>c.url),[origin+'/robots.txt',merchant.shopUrl]);
 assert.ok(f.calls[1].at-f.calls[0].at>=3000);
 assert.ok(f.calls.every(c=>c.method==='GET'&&c.agent==='AiradarBot/1.0 (+https://airadar.vip)'));
});
test('a different merchant origin cannot trigger the reviewed ProdClub endpoint',async t=>{
 const f=fixture(t,'User-agent: *\nAllow: /');
 const result=await f.run({...merchant,identity:'domain:other.example.net',shopUrl:'https://other.example.net/r/KRXMTA'});
 assert.equal(result.unsupported,true);
 assert.ok(f.calls.every(c=>new URL(c.url).origin==='https://other.example.net'));
 assert.ok(f.calls.every(c=>new URL(c.url).pathname!=='/api/v1/offers'));
});
