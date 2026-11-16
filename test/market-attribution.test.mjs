import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {retentionSchema} from '../lib/retention-store.mjs';
import {observeMarket,weeklyMarket} from '../lib/retention-market.mjs';
import {weeklyContent} from '../lib/retention-ui.mjs';
const now=new Date('2026-09-13T02:00:00Z');
const group={id:'a'.repeat(24),productKey:'chatgpt-plus',name:'ChatGPT Plus',family:'chatgpt',spec:'1 个月 · 成品账号',comparisonKey:'1m:plus:成品账号:常规:地区未注明:单位未注明:CNY',currency:'CNY',state:'available'};
const observed=(db,quotes,time,extra={})=>observeMarket(db,{groups:[{...group,price:Math.min(...quotes.map(q=>q.price)),quoteEvidence:quotes,fingerprint:JSON.stringify(quotes),...extra}]},new Date(time));
function setup(){const db=new DatabaseSync(':memory:');db.exec(retentionSchema);return db;}
test('weekly quote sets distinguish repricing, newly observed lower quotes and mixed changes',()=>{
 const cases=[
  [[{id:'a',price:100},{id:'b',price:120}],[{id:'a',price:90},{id:'b',price:120}],'same_offer_changed'],
  [[{id:'a',price:100}],[{id:'a',price:100},{id:'b',price:90}],'new_lower_source'],
  [[{id:'a',price:100},{id:'b',price:90}],[{id:'a',price:100}],'coverage_changed'],
  [[{id:'a',price:100}],[{id:'a',price:95},{id:'b',price:90}],'mixed'],
 ];
 for(const [first,last,kind] of cases){const db=setup();try{
  observed(db,first,'2026-09-12T02:00:00Z');observed(db,last,now);
  const r=weeklyMarket(db,{}, {now});assert.equal(r.items[0].attribution.kind,kind);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_market_daily').get().n,0,'no legacy backfill');
 }finally{db.close();}}
});
test('unmatched closing times and missing endpoint evidence remain unknown',()=>{
 const db=setup();try{
  observed(db,[{id:'a',price:100}],'2026-09-12T02:00:00Z');observed(db,[{id:'a',price:90}],now);
  db.prepare("UPDATE retention_market_evidence SET observed_at='2026-09-12T01:00:00Z' WHERE day='2026-09-12'").run();
  assert.equal(weeklyMarket(db,{}, {now}).items[0].attribution.kind,'unknown');
  db.prepare("DELETE FROM retention_market_evidence WHERE day='2026-09-12'").run();
  assert.equal(weeklyMarket(db,{}, {now}).items[0].attribution.kind,'unknown');
 }finally{db.close();}
});
test('evidence starts with a new observation and does not rewrite older closing rows',()=>{
 const db=setup();try{
  observed(db,[{id:'a',price:100}],'2026-09-12T02:00:00Z',{quoteEvidence:undefined});
  observed(db,[{id:'a',price:100}],'2026-09-13T02:00:00Z',{quoteEvidence:undefined});
  observed(db,[{id:'a',price:100}],'2026-09-13T03:00:00Z');
  const rows=db.prepare('SELECT * FROM retention_market_evidence').all();assert.equal(rows.length,1);assert.equal(rows[0].day,'2026-09-13');
  assert.equal(db.prepare("SELECT last_at FROM retention_market_daily_v2 WHERE day='2026-09-12'").get().last_at,'2026-09-12T02:00:00.000Z');
 }finally{db.close();}
});
test('historical share selection resolves a specific group before the 20-item report limit',()=>{
 const db=setup();try{
  for(let i=0;i<25;i++){
   const id=i.toString(16).padStart(24,'0');
   observed(db,[{id:'a',price:100}],'2026-09-12T02:00:00Z',{id});
   observed(db,[{id:'a',price:100-i-1}],now,{id});
  }
  const id='0'.repeat(24);assert.equal(weeklyMarket(db,{}, {now}).items.length,20);
  assert.equal(weeklyMarket(db,{}, {now,groupId:id}).items[0].id,id);
  const service={store:{db},weekly:(date,groupId)=>weeklyMarket(db,{}, {now,date,groupId})};
  const html=weeklyContent(service,new URL('https://airadar.vip/weekly?date=2026-09-13&group='+id));
  assert.equal((html.match(/id="history-/g)||[]).length,1);
  assert.ok(html.includes('同店同商品标价变化'));
  assert.equal(weeklyContent(service,new URL('https://airadar.vip/weekly?date=2026-09-13&group=invalid')),null);
 }finally{db.close();}
});
