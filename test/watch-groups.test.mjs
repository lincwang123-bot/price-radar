import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,openDbReadOnly,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {runWatch} from '../lib/watch.mjs';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const cfg={rules:[{id:'drop',source:'direct-shops',product:'chatgpt-plus-recharge',kind:'drop_pct',pct:8,window:24}]};
test('Web旧表只读正常，新提醒列在线升级后同只读连接显示规格链接',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'radar-watch-reader-')),file=path.join(dir,'data.sqlite'),db=openDb(file),reader=openDbReadOnly(file),app=createApp({db:reader});
 try{
  db.prepare('INSERT INTO alerts(ts,source,product_id,product_name,kind,message) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(),'ldxp-goods','old','旧提醒','min_below','历史 ¥88');
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  assert.match(await(await fetch(base+'/alerts')).text(),/历史 ¥88/);
  save(db,'1',[['1个月',100]]);const events=runWatch(db,{rules:[{id:'monthly',source:'direct-shops',kind:'min_below',term:'1m',threshold:105}]});assert.equal(events.length,1);
  const html=await(await fetch(base+'/alerts')).text();assert.ok(html.includes('spec='+encodeURIComponent(events[0].groupId)));assert.match(html,/历史 ¥88/);assert.throws(()=>reader.exec('CREATE TABLE x(id)'),/readonly/i);
 }finally{if(app.listening)await new Promise(r=>app.close(r));reader.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
function save(db,id,offers,{stale=false}={}){storeSnapshot(db,{source:'direct-shops',snapshotId:id,fetchedAt:new Date(Date.now()-60000+Number(id)*1000).toISOString(),stale,products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:offers.map(([term,price,extra={}],i)=>({offerId:term+i,title:'ChatGPT Plus 代充 '+term,price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://morimm.com/products/'+term,...extra}))}]});}
test('提醒同规格独立窗口，新周期和缺失周期不制造降价，重复运行不重复',()=>{const db=openDb(':memory:');try{
 save(db,'1',[['1年',1000]]);assert.deepEqual(runWatch(db,cfg),[]);
 save(db,'2',[['1年',1000],['1个月',100],['',1]]);assert.deepEqual(runWatch(db,cfg),[]);
 save(db,'3',[['1年',1000],['1个月',90],['',1]]);const events=runWatch(db,cfg);assert.equal(events.length,1);assert.match(events[0].groupId,/^1m:/);assert.match(events[0].message,/1 个月/);assert.equal(db.prepare('SELECT group_id FROM alerts').get().group_id,events[0].groupId);assert.deepEqual(runWatch(db,cfg),[]);
}finally{db.close();}});
test('旧自定义规则原source保留，同规格换店和全无货提醒保持隔离',()=>{
 const db=openDb(':memory:');try{
 const rule={rules:[{id:'custom',source:'direct-shops',product:'chatgpt-plus-recharge',kind:'cheapest_changed'}]};
 save(db,'1',[['1个月',110,{url:'https://morimm.com/products/a'}]]);assert.equal(runWatch(db,rule).length,0);
 save(db,'2',[['1个月',100,{url:'https://morimm.com/products/b'}],['1年',5]]);const changed=runWatch(db,rule);assert.equal(changed.length,1);assert.match(changed[0].groupId,/^1m:/);assert.match(changed[0].message,/¥110 →.*¥100/);
 const gone={rules:[{...rule.rules[0],id:'gone',kind:'offer_gone'}]};runWatch(db,gone);
 save(db,'3',[['1个月',100,{status:'out_of_stock',stockCount:0}],['1年',5]]);assert.equal(runWatch(db,gone).filter(e=>e.groupId.startsWith('1m:')).length,1);assert.equal(runWatch(db,gone).length,0);
 const legacy={rules:[{id:'legacy',source:'ldxp-goods',kind:'min_below',threshold:105,product:'chatgpt-plus-recharge'}]};storeSnapshot(db,{source:'ldxp-goods',snapshotId:'legacy',products:[{productId:'chatgpt-plus-recharge',currency:'CNY',offers:[{offerId:'x',title:'ChatGPT Plus 代充 1个月',price:90,currency:'CNY',status:'in_stock',stockCount:1}]}]});assert.equal(runWatch(db,legacy)[0].source,'ldxp-goods');
 }finally{db.close();}
});
test('月付阈值过滤旧、无货、无质保，partial整轮跳过且恢复不重复',()=>{const db=openDb(':memory:');try{
 const rules={rules:[{id:'min',source:'direct-shops',product:'chatgpt-plus-recharge',kind:'min_below',threshold:105,term:'1m',currency:'CNY'}]};
 save(db,'1',[['1年',50],['1个月',110],['1个月',1,{status:'out_of_stock',stockCount:0}],['1个月 无质保',2],['1个月',3,{capturedAt:'2020-01-01T00:00:00Z'}]]);assert.deepEqual(runWatch(db,rules),[]);
 save(db,'2',[['1个月',100,{extra:{quoteHealth:{status:'ok'}}}],['1个月',1,{extra:{quoteHealth:{status:'failed'}}}]],{stale:true});assert.equal(runWatch(db,rules).length,0);assert.equal(db.prepare("SELECT value FROM meta WHERE key='watch_wm_direct-shops'").get().value,'1');
 save(db,'3',[['1个月',100,{extra:{quoteHealth:{status:'ok'}}}]]);assert.equal(runWatch(db,rules).length,0);
 save(db,'4',[['1个月',100,{extra:{quoteHealth:{status:'ok'}}}]]);assert.equal(runWatch(db,rules).length,1);assert.equal(runWatch(db,rules).length,0);
}finally{db.close();}});
