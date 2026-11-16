import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {offerSpec} from '../lib/offer-spec.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {readRetentionMarket,observeMarket,marketHistory,weeklyMarket} from '../lib/retention-market.mjs';

test('parsing corrections fence only affected histories and rebase alerts without changing renewal settings',()=>{
 const quotes=openDb(':memory:'),db=new DatabaseSync(':memory:');let time=new Date('2026-09-15T08:00:00Z');
 const store=createRetentionStore(db,{secret:'test'.repeat(20),now:()=>time});
 try{
  const product={productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'negative',title:'ChatGPT Plus 月卡成品号（非日抛）',price:35,currency:'CNY',status:'in_stock',url:'https://shop.example/month'}]};
  storeSnapshot(quotes,{source:'ldxp-goods',snapshotId:'corrected',fetchedAt:time.toISOString(),products:[product]});
  const current=readRetentionMarket(quotes,{now:time}),g=current.groups[0];assert.ok(g.comparisonKey.includes('常规'));
  const oldKey=offerSpec(product.offers[0],{}, {legacyAmbiguity:true}).key;
  const oldId=createHash('sha256').update('chatgpt-plus|'+oldKey).digest('hex').slice(0,24);
  assert.ok(current.corrections.includes(oldId));assert.ok(current.corrections.includes(g.id));
  const unaffected={...g,id:'b'.repeat(24),productKey:'claude-pro',comparisonKey:'another',name:'Claude Pro'};
  for(let day=13;day<=14;day++)observeMarket(db,{groups:[{...g,price:80,fingerprint:'before-'+day},{...g,id:oldId,price:day===13?50:35,fingerprint:'old-'+day},{...unaffected,price:day===13?100:90,fingerprint:'other-'+day}]},new Date(`2026-09-${day}T08:00:00Z`));
  const request=store.requestCode('qa@example.com','fixture'),code=JSON.parse(db.prepare("SELECT payload FROM retention_mail WHERE kind='code'").get().payload).code;
  const account=store.verifyCode(request.requestId,code).account;
  const watch=store.saveWatch(account.id,{productKey:g.productKey,groupId:g.id,mode:'changes',dropPct:5,renewalDate:'2026-10-15'}, {...current,groups:[{...g,price:80}]});
  const before=db.prepare('SELECT renewal_date,lead_days,created_at,updated_at FROM retention_watches WHERE id=?').get(watch.id);
  observeMarket(db,current,time);store.observe(current);
  assert.equal(current.groups[0].comparisonPolicyVersion,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_notices').get().n,0,'a correction is not a price-drop notice');
  assert.deepEqual(db.prepare('SELECT renewal_date,lead_days,created_at,updated_at FROM retention_watches WHERE id=?').get(watch.id),before);
  assert.equal(marketHistory(db,g.id,30,time).days,0,'mixed migration day is excluded');
  assert.equal(marketHistory(db,oldId,30,time).days,0,'incorrect old group no longer enters the weekly report');
  assert.equal(marketHistory(db,unaffected.id,30,time).days,2);
  assert.deepEqual(weeklyMarket(db,current,{now:time}).items.map(i=>i.id),[unaffected.id]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_market_daily_v2 WHERE group_id=?').get(oldId).n,2,'original rows remain stored');
  time=new Date('2026-09-16T08:00:00Z');const next={groups:[{...g,comparisonPolicyVersion:2,price:31,fingerprint:'after'}],products:current.products};observeMarket(db,next,time);store.observe(next);
  assert.equal(next.groups[0].comparisonPolicyVersion,3,'correction policy persists even when corrected offers disappear');
  assert.equal(marketHistory(db,g.id,30,time).days,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_notices').get().n,1,'a later real price drop still alerts');
 }finally{quotes.close();db.close();}
});
