import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot,metaSet} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('HTTP warm catalog avoids re-projection; updated prices, stock and failed health immediately replace it',async()=>{
 const db=openDb(':memory:');let healthReads=0;
 const wrapped=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(sql==='SELECT value FROM meta WHERE key = ?')healthReads++;return target.prepare(sql);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const now=new Date().toISOString();storeSnapshot(db,{source:'direct-shops',snapshotId:'speed-fixture',fetchedAt:now,products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'one',title:'ChatGPT Plus iOS 代充 1个月',price:129,status:'in_stock',currency:'CNY',url:'https://fixture.example/buy/1',capturedAt:now}]}]});
 const app=createApp({db:wrapped});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const route='http://127.0.0.1:'+app.address().port+'/?family=chatgpt&product=chatgpt-plus&delivery=recharge',read=async()=>await(await fetch(route)).text();
  assert.match(await read(),/data-price="129"/);const cold=healthReads;assert.ok(cold>0);
  assert.match(await read(),/data-price="129"/);assert.equal(healthReads,cold);
  db.prepare('UPDATE offers SET price=141').run();assert.match(await read(),/data-price="141"/);assert.ok(healthReads>cold);
  db.prepare("UPDATE offers SET status='out_of_stock'").run();assert.doesNotMatch(await read(),/data-price="141"/);
  db.prepare("UPDATE offers SET status='in_stock'").run();assert.match(await read(),/data-price="141"/);
  metaSet(db,'health:direct-shops',JSON.stringify({status:'failed',checkedAt:new Date(Date.now()+1).toISOString()}));const failed=await read();assert.match(failed,/data-price="141"/);assert.match(failed,/本次更新失败，价格待核对/);assert.ok(failed.includes('datetime="'+now+'"'));
  metaSet(db,'health:direct-shops',JSON.stringify({status:'ok',checkedAt:new Date().toISOString()}));assert.doesNotMatch(await read(),/本次更新失败，价格待核对/);
 }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();}
});
