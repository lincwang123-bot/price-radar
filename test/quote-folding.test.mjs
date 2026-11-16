import test from 'node:test';
import assert from 'node:assert/strict';
import {foldQuoteEntries} from '../lib/quote-folding.mjs';
const row=(price,patch={})=>({product:{currency:'CNY'},offer:{title:'Plus 月卡成品号',comparison_key:'month-account',comparison_known:true,comparison_eligible:true,currency:'CNY',price,url:'https://shop.example/'+price,...patch}});
test('folding preserves every price and original representative order',()=>{
  const entries=[row(35),row(50,{title:'Plus 月卡代充'}),row(60)];
  const groups=foldQuoteEntries(entries);
  assert.equal(groups.length,2);assert.equal(groups[0].entry,entries[0]);assert.equal(groups[0].alternatives[0],entries[2]);assert.equal(groups[1].entry,entries[1]);
  assert.equal(entries.length,3);
});
test('same titles with unknown conditions, different currency or different specifications stay separate',()=>{
  const entries=[row(35),row(40,{comparison_key:'year-account'}),row(5,{currency:'USD'}),row(50,{comparison_known:false}),row(60,{comparison_eligible:false}),{...row(70),reference:true}];
  assert.equal(foldQuoteEntries(entries).length,6);
});

test('known iOS and web recharge channels remain separate even when titles match',()=>{
 const a={...row(35),rechargeMethod:{kind:'ios'}},b={...row(40),rechargeMethod:{kind:'other'}};
 assert.equal(foldQuoteEntries([a,b]).length,2);
});
