import {verifyApplicationPhone} from './helpers/merchant-phone.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication,reviewMerchantApplication,approvedMerchantBadges} from '../lib/merchant-onboarding.mjs';
import {recordMerchantReply} from '../lib/merchant-replies.mjs';
import {queueAutomaticPreflight,queueMerchantPreflight,latestMerchantPreflight,syncPreflightManifest} from '../lib/merchant-preflight-store.mjs';
import {readPreflightRequests,processMerchantPreflights} from '../lib/merchant-preflight-worker.mjs';
import {normalizeCollectionAccess} from '../lib/merchant-collection-access.mjs';

const origin='https://restricted-shop.com';
function fixture(t,{urls=[origin+'/item/1'],scope='ongoing'}={}){
 const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'merchant-access-'));
 const bridgeDir=path.join(dir,'bridge'),resultsDir=path.join(dir,'data','merchant-preflights');
 mkdirSync(bridgeDir);mkdirSync(resultsDir,{recursive:true});
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const start=Date.now()-600000;
 const {id}=createMerchantApplication(db,{shopName:'受限页面店铺',shopUrl:origin+'/',productAreas:['chatgpt'],email:'owner@example.org',contact:'owner',consent:true},{now:new Date(start)});
 verifyApplicationPhone(db,id);
 const reply=recordMerchantReply(db,{applicationId:id,messageId:'verified123',threadId:'thread123',sender:'owner@example.org',authentication:'gmail-aligned',expectedVersion:1,receivedAt:new Date(start+1000).toISOString(),summary:'仅公开页面，持续读取，间隔三秒',publicUrls:urls},{now:new Date(start+2000)}).reply;
 const access={mode:'public_pages_only',replyId:reply.id,publicUrls:urls.length?urls:[origin+'/'],minimumIntervalMs:3000,permissionScope:scope};
 const options={bridgeDir,resultsDir,now:new Date(start+120000)};
 const review={action:'approve',expectedVersion:1,ownershipConfirmed:true,permissionConfirmed:true,sampleReviewed:true,note:'已人工核对'};
 const queue=(extra={})=>queueAutomaticPreflight(db,id,{...options,force:true,collectionAccess:access,...extra});
 const saveResult=(request,extra={})=>{
  const r={schemaVersion:1,id:request.id,applicationId:id,applicationVersion:1,identity:request.identity,startedAt:request.requestedAt,checkedAt:request.requestedAt,status:'ready',rawCount:1,validCount:1,message:'测试完成',samples:[{title:'ChatGPT Plus 月卡代充',price:100,currency:'CNY',url:access.publicUrls[0]}],...(request.collectionAccess?{collectionAccess:request.collectionAccess}:{}),...extra};
  writeFileSync(path.join(resultsDir,request.id+'.json'),JSON.stringify(r));return r;
 };
 return {db,dir,id,start,reply,access,options,review,queue,saveResult};
}

test('page-only contract rejects unsafe, unverified, ambiguous and expanded fields',()=>{
 const value={mode:'public_pages_only',replyId:4,publicUrls:[origin+'/item/1'],minimumIntervalMs:1100,permissionScope:'ongoing'};
 assert.deepEqual(normalizeCollectionAccess(value,{shopUrl:origin+'/',replyId:4,publicUrls:[origin+'/item/1']}),value);
 for(const change of [{mode:'all'}, {replyId:0},{replyId:'4'},{minimumIntervalMs:1000},{minimumIntervalMs:60001},{permissionScope:'forever'},
  {publicUrls:[]},{publicUrls:[origin+'/item/1',origin+'/item/1']},{publicUrls:Array.from({length:6},(_,i)=>origin+'/item/'+i)},
  {publicUrls:['https://other.com/item/1']},{publicUrls:[origin+'/api/products']},{publicUrls:[origin+'/item/1?token=x']},
  {publicUrls:[origin+'/assets/main.js']},{publicUrls:[origin+'/item/%2e%2e/admin']},{publicUrls:[origin+'/orders/1']},{allowApi:true}])
  assert.throws(()=>normalizeCollectionAccess({...value,...change},{shopUrl:origin+'/'}));
 assert.throws(()=>normalizeCollectionAccess(value,{shopUrl:origin+'/',replyId:5,publicUrls:value.publicUrls}));
 assert.throws(()=>normalizeCollectionAccess(value,{shopUrl:origin+'/',replyId:4,publicUrls:[origin+'/item/2']}));
});

test('trusted queue binds verified links and an empty-link reply may explicitly authorize the registered homepage',t=>{
 const f=fixture(t),r=f.queue();
 assert.deepEqual(r.collectionAccess,f.access);
 assert.deepEqual(JSON.parse(readFileSync(path.join(f.options.bridgeDir,'preflight-requests.json'))).requests[0].collectionAccess,f.access);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT collection_access FROM merchant_preflight_requests WHERE id=?').get(r.id).collection_access),f.access);
 for(const collectionAccess of [null,{...f.access,replyId:f.reply.id+1},{...f.access,publicUrls:[origin+'/item/not-supplied']}])
  assert.throws(()=>f.queue({collectionAccess}),{status:422});
 const g=fixture(t,{urls:[]});assert.equal(g.queue().collectionAccess.publicUrls[0],origin+'/');
});

test('ordinary retries inherit restrictions and never reuse a pending request with another context',t=>{
 const f=fixture(t),old=f.queue();
 const reused=queueAutomaticPreflight(f.db,f.id,{...f.options,force:true});
 assert.equal(reused.id,old.id);assert.deepEqual(reused.collectionAccess,f.access);
 assert.equal(f.queue({collectionAccess:{...f.access,minimumIntervalMs:4000}}),null);
 const newer=f.queue({now:new Date(+f.options.now+61000),collectionAccess:{...f.access,minimumIntervalMs:4000}});
 assert.notEqual(newer.id,old.id);assert.equal(newer.collectionAccess.minimumIntervalMs,4000);
 assert.deepEqual(readPreflightRequests(f.options.bridgeDir).requests.map(r=>r.id),[newer.id]);
 const manual=queueMerchantPreflight(f.db,f.id,f.review,{...f.options,now:new Date(+f.options.now+122000)});
 assert.equal(manual.collectionAccess.minimumIntervalMs,4000);
});

test('a new reply revokes the old restricted manifest and requires renewed explicit context',t=>{
 const f=fixture(t),old=f.queue();
 const later=new Date(+f.options.now+61000);
 const reply=recordMerchantReply(f.db,{applicationId:f.id,messageId:'newreply456',threadId:'thread123',sender:'owner@example.org',authentication:'gmail-aligned',expectedVersion:1,receivedAt:later.toISOString(),summary:'新增另一个商品页，仍待站方确认读取范围',publicUrls:[origin+'/item/2']},{now:later}).reply;
 assert.deepEqual(syncPreflightManifest(f.db,{...f.options,now:later}).requests,[]);
 assert.equal(queueAutomaticPreflight(f.db,f.id,{...f.options,now:later,force:true}),null);
 assert.throws(()=>queueMerchantPreflight(f.db,f.id,f.review,{...f.options,now:later}),{status:422});
 const next=f.queue({now:later,collectionAccess:{...f.access,replyId:reply.id,publicUrls:[origin+'/item/2']}});
 assert.notEqual(next.id,old.id);assert.equal(next.collectionAccess.replyId,reply.id);
});

test('results must match their exact access context; single-test permission cannot approve',t=>{
 const f=fixture(t),r=f.queue();
 f.saveResult(r,{collectionAccess:undefined});assert.equal(latestMerchantPreflight(f.db,f.id,f.options).status,'invalid');
 f.saveResult(r,{collectionAccess:{...f.access,minimumIntervalMs:1100}});assert.equal(latestMerchantPreflight(f.db,f.id,f.options).status,'invalid');
 f.saveResult(r,{samples:[{title:'商品',price:100,currency:'CNY',url:origin+'/item/not-authorized'}]});assert.equal(latestMerchantPreflight(f.db,f.id,f.options).status,'invalid');
 f.saveResult(r);assert.equal(latestMerchantPreflight(f.db,f.id,f.options).canApprove,true);
 const g=fixture(t,{scope:'test_only'}),one=g.queue();g.saveResult(one);
 assert.equal(latestMerchantPreflight(g.db,g.id,g.options).canApprove,false);
 assert.throws(()=>reviewMerchantApplication(g.db,g.id,g.review,{...g.options,notify:false}),{status:422});
});

test('ongoing constraints survive approval, manifest, and pause; no unconstrained fallback after restore',t=>{
 const f=fixture(t),r=f.queue();f.saveResult(r);
 reviewMerchantApplication(f.db,f.id,f.review,{...f.options,notify:false});
 assert.deepEqual(approvedMerchantBadges(f.db)[0].collectionAccess,f.access);
 assert.deepEqual(JSON.parse(readFileSync(path.join(f.options.bridgeDir,'approved.json'))).merchants[0].collectionAccess,f.access);
 reviewMerchantApplication(f.db,f.id,{...f.review,action:'pause',expectedVersion:2},{...f.options,notify:false});
 reviewMerchantApplication(f.db,f.id,{...f.review,action:'restore',expectedVersion:3},{...f.options,notify:false});
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT collection_access FROM merchant_applications WHERE public_id=?').get(f.id).collection_access),f.access);
 assert.equal(queueAutomaticPreflight(f.db,f.id,{...f.options,force:true,now:new Date(+f.options.now+120000)}),null);
});

test('worker rejects malformed access before any network work and does not accept script paths',async t=>{
 const f=fixture(t),r=f.queue();let calls=0;
 for(const access of [{...f.access,publicUrls:['https://other.com/item/1']},{...f.access,minimumIntervalMs:0},{...f.access,publicUrls:[origin+'/assets/app.js']},{...f.access,unknown:'ignored?'}]){
  writeFileSync(path.join(f.options.bridgeDir,'preflight-requests.json'),JSON.stringify({schemaVersion:1,requests:[{...r,collectionAccess:access}]}));
  assert.equal(readPreflightRequests(f.options.bridgeDir).valid,false);
  await processMerchantPreflights({dataDir:path.join(f.dir,'data'),merchantBridgeDir:f.options.bridgeDir,merchantFetchFactory:()=>async()=>{calls++;throw new Error('must not fetch');}});
 }
 assert.equal(calls,0);assert.equal(existsSync(path.join(f.options.resultsDir,r.id+'.json')),false);
});

test('bounded diagnostics survive result reading while mismatches fail closed and private extras stay out',t=>{
 const f=fixture(t),r=f.queue();
 const diagnostics={schemaVersion:1,rawCount:1,validCount:1,items:[{index:0,reasonCodes:[],privateText:'secret'}],truncated:false,privateText:'secret'};
 f.saveResult(r,{diagnostics});
 const result=latestMerchantPreflight(f.db,f.id,f.options).result;
 assert.equal(result.diagnostics.items.length,1);assert.doesNotMatch(JSON.stringify(result.diagnostics),/secret|privateText/);
 for(const bad of [{...diagnostics,rawCount:2},{...diagnostics,items:[{index:0,reasonCodes:['merchant_unverified_claim']}]},{...diagnostics,truncated:true}]){
  f.saveResult(r,{diagnostics:bad});assert.equal(latestMerchantPreflight(f.db,f.id,f.options).status,'invalid');
 }
});

test('worker binds actual reply-page results and discards results when access changes in flight',async t=>{
 for(const alter of [false,true]){
  const f=fixture(t),access={...f.access,minimumIntervalMs:1100},r=f.queue({collectionAccess:access}),calls=[];
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'ChatGPT Plus 月卡代充',offers:{'@type':'Offer',price:'100.00',priceCurrency:'CNY',availability:'https://schema.org/InStock',url:origin+'/item/1'}})+'</script><main><h1>ChatGPT Plus 月卡代充</h1><div class="price">¥100.00</div></main>';
  await processMerchantPreflights({dataDir:path.join(f.dir,'data'),merchantBridgeDir:f.options.bridgeDir,merchantFetchFactory:()=>async url=>{
   calls.push(url);
   if(url===origin+'/robots.txt'){
    if(alter)writeFileSync(path.join(f.options.bridgeDir,'preflight-requests.json'),JSON.stringify({schemaVersion:1,requests:[{...r,collectionAccess:{...access,minimumIntervalMs:2000}}]}));
    return new Response('User-agent: *\nAllow: /\nDisallow: /api/');
   }
   assert.equal(url,origin+'/item/1');return new Response(html,{headers:{'content-type':'text/html'}});
  }});
  assert.deepEqual(calls,[origin+'/robots.txt',origin+'/item/1']);
  const resultFile=path.join(f.options.resultsDir,r.id+'.json');
  assert.equal(existsSync(resultFile),!alter);
  if(!alter){
   const result=JSON.parse(readFileSync(resultFile));assert.equal(result.status,'ready');assert.deepEqual(result.collectionAccess,access);
   assert.equal(result.diagnostics.validCount,1);
   assert.equal(latestMerchantPreflight(f.db,f.id,{...f.options,now:new Date()}).canApprove,true);
  }
 }
});
