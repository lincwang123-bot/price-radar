import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('missing historical source URLs lead to the same current product without reviving retired quotes',async()=>{
 const db=openDb(':memory:'); let app;
 const product=(productId,name,price=120)=>({productId,name,currency:'CNY',offers:[{offerId:productId,title:name+' 代充 1个月 新开续费均可',price,currency:'CNY',stockCount:2,status:'in_stock',storeName:price===1?'Retired quote':'Current store',url:'https://merchant.example.org/'+productId}]});
 try{
  storeSnapshot(db,{source:'priceai',snapshotId:'historic',products:[product('chatgpt-plus-recharge','ChatGPT Plus',1),product('chatgpt-pro-20x','ChatGPT Pro 20x',1),product('chatgpt-team-business','ChatGPT Team Business',1),product('claude-max-20x','Claude Max 20x',1),product('api-cdk-credits','API 中转',1)]});
  db.prepare("DELETE FROM products WHERE source='priceai' AND product_id='chatgpt-plus-recharge'").run(); // retired source rows may already be gone
  storeSnapshot(db,{source:'ldxp-goods',snapshotId:'old',fetchedAt:'2026-01-01T00:00:00Z',products:[product('chatgpt-plus','ChatGPT Plus')]});
  storeSnapshot(db,{source:'ldxp-goods',snapshotId:'current',products:[]});
  storeSnapshot(db,{source:'direct-shops',snapshotId:'current',products:[product('chatgpt-plus-recharge','ChatGPT Plus'),product('chatgpt-pro-20x','ChatGPT Pro 20x'),product('chatgpt-team-business','ChatGPT Team Business')]});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+app.address().port;
  const get=(path,method='GET')=>fetch(origin+path,{method,redirect:'manual'});
  for(const [old,target] of [
   ['/product?source=priceai&id=chatgpt-plus-recharge','/prices/chatgpt-plus'],
   ['/product?source=priceai&id=chatgpt-pro-20x','/prices/chatgpt-pro-20x'],
   ['/product?source=ldxp-goods&id=chatgpt-plus','/prices/chatgpt-plus'],
   ['/product?source=priceai&id=chatgpt-team-business','/?family=chatgpt&product=chatgpt-team-business'],
  ]){
   for(const method of ['GET','HEAD']){
    const r=await get(old,method);assert.equal(r.status,301,old);assert.equal(r.headers.get('location'),target);assert.equal(await r.text(),'');
   }
   const r=await get(target);assert.equal(r.status,200,target);const html=await r.text();assert.doesNotMatch(html,/Retired quote/);
   assert.match(html,/<meta name="robots" content="index, follow/);
  }
  const filtered=await get('/product?source=priceai&id=chatgpt-plus-recharge&delivery=account&currency=CNY&spec=old-group&page=4&utm_source=google&next=https://other.example');
  const location=new URL(filtered.headers.get('location'),origin);
  assert.equal(location.pathname,'/prices/chatgpt-plus');
  for(const key of ['delivery','currency','spec','utm_source'])assert.ok(location.searchParams.has(key));
  for(const key of ['source','id','page','next'])assert.equal(location.searchParams.has(key),false);
  for(const path of [
   '/product?source=priceai&id=claude-max-20x', // no current equivalent
   '/product?source=priceai&id=chatgpt-go', // no current equivalent
   '/product?source=priceai&id=api-cdk-credits',
   '/product?source=goaihop-relay&id=chatgpt-plus',
   '/product?source=unregistered&id=chatgpt-plus',
   '/product?source=priceai&source=direct-shops&id=chatgpt-plus-recharge',
  ])assert.equal((await get(path)).status,404,path);
  assert.equal((await get('/product?source=direct-shops&id=chatgpt-plus-recharge')).status,301,'active source maps to clean price page');
  const map=await(await get('/sitemap.xml')).text();assert.doesNotMatch(map,/priceai|api-cdk-credits/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE source='priceai'").get().n,4,'remaining history stays intact');
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});


// GSC's 2026-10-08 404 export contains these exact historical identities.
// They retain separate plan tiers; no unknown PriceAI source ID is inferred.
test('Oct8 observed legacy products migrate only to their same live product and retain explicit filters',async()=>{
 const db=openDb(':memory:');let app;
 const product=(productId,name,months=1)=>({productId,name,currency:'CNY',offers:[{offerId:productId,title:`${name} 代充 ${months}个月 新开续费均可`,price:120,currency:'CNY',stockCount:2,status:'in_stock',storeName:'Current store',url:'https://merchant.example.org/'+productId}]});
 const migrations=[
  ['claude-pro-month','claude-pro','Claude Pro'],
  ['claude-max-5x','claude-max-5x','Claude Max（原 Max 5x）'],
  ['claude-max-20x','claude-max-20x','Claude Ultra（原 Max 20x）'],
  ['gemini-pro-recharge','gemini-pro','Gemini Pro'],
  ['gemini-pro-year','gemini-pro','Gemini Pro'],
  ['gemini-ultra','gemini-ultra','Gemini Ultra'],
  ['super-grok','super-grok','Super Grok'],
  ['chatgpt-go','chatgpt-go','ChatGPT Go'],
  ['x-twitter-premium','x-twitter-premium','X Premium'],
 ];
 try{
  storeSnapshot(db,{source:'direct-shops',snapshotId:'historic-month',fetchedAt:'2026-01-01T00:00:00Z',products:[product('perplexity-pro-1m','Perplexity Pro')]});
  const products=migrations.filter(([,key],i)=>migrations.findIndex(([,candidate])=>candidate===key)===i).map(([id,,name])=>product(id,name));
  products.push(product('perplexity-pro-12m','Perplexity Pro',12));
  storeSnapshot(db,{source:'direct-shops',snapshotId:'current-oct8',products});
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
  const get=(path,method='GET')=>fetch(origin+path,{method,redirect:'manual'});
  const pairs=migrations.map(([id,key])=>[`/product?source=priceai&id=${id}`,key==='x-twitter-premium'?'/?family=x&product=x-twitter-premium':'/prices/'+key]);
  pairs.push(['/product?source=direct-shops&id=perplexity-pro-1m','/?family=perplexity&product=perplexity-pro']);
  for(const [old,target] of pairs){
   for(const method of ['GET','HEAD']){const res=await get(old,method);assert.equal(res.status,301,old);assert.equal(res.headers.get('location'),target,old);assert.equal(await res.text(),'');}
   const res=await get(target);assert.equal(res.status,200,target);const text=await res.text();assert.match(text,/<meta name="robots" content="index, follow/);
  }
  const filtered=await get('/product?source=priceai&id=gemini-pro-year&spec=12m%3Apro%3Aaccount%3ACNY&delivery=account&currency=CNY&page=9&utm_source=google&next=https://other.example');
  assert.equal(filtered.status,301);const loc=new URL(filtered.headers.get('location'),origin);assert.equal(loc.pathname,'/prices/gemini-pro');
  for(const [key,value] of [['spec','12m:pro:account:CNY'],['delivery','account'],['currency','CNY'],['utm_source','google']])assert.equal(loc.searchParams.get(key),value);
  for(const key of ['source','id','page','next'])assert.equal(loc.searchParams.has(key),false);
  const monthly=await get('/product?source=direct-shops&id=perplexity-pro-1m&spec=1m%3Apro%3Arecharge%3ACNY');assert.equal(monthly.status,301);assert.equal(new URL(monthly.headers.get('location'),origin).searchParams.get('spec'),'1m:pro:recharge:CNY');
  for(const path of ['/product?source=priceai&id=claude-team-premium','/product?source=priceai&id=claude-account','/product?source=priceai&id=gemini-claim-link','/product?source=priceai&id=perplexity-pro-1m','/product?source=priceai&id=unknown-product','/product?source=priceai&source=direct-shops&id=chatgpt-go','/product?source=priceai&id=chatgpt-go&id=gemini-ultra'])assert.equal((await get(path)).status,404,path);
  assert.equal((await get('/?family=relay&product=api-cdk-credits')).status,410);
  assert.equal((await get('/product?source=direct-shops&id=perplexity-pro-12m')).status,200);
  assert.doesNotMatch(await(await get('/sitemap.xml')).text(),/source=priceai|api-cdk-credits/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE source='priceai'").get().n,0,'migration must not restore retired source rows');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE snapshot_id='historic-month'").get().n,1,'original historical month record is unchanged');
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});


test('observed Perplexity alias needs both a historical row and a live equivalent',async()=>{
 const product=(productId,months)=>({productId,name:'Perplexity Pro',currency:'CNY',offers:[{offerId:productId,title:`Perplexity Pro 代充 ${months}个月 新开续费均可`,price:120,currency:'CNY',stockCount:2,status:'in_stock',storeName:'Current store',url:'https://merchant.example.org/'+productId}]});
 for(const scenario of ['without-history','without-live-product']){
  const db=openDb(':memory:');let app;
  try{
   if(scenario==='without-live-product')storeSnapshot(db,{source:'direct-shops',snapshotId:'old-month',fetchedAt:'2026-01-01T00:00:00Z',products:[product('perplexity-pro-1m',1)]});
   storeSnapshot(db,{source:'direct-shops',snapshotId:'newest',products:scenario==='without-history'?[product('perplexity-pro-12m',12)]:[]});
   app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
   const res=await fetch(origin+'/product?source=direct-shops&id=perplexity-pro-1m',{redirect:'manual'});assert.equal(res.status,404,scenario);assert.equal(res.headers.get('location'),null);
  }finally{if(app?.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
 }
});
