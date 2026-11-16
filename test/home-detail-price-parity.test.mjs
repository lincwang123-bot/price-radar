import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {readRetentionMarket} from '../lib/retention-market.mjs';

test('home starting prices include incomplete current quotes just like the linked price-sorted detail, in both languages',async()=>{
 const db=openDb(':memory:');let app;
 const now=new Date().toISOString();
 const retainedAt=new Date(Date.now()-24*3600000).toISOString();
 const offer=(id,price,extra={})=>({offerId:id,storeName:'Parity '+id,title:'ChatGPT Plus 代充30天 新开续费均可',price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://parity-'+id+'.example.org/item',capturedAt:now,...extra});
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'home-detail-parity',fetchedAt:now,products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[
   offer('complete',110),offer('incomplete',108.7,{title:'ChatGPT Plus 代充30天'}),
   offer('retained',80,{capturedAt:retainedAt,extra:{quoteHealth:{status:'stale',maxAgeMinutes:1440}}}),
   offer('retained-old',79,{capturedAt:'2020-01-01T00:00:00Z',extra:{quoteHealth:{status:'stale',maxAgeMinutes:1440}}}),
   offer('sold',1,{status:'out_of_stock',stockCount:0}),offer('expired',2,{expiresAt:'2020-01-01T00:00:00Z'}),
   offer('foreign',3,{currency:'USD'}),offer('account',35,{title:'ChatGPT Plus 成品账号1个月'}),
  ]}]});
  storeSnapshot(db,{source:'cardnav-official',snapshotId:'home-detail-reference',fetchedAt:now,products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[offer('reference',5,{status:'official'})]}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
  const get=async p=>(await fetch(origin+p)).text();
  for(const prefix of ['','/en'])for(const path of ['/','/catalog']){
   const html=await get(prefix+path),row=html.match(/<article class="directory-row" data-directory-product="chatgpt-plus">[\s\S]*?<\/article>/)[0];
   const card=row.match(/<a class="directory-delivery-card" data-delivery-link="recharge"[\s\S]*?<\/a>/)[0];
   assert.match(card,/data-directory-minimum>¥108\.70 /);
   assert.match(card,prefix?/Merchant price · Check conditions/:/商家标价 · 条件待确认/);
   assert.doesNotMatch(card,/¥110|¥80|¥35|¥5|\$3/);
   const href=card.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&'),detail=await get(href);
   const rows=[...detail.split('<section class="directory-references">')[0].matchAll(/<article class="directory-quote"[\s\S]*?<\/article>/g)].map(m=>m[0]);
   const fresh=rows.filter(row=>!row.includes('class="quote-retained"'));
   assert.match(rows[0],/data-price="80"/);assert.match(rows[0],new RegExp(retainedAt.replaceAll('.','\\.')));
   // Retained observations older than the display limit are omitted.
   assert.doesNotMatch(detail,/data-price="79"/);
   // Retained observations stay visible but cannot lower a current headline.
   assert.match(fresh[0],/data-price="108\.7"/);assert.match(fresh[0],/data-quote-quality="C"/);
   assert.match(detail,/data-sort-choice="price_asc" aria-current="true"/);
  }
  const market=readRetentionMarket(db);
  const cnyRecharge=market.groups.filter(g=>g.currency==='CNY'&&g.price===110);
  assert.ok(cnyRecharge.length,'complete same-spec price remains eligible for alerts');
  assert.ok(!market.groups.some(g=>g.price===108.7||g.price===80),'incomplete and stale prices still do not trigger alerts');
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});

test('education verification cannot become the Plus home starting price or appear in the Plus detail',async()=>{
 const db=openDb(':memory:');let app;
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'education-home-price',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[
   {offerId:'student',title:'ChatGPT Plus 学生认证代充',price:75,currency:'CNY',status:'in_stock',url:'https://student.example.org/offer'},
   {offerId:'normal',title:'ChatGPT Plus 代充1个月 新开续费均可',price:110,currency:'CNY',status:'in_stock',url:'https://normal.example.org/offer'},
  ]}]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  for(const prefix of ['','/en']){
  const origin='http://127.0.0.1:'+app.address().port;
  const html=await(await fetch(origin+prefix+'/')).text();
  const card=html.match(/<a class="directory-delivery-card" data-delivery-link="recharge"[\s\S]*?<\/a>/)[0];
  assert.match(card,/data-directory-minimum>¥110 /);
  assert.doesNotMatch(card,/¥75|学生认证|教育优惠/);
  const detail=await(await fetch(origin+prefix+'/prices/chatgpt-plus?delivery=recharge')).text();
  assert.doesNotMatch(detail,/学生认证|data-price="75"/);
  assert.match(detail,/data-price="110"/);
  }
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
