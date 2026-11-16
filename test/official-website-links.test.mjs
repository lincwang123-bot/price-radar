import test from 'node:test';
import assert from 'node:assert/strict';
import * as baselines from '../lib/official-baselines.mjs';
import {officialPriceContent} from '../lib/official-price-ui.mjs';
import {DEFAULT_PAGES,parseCardnavPage} from '../sources/cardnav.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

const sites={ChatGPT:'https://chatgpt.com/pricing/',Claude:'https://claude.com/pricing',Gemini:'https://gemini.google/subscriptions/',Muse:'https://muse.ai/',Grok:'https://grok.com/',Microsoft:'https://copilot.microsoft.com/',X:'https://x.com/','X 融合订阅':'https://x.ai/pricing'};
const assertLink=(html,id,url)=>{
 const anchor=html.match(new RegExp('<a[^>]*data-official-website="'+id+'"[^>]*>[^<]*</a>'))?.[0];
 assert.ok(anchor,'missing official website for '+id);
 assert.ok(anchor.includes('href="'+url+'"'),anchor);
 assert.match(anchor,/target="_blank"/);assert.match(anchor,/rel="noopener noreferrer"/);
 assert.match(anchor,/前往官网/);assert.doesNotMatch(anchor,/data-store-risk|cardnav\.xyz|\/out\?/);
};

test('all official monthly references have a separate direct vendor link in full and compact cards',()=>{
 for(const row of baselines.OFFICIAL_BASELINES){
  for(const compact of [false,true]){
   const html=baselines.baselineHtml(row,{compact});
   assertLink(html,row.id,sites[row.platform]);
   assert.ok(html.includes('href="'+row.source+'"'));
   assert.match(html,/查看官方依据/);
  }
 }
});

test('official links use a reviewed product allowlist, never upstream or user supplied URLs',()=>{
 assert.equal(typeof baselines.officialWebsite,'function');
 for(const id of DEFAULT_PAGES)assert.equal(baselines.officialWebsite(id),sites[parseCardnavPage('',id).platform]);
 for(const id of ['unknown','chatgpt-evil','https://evil.test/','__proto__','constructor','muse-power\"><script>']){
  assert.equal(baselines.officialWebsite(id),null);
  assert.equal(baselines.officialWebsiteLink(id),'');
 }
});

function fixture(){
 const db=openDb(':memory:');const now=new Date().toISOString();
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'official-links',fetchedAt:now,products:DEFAULT_PAGES.map(id=>{
  const meta=parseCardnavPage('',id);
  return {productId:id,name:meta.name,platform:meta.platform,currency:'CNY',offers:[{offerId:id+'-us',storeName:'美国 (US)',title:'美国 $20 USD',price:140,currency:'CNY',status:'official',url:'https://cardnav.xyz/official-price/'+id,capturedAt:now}]};
 })});
 return db;
}

test('all regional reference cards and detail headers expose vendor links without replacing source links',()=>{
 const db=fixture();
 try{
  const overview=officialPriceContent(db,new URL('https://airadar.vip/official-prices'));
  const cards=[...overview.matchAll(/<article class="official-card">([\s\S]*?)<\/article>/g)].map(m=>m[1]);
  assert.equal(cards.length,DEFAULT_PAGES.length);
  for(const id of DEFAULT_PAGES){
   const card=cards.find(html=>html.includes('/official-prices/'+id+'"'));
   assert.ok(card,'regional card '+id);assertLink(card,id,sites[parseCardnavPage('',id).platform]);
   const detail=officialPriceContent(db,new URL('https://airadar.vip/product?source=cardnav-official&id='+id));
   assertLink(detail.split('</header>')[0],id,sites[parseCardnavPage('',id).platform]);
   assert.ok(detail.includes('href="https://cardnav.xyz/official-price/'+id+'"'));
  }
 }finally{db.close();}
});

test('product quote pages retain clickable official destinations for compact baselines and reference rows',async()=>{
 const db=fixture(),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 try{
  const response=await fetch('http://127.0.0.1:'+app.address().port+'/?family=chatgpt&product=chatgpt-plus');
  assert.equal(response.status,200);const html=await response.text();
  assertLink(html,'chatgpt-plus',sites.ChatGPT);
  const references=html.match(/<section class="directory-references">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(references,'official reference section');
  assertLink(references,'chatgpt-plus',sites.ChatGPT);
 }finally{
  app.closeAllConnections();await new Promise(r=>app.close(r));
  await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();
 }
});
