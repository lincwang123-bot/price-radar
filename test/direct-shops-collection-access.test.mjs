import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDb,metaGet,metaSet} from '../lib/db.mjs';
import {merchantIdentityForUrl} from '../lib/merchant-identity.mjs';
import {importDirectTransfer} from '../lib/direct-transfer.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication,syncApprovedMerchantManifest} from '../lib/merchant-onboarding.mjs';
import {readApprovedManifest} from '../lib/merchant-collection.mjs';
import {pull} from '../sources/direct-shops.mjs';

const at=()=>new Date().toISOString();
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const kami=()=>({code:200,total:1,data:[{id:1,name:'ChatGPT Plus 月卡代充',price:50,stock:3,status:1}]});
function merchant(shopUrl='https://aisou.pro/',{restricted=true,platform='independent'}={}){
 const identity=merchantIdentityForUrl(shopUrl),origin=new URL(shopUrl).origin;
 return {id:'merchant-'+createHash('sha256').update(identity).digest('hex').slice(0,16),identity,shopName:'读取范围测试店',shopUrl,platform,status:'approved',version:1,approvedAt:at(),identityVerifiedAt:at(),
  ...(restricted?{collectionAccess:{mode:'public_pages_only',replyId:1,publicUrls:[origin+'/item/1'],minimumIntervalMs:1100,permissionScope:'ongoing'}}:{})};
}
function fixture(t){
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-10T00:00:00Z')});
 const dataDir=mkdtempSync(path.join(tmpdir(),'direct-access-')),merchantBridgeDir=path.join(dataDir,'bridge');mkdirSync(merchantBridgeDir);
 const db=openDb(':memory:');
 t.after(()=>{db.close();rmSync(dataDir,{recursive:true,force:true});t.mock.timers.reset();});
 const save=merchants=>writeFileSync(path.join(merchantBridgeDir,'approved.json'),JSON.stringify({schemaVersion:1,merchants}));
 return {dataDir,merchantBridgeDir,db,save,sleep:async ms=>t.mock.timers.tick(ms),config:{sources:{'direct-shops':{targets:['aisou']}}}};
}
function productPage(url){
 return new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'ChatGPT Plus 月卡代充',offers:{'@type':'Offer',price:'100.00',priceCurrency:'CNY',availability:'https://schema.org/InStock',url}})+'</script><h1>ChatGPT Plus 月卡代充</h1><div class="price">¥100.00</div>',{headers:{'content-type':'text/html'}});
}
const offers=result=>result.snapshot.products.flatMap(p=>p.offers);

test('restricted fixed targets cannot read their legacy API or reuse its cache',async t=>{
 const f=fixture(t);let legacyReads=0;
 // Establish a valid fixed-target cache before the restriction is approved.
 f.save([]);await pull({...f,fetchImpl:async()=>{legacyReads++;return json(kami());}});
 const cachePath=path.join(f.dataDir,'direct-shops-cache','aisou.json'),oldCache=readFileSync(cachePath,'utf8');
 const row=merchant();f.save([row]);const pageReads=[];
 const result=await pull({...f,fetchImpl:async()=>{legacyReads++;throw new Error('legacy API must not run');},merchantFetchFactory:()=>async url=>{
  pageReads.push(url);return url.endsWith('/robots.txt')?new Response('User-agent: *\nDisallow: /api/'):productPage(url);
 }});
 assert.equal(legacyReads,1);assert.deepEqual(pageReads,['https://aisou.pro/robots.txt','https://aisou.pro/item/1']);
 assert.equal(offers(result).length,1);assert.equal(offers(result)[0].price,100);
 assert.equal(offers(result)[0].extra.merchantCollectionId,row.id);
 assert.equal(readFileSync(cachePath,'utf8'),oldCache,'legacy cache remains preserved but unused');
});

test('restriction guards survive pause, missing approval and invalid manifest without restoring fixed traffic',async t=>{
 const f=fixture(t),row=merchant();f.save([row]);let reads=0;
 const ctx={...f,fetchImpl:async()=>{reads++;return json(kami());},merchantFetchFactory:()=>async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):productPage(url)};
 assert.equal(offers(await pull(ctx)).length,1);
 f.save([]);t.mock.timers.tick(31*60000);assert.equal(offers(await pull(ctx)).length,0);
 writeFileSync(path.join(f.merchantBridgeDir,'approved.json'),'{invalid');t.mock.timers.tick(31*60000);
 assert.equal(offers(await pull(ctx)).length,0);assert.equal(reads,0);
 assert.deepEqual(JSON.parse(metaGet(f.db,'merchant-onboarding:restricted-origins')),['https://aisou.pro']);
 metaSet(f.db,'merchant-onboarding:restricted-origins','null');
 await assert.rejects(()=>pull(ctx),/约束记录无效/);assert.equal(reads,0);
});

test('approval changing during a legacy read removes that older offer before publication',async t=>{
 const f=fixture(t),row=merchant();f.save([]);let reads=0;
 const result=await pull({...f,fetchImpl:async()=>{reads++;f.save([row]);return json(kami());}});
 assert.equal(reads,1);assert.equal(offers(result).length,0);
 assert.deepEqual(JSON.parse(metaGet(f.db,'merchant-onboarding:restricted-origins')),['https://aisou.pro']);
});

test('origin restriction blocks discovery and previously discovered 16688 target caches including host aliases',async t=>{
 const f=fixture(t),row=merchant('https://16688.com.cn/shop/S987654',{platform:'16688'});f.save([row]);
 const discovery=path.join(f.dataDir,'direct-discovery');mkdirSync(discovery);
 writeFileSync(path.join(discovery,'16688.json'),JSON.stringify({schemaVersion:1,checkedAt:at(),status:'ok',stores:[{shopNo:'S987654',seedGoodsNo:'G123',name:'旧发现店',verifiedAt:at()}]}));
 let legacyReads=0;
 const result=await pull({...f,config:{sources:{'direct-shops':{targets:['16688-s937885'],discovery:{platform16688:true}}}},
  fetchImpl:async()=>{legacyReads++;throw new Error('legacy platform reads forbidden');},merchantFetchFactory:()=>async()=>{throw new Error('fixture has no readable page');}});
 assert.equal(legacyReads,0);assert.equal(offers(result).length,0);
 assert.deepEqual(JSON.parse(metaGet(f.db,'merchant-onboarding:restricted-origins')),['https://www.16688.com.cn']);
});

test('shared-origin imports and unscoped dynamic merchants cannot bypass another merchant restriction',async t=>{
 const f=fixture(t),restricted=merchant('https://wzyp.cn/shop/harvey',{platform:'ldxp'}),other=merchant('https://wzyp.cn/shop/paimon',{restricted:false,platform:'ldxp'});f.save([restricted,other]);
 importDirectTransfer({version:1,checkedAt:at(),targets:[{targetId:'wzyp-harvey',status:'ok',checkedAt:at(),offers:[{
  offerId:'wzyp-harvey:1',sourceId:'wzyp-harvey',title:'ChatGPT Plus 月卡代充',price:80,currency:'CNY',status:'in_stock',stockCount:3,url:'https://wzyp.cn/item/1',capturedAt:at()
 }]}]},{dataDir:f.dataDir});
 const urls=[];
 const result=await pull({...f,fetchImpl:async()=>json(kami()),merchantFetchFactory:()=>async url=>{
  urls.push(url);if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /api/');
  throw new Error('no current readable fixture page');
 }});
 assert.deepEqual(urls,['https://wzyp.cn/robots.txt','https://wzyp.cn/item/1']);
 assert.equal(offers(result).length,1);assert.equal(offers(result)[0].sourceId,'aisou');
});

test('paused restrictions reach a collector that never observed the earlier approved state',async t=>{
 const f=fixture(t),privateDb=openSubmissionsDb(':memory:');t.after(()=>privateDb.close());
 const row=merchant(),application=createMerchantApplication(privateDb,{shopName:row.shopName,shopUrl:row.shopUrl,productAreas:['chatgpt'],email:'owner@example.org',contact:'owner',consent:true});
 privateDb.prepare("UPDATE merchant_applications SET status='paused',collection_access=? WHERE public_id=?").run(JSON.stringify(row.collectionAccess),application.id);
 const manifest=syncApprovedMerchantManifest(privateDb,f.merchantBridgeDir);
 assert.deepEqual(manifest.merchants,[]);assert.deepEqual(manifest.restrictedOrigins,['https://aisou.pro']);
 assert.deepEqual(readApprovedManifest(f.merchantBridgeDir).restrictedOrigins,['https://aisou.pro']);
 let reads=0;assert.equal(offers(await pull({...f,fetchImpl:async()=>{reads++;return json(kami());}})).length,0);assert.equal(reads,0);
 for(const restrictedOrigins of [null,['https://127.0.0.1'],['https://aisou.pro/item/1'],['https://aisou.pro','https://aisou.pro']]){
  writeFileSync(path.join(f.merchantBridgeDir,'approved.json'),JSON.stringify({...manifest,restrictedOrigins}));
  assert.equal(readApprovedManifest(f.merchantBridgeDir).valid,false);
 }
});
