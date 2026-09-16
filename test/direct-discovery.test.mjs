import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {discover16688,loadDiscovered16688} from '../lib/direct-discovery.mjs';
import {collect16688} from '../collectors/direct/platform16688.mjs';
import {pull} from '../sources/direct-shops.mjs';
import {openDb,metaGet} from '../lib/db.mjs';

function fixture(t){const dataDir=mkdtempSync(path.join(tmpdir(),'direct-discovery-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));return dataDir;}
function fetcher(calls,{denied=false,robots='',mismatch=false}={}){return async(url,init)=>{
  const p=new URL(url).pathname;calls.push(p);
  if(p==='/robots.txt')return new Response(robots);
  if(denied)return new Response('denied',{status:403});
  if(p==='/index/SourceGoods/list')return Response.json({code:1,data:{total:2,list:[{goods_no:'G1',name:'ChatGPT Plus',agent_price:1,merchant:{email:'ignored@example.org'}},{goods_no:'G2',name:'Claude Pro',agent_price:2}]}});
  if(p==='/shopApi/goods/detail')return Response.json({code:1,data:{goods_no:mismatch?'G99':JSON.parse(init.body).goods_no,shop_no:'S999',price:120}});
  if(p==='/shopApi/shop/detail')return Response.json({code:1,data:{shop_no:'S999',name:'新店',contact_qq:'never persisted'}});
  if(p==='/shopApi/goods/list')return Response.json({code:1,data:{list:[{goods_no:'G1',shop_no:'S999',name:'ChatGPT Plus 月卡代充',price:120,agent_price:1,stock_available_quantity:3}]}});
  throw new Error('unexpected path '+p);
};}
test('original directory discovers unique stores, persists no wholesale price/contact, then collects retail',async t=>{
  const dataDir=fixture(t),calls=[],fetchImpl=fetcher(calls);
  const result=await discover16688({dataDir,fetchImpl,sleep:async()=>{}});
  assert.equal(result.status,'ok');assert.equal(result.targets.length,1);assert.equal(result.discoveredCount,1);
  const targets=loadDiscovered16688(dataDir);assert.equal(targets.length,1);
  const rows=await collect16688(targets[0],{fetchImpl});assert.equal(rows[0].price,120);
  const persisted=readFileSync(path.join(dataDir,'direct-discovery','16688.json'),'utf8');
  for(const forbidden of ['agent_price','ignored@example.org','contact_qq','never persisted'])assert.ok(!persisted.includes(forbidden));
  const count=calls.length;await discover16688({dataDir,fetchImpl,sleep:async()=>{}});assert.equal(calls.length,count);
  assert.ok(calls.every(p=>!/(?:login|order|merchant\/)/.test(p)));
});
test('restriction stops immediately, no unverified identity persists',async t=>{
  for(const options of [{denied:true},{robots:'User-agent: *\nDisallow: /shopApi/'},{mismatch:true}]) {
    const dataDir=fixture(t),calls=[];
    const result=await discover16688({dataDir,fetchImpl:fetcher(calls,options),sleep:async()=>{}});
    assert.equal(result.targets.length,0);
    assert.equal(loadDiscovered16688(dataDir).length,0);
    if(options.denied)assert.equal(calls.length,2);
    if(options.robots)assert.equal(calls.length,1);
    if(options.mismatch)assert.ok(result.failures>0);
  }
});
test('truncated or repeated discovery page is not treated as a complete directory',async t=>{
  const dataDir=fixture(t);
  const result=await discover16688({dataDir,sleep:async()=>{},fetchImpl:async url=>new URL(url).pathname==='/robots.txt'?new Response(''):Response.json({code:1,data:{total:100,list:[{goods_no:'G1',name:'ChatGPT Plus'}]}})});
  assert.equal(result.status,'failed');assert.equal(result.targets.length,0);assert.equal(result.reasonCode,'invalid_catalog');
});
test('discovered store joins scheduled direct-source retail quotes; restrictions stop all same-origin reads',async t=>{
  for(const blocked of [false,true]){
    const dataDir=fixture(t),db=openDb(':memory:');t.after(()=>db.close());const calls=[];
    const base=fetcher(calls,{robots:blocked?'User-agent: *\nDisallow: /shopApi/':''});
    const result=await pull({db,dataDir,sleep:async()=>{},config:{sources:{'direct-shops':{targets:['aisou'],discovery:{platform16688:true}}}},
      fetchImpl:async(url,init)=>new URL(url).hostname==='aisou.pro'?Response.json({code:200,total:0,data:[]}):base(url,init)});
    const quotes=result.snapshot.products.flatMap(p=>p.offers);
    assert.equal(quotes.length,blocked?0:1);
    if(!blocked){assert.equal(quotes[0].price,120);assert.equal(quotes[0].sourceId,'16688-s999');assert.equal(quotes[0].extra.quoteHealth.status,'ok');}
    const discovery=JSON.parse(metaGet(db,'health:direct-discovery'));
    assert.equal(discovery.storeCount,blocked?0:1);
    if(blocked)assert.deepEqual(calls,['/robots.txt']);
  }
});
test('an existing discovered roster survives discovery failure without converting wholesale data to quotes',async t=>{
  const dataDir=fixture(t);await discover16688({dataDir,fetchImpl:fetcher([]),sleep:async()=>{}});
  const calls=[];const result=await discover16688({dataDir,refresh:true,fetchImpl:fetcher(calls,{denied:true}),sleep:async()=>{}});
  assert.equal(result.status,'failed');assert.equal(result.blockedOrigin,'https://www.16688.com.cn');assert.equal(result.targets.length,1);
  assert.equal(loadDiscovered16688(dataDir).length,1);assert.equal(calls.length,2);
});
