import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('Chinese and English quote conditions display term states before numeric units',async()=>{
 const db=openDb(':memory:');let app;
 const cases=[['ambiguous','单月 两月 三月','待确认'],['unknown','','未注明'],['monthly','1个月','1 个月'],['daily','30天','30 天']];
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'term-rendering',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:cases.map(([id,term],i)=>({offerId:id,title:'ChatGPT Plus 成品账号 '+term,storeName:'Term '+id,price:100+i,currency:'CNY',status:'in_stock',stockCount:1,url:'https://term-'+id+'.example/item'}))}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+app.address().port;
  for(const path of ['/prices/chatgpt-plus','/en/prices/chatgpt-plus']){
   const response=await fetch(origin+path),html=await response.text();assert.equal(response.status,200);
   for(const [, ,label] of cases)assert.ok(html.includes('订阅期限：'+label+'；'),path+' / '+label);
   assert.doesNotMatch(html,/a 个月biguous|订阅期限：(?:ambiguous|unknown)/);
  }
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));assert.equal(app.listening,false);await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();}db.close();}
});
