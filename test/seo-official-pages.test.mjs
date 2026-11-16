import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {PRODUCT_FAQ} from '../lib/buying-faq.mjs';
import {officialSummary} from '../lib/official-summary.mjs';
import {autoManifest,indexNowAutoEnabled,indexNowDocuments} from '../lib/indexnow-auto.mjs';
import {planIndexNow,indexNowUrl} from '../lib/indexnow.mjs';
const ids=['chatgpt-plus','chatgpt-go','chatgpt-pro-5x','chatgpt-pro-20x','claude-pro'];
const collected='2026-10-20T01:02:03.000Z';
function fixture(path=':memory:'){
 const db=openDb(path);
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'seo-official',fetchedAt:collected,products:ids.map((id,i)=>({productId:id,name:id,platform:'AI',currency:'CNY',offers:[
  {offerId:'month',storeName:'测试地区 A',price:137.43+i,status:'official',url:'https://cardnav.xyz/official-price/'+id,extra:{officialPrice:{originalPrice:'fixture-31.27',originalCurrency:'USD',period:'month',upstreamRefreshedAt:collected}}},
  {offerId:'year',storeName:'测试地区 B',price:1.23,status:'official',url:'https://cardnav.xyz/official-price/'+id,extra:{officialPrice:{originalPrice:'fixture-annual',originalCurrency:'USD',period:'year',upstreamRefreshedAt:collected}}},
 ]}))});
 storeSnapshot(db,{source:'direct-shops',snapshotId:'seo-shops',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[
  {offerId:'recharge',title:'ChatGPT Plus 1个月代充',storeName:'测试代充',price:187.62,status:'in_stock',stockCount:1,url:'https://fixture.example/recharge'},
  {offerId:'account',title:'ChatGPT Plus 1个月成品账号',storeName:'测试成品',price:2.34,status:'in_stock',stockCount:1,url:'https://fixture.example/account'},
 ]}]});return db;
}
const schemas=html=>JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
test('five canonical official pages share fixture evidence with FAQ, Dataset, hreflang, Markdown and sitemap',async()=>{
 const db=fixture(),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 const get=(path,method='GET')=>fetch(origin+path,{method,redirect:'manual'});
 try{
  for(const [i,id] of ids.entries()){
   const path='/official-prices/'+id,response=await get(path);assert.equal(response.status,200);
   const html=await response.text(),graph=schemas(html),faq=graph.find(s=>s['@type']==='FAQPage');
   const conclusion=html.match(/class="official-conclusion">(.*?)<\/p>/)[1];
   assert.match(conclusion,/测试地区 A/);assert.match(conclusion,/fixture-31.27 USD/);assert.ok(conclusion.includes((137.43+i).toFixed(2)));assert.doesNotMatch(conclusion,/测试地区 B/);assert.match(conclusion,/本期未收录美区参考/);
   assert.ok(html.includes('rel="canonical" href="https://airadar.vip'+path+'"'));assert.ok(html.includes('hreflang="en" href="https://airadar.vip/en'+path+'"'));
   assert.equal(graph.find(s=>s['@type']==='Dataset').dateModified,collected);assert.equal(faq.mainEntity.length,5);
   for(const q of faq.mainEntity){assert.ok(html.includes(q.name));assert.ok(html.includes(q.acceptedAnswer.text));}
   const crumbs=graph.find(s=>s['@type']==='BreadcrumbList');assert.deepEqual(crumbs.itemListElement.map(s=>s.item),['https://airadar.vip/','https://airadar.vip/official-prices','https://airadar.vip'+path]);
   const markdown=await get(path+'.md');assert.equal(markdown.status,200);assert.match(markdown.headers.get('content-type'),/text\/markdown/);const text=await markdown.text();assert.match(text,/未经本站逐条结账核验/);assert.ok(text.includes((137.43+i).toFixed(2)));assert.ok(text.includes(path));assert.equal((await get('/en'+path)).status,200);
  }
  for(const method of ['GET','HEAD'])for(const path of ['/official-prices?id=chatgpt-plus','/product?source=cardnav-official&id=chatgpt-plus','/en/official-prices?id=chatgpt-plus']){
   const r=await get(path,method);assert.equal(r.status,301);assert.equal(r.headers.get('location'),(path.startsWith('/en/')?'/en':'')+'/official-prices/chatgpt-plus');if(method==='HEAD')assert.equal(await r.text(),'');
  }
  for(const path of ['/official-prices/unknown','/en/official-prices/unknown','/product?source=cardnav-official&id=unknown'])assert.equal((await get(path)).status,404);
  assert.notEqual((await get('/official-prices?id=unknown')).status,301);
  const filter=await(await get('/official-prices/chatgpt-plus?period=year')).text();assert.match(filter,/name="robots" content="noindex/);assert.match(filter,/canonical" href="https:\/\/airadar.vip\/official-prices\/chatgpt-plus"/);
  const map=await(await get('/sitemap.xml')).text();assert.ok(map.includes('<loc>https://airadar.vip/official-prices/chatgpt-plus</loc><lastmod>'+collected+'</lastmod>'));assert.doesNotMatch(map,/product\?source=(?:cardnav-official|direct-shops)&amp;id=chatgpt-plus/);assert.doesNotMatch(map,/\?family=/);
  const llms=await(await get('/llms-full.txt')).text();assert.ok(llms.length>8000);assert.match(llms,/fixture-31.27/);assert.match(llms,/official-prices\/chatgpt-plus.md/);assert.match(llms,/不作交易担保/);
 }finally{await new Promise(r=>app.close(r));db.close();}
});
test('clean price FAQ matches visible text and AggregateOffer excludes cheaper account delivery',async()=>{
 const db=fixture(),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 try{
  for(const path of ['/product?id=chatgpt-plus-recharge','/product?source=direct-shops&id=chatgpt-plus-recharge']){
   const r=await fetch(origin+path+'&delivery=all&sort=price_asc&utm_source=fixture&next=https://evil.example&page=2',{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/prices/chatgpt-plus?utm_source=fixture');
  }
  const html=await(await fetch(origin+'/prices/chatgpt-plus')).text(),graph=schemas(html);
  assert.match(html,/data-price="2.34"/);assert.equal(graph.find(s=>s['@type']==='Product').offers.lowPrice,187.62);assert.equal(graph.find(s=>s['@type']==='Product').offers.offerCount,1);
  const faq=graph.find(s=>s['@type']==='FAQPage');assert.deepEqual(faq.mainEntity.map(q=>[q.name,q.acceptedAnswer.text]),PRODUCT_FAQ);for(const [q,a] of PRODUCT_FAQ){assert.ok(html.includes(q));assert.ok(html.includes(a));}
 }finally{await new Promise(r=>app.close(r));db.close();}
});
test('summary missing comparable CNY and US data is explicit; no FX inference',()=>{
 const p={name:'测试套餐',rows:[{region:'测试地区',period:'unknown',originalCurrency:'USD',originalPrice:'123',cny:1,collectedAt:collected}]};
 assert.match(officialSummary(p).conclusion,/本期未收录/);assert.match(officialSummary(p).american,/本期未收录美区参考/);
 p.rows[0].period='month';p.rows[0].cny=null;assert.match(officialSummary(p).conclusion,/本期未收录/);
 p.rows[0].region='美国 (US)';assert.match(officialSummary(p).american,/123 USD/);assert.match(officialSummary(p).american,/人民币参考额本期未收录/);
});
test('automatic semantic manifests ignore collection clocks, establish baseline, bound batches and retain cooldown/pending rules',()=>{
 for(const value of [undefined,'0','off','invalid','true']){assert.equal(indexNowAutoEnabled(value),false);const result=JSON.parse(execFileSync(process.execPath,['scripts/indexnow.mjs','--auto'],{env:{...process.env,AIRADAR_INDEXNOW_AUTO:value||''},encoding:'utf8'}));assert.equal(result.disabled,true);}
 assert.equal(indexNowAutoEnabled('on'),true);assert.equal(indexNowAutoEnabled('1'),true);
 const db=fixture();try{
  const docs=indexNowDocuments(db),baseline=autoManifest(docs,{});assert.equal(baseline.manifest.changes.length,0);
  db.prepare("UPDATE snapshots SET fetched_at='2026-10-21T00:00:00Z' WHERE source='cardnav-official'").run();assert.equal(autoManifest(indexNowDocuments(db),{fingerprints:baseline.fingerprints}).manifest.changes.length,0);
  db.prepare("UPDATE offers SET price=price+7 WHERE source='cardnav-official'").run();
  const now=Date.parse('2026-11-01T00:00:00Z'),changed=autoManifest(indexNowDocuments(db),{fingerprints:baseline.fingerprints},now);assert.equal(changed.manifest.changes.length,10);
  const state={version:1,activatedAt:'2026-10-01T00:00:00Z',accepted:[],pending:[]};const plan=planIndexNow(changed.manifest,state,now);assert.equal(plan.selected.length,10);
  state.pending=[plan.selected[0]];assert.equal(planIndexNow(changed.manifest,state,now).skipped[0].why,'previous_attempt_uncertain');state.pending=[];state.accepted=[{...plan.selected[0],revision:'f'.repeat(64),submittedAt:new Date(now-1000).toISOString()}];assert.equal(planIndexNow(changed.manifest,state,now).skipped[0].why,'five_minute_cooldown');
  assert.equal(autoManifest(Array.from({length:25},(_,i)=>({url:'/guides/fixture-'+i,content:i})),{fingerprints:{}},now).manifest.changes.length,20);
  assert.equal(indexNowUrl('/en/official-prices/chatgpt-pro-5x'),'https://airadar.vip/en/official-prices/chatgpt-pro-5x');for(const url of ['/official-prices/unknown','/official-prices/chatgpt-plus.md','https://evil.example/','/account'])assert.throws(()=>indexNowUrl(url));
 }finally{db.close();}
});

test('enabled automatic task sends semantic changes, throttles, records rejection and never retries pending',()=>{
 const dir=mkdtempSync(join(tmpdir(),'seo-auto-'));
 try{
  const database=join(dir,'catalog.sqlite'),statePath=join(dir,'state.json'),stub=join(dir,'fetch.mjs'),capture=join(dir,'calls.json');
  const db=fixture(database);db.close();
  writeFileSync(statePath,JSON.stringify({version:1,activatedAt:new Date(Date.now()-3600000).toISOString(),accepted:[],pending:[]}));
  writeFileSync(stub,`import {writeFileSync} from 'node:fs';
import {INDEXNOW_KEY,INDEXNOW_KEY_PATH,INDEXNOW_ENDPOINT} from ${JSON.stringify(new URL('../lib/indexnow.mjs',import.meta.url).href)};
const calls=[];globalThis.fetch=async(url,options)=>{calls.push(url);writeFileSync(${JSON.stringify(capture)},JSON.stringify(calls));if(url.endsWith(INDEXNOW_KEY_PATH))return new Response(INDEXNOW_KEY);if(url===INDEXNOW_ENDPOINT)return new Response('',{status:Number(process.env.FIXTURE_STATUS||202)});return new Response('<link rel="canonical" href="'+url+'">',{headers:{'Content-Type':'text/html'}});};`);
  const run=(status='202')=>JSON.parse(execFileSync(process.execPath,['--import',stub,'scripts/indexnow.mjs','--auto'],{encoding:'utf8',env:{...process.env,AIRADAR_INDEXNOW_AUTO:'on',AIRADAR_INDEXNOW_STATE:statePath,AIRADAR_INDEXNOW_DB:database,FIXTURE_STATUS:status}}));
  const mutate=()=>{const db=openDb(database);try{db.prepare("UPDATE offers SET price=price+1 WHERE source='cardnav-official'").run();}finally{db.close();}};
  assert.equal(run().submitted,0);assert.equal(existsSync(capture),false);
  mutate();assert.equal(run().submitted,10);let saved=JSON.parse(readFileSync(statePath));assert.equal(saved.accepted.length,10);assert.equal(saved.pending.length,0);
  mutate();const cooled=run();assert.equal(cooled.submitted,0);assert.equal(cooled.skipped.length,10);assert.ok(cooled.skipped.every(x=>x.why==='five_minute_cooldown'));
  saved=JSON.parse(readFileSync(statePath));saved.accepted=[];writeFileSync(statePath,JSON.stringify(saved));
  assert.throws(()=>run('429'));saved=JSON.parse(readFileSync(statePath));assert.equal(saved.pending.length,10);assert.equal(saved.lastResponse.status,429);
  mutate();const uncertain=run();assert.equal(uncertain.submitted,0);assert.ok(uncertain.skipped.every(x=>x.why==='previous_attempt_uncertain'));assert.equal(existsSync(statePath+'.lock'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
