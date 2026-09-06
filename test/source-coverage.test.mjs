import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCoverage, replacementGate, coverageFromDb, recordCoverageDaily } from '../lib/source-coverage.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const offer=(id,title='Claude Pro 美区代充1个月',price=100)=>({offer_id:id,source_id:id,url:`https://${id}.example/item/1`,title,price,currency:'CNY',status:'in_stock',comparison_known:true,comparison_key:'1m:pro:代充:常规:美国:单位未注明:CNY',quote_stale:false});
const group=(offers)=>({product_id:'claude-pro-month',comparison_key:offers[0].comparison_key,offers,comparable:true});
test('同规格覆盖不把不同周期、无货或陈旧计入；PriceAI stale不可判定',()=>{
 const baseline=[group([offer('reference')])],direct=[group([offer('a')])];
 assert.equal(evaluateCoverage({baseline,direct}).coverageRatio,1);
 assert.equal(evaluateCoverage({baseline,direct,baselineStale:true}).coverageRatio,null);
 assert.equal(evaluateCoverage({baseline,direct:[group([{...offer('a'),quote_stale:true}])]}).coverageRatio,0);
 assert.equal(evaluateCoverage({baseline,direct:[group([{...offer('a'),status:'out_of_stock'}])]}).coverageRatio,0);
 assert.equal(evaluateCoverage({baseline,direct:[{...group([offer('a')]),comparison_key:'12m'}]}).coverageRatio,0);
 assert.equal(evaluateCoverage({baseline,direct:[group([offer('a',undefined,110)])]}).passes,false);
});
test('每日幂等记录可从不足恢复，但旧published/generation不能被本地fresh fetch伪装',()=>{
 const db=openDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'source-coverage-test-')),file=path.join(dir,'ledger.json'),now=Date.parse('2026-09-06T12:00:00Z');
 try {
   const first=recordCoverageDaily(db,file,{now});assert.equal(first.result.status,'indeterminate');
   for(const source of ['priceai','direct-shops'])storeSnapshot(db,{source,snapshotId:'s1',fetchedAt:new Date(now).toISOString(),generatedAt:new Date(now).toISOString(),products:[{productId:'claude-pro-month',offers:[{offerId:source,title:'Claude Pro 美区代充1个月',price:100,currency:'CNY',status:'in_stock',url:`https://${source}.example/item/1`}]}]});
   assert.equal(recordCoverageDaily(db,file,{now}).result.passes,true);
   assert.equal(recordCoverageDaily(db,file,{now}).written,false);
   assert.equal(JSON.parse(readFileSync(file,'utf8')).length,1);
   db.prepare("UPDATE snapshots SET generated_at='2026-09-01T00:00:00Z' WHERE source='priceai'").run();
   assert.equal(coverageFromDb(db,{now}).status,'indeterminate');
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('未知规格不算覆盖，空基准不伪造100%',()=>{
 assert.equal(evaluateCoverage({baseline:[],direct:[]}).status,'indeterminate');
 const p=group([{...offer('a'),comparison_known:false}]);
 assert.equal(evaluateCoverage({baseline:[p],direct:[p]}).status,'indeterminate');
});
test('仅明确标题映射跨源产品ID，质保口径不同不宣称等价',()=>{
 const baseline=[{...group([offer('reference')]),product_id:'claude-pro-public-alias'}];
 assert.equal(evaluateCoverage({baseline,direct:[group([offer('shop')])]}).coverageRatio,1);
 assert.equal(evaluateCoverage({baseline,direct:[group([offer('shop','Claude Pro 美区代充1个月 全程质保')])]}).coverageRatio,0);
});
test('当日有效对照曾失败不能被后续瞬时成功冲掉，直采全过期不可判定',()=>{
 const db=openDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'source-coverage-test-')),file=path.join(dir,'ledger.json'),now=Date.parse('2026-09-06T12:00:00Z');
 try {
   for(const source of ['priceai','direct-shops'])storeSnapshot(db,{source,snapshotId:'s1',fetchedAt:new Date(now).toISOString(),generatedAt:new Date(now).toISOString(),products:[{productId:'claude-pro-month',offers:[{offerId:source,title:'Claude Pro 美区代充1个月',price:source==='priceai'?100:110,currency:'CNY',status:'in_stock',url:`https://${source}.example/item/1`}]}]});
   assert.equal(recordCoverageDaily(db,file,{now}).result.passes,false);
   db.prepare("UPDATE offers SET price=90 WHERE source='direct-shops'").run();
   const after=recordCoverageDaily(db,file,{now});assert.equal(after.result.latestPasses,true);assert.equal(after.result.passes,false);
   db.prepare("UPDATE snapshots SET fetched_at='2026-09-01T00:00:00Z' WHERE source='direct-shops'").run();
   assert.equal(coverageFromDb(db,{now}).status,'indeterminate');
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('七个连续日期且相同范围均通过才建议停用，缺日/陈旧/换范围不能通过',()=>{
 const result=evaluateCoverage({baseline:[group([offer('reference')])],direct:[group([offer('a')])]});
 const rows=Array.from({length:7},(_,i)=>({...result,date:`2026-09-0${i+1}`}));
 assert.equal(replacementGate(rows,{now:Date.parse('2026-09-07T12:00:00Z')}).recommendation,'eligible_for_manual_review');
 assert.notEqual(replacementGate(rows.slice(1)).recommendation,'eligible_for_manual_review');
 assert.notEqual(replacementGate([...rows.slice(0,6),{...rows[6],status:'indeterminate'}]).recommendation,'eligible_for_manual_review');
});
