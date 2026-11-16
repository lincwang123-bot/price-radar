import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiClassification,geminiReviewKey,geminiDisplayRows,validateGeminiReview,geminiQuoteGroupHtml} from '../lib/gemini-eligibility.mjs';
import {directoryQuotes,buildProductDirectory} from '../lib/product-directory.mjs';
const product={key:'gemini-pro',deliveryEnabled:true};
const verifiedAt='2026-11-08T00:00:00Z';
const dimension=kind=>({kind,status:'confirmed',basis:'Public SKU description checked against supplier record',verifiedAt});
const source={type:'upstream',status:'confirmed',sourceId:'supplier-1',goodsId:'goods-1',reference:'https://supplier.example/sku/1',basis:'SKU binding cross-checked',verifiedAt};
const entry=(id,price=10)=>({list:{source:'direct-shops'},product:{product_id:'gemini-pro',currency:'CNY'},offer:{offer_id:id,title:'Gemini Pro 学生 家庭组 成品号',price,currency:'CNY',url:`https://${id}.example.org/product`,store_name:id,status:'in_stock',stock_count:2,comparison_known:true,comparison_key:'1m:account:CNY',comparison_eligible:true,purchase_conditions:{subscriptionTerm:'1m'}}});
const review=(e,patch={})=>({key:geminiReviewKey(e),productKey:'gemini-pro',actor:'operator',reason:'Reviewed public evidence',recordedAt:verifiedAt,delivery:dimension('account'),eligibility:dimension('paid'),plan:'Google AI Pro',term:'1m',sameSource:{...source},...patch});
const classified=(e,r=review(e))=>({...e,gemini:geminiClassification(e,[r])});
test('dimensions require independent evidence, never title, price or collector assertions',()=>{
 const e=entry('one',0.01);e.offer.extra={gemini:{delivery:dimension('family')}};
 assert.equal(geminiClassification(e,[]).delivery.kind,'unknown');
 assert.equal(geminiClassification(e,[]).eligibility.kind,'unknown');
 for(const [field,other] of [['delivery','eligibility'],['eligibility','delivery']]){
  const r=review(e);delete r[other];
  assert.equal(geminiClassification(e,[r])[field].status,'confirmed');
  assert.equal(geminiClassification(e,[r])[other].kind,'unknown');
  r[field].status='conflict';assert.equal(geminiClassification(e,[r])[field].kind,'unknown');
 }
 const r=review(e);r.eligibility.verifiedAt='invalid';assert.equal(geminiClassification(e,[r]).eligibility.kind,'unknown');
});
test('same title, price, system or image cannot fold without source and goods ID',()=>{
 const a=entry('a'),b=entry('b');
 for(const patch of [{sameSource:undefined},{sameSource:{...source,goodsId:''}},{sameSource:{...source,reference:''}},{sameSource:{...source,status:'paused'}}]){
  assert.equal(geminiDisplayRows([classified(a,review(a,patch)),classified(b,review(b,patch))],product).length,2);
 }
});
test('verified upstream groups retain all members, links and first original position',()=>{
 const entries=[classified(entry('a',10)),classified(entry('middle',11),review(entry('middle'),{sameSource:undefined})),classified(entry('b',12))];
 const rows=geminiDisplayRows(entries,product);
 assert.deepEqual(rows.map(r=>r.originalPosition),[0,1]);
 assert.deepEqual(rows[0].members.map(e=>e.offer.offer_id),['a','b']);
 assert.equal(rows[0].shopCount,2);
 assert.equal(rows.flatMap(r=>r.members).length,entries.length);
 assert.deepEqual(rows[0].members.map(e=>e.offer.url),[entries[0].offer.url,entries[2].offer.url]);
 assert.deepEqual(rows[0].members.map(e=>e.offer.price),[10,12]);
 assert.deepEqual(entries.map(e=>e.offer.price),[10,11,12]);
});
test('plan, term, dimension conflicts pause folding; manual split and later correction are audited',()=>{
 const a=entry('a'),b=entry('b'),c=entry('c');
 for(const patch of [{plan:'Ultra'},{delivery:dimension('family')},{eligibility:dimension('student')},{sameSource:{...source,status:'split'}},{eligibility:{...dimension('paid'),status:'conflict'}}]){
  const entries=[classified(a),classified(b),classified(c,review(c,patch))];
  assert.equal(geminiDisplayRows(entries,product).length,3);
 }
 const term=classified(b);term.offer.purchase_conditions.subscriptionTerm='12m';
 assert.equal(geminiDisplayRows([classified(a),term],product).length,2);
 const old=review(a),split=review(a,{reason:'Wrong source; split',sameSource:{...source,status:'split'}});
 assert.equal(geminiClassification(a,[old,split]).review.reason,'Wrong source; split');
 assert.equal(validateGeminiReview(split),split);
 assert.throws(()=>validateGeminiReview(review(a,{sameSource:{...source,goodsId:''}})));
 assert.throws(()=>validateGeminiReview({...old,actor:''}));
});
test('directory defaults all Gemini product types to pending; other brands preserve existing classification and sorting',()=>{
 const entries=[entry('b',12),entry('a',10)];
 for(const key of ['gemini-pro','gemini-ultra','gemini-pro-long','gemini-ultra-long','gemini-ai-plus','gemini-activation-service','gemini-claim-link']){
  const p={...product,key,quoteEntries:entries};
  const quotes=directoryQuotes(p);
  assert.deepEqual(quotes.entries.map(e=>e.offer.price),[10,12]);
  assert.equal(quotes.entries[0].gemini.delivery.kind,'unknown');
  assert.equal(directoryQuotes(p,{eligibility:'paid'}).total,0);
  assert.equal(directoryQuotes(p,{delivery:'unknown',eligibility:'unknown'}).total,2);
  assert.equal(quotes.displayRows.length,2);
 }
 const p={key:'chatgpt-plus',deliveryEnabled:true,quoteEntries:entries};
 assert.deepEqual(directoryQuotes(p,{eligibility:'paid'}),directoryQuotes(p));
 assert.equal(directoryQuotes(p).entries[0].delivery.kind,'account');
 assert.equal(directoryQuotes(p).entries[0].gemini,undefined);
 assert.equal(geminiDisplayRows([classified(entries[0]),classified(entries[1])],p).length,2);
 const directory=buildProductDirectory([{source:'ldxp-goods',products:[{product_id:'gemini-claim-link',name:'Gemini 权益领取链接',currency:'CNY',offers:[{...entry('link').offer,title:'Gemini 权益领取链接'}]}]}]);
 assert.equal(directory.find(c=>c.key==='gemini').products.find(p=>p.key==='gemini-claim-link').deliveryEnabled,true);
});

test('expanded SSR retains every member price, classification and original link',()=>{
 const entries=[classified(entry('a',10)),classified(entry('b',12))];
 const row=geminiDisplayRows(entries,product)[0];
 const html=geminiQuoteGroupHtml(row,e=>`<article><a href="${e.offer.url}">${e.offer.price}</a><span>${e.gemini.delivery.label} ${e.gemini.eligibility.label} ${e.gemini.delivery.status}</span></article>`);
 assert.match(html,/<details class="gemini-same-source"><summary>共 2 家店报价/);
 assert.equal((html.match(/<article>/g)||[]).length,2);
 for(const e of entries){assert.ok(html.includes(e.offer.url));assert.ok(html.includes(e.gemini.delivery.label));assert.ok(html.includes(e.gemini.eligibility.label));}
 assert.ok(html.indexOf(entries[0].offer.url)<html.indexOf(entries[1].offer.url));
});

test('integration and merchant evidence need both verifiable identity components',()=>{
 for(const sameSource of [
  {...source,type:'integration',supplierId:'supplier',sku:'sku'},
  {...source,type:'merchant',sourceId:'supplier',crossCheckId:'cross-checked confirmation'},
 ]){
  const a=entry('a'),b=entry('b');
  assert.equal(geminiDisplayRows([classified(a,review(a,{sameSource})),classified(b,review(b,{sameSource}))],product).length,1);
  const invalid={...sameSource};delete invalid[sameSource.type==='integration'?'sku':'crossCheckId'];
  assert.throws(()=>validateGeminiReview(review(a,{sameSource:invalid})));
 }
});
test('filters cannot hide source conflicts and permit folding; unknown term never groups',()=>{
 const a=classified(entry('a')),b=classified(entry('b')),c=classified(entry('c'),review(entry('c'),{eligibility:dimension('student')}));
 assert.equal(geminiDisplayRows([a,b],product,[a,b,c]).length,2);
 for(const term of ['unknown','ambiguous',undefined]){
  const e=classified(entry('a'));e.offer.purchase_conditions.subscriptionTerm=term;
  assert.equal(geminiDisplayRows([e,classified(entry('b'))],product).length,2);
 }
});
