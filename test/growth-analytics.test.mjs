import test from 'node:test';import assert from 'node:assert/strict';
import {openAnalytics} from '../lib/analytics.mjs';
import {growthSource} from '../lib/growth-analytics.mjs';
import {analyticsContent} from '../lib/admin-analytics.mjs';
const secret= 'example-fixture-secret',now=new Date('2026-09-13T06:00:00Z');
const req=(patch={})=>({method:'GET',url:'/prices/chatgpt-plus?private=do-not-save',socket:{remoteAddress:'127.0.0.1'},headers:{'user-agent':'Mozilla/5.0 Chrome/150','cf-connecting-ip':'203.0.113.9','sec-fetch-dest':'document',referer:'https://www.google.com/search?q=private'},...patch});
test('growth stages deduplicate independently and never persist URLs, IPs or search terms',()=>{
 const a=openAnalytics(':memory:',secret,{now});
 try{
  const context={productKey:'chatgpt-plus',kind:'product_view',specSelected:true};
  a.record(req(),200,now,context);a.record(req(),200,now,context);
  a.record(req(),302,now,{productKey:'chatgpt-plus',kind:'outbound'});
  a.record(req({method:'POST'}),200,now,{productKey:'chatgpt-plus',kind:'follow',renewalSet:true});
  const r=a.growth.report(7,now);assert.equal(r.counts.product_view,1);assert.equal(r.counts.spec_selected,1);assert.equal(r.counts.outbound,1);assert.equal(r.counts.follow,1);assert.equal(r.counts.renewal,1);assert.equal(r.startedAt,now.toISOString());assert.equal(r.sources[0].source,'search');
  const stored=JSON.stringify([...a.db.prepare('SELECT * FROM growth_events').all(),...a.db.prepare('SELECT * FROM growth_sources').all()]);assert.doesNotMatch(stored,/private|203\.0\.113|google|https:/);
  assert.equal(a.report(7,now).pv,2,'redirect/API actions do not inflate page views');
 }finally{a.close();}
});
test('invalid, failed, bot and unconfirmed events cannot create product growth stages',()=>{
 const a=openAnalytics(':memory:',secret,{now});try{
  for(const c of [{productKey:'not-a-product',kind:'product_view'},{productKey:'chatgpt-plus',kind:'purchase'},{productKey:'chatgpt-plus',kind:'outbound'}])a.record(req(),200,now,c);
  a.record(req(),404,now,{productKey:'chatgpt-plus',kind:'product_view'});
  a.record(req({headers:{...req().headers,'user-agent':'Mozilla/5.0 Googlebot'}}),200,now,{productKey:'chatgpt-plus',kind:'product_view'});
  assert.equal(a.growth.report(7,now).counts.product_view,0);assert.equal(a.growth.report(7,now).counts.outbound,0);
  assert.equal(growthSource(req({headers:{referer:'https://google.com.evil.test/?q=x'}})),'referral');assert.equal(growthSource(req({headers:{}})),'direct_unknown');
 }finally{a.close();}
});
const tapeoutTags='utm_source=tapeout&utm_medium=deweb&utm_campaign=deweb-entry';
test('reviewed TapeOut campaigns take priority over referrers without persisting arbitrary tags',()=>{
 for(const campaign of ['deweb-entry','ai-cost-helper']){
  const url='/prices/chatgpt-plus?utm_source=tapeout&utm_medium=deweb&utm_campaign='+campaign+'&utm_content=hero';
  assert.equal(growthSource(req({url})),'tapeout_deweb');
  assert.equal(growthSource(req({url,headers:{}})),'tapeout_deweb');
 }
 const invalid=[
  'utm_source=tapeout&utm_medium=deweb',
  'utm_source=other&utm_medium=deweb&utm_campaign=deweb-entry',
  'utm_source=tapeout&utm_medium=other&utm_campaign=deweb-entry',
  'utm_source=tapeout&utm_medium=deweb&utm_campaign=unreviewed',
  'utm_source=TapeOut&utm_medium=deweb&utm_campaign=deweb-entry',
  ...['utm_source=tapeout','utm_medium=deweb','utm_campaign=deweb-entry','utm_campaign=ai-cost-helper'].map(duplicate=>tapeoutTags+'&'+duplicate),
 ];
 for(const query of invalid){
  assert.equal(growthSource(req({url:'/prices/chatgpt-plus?'+query})),'search',query);
  assert.equal(growthSource(req({url:'/prices/chatgpt-plus?'+query,headers:{}})),'direct_unknown',query);
 }
 assert.equal(growthSource(req({url:'http://['})),'search');
});
test('TapeOut source retains product-view filtering and deduplication and stores only its fixed category',()=>{
 const a=openAnalytics(':memory:',secret,{now});try{
  const context={productKey:'chatgpt-plus',kind:'product_view'},url='/prices/chatgpt-plus?'+tapeoutTags+'&utm_content=hero-private-content&other=private-query';
  const tagged=req({url,headers:{...req().headers,referer:undefined}});
  a.record(tagged,200,now,context);a.record({...tagged,url:url.replace('hero-private-content','footer-private-content')},200,now,context);
  const r=a.growth.report(7,now);assert.equal(r.counts.product_view,1);assert.deepEqual(r.sources.map(source=>({...source})),[{source:'tapeout_deweb',n:1}]);
  const tables=a.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const stored=JSON.stringify(tables.flatMap(({name})=>a.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()));
  assert.doesNotMatch(stored,/utm_|deweb-entry|ai-cost-helper|hero-private-content|footer-private-content|private-query|203\.0\.113|https:/);
  const html=analyticsContent({...a,growth:{report:()=>r}},7);assert.match(html,/TapeOut \/ DeWEB 来源/);assert.match(html,/不归因后续关注、商家点击或下单/);assert.match(html,/utm_content/);
 }finally{a.close();}
});
test('TapeOut tags on entry pages or later actions do not create product-source records',()=>{
 const a=openAnalytics(':memory:',secret,{now});try{
  for(const pathname of ['/tapeout/','/','/following'])a.record(req({url:pathname+'?'+tapeoutTags}),200,now);
  a.record(req({url:'/go?'+tapeoutTags}),302,now,{productKey:'chatgpt-plus',kind:'outbound'});
  a.record(req({method:'POST',url:'/api/retention/event?'+tapeoutTags}),200,now,{productKey:'chatgpt-plus',kind:'follow'});
  const context={productKey:'chatgpt-plus',kind:'product_view'},url='/prices/chatgpt-plus?'+tapeoutTags;
  a.record(req({url}),404,now,context);
  a.record(req({url,method:'HEAD'}),200,now,context);
  for(const headers of [{'user-agent':'Mozilla/5.0 Googlebot'},{'sec-fetch-dest':'empty'},{purpose:'prefetch'},{cookie:'airadar_admin=test'}])a.record(req({url,headers:{...req().headers,...headers}}),200,now,context);
  a.record(req({url,socket:{remoteAddress:'198.51.100.1'}}),200,now,context);
  const r=a.growth.report(7,now);assert.equal(r.counts.product_view,0);assert.equal(r.counts.outbound,1);assert.equal(r.counts.follow,1);assert.deepEqual(r.sources,[]);
 }finally{a.close();}
});

test('guard responses never create page or growth events even with HTTP 200',()=>{
 const a=openAnalytics(':memory:',secret,{now}),context={productKey:'chatgpt-plus',kind:'product_view',specSelected:true};
 try{
  for(const [action,status] of [['challenge',200],['block',429]]){
   a.record(req(),status,now,context,{scrapeGuardAction:action});
   a.growth.record(req(),status,context,now,{scrapeGuardAction:action});
  }
  assert.equal(a.report(7,now).pv,0);assert.equal(a.report(7,now).uv,0);assert.equal(a.growth.report(7,now).counts.product_view,0);assert.equal(a.growth.report(7,now).counts.spec_selected,0);
  a.record(req(),200,now,context);assert.equal(a.report(7,now).pv,1);assert.equal(a.growth.report(7,now).counts.product_view,1);
 }finally{a.close();}
});
