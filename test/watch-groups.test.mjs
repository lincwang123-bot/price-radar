import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,openDbReadOnly,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {runWatch} from '../lib/watch.mjs';
import {migrateWatchDefaults} from '../scripts/migrate-watch-defaults.mjs';
import {migrateFile} from '../scripts/migrate-watch-defaults.mjs';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const cfg={rules:[{id:'drop',source:'direct-shops',product:'chatgpt-plus-recharge',kind:'drop_pct',pct:8,window:24}]};
test('只迁移精确旧默认规则，禁用状态与用户自定义不变且幂等',()=>{
 const min={id:'chatgpt-plus-recharge-below-105',kind:'min_below',source:'priceai',product:'chatgpt-plus-recharge',threshold:105};
 const drop={id:'chatgpt-any-drop-8pct',kind:'drop_pct',source:'priceai',window:24,pct:8,enabled:false};
 const input={watch:{rules:[min,drop,{...min,threshold:90},{...drop,product:'claude-pro-month'},{...min,id:'my-rule'}]},notify:{token:'fixture'}};
 const result=migrateWatchDefaults(input);assert.equal(result.changed.length,2);assert.equal(result.config.watch.rules[0].term,'1m');assert.equal(result.config.watch.rules[0].threshold,105);assert.equal(result.config.watch.rules[1].enabled,false);assert.deepEqual(result.config.watch.rules.slice(2),input.watch.rules.slice(2));assert.equal(input.watch.rules[0].source,'priceai');assert.deepEqual(migrateWatchDefaults(result.config).changed,[]);
});
test('配置迁移默认dry-run，apply原字节备份且重复运行不改文件',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'radar-watch-migrate-')),file=path.join(dir,'config.json');
 try{const original=JSON.stringify({watch:{rules:[{id:'chatgpt-plus-recharge-below-105',source:'priceai',kind:'min_below',product:'chatgpt-plus-recharge',threshold:105}]},custom:{value:'keep'}});writeFileSync(file,original);assert.equal(migrateFile(file).applied,false);assert.equal(readFileSync(file,'utf8'),original);assert.equal(readdirSync(dir).length,1);assert.equal(migrateFile(file,{apply:true}).applied,true);const migrated=readFileSync(file,'utf8');assert.equal(migrateFile(file,{apply:true}).applied,false);assert.equal(readFileSync(file,'utf8'),migrated);const backups=readdirSync(path.join(dir,'backups')).filter(f=>f.includes('before-watch'));assert.equal(backups.length,1);assert.equal(statSync(path.join(dir,'backups')).mode&0o777,0o700);assert.equal(statSync(path.join(dir,'backups',backups[0])).mode&0o777,0o600);assert.equal(readFileSync(path.join(dir,'backups',backups[0]),'utf8'),original);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('Web旧表只读正常，新提醒列在线升级后同只读连接显示规格链接',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'radar-watch-reader-')),file=path.join(dir,'data.sqlite'),db=openDb(file),reader=openDbReadOnly(file),app=createApp({db:reader});
 try{
  db.prepare('INSERT INTO alerts(ts,source,product_id,product_name,kind,message) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(),'priceai','old','旧提醒','min_below','历史 ¥88');
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
 const legacy={rules:[{id:'legacy',source:'priceai',kind:'min_below',threshold:105,product:'chatgpt-plus-recharge'}]};storeSnapshot(db,{source:'priceai',snapshotId:'legacy',products:[{productId:'chatgpt-plus-recharge',currency:'CNY',offers:[{offerId:'x',title:'ChatGPT Plus 代充 1个月',price:90,currency:'CNY',status:'in_stock',stockCount:1}]}]});assert.equal(runWatch(db,legacy)[0].source,'priceai');
 }finally{db.close();}
});
test('月付阈值过滤旧、无货、无质保，partial整轮跳过且恢复不重复',()=>{const db=openDb(':memory:');try{
 const rules={rules:[{id:'min',source:'direct-shops',product:'chatgpt-plus-recharge',kind:'min_below',threshold:105,term:'1m',currency:'CNY'}]};
 save(db,'1',[['1年',50],['1个月',110],['1个月',1,{status:'out_of_stock',stockCount:0}],['1个月 无质保',2],['1个月',3,{capturedAt:'2020-01-01T00:00:00Z'}]]);assert.deepEqual(runWatch(db,rules),[]);
 save(db,'2',[['1个月',100,{extra:{quoteHealth:{status:'ok'}}}],['1个月',1,{extra:{quoteHealth:{status:'failed'}}}]],{stale:true});assert.equal(runWatch(db,rules).length,0);assert.equal(db.prepare("SELECT value FROM meta WHERE key='watch_wm_direct-shops'").get().value,'1');
 save(db,'3',[['1个月',100,{extra:{quoteHealth:{status:'ok'}}}]]);assert.equal(runWatch(db,rules).length,0);
 save(db,'4',[['1个月',100,{extra:{quoteHealth:{status:'ok'}}}]]);assert.equal(runWatch(db,rules).length,1);assert.equal(runWatch(db,rules).length,0);
}finally{db.close();}});
