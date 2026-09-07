import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRetentionStore,evaluateWatch} from '../lib/retention-store.mjs';
import {observeMarket,marketHistory} from '../lib/retention-market.mjs';
import {readRetentionMarket,weeklyMarket} from '../lib/retention-market.mjs';
import {openDb,storeSnapshot,metaSet} from '../lib/db.mjs';
import {drainRetentionMail,retentionMessage} from '../lib/retention-mail.mjs';
import {createRetention} from '../lib/retention.mjs';
import http from 'node:http';

const now=new Date('2026-09-08T02:00:00Z');
const group={id:'a'.repeat(24),productKey:'chatgpt-plus',name:'ChatGPT Plus',family:'chatgpt',spec:'1 个月 · 代充',comparisonKey:'1m:plus:代充:常规:地区未注明:单位未注明:CNY',currency:'CNY',state:'available',price:100,maxPrice:120,offerCount:2,shopCount:2,observedAt:now.toISOString(),fingerprint:'one'};
const market={products:[{key:'chatgpt-plus',name:'ChatGPT Plus',family:'chatgpt'}],groups:[group]};
function setup(){const db=new DatabaseSync(':memory:');const store=createRetentionStore(db,{secret:'s'.repeat(64),now:()=>now});return {db,store};}
function login(store,db,email='reader@example.com'){
 const r=store.requestCode(email,'client');
 const code=JSON.parse(db.prepare("SELECT payload FROM retention_mail WHERE kind='code' ORDER BY id DESC").get().payload).code;
 return store.verifyCode(r.requestId,code);
}
test('邮箱确认一次性验证码、账号隔离和会话撤销',()=>{
 const {db,store}=setup();try{
  const r=store.requestCode('reader@example.com','client');
  const code=JSON.parse(db.prepare('SELECT payload FROM retention_mail').get().payload).code;
  assert.throws(()=>store.verifyCode(r.requestId,'invalid'));
  const a=store.verifyCode(r.requestId,code);assert.equal(store.session(a.token).id,a.account.id);
  assert.throws(()=>store.verifyCode(r.requestId,code));
  store.saveWatch(a.account.id,{productKey:'chatgpt-plus',groupId:group.id,mode:'target',targetPrice:90},market);
  const b=login(store,db,'second@example.com');assert.equal(store.watches(b.account.id).length,0);
  assert.throws(()=>store.removeWatch(b.account.id,store.watches(a.account.id)[0].id));
  store.logout(a.token);assert.equal(store.session(a.token),null);
 }finally{db.close();}
});
test('实时目录把期限、交付和币种分开；明确售罄与采集失效不混淆',()=>{
 const quotes=openDb(':memory:');
 try{
  storeSnapshot(quotes,{source:'priceai',snapshotId:'s',fetchedAt:now.toISOString(),products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[
   {offerId:'a',title:'ChatGPT Plus 代充1个月',price:100,status:'in_stock',url:'https://shop.example/a',currency:'CNY'},
   {offerId:'b',title:'ChatGPT Plus 代充12个月',price:900,status:'in_stock',url:'https://shop.example/b',currency:'CNY'},
   {offerId:'c',title:'ChatGPT Plus 成品账号1个月',price:20,status:'in_stock',url:'https://shop.example/c',currency:'CNY'},
   {offerId:'d',title:'ChatGPT Plus 代充1个月',price:20,status:'out_of_stock',url:'https://shop.example/d',currency:'USD'},
   {offerId:'e',title:'ChatGPT Plus 代充 期限未注明',price:1,status:'in_stock',url:'https://shop.example/e',currency:'CNY'},
  ]}]});
  const m=readRetentionMarket(quotes,{now});assert.equal(m.groups.length,4);
  assert.equal(m.groups.find(g=>g.currency==='USD').state,'unavailable');
  assert.deepEqual(m.groups.filter(g=>g.state==='available').map(g=>g.price).sort((a,b)=>a-b),[20,100,900]);
  metaSet(quotes,'health:priceai',JSON.stringify({status:'failed',checkedAt:now.toISOString()}));
  assert.ok(readRetentionMarket(quotes,{now}).groups.every(g=>g.state==='unknown'));
 }finally{quotes.close();}
});
test('提醒只发给确认邮箱且暂停、删除、报价回升在发送前失效；不确定发送不重试',async()=>{
 let time=new Date(now);const db=new DatabaseSync(':memory:');const store=createRetentionStore(db,{secret:'s'.repeat(64),now:()=>time});
 try{
  const a=login(store,db),w=store.saveWatch(a.account.id,{productKey:'chatgpt-plus',groupId:group.id,mode:'target',targetPrice:95},market);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_mail WHERE kind='digest'").get().n,0);
  time=new Date(+time+1000);const lower={...market,groups:[{...group,price:90}]};store.observe(lower);store.observe(lower);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_notices').get().n,1);
  const mail=db.prepare("SELECT * FROM retention_mail WHERE kind='digest'").get();assert.ok(mail);
  assert.equal(retentionMessage(store,mail,market,'notify@example.com',{now:time}),null);
  assert.ok(retentionMessage(store,mail,lower,'notify@example.com',{now:time}));
  store.saveWatch(a.account.id,{...w,paused:true},market);
  assert.equal(retentionMessage(store,mail,lower,'notify@example.com',{now:time}),null);
  store.saveWatch(a.account.id,{...w,paused:false},market);
  const transport={sendMail:async()=>{throw Object.assign(new Error('uncertain'),{code:'ESOCKET',command:'DATA'});}};
  await drainRetentionMail(store,lower,{transport,from:'notify@example.com',now:time});
  assert.equal(db.prepare('SELECT status FROM retention_mail WHERE id=?').get(mail.id).status,'uncertain');
  await drainRetentionMail(store,lower,{transport:{sendMail:()=>assert.fail('must not retry uncertain mail')},from:'notify@example.com',now:new Date(+time+3600000)});
 }finally{db.close();}
});
test('周报只使用所选截止日期已有的同规格记录，历史不足保持空态',()=>{
 const {db}=setup();try{
  observeMarket(db,market,now);assert.equal(weeklyMarket(db,market,{now}).items.length,0);
  const next=new Date(+now+86400000);observeMarket(db,{...market,groups:[{...group,price:90,fingerprint:'two'}]},next);
  const r=weeklyMarket(db,market,{now:next});assert.equal(r.items[0].change,-10);
  assert.equal(weeklyMarket(db,market,{now:next,date:'2026-09-08'}).items.length,0);
  assert.equal(weeklyMarket(db,market,{now:next,date:'2026-02-30'}),null);
  assert.equal(weeklyMarket(db,market,{now:next,date:'2026-09-10'}),null);
 }finally{db.close();}
});
test('验证码有次数上限及到期时间；目标价不接受非有限数字',()=>{
 let time=new Date(now);const db=new DatabaseSync(':memory:');const store=createRetentionStore(db,{secret:'s'.repeat(64),now:()=>time});
 try{
  const r=store.requestCode('reader@example.com','client'),code=JSON.parse(db.prepare('SELECT payload FROM retention_mail').get().payload).code;
  for(let i=0;i<5;i++)assert.throws(()=>store.verifyCode(r.requestId,'bad'));
  assert.throws(()=>store.verifyCode(r.requestId,code));
  time=new Date(+time+3600000);const late=store.requestCode('late@example.com','client');time=new Date(+time+11*60000);assert.throws(()=>store.verifyCode(late.requestId,'123456'));
  const a=login(store,db,'new@example.com');for(const targetPrice of [Infinity,NaN,-1,0])assert.throws(()=>store.saveWatch(a.account.id,{productKey:'chatgpt-plus',groupId:group.id,mode:'target',targetPrice},market));
 }finally{db.close();}
});
test('HTTP: 同源CSRF验证、服务端会话隔离、私有内容不被GET写入',async()=>{
 const quotes=openDb(':memory:'),privateDb=new DatabaseSync(':memory:');
 const service=createRetention({db:quotes,submissionsDb:privateDb,secret:'s'.repeat(64),env:{}});
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');service.route(req,res,url).then(done=>{if(!done){res.statusCode=404;res.end();}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  let response=await fetch(origin+'/api/retention/state');const state=await response.json(),cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  response=await fetch(origin+'/api/retention/save-watch',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example',Cookie:cookie,'X-CSRF-Token':state.csrf},body:'{}'});assert.equal(response.status,403);
  response=await fetch(origin+'/api/retention/save-watch',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie,'X-CSRF-Token':state.csrf},body:'{}'});assert.equal(response.status,401);
  response=await fetch(origin+'/api/retention/unsubscribe?token=bad');assert.equal(response.status,405);
  response=await fetch(origin+'/api/retention/state',{headers:{Cookie:'airadar_reader=forged'}});assert.equal((await response.json()).account,null);assert.match(response.headers.get('x-robots-tag'),/noindex/);
 }finally{await new Promise(resolve=>server.close(resolve));quotes.close();privateDb.close();}
});
test('未知规格不接受价格提醒，正常关注支持暂停及签名退订',()=>{
 const {db,store}=setup();try{
  const a=login(store,db);
  assert.throws(()=>store.saveWatch(a.account.id,{productKey:'chatgpt-plus',mode:'target',targetPrice:50},market));
  const w=store.saveWatch(a.account.id,{productKey:'chatgpt-plus',groupId:group.id,mode:'target',targetPrice:90},market);
  assert.equal(store.saveWatch(a.account.id,{...w,paused:true},market).paused,1);
  assert.throws(()=>store.unsubscribe('forged'));
  store.unsubscribe(store.unsubscribeToken(a.account.id));assert.equal(store.account(a.account.id).email_enabled,0);
 }finally{db.close();}
});
test('首次关注、失效报价、不同规格不触发提醒，恢复库存需有售罄证据',()=>{
 const w={mode:'target',target_price:95,group_id:group.id,paused:0};
 assert.equal(evaluateWatch(w,null,group),null);
 assert.equal(evaluateWatch(w,group,{...group,price:90,state:'unknown'}),null);
 assert.equal(evaluateWatch(w,group,{...group,id:'b'.repeat(24),price:90}),null);
 assert.equal(evaluateWatch(w,group,{...group,price:90}).kind,'target');
 assert.equal(evaluateWatch(w,{...group,price:90},{...group,price:89}),null);
 assert.equal(evaluateWatch({...w,mode:'restock'},{...group,state:'unknown'},group),null);
 assert.equal(evaluateWatch({...w,mode:'restock'},{...group,state:'unavailable'},group).kind,'restock');
});
test('行情观察保留真实天数，不混规格、币种或伪造过去30日',()=>{
 const {db}=setup();try{
  observeMarket(db,market,now);observeMarket(db,market,now);
  observeMarket(db,{...market,groups:[{...group,price:90,fingerprint:'two'}]},new Date(+now+86400000));
  const h=marketHistory(db,group.id,30,new Date(+now+86400000));
  assert.equal(h.days,2);assert.equal(h.low,90);assert.equal(h.high,100);assert.equal(h.series.length,2);
  assert.equal(marketHistory(db,'b'.repeat(24),30,now).days,0);
 }finally{db.close();}
});
test('每天汇总上限不会丢失冷却期间累计降价，续费只按所选日期提醒一次',()=>{
 let time=new Date(now);const db=new DatabaseSync(':memory:');const store=createRetentionStore(db,{secret:'s'.repeat(64),now:()=>time});
 try{
  const a=login(store,db);store.saveWatch(a.account.id,{productKey:'chatgpt-plus',groupId:group.id,mode:'changes',dropPct:5,renewalDate:'2026-09-09',leadDays:0},market);
  const observe=price=>store.observe({...market,groups:[{...group,price}]});
  observe(94);time=new Date(+time+3600000);observe(87);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_notices WHERE kind='drop'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_mail WHERE kind='digest'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_notices WHERE kind='renewal'").get().n,0);
  time=new Date(+now+86400000+1000);observe(87);observe(87);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_notices WHERE kind='drop'").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_notices WHERE kind='renewal'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retention_mail WHERE kind='digest'").get().n,2);
 }finally{db.close();}
});
