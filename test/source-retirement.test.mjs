import test from 'node:test';
import assert from 'node:assert/strict';
import {listSources} from '../sources/registry.mjs';
import {loadConfig} from '../lib/config.mjs';
import {retiredCatalogSource,filterCatalogSnapshot} from '../lib/catalog-policy.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {seoProducts,seoProduct} from '../lib/seo.mjs';
import {readRetentionMarket} from '../lib/retention-market.mjs';
import {runWatch} from '../lib/watch.mjs';
import {resolveOutboundOffer} from '../lib/outbound.mjs';

test('only registered retained catalogs are enabled and public',()=>{
 const sources=['cardnav-official','direct-shops','ldxp-goods'];
 assert.deepEqual(listSources().map(s=>s.id).sort(),sources);
 assert.deepEqual(Object.entries(loadConfig().sources).filter(([,s])=>s.enabled).map(([id])=>id).sort(),sources);
 for(const source of sources)assert.equal(retiredCatalogSource(source),false);
 assert.equal(retiredCatalogSource('retired-example'),true);
 assert.deepEqual(filterCatalogSnapshot({source:'retired-example',products:[{productId:'chatgpt-plus'}]}).products,[]);
});

test('unregistered legacy rows cannot reappear in pages, SEO, outbound, market or watch alerts',async()=>{
 const db=openDb(':memory:');let app;
 try{
  for(const source of ['direct-shops','retired-example'])storeSnapshot(db,{source,snapshotId:'s1',fetchedAt:new Date().toISOString(),products:[
   {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[
    {offerId:'one',title:'ChatGPT Plus 代充 1个月 新开续费均可',price:source==='direct-shops'?120:1,currency:'CNY',stockCount:1,status:'in_stock',storeName:source==='direct-shops'?'Retained merchant':'Retired merchant',url:'https://merchant.example.org/'+source}
   ]}
  ]});
  assert.equal(seoProducts(db).length,1);
  assert.equal(seoProduct(db,new URL('https://site.example/product?source=retired-example&id=chatgpt-plus-recharge')),null);
  assert.equal(resolveOutboundOffer(db,{source:'retired-example',snapshot:'s1',product:'chatgpt-plus-recharge',offer:'one'}),null);
  assert.deepEqual(readRetentionMarket(db).groups.map(g=>g.price),[120]);
  assert.deepEqual(runWatch(db,{rules:[{id:'old',source:'retired-example',kind:'min_below',threshold:105}]}),[]);
  app=createApp({db});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.address().port;
  for(const path of ['/','/sources','/sitemap.xml','/?family=chatgpt&product=chatgpt-plus']){
   const response=await fetch(base+path);assert.equal(response.status,200,path);
   assert.doesNotMatch(await response.text(),/retired-example|Retired merchant/,path);
  }
  for(const path of ['/product?source=retired-example&id=chatgpt-plus-recharge','/go?source=retired-example&snapshot=s1&product=chatgpt-plus-recharge&offer=one']){
   assert.equal((await fetch(base+path,{redirect:'manual'})).status,404,path);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM offers WHERE source='retired-example'").get().n,1,'projection does not silently mutate history');
 }finally{if(app?.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}db.close();}
});
