import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
import {createRetentionStore,retentionSchema} from '../lib/retention-store.mjs';
import {readRetentionMarket,observeMarket,marketHistory,weeklyMarket} from '../lib/retention-market.mjs';
import {retentionMessage,drainRetentionMail} from '../lib/retention-mail.mjs';
import legacyPending from './fixtures/retention-legacy-pending.json' with {type:'json'};

const start=new Date('2026-10-02T02:00:00Z');
const source='ldxp-goods';
function snapshot(db,offers,at=start,id='current'){
 storeSnapshot(db,{source,snapshotId:id,fetchedAt:at.toISOString(),products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers}]});
 // Fixture two independently verified SKUs in a single source snapshot.
 db.prepare('UPDATE offers SET last_verified_at=captured_at WHERE source=? AND snapshot_id=?').run(source,id);
}
const quote=(offerId,method,price,extra={})=>({offerId,title:`ChatGPT Plus ${method}代充 1个月 新开续费均可`,price,currency:'CNY',status:'in_stock',url:'https://merchant.example/product',capturedAt:start.toISOString(),...extra});
function directory(db,now=start){
 const s=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);
 const products=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(source,s.snapshot_id).map(p=>projectProduct(db,source,s,p,{now:+now}));
 return buildProductDirectory([{source,fetchedAt:s.fetched_at,products}]).flatMap(c=>c.products);
}
test('retention preserves same-URL Web and iOS SKUs and agrees with directory prices',()=>{
 const db=openDb(':memory:');try{
  snapshot(db,[quote('web','Web ',80,{capturedAt:'2026-10-02T01:58:00Z'}),quote('ios','iOS ',120,{capturedAt:'2026-10-02T01:59:00Z'})]);
  const market=readRetentionMarket(db,{now:start}),group=market.groups[0],publicQuotes=directoryQuotes(directory(db)[0]);
  assert.equal(market.groups.length,1);
  assert.deepEqual(publicQuotes.entries.map(e=>e.offer.price),[80,120]);
  assert.equal(group.price,80);assert.equal(group.maxPrice,120);assert.equal(group.offerCount,2);
  assert.equal(new Set(group.quoteEvidence.map(q=>q.id)).size,2,'each channel has its own evidence identity');
 }finally{db.close();}
});
test('retention and directory normalize duplicate destinations',()=>{
 const db=openDb(':memory:');try{
  snapshot(db,[quote('older','Web ',80,{url:'https://www.merchant.example/product?utm_source=old#details',capturedAt:'2026-10-02T01:58:00Z'}),quote('newer','Web ',90,{url:'https://merchant.example/product',capturedAt:'2026-10-02T01:59:00Z'})]);
  const market=readRetentionMarket(db,{now:start}),publicQuotes=directoryQuotes(directory(db)[0]);
  assert.equal(publicQuotes.total,1);assert.equal(market.groups[0].offerCount,1);assert.equal(market.groups[0].price,90);
 }finally{db.close();}
});
test('one storefront URL with matching specifications keeps different canonical products and evidence separate',()=>{
 const db=openDb(':memory:');try{
  storeSnapshot(db,{source,snapshotId:'products',fetchedAt:start.toISOString(),products:[['claude-pro','Claude Pro',100],['cursor-pro','Cursor Pro',80]].map(([productId,name,price])=>({productId,name,currency:'CNY',offers:[quote(productId,'Web ',price,{title:name+' Web 代充 1个月 新开续费均可'})]}))});
  const market=readRetentionMarket(db,{now:start});assert.equal(market.groups.length,2);
  assert.equal(new Set(market.groups.map(g=>g.comparisonKey)).size,1,'the specifications really collide');
  assert.deepEqual(market.groups.map(g=>g.productKey).sort(),['claude-pro','cursor-pro']);
  assert.equal(new Set(market.groups.flatMap(g=>g.quoteEvidence.map(q=>q.id))).size,2,'evidence includes the canonical product identity');
 }finally{db.close();}
});
test('a verified 16688 single-product destination deduplicates before retention grouping',()=>{
 const db=openDb(':memory:');try{
  snapshot(db,[quote('older','Web ',800,{title:'ChatGPT Plus Web 代充 12个月 新开续费均可',url:'https://www.16688.com.cn/goods/G123',capturedAt:'2026-10-02T01:58:00Z'}),quote('newer','iOS ',120,{url:'https://16688.com.cn/goods/G123',capturedAt:'2026-10-02T01:59:00Z'})]);
  const publicQuotes=directoryQuotes(directory(db)[0]),market=readRetentionMarket(db,{now:start});
  assert.equal(publicQuotes.total,1);assert.equal(market.groups.length,1);assert.equal(market.groups[0].price,120);
 }finally{db.close();}
});

function setup(){
 const db=new DatabaseSync(':memory:');let time=new Date(start);
 const store=createRetentionStore(db,{secret:'fixture'.repeat(10),now:()=>time}),accountId='1'.repeat(32);
 db.prepare('INSERT INTO retention_accounts VALUES(?,?,?,1)').run(accountId,'fixture@example.com',time.toISOString());
 const a={id:'a'.repeat(24),productKey:'chatgpt-plus',name:'ChatGPT Plus',family:'chatgpt',spec:'1个月代充',comparisonKey:'month-recharge',currency:'CNY',state:'available',price:100,offerCount:2,observedAt:time.toISOString(),comparisonPolicyVersion:2,quoteIdentityVersion:2};
 const b={...a,id:'b'.repeat(24),spec:'1个月成品号',comparisonKey:'month-account',price:80};
 const c={...a,id:'c'.repeat(24),productKey:'claude-pro',name:'Claude Pro',spec:'1个月代充',price:70};
 const market={products:[{key:a.productKey,name:a.name},{key:c.productKey,name:c.name}],groups:[a,b,c]};
 const watch=input=>store.saveWatch(accountId,{productKey:a.productKey,groupId:a.id,mode:'changes',dropPct:5,...input},market);
 const lower={...market,groups:[{...a,price:90},b,c]};
 const mail=()=>db.prepare("SELECT * FROM retention_mail WHERE kind='digest' ORDER BY id DESC LIMIT 1").get();
 const message=(row=mail(),m=lower)=>retentionMessage(store,row,m,'notify@example.com',{now:time});
 return {db,store,accountId,a,b,c,market,lower,watch,mail,message,setTime:value=>{time=new Date(value);}};
}
for(const [name,edit] of [
 ['group',f=>({groupId:f.b.id})],['product',f=>({productKey:f.c.productKey,groupId:f.c.id})],
 ['drop threshold',()=>({dropPct:20})],['mode round trip',()=>({mode:'off'})],
])test(`editing ${name} invalidates the old queued price notice even after restoring settings`,()=>{
 const f=setup();try{
  const w=f.watch();f.store.observe(f.lower);const old=f.mail();assert.ok(f.message(old));
  f.store.saveWatch(f.accountId,{...w,...edit(f)},f.lower);
  assert.equal(f.message(old),null);
  f.store.saveWatch(f.accountId,w,f.lower);
  assert.equal(f.message(old),null,'restoring a setting must not revive the prior event');
  assert.equal(f.store.notices(f.accountId).length,1,'retain historical notices');
 }finally{f.db.close();}
});
test('a changed target price and an updated comparison policy cannot reuse a queued trigger',()=>{
 const f=setup();try{
  const w=f.watch({mode:'target',targetPrice:95});f.store.observe(f.lower);const old=f.mail();
  f.store.saveWatch(f.accountId,{...w,targetPrice:96},f.lower);assert.equal(f.message(old),null);
 }finally{f.db.close();}
 const g=setup();try{
  g.watch();g.store.observe(g.lower);const old=g.mail();
  assert.equal(g.message(old,{...g.lower,groups:g.lower.groups.map(x=>({...x,comparisonPolicyVersion:3}))}),null);
  assert.equal(g.message(old,{...g.lower,groups:g.lower.groups.map(x=>({...x,quoteIdentityVersion:3}))}),null);
 }finally{g.db.close();}
});
test('price-only edits preserve renewal reminders, while reduced lead time and product changes invalidate them',()=>{
 const f=setup();try{
  const w=f.watch({renewalDate:'2026-10-05',leadDays:3});f.store.observe(f.market);const old=f.mail();assert.ok(f.message(old,f.market));
  f.store.saveWatch(f.accountId,{...w,dropPct:20},f.market);assert.ok(f.message(old,f.market));
  f.store.saveWatch(f.accountId,{...w,leadDays:0},f.market);assert.equal(f.message(old,f.market),null);
  f.setTime('2026-10-05T02:00:00Z');assert.equal(f.message(old,f.market),null,'old lead-time trigger stays invalid even once the date arrives');
 }finally{f.db.close();}
 const g=setup();try{
  const w=g.watch({renewalDate:'2026-10-05',leadDays:3});g.store.observe(g.market);const old=g.mail();
  g.store.saveWatch(g.accountId,{...w,productKey:g.c.productKey,groupId:g.c.id},g.market);assert.equal(g.message(old,g.market),null);
 }finally{g.db.close();}
});
test('an invalidated queued digest is cancelled and a later valid renewal can still send once',async()=>{
 const f=setup();try{
  const w=f.watch({renewalDate:'2026-10-05',leadDays:3});f.store.observe(f.market);const old=f.mail();
  f.store.saveWatch(f.accountId,{...w,leadDays:0},f.market);
  let sent=0;const transport={sendMail:async message=>{sent++;return {accepted:[message.to]};}};
  await drainRetentionMail(f.store,f.market,{transport,from:'notify@example.com',now:start});
  assert.equal(sent,0);assert.equal(f.db.prepare('SELECT status FROM retention_mail WHERE id=?').get(old.id).status,'cancelled');
  f.store.saveWatch(f.accountId,{...w,renewalDate:'2026-10-02',leadDays:0},f.market);f.store.observe(f.market);
  await drainRetentionMail(f.store,f.market,{transport,from:'notify@example.com',now:start});
  assert.equal(sent,1);f.store.observe(f.market);
  await drainRetentionMail(f.store,f.market,{transport,from:'notify@example.com',now:start});assert.equal(sent,1);
 }finally{f.db.close();}
});
test('SKU correction fences only affected history and rebases alerts; subsequent real drops still notify',()=>{
 const quotes=openDb(':memory:'),f=setup();try{
  snapshot(quotes,[quote('web','Web ',80,{capturedAt:'2026-10-02T01:58:00Z'}),quote('ios','iOS ',120,{capturedAt:'2026-10-02T01:59:00Z'})]);
  const current=readRetentionMarket(quotes,{now:start}),g=current.groups[0],unaffected={...g,id:'d'.repeat(24),productKey:'claude-pro',quoteIdentityVersion:1};
  const previous={...g,price:120,maxPrice:120,offerCount:1,quoteIdentityVersion:1,quoteEvidence:[{id:'legacy',price:120}]};
  for(const day of ['2026-09-30','2026-10-01'])observeMarket(f.db,{groups:[{...previous,fingerprint:'old-'+day},{...unaffected,price:100,fingerprint:'other-'+day}]},new Date(day+'T02:00:00Z'));
  const w=f.store.saveWatch(f.accountId,{productKey:g.productKey,groupId:g.id,mode:'changes',dropPct:5,renewalDate:'2026-11-01'}, {...current,groups:[previous]});
  observeMarket(f.db,current,start);f.store.observe(current);
  assert.equal(f.store.notices(f.accountId).length,0,'repairing dedupe is not a price change');
  assert.equal(marketHistory(f.db,g.id,30,start).days,0,'exclude historical observations under affected dedupe');
  assert.equal(marketHistory(f.db,unaffected.id,30,start).days,2,'unaffected history survives');
  assert.equal(f.store.watches(f.accountId)[0].renewalDate,'2026-11-01');assert.equal(f.store.account(f.accountId).email_enabled,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM retention_market_daily_v2 WHERE group_id=?').get(g.id).n,3,'original history remains stored');
  const next=new Date(+start+86400000);f.setTime(next);snapshot(quotes,[quote('web','Web ',70,{capturedAt:next.toISOString()}),quote('ios','iOS ',120,{capturedAt:next.toISOString()})],next,'next');
  const after=readRetentionMarket(quotes,{now:next});observeMarket(f.db,after,next);f.store.observe(after);
  assert.equal(f.store.notices(f.accountId).length,1);assert.equal(f.store.notices(f.accountId)[0].payload.watchId,w.id);
  assert.equal(marketHistory(f.db,g.id,30,next).days,1);
  const later=new Date(+next+86400000);f.setTime(later);snapshot(quotes,[quote('web','Web ',60,{capturedAt:later.toISOString()}),quote('ios','iOS ',120,{capturedAt:later.toISOString()})],later,'later');
  const last=readRetentionMarket(quotes,{now:later});observeMarket(f.db,last,later);f.store.observe(last);
  assert.equal(marketHistory(f.db,g.id,30,later).days,2,'subsequent observations do not move the migration boundary');
  assert.equal(weeklyMarket(f.db,last,{now:later}).items.find(i=>i.id===g.id).attribution.kind,'same_offer_changed');
 }finally{quotes.close();f.db.close();}
});
test('old watch schema migrates idempotently and pre-upgrade renewal notices neither duplicate nor disappear',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(retentionSchema.replace(',alert_revision INTEGER NOT NULL DEFAULT 0,renewal_revision INTEGER NOT NULL DEFAULT 0',''));
  const options={secret:'fixture'.repeat(10),now:()=>start};
  const store=createRetentionStore(db,options);createRetentionStore(db,options);
  const accountId='2'.repeat(32);db.prepare('INSERT INTO retention_accounts VALUES(?,?,?,1)').run(accountId,'legacy@example.com',start.toISOString());
  const market={products:[{key:'chatgpt-plus',name:'ChatGPT Plus'}],groups:[]};
  const watch=store.saveWatch(accountId,{productKey:'chatgpt-plus',mode:'off',renewalDate:'2026-10-02',leadDays:0},market);
  db.prepare('INSERT INTO retention_notices VALUES(?,?,?,?,?,?,?,0)').run('3'.repeat(32),`${watch.id}:renewal:2026-10-02:0`,accountId,watch.id,'renewal',start.toISOString(),JSON.stringify({watchId:watch.id,productKey:'chatgpt-plus',name:'ChatGPT Plus',renewalDate:'2026-10-02',kind:'renewal'}));
  store.observe(market);assert.equal(store.notices(accountId).length,1);
  const mail=db.prepare("SELECT * FROM retention_mail WHERE kind='digest'").get();
  assert.ok(retentionMessage(store,mail,market,'notify@example.com',{now:start}));
  assert.equal(store.watches(accountId)[0].renewalDate,'2026-10-02');assert.equal(store.account(accountId).email_enabled,1);
 }finally{db.close();}
});
test('changed evidence identity versions make cross-version weekly attribution unknown',()=>{
 const f=setup();try{
  const g=f.a;
  observeMarket(f.db,{groups:[{...g,price:100,quoteIdentityVersion:1,quoteEvidence:[{id:'old',price:100}],fingerprint:'before'}]},new Date('2026-10-01T02:00:00Z'));
  observeMarket(f.db,{groups:[{...g,price:90,quoteIdentityVersion:2,quoteEvidence:[{id:'new',price:90}],fingerprint:'after'}]},start);
  const report=weeklyMarket(f.db,{}, {now:start});assert.equal(report.items[0].attribution.kind,'unknown');
 }finally{f.db.close();}
});

// These rows were generated by the real pre-upgrade implementations, not by
// deleting version fields from new notices. The fixture records both source hashes.
function upgradeLegacy(name){
 const db=new DatabaseSync(':memory:');
 db.exec(legacyPending.watchSchema);db.exec(retentionSchema);
 for(const [table,rows] of Object.entries(legacyPending.cases[name].tables))for(const row of rows){
  const fields=Object.keys(row);
  db.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).run(...Object.values(row));
 }
 const now=new Date('2026-10-02T03:00:00Z'),store=createRetentionStore(db,{secret:'legacy-fixture-secret'.repeat(3),now:()=>now});
 const accountId='1'.repeat(32),group=JSON.parse(db.prepare('SELECT payload FROM retention_market').get().payload);
 const market={products:[{key:group.productKey,name:group.name}],groups:[{...group,quoteIdentityVersion:2,fingerprint:'after-upgrade'}]};
 const row=db.prepare("SELECT * FROM retention_mail WHERE kind='digest'").get();
 const message=()=>retentionMessage(store,row,market,'notify@example.com',{now});
 return {db,store,accountId,market,row,now,message};
}
for(const name of ['target','drop','correctedDrop'])test(`a real legacy ${name} pending notice survives an unaffected upgrade and sends once`,async()=>{
 const f=upgradeLegacy(name);try{
  const old=f.db.prepare('SELECT * FROM retention_notices').get(),payload=JSON.parse(old.payload);
  assert.equal(payload.comparisonPolicyVersion,undefined);assert.equal(payload.quoteIdentityVersion,undefined);
  assert.equal(old.mailed,1,'the old worker already assigned this notice to its queued digest');
  assert.equal(JSON.parse(f.db.prepare('SELECT baseline FROM retention_watches').get().baseline).price,90);
  observeMarket(f.db,f.market,f.now);f.store.observe(f.market);
  assert.ok(f.message(),'missing version metadata alone does not invalidate an otherwise valid old event');
  let sent=0;const transport={sendMail:async message=>{sent++;assert.match(message.text,/CNY 90/);return {accepted:[message.to]};}};
  await drainRetentionMail(f.store,f.market,{transport,from:'notify@example.com',now:f.now});
  assert.equal(sent,1);assert.equal(f.db.prepare('SELECT status FROM retention_mail WHERE id=?').get(f.row.id).status,'accepted');
  f.store.observe(f.market);await drainRetentionMail(f.store,f.market,{transport,from:'notify@example.com',now:f.now});
  assert.equal(sent,1);assert.equal(f.store.notices(f.accountId).length,1);
  assert.equal(f.store.watches(f.accountId)[0].renewalDate,'2026-11-01');assert.equal(f.store.account(f.accountId).email_enabled,1);
 }finally{f.db.close();}
});
test('a real legacy false-drop pending notice is cancelled when its SKU interpretation is corrected',async()=>{
 const f=upgradeLegacy('skuDrop'),quotes=openDb(':memory:');try{
  snapshot(quotes,[quote('web','Web ',80,{capturedAt:'2026-10-02T01:59:00Z'}),quote('ios','iOS ',90)]);
  const current=readRetentionMarket(quotes,{now:f.now}),id=f.market.groups[0].id;
  assert.equal(current.groups[0].id,id);assert.ok(current.skuCorrections.includes(id));
  observeMarket(f.db,current,f.now);f.store.observe(current);
  assert.equal(current.groups[0].quoteIdentityCorrectedAt,f.now.toISOString());
  assert.equal(retentionMessage(f.store,f.row,current,'notify@example.com',{now:f.now}),null);
  let sent=0;await drainRetentionMail(f.store,current,{transport:{sendMail:async()=>{sent++;return {accepted:['legacy@example.com']};}},from:'notify@example.com',now:f.now});
  assert.equal(sent,0);assert.equal(f.db.prepare('SELECT status FROM retention_mail WHERE id=?').get(f.row.id).status,'cancelled');
  assert.equal(f.store.notices(f.accountId).length,1,'correction does not create a replacement false price drop');
  const again=readRetentionMarket(quotes,{now:new Date(+f.now+60000)});observeMarket(f.db,again,new Date(+f.now+60000));
  assert.equal(again.groups[0].quoteIdentityCorrectedAt,f.now.toISOString(),'the correction boundary persists without shifting');
 }finally{quotes.close();f.db.close();}
});
test('legacy notices preceding a comparison correction or a changed setting stay invalid',()=>{
 const f=upgradeLegacy('drop');try{
  f.market.corrections=[f.market.groups[0].id];observeMarket(f.db,f.market,f.now);f.store.observe(f.market);
  assert.equal(f.market.groups[0].comparisonCorrectedAt,f.now.toISOString());assert.equal(f.message(),null);
 }finally{f.db.close();}
 const g=upgradeLegacy('target');try{
  observeMarket(g.db,g.market,g.now);assert.ok(g.message());
  const watch=g.store.watches(g.accountId)[0];g.store.saveWatch(g.accountId,{...watch,targetPrice:96},g.market);
  assert.equal(g.message(),null,'a still-reached target cannot authorize a notice from old settings');
 }finally{g.db.close();}
});
