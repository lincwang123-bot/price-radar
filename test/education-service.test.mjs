import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDirectOffer,groupDirectOffers} from '../collectors/direct/catalog.mjs';
import {offerSpec} from '../lib/offer-spec.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
import {openDb,storeSnapshot,recentSnapshots,productsOfSnapshot} from '../lib/db.mjs';
import {projectProduct,quoteSeries} from '../lib/quote-policy.mjs';
import {readRetentionMarket} from '../lib/retention-market.mjs';
import {createApp} from '../lib/web.mjs';

const serviceId='education-verification-service';
const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',status:'in_stock',stockCount:1,url:`https://education-fixture.example.org/item/${id}`,capturedAt:new Date().toISOString()});

test('the separate service page and its sort links work in both languages',async()=>{
 const db=openDb(':memory:');let app;
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'education-routes',products:groupDirectOffers([offer('student','Plus学生认证',85)])});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+app.address().port;
  for(const prefix of ['','/en']){
   const res=await fetch(origin+prefix+'/prices/'+serviceId),html=await res.text();
   assert.equal(res.status,200);
   assert.match(html,prefix?/Education \/ student verification \(not a subscription\)/:/教育资格 \/ 学生认证（非订阅）/);
   assert.match(html,/data-price="85"/);
   const sortLinks=[...html.matchAll(/<a\b[^>]*data-sort-choice[^>]*>/g)].map(m=>m[0].match(/href="([^"]+)"/)[1]);
   assert.equal(sortLinks.length,3);
   for(const href of sortLinks){
    const sorted=await fetch(origin+href.replaceAll('&amp;','&'));
    assert.equal(sorted.status,200);
    assert.match(await sorted.text(),/data-price="85"/);
   }
  }
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});

test('education verification and eligibility are auxiliary services, never Plus subscriptions',()=>{
 for(const title of ['Plus学生认证','ChatGPT Plus 学生认证代充30天','GPT Plus 教育资格代办','Gemini Pro 学籍验证','Student verification service','ChatGPT Plus education eligibility service','SheerID 学生认证']){
  const row=offer('student',title,85);
  assert.equal(classifyDirectOffer(row)?.id,serviceId,title);
  const spec=offerSpec(row,{product_id:'chatgpt-plus-recharge'});
  assert.equal(spec.comparison_eligible,false,title);
  assert.match(spec.label,/非订阅/);
  assert.match(spec.key,/^other:education-verification-service:/);
 }
});

test('negated requirements, actual subscriptions, education email and unrelated parent text do not become verification services',()=>{
 for(const title of ['ChatGPT Plus 代充30天 无需学生认证','ChatGPT Plus 月卡 非教育资格代办','ChatGPT Plus monthly recharge - no student verification required','ChatGPT Plus 月卡 学生也可购买','ChatGPT Plus 成品账号1个月 已通过学生认证']){
  assert.notEqual(classifyDirectOffer({title})?.id,serviceId,title);
  assert.ok(classifyDirectOffer({title}),title);
 }
 assert.equal(classifyDirectOffer({title:'教育邮箱账号（可用于学生认证）'})?.id,'email-accounts');
 const title='ChatGPT Plus 代充30天';
 const evidence={productTitle:title,description:'本商品仅提供学生认证服务，不含订阅',descriptionScope:'product'};
 assert.equal(classifyDirectOffer({title,extra:{deliveryEvidence:evidence}})?.id,serviceId);
 for(const extra of [
  {deliveryEvidence:{...evidence,productTitle:'另一件商品'}},
  {deliveryEvidence:{...evidence,descriptionScope:'product_multi'}},
  {deliveryEvidence:{...evidence,description:'本店另有学生认证服务'}},
  {deliveryEvidence:{...evidence,description:'无需学生认证，直接充值到自己的账号'}},
  {deliveryEvidence:{category:'学生认证'}},
  {deliveryEvidence:{...evidence,skuTitle:'普通月卡（无需学生认证）',descriptionScope:'product_multi'}},
  {notice:'学生认证'},
 ])assert.equal(classifyDirectOffer({title,extra})?.id,'chatgpt-plus-recharge');
 assert.equal(classifyDirectOffer({title:'ChatGPT Plus 商品 · 学生认证',extra:{deliveryEvidence:{skuTitle:'学生认证',descriptionScope:'product_multi'}}})?.id,serviceId);
});

test('new collection groups service separately; stored Plus/search buckets and price history cannot leak its price',()=>{
 const student=offer('student','ChatGPT Plus 学生认证代充30天 新开续费均可',85),normal=offer('normal','ChatGPT Plus 代充30天 新开续费均可',110);
 const grouped=groupDirectOffers([student,normal]);
 assert.equal(grouped.find(p=>p.productId==='chatgpt-plus-recharge').offers.length,1);
 assert.equal(grouped.find(p=>p.productId===serviceId).offers.length,1);
 for(const source of ['direct-shops','ldxp-goods']){
  const db=openDb(':memory:');
  try{
   storeSnapshot(db,{source,snapshotId:'education-old',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',offers:[student,normal]}]});
   const snapshot=recentSnapshots(db,source,1)[0],product=productsOfSnapshot(db,source,snapshot.snapshot_id)[0];
   const projected=projectProduct(db,source,snapshot,product);
   const directory=buildProductDirectory([{source,products:[projected]}]).flatMap(c=>c.products);
   assert.deepEqual(directoryQuotes(directory.find(p=>p.key==='chatgpt-plus')).entries.map(e=>e.offer.price),[110]);
   assert.ok(!readRetentionMarket(db).groups.some(g=>g.price===85));
   assert.notEqual(quoteSeries(db,{source,productId:'chatgpt-plus-recharge'})[0].lowest_price,85);
   assert.equal(db.prepare('SELECT count(*) n FROM offers').get().n,2,'original records remain intact');
  }finally{db.close();}
 }
 const db=openDb(':memory:');
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'education-new',products:grouped});
  const snapshot=recentSnapshots(db,'direct-shops',1)[0];
  const products=productsOfSnapshot(db,'direct-shops',snapshot.snapshot_id).map(p=>projectProduct(db,'direct-shops',snapshot,p));
  const directory=buildProductDirectory([{source:'direct-shops',products}]);
  const auxiliary=directory.find(c=>c.key==='other').products.find(p=>p.key===serviceId);
  assert.equal(directoryQuotes(auxiliary).entries[0].offer.price,85);
  assert.equal(auxiliary.deliveryEnabled,false);
 }finally{db.close();}
});
