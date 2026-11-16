import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readApprovedManifest,collectApprovedMerchants,probeMerchantCatalog,SHOP_API_MAX_REQUESTS,SHOP_API_TOTAL_TIMEOUT_MS} from '../lib/merchant-collection.mjs';
import {PUBLIC_HTML_MAX_REQUESTS} from '../collectors/direct/public-html.mjs';
import {merchantIdentityForUrl,merchantIdentityForOffer} from '../lib/merchant-identity.mjs';
import {openDb,metaGet} from '../lib/db.mjs';
import {pull} from '../sources/direct-shops.mjs';
import {parseDujiaoProducts} from '../collectors/direct/dujiao.mjs';
import {parse16688Goods} from '../collectors/direct/platform16688.mjs';

const at = () => new Date().toISOString();
const merchant = (shopUrl='https://new-shop.com/',platform='independent') => {
  const identity=merchantIdentityForUrl(shopUrl);
  return {id:`merchant-${createHash('sha256').update(identity).digest('hex').slice(0,16)}`,identity,shopName:'新店铺',shopUrl,platform,status:'approved',version:1,approvedAt:at(),identityVerifiedAt:at()};
};
function fixture(t) {
  const dataDir=mkdtempSync(path.join(tmpdir(),'merchant-collection-'));
  const merchantBridgeDir=path.join(dataDir,'bridge');mkdirSync(merchantBridgeDir);
  t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
  return {dataDir,merchantBridgeDir,save:merchants=>writeFileSync(path.join(merchantBridgeDir,'approved.json'),JSON.stringify({schemaVersion:1,merchants}))};
}
const json = (payload,status=200) => new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
const kami = () => ({code:200,total:1,data:[{id:1,name:'ChatGPT Plus 月卡代充',price:100,stock:3,status:1}]});
const dujiao = () => ({status_code:200,data:[{id:1,title:'ChatGPT Plus 月卡代充',skus:[{id:1,price_amount:100,auto_stock_available:3}]}],pagination:{total:1,total_page:1,page:1}});

test('只接受经过审核且身份一致的有界manifest；无效文件整体fail closed',t=>{
  const f=fixture(t),row=merchant();f.save([row]);assert.equal(readApprovedManifest(f.merchantBridgeDir).merchants.length,1);
  for(const change of [{status:'pending'},{status:'paused'},{identity:'domain:other.com'},{id:'../../evil'},{shopUrl:'https://127.0.0.1/'},{shopUrl:'https://new-shop.com/?secret=1'},{approvedAt:null}]) {
    f.save([{...row,...change}]);assert.equal(readApprovedManifest(f.merchantBridgeDir).valid,false);assert.equal(readApprovedManifest(f.merchantBridgeDir).merchants.length,0);
  }
  f.save([row,row]);assert.equal(readApprovedManifest(f.merchantBridgeDir).valid,false);
});

test('批准清单允许超过100家店铺，仍拒绝超过256 KiB的文件',t=>{
  const f=fixture(t);
  const rows=Array.from({length:101},(_,i)=>merchant(`https://merchant-${i}.com/`));
  f.save(rows);
  const manifest=readApprovedManifest(f.merchantBridgeDir);
  assert.equal(manifest.valid,true);
  assert.equal(manifest.merchants.length,101);
  const content=JSON.stringify({schemaVersion:1,merchants:rows});
  assert.ok(Buffer.byteLength(content)<256*1024);
  writeFileSync(path.join(f.merchantBridgeDir,'approved.json'),content+' '.repeat(256*1024-Buffer.byteLength(content)));
  assert.equal(readApprovedManifest(f.merchantBridgeDir).valid,true);
  writeFileSync(path.join(f.merchantBridgeDir,'approved.json'),content+' '.repeat(256*1024-Buffer.byteLength(content)+1));
  assert.equal(readApprovedManifest(f.merchantBridgeDir).valid,false);
  assert.equal(readApprovedManifest(f.merchantBridgeDir).merchants.length,0);
});

test('动态目标不能通过JSON批准标志绕过固定适配器授权',()=>{
  assert.throws(()=>parseDujiaoProducts(dujiao(),{id:'evil',origin:'https://new-shop.com',approved:true}),/未登记/);
  assert.throws(()=>parse16688Goods({code:1,data:{list:[]}},{id:'evil',origin:'https://www.16688.com.cn',shopNo:'S999999',approved:true}),/未登记/);
});

test('精确商家身份匹配防止共享域名与第三方extra串标',()=>{
  assert.equal(merchantIdentityForUrl('https://www.mystore.com/'),'domain:www.mystore.com');
  assert.equal(merchantIdentityForUrl('https://wzyp.cn/SHOP'),null);
  const offer={source:'direct-shops',url:'https://www.16688.com.cn/goods/G1',extra:{shopNo:'S1',shopUrl:'https://16688.com.cn/shop/S1'}};
  assert.equal(merchantIdentityForOffer(offer),'shop:16688:S1');
  assert.equal(merchantIdentityForOffer({...offer,source:'ldxp-goods'}),null);
  assert.equal(merchantIdentityForOffer({...offer,extra:{...offer.extra,shopNo:'S2'}}),null);
  assert.equal(merchantIdentityForOffer({...offer,url:'https://wzyp.cn/item/1'}),null);
});

test('自动识别新Dujiao/Kami；缓存按批准version隔离',async t=>{
  const f=fixture(t);let calls=0;
  const ctx={...f,merchantFetchFactory:()=>async url=>{calls++;return url.includes('/api/v1/')?json({},404):json(kami());}};
  const row=merchant();f.save([row]);
  let result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'active');assert.equal(result.offers.length,1);assert.equal(calls,4);
  assert.equal(result.offers[0].extra.merchantIdentity,row.identity);
  result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});assert.equal(calls,4);
  f.save([{...row,version:2}]);ctx.merchantFetchFactory=()=>async()=>{calls++;return json(dujiao());};
  result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.offers.length,1);assert.equal(calls,7);
});

test('未知系统补查公开页面，WAF立即停止，无登录或挑战绕过',async t=>{
  const f=fixture(t);f.save([merchant()]);let calls=0;
  const ctx={...f,sleep:async()=>{},merchantFetchFactory:()=>async url=>{calls++;return url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):json({data:[{id:1,email:'not-a-product'}]});}};
  let result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'waiting_adapter');assert.equal(calls,4);assert.equal(result.offers.length,0);
  f.save([merchant('https://blocked-shop.com/')]);calls=0;
  ctx.merchantFetchFactory=()=>async()=>{calls++;return json({message:'captcha required'},403);};
  result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'unavailable');assert.equal(calls,1);
  assert.ok(!JSON.stringify(result.health).includes('captcha'));
});

test('可读取空目录不代表有报价接入；审核健康展示有效条数', async t => {
  const f=fixture(t); f.save([merchant()]);
  const result=await collectApprovedMerchants({...f,merchantFetchFactory:()=>async()=>json({status_code:200,data:[],pagination:{total:0,total_page:1,page:1}})},
    {manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'no_valid_offers');
  assert.equal(result.health[0].validCount,0);
  assert.equal(result.offers.length,0);
});

test('新增16688与wzyp公开适配；不信任商品响应的跨源URL',async t=>{
  const f=fixture(t);f.save([merchant('https://16688.com.cn/shop/S987654','16688')]);
  let result=await collectApprovedMerchants({...f,sleep:async()=>{},merchantFetchFactory:()=>async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):url.endsWith('/shop/detail')?json({code:1,data:{shop_no:'S987654'}}):json({code:1,data:{list:[{goods_no:'G123',shop_no:'S987654',name:'ChatGPT Plus 月卡代充',price:100,stock_available_quantity:3}]}})}, {manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.offers.length,1);assert.equal(result.offers[0].extra.shopNo,'S987654');
  f.save([merchant('https://wzyp.cn/shop/newtoken','ldxp')]);
  result=await collectApprovedMerchants({...f,merchantFetchFactory:()=>async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):json(url.includes('categoryList')?{code:1,data:[{id:0,name:'全部'}]}:{code:1,data:{list:[{id:1,name:'ChatGPT Plus 月卡代充',price:100,stock:3,link:'https://evil.com/item/1'}],total:1}})}, {manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.offers.length,0);assert.equal(result.health[0].status,'unavailable');
});

test('加入不受静态源30min节流；复用固定报价不重复，暂停下轮移除动态报价',async t=>{
  const f=fixture(t),db=openDb(':memory:');t.after(()=>db.close());
  const ctx={...f,db,config:{sources:{'direct-shops':{targets:['aisou']}}},fetchImpl:async()=>json(kami())};
  let staticCalls=0,dynamicCalls=0;ctx.fetchImpl=async()=>{staticCalls++;return json(kami());};
  await pull(ctx);assert.equal((await pull(ctx)).skipped,true);
  const row=merchant();f.save([row,merchant('https://aisou.pro/')]);
  ctx.merchantFetchFactory=()=>async()=>{dynamicCalls++;return json(dujiao());};
  let result=await pull(ctx);
  assert.equal(staticCalls,1);assert.equal(dynamicCalls,3);assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,2);
  assert.equal(JSON.parse(metaGet(db,'health:merchant-onboarding')).targets.length,2);
  f.save([]);result=await pull(ctx);
  assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,1);assert.equal(staticCalls,1);assert.equal(dynamicCalls,3);
  assert.deepEqual(JSON.parse(metaGet(db,'health:merchant-onboarding')).targets,[]);
  assert.equal((await pull(ctx)).skipped,true);
});

test('manifest损坏下轮撤下动态报价，保留有效固定源缓存',async t=>{
  const f=fixture(t),db=openDb(':memory:');t.after(()=>db.close());f.save([merchant()]);
  const ctx={...f,db,config:{sources:{'direct-shops':{targets:['aisou']}}},fetchImpl:async()=>json(kami()),merchantFetchFactory:()=>async()=>json(dujiao())};
  assert.equal((await pull(ctx)).snapshot.products.flatMap(p=>p.offers).length,2);
  writeFileSync(path.join(f.merchantBridgeDir,'approved.json'),'{broken');
  assert.equal((await pull(ctx)).snapshot.products.flatMap(p=>p.offers).length,1);
  assert.equal(JSON.parse(metaGet(db,'health:merchant-onboarding')).manifestValid,false);
  assert.equal(JSON.parse(metaGet(db,'health:merchant-onboarding')).source,'merchant-onboarding');
  assert.equal(JSON.parse(metaGet(db,'health:merchant-onboarding')).status,'unavailable');
});

test('后续失败保留上次价格与真实采集时间，超过新鲜期也只作为stale记录',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-07T00:00:00Z')});
  t.after(()=>t.mock.timers.reset());
  const f=fixture(t);f.save([merchant()]);
  const ctx={...f,merchantFetchFactory:()=>async()=>json(dujiao())};
  const options=()=>({manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at(),maxCacheAgeMinutes:60});
  const first=await collectApprovedMerchants(ctx,options());
  const original=first.offers[0].capturedAt;
  t.mock.timers.tick(31*60000);ctx.merchantFetchFactory=()=>async()=>{throw new Error('private credential diagnostics must not leak');};
  let result=await collectApprovedMerchants(ctx,options());
  assert.equal(result.health[0].status,'unavailable');assert.equal(result.offers[0].extra.quoteHealth.status,'stale');assert.equal(result.offers[0].capturedAt,original);
  assert.ok(!JSON.stringify(result.health).includes('credential'));
  t.mock.timers.tick(31*60000);result=await collectApprovedMerchants(ctx,options());
  assert.equal(result.offers.length,first.offers.length);assert.equal(result.health[0].status,'unavailable');
  assert.equal(result.offers[0].capturedAt,original);assert.equal(result.offers[0].extra.quoteHealth.status,'stale');
  ctx.merchantFetchFactory=()=>async()=>json(dujiao());t.mock.timers.tick(31*60000);
  const recovered=await collectApprovedMerchants(ctx,options());assert.equal(recovered.health[0].status,'active');assert.notEqual(recovered.offers[0].capturedAt,original);assert.equal(recovered.offers[0].extra.quoteHealth.status,'cached');
  t.mock.timers.tick(31*60000);ctx.merchantFetchFactory=()=>async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):json({data:[{id:1,email:'not-a-product'}]});
  const changed=await collectApprovedMerchants(ctx,options());assert.equal(changed.health[0].status,'waiting_adapter');assert.equal(changed.offers[0].price,recovered.offers[0].price);assert.equal(changed.offers[0].capturedAt,recovered.offers[0].capturedAt);assert.equal(changed.offers[0].extra.quoteHealth.status,'stale');
  t.mock.timers.tick(31*60000);ctx.merchantFetchFactory=()=>async()=>json({...dujiao(),data:[],pagination:{total:0,total_page:1,page:1}});
  const empty=await collectApprovedMerchants(ctx,options());assert.equal(empty.offers.length,0);assert.equal(empty.health[0].status,'no_valid_offers');
  t.mock.timers.tick(31*60000);ctx.merchantFetchFactory=()=>async()=>{throw new Error('fixture failure');};
  assert.equal((await collectApprovedMerchants(ctx,options())).offers.length,0,'do not resurrect prices deleted by a successful catalog read');
});

test('采集中暂停也在本次发布前撤下报价',async t=>{
  const f=fixture(t),db=openDb(':memory:');t.after(()=>db.close());f.save([merchant()]);
  const result=await pull({...f,db,config:{sources:{'direct-shops':{targets:['aisou']}}},fetchImpl:async()=>json(kami()),merchantFetchFactory:()=>async()=>{f.save([]);return json(dujiao());}});
  assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,1);
  assert.deepEqual(JSON.parse(metaGet(db,'health:merchant-onboarding')).targets,[]);
});

test('采集中审核version变化不能发布旧批准版本的结果',async t=>{
  const f=fixture(t),db=openDb(':memory:');t.after(()=>db.close());const row=merchant();f.save([row]);
  const result=await pull({...f,db,config:{sources:{'direct-shops':{targets:['aisou']}}},fetchImpl:async()=>json(kami()),merchantFetchFactory:()=>async()=>{f.save([{...row,version:2}]);return json(dujiao());}});
  assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,1);
});

test('temporary transport failures retry after five minutes; permission failures retain thirty-minute cadence',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-19T00:00:00Z')});
 for(const [code,fast] of [['ETIMEDOUT',true],['ECONNRESET',true],['EAI_AGAIN',true],['HTTP500',true],['ROBOTS_DISALLOWED',false],['HTTP403',false],['HTTP429',false]]){
  const f=fixture(t),row=merchant();f.save([row]);let attempts=0,failed=false,networkOptions;
  const ctx={...f,sleep:async()=>{},merchantFetchFactory:(_origin,options)=>{networkOptions=options;attempts++;return async()=>{if(failed)throw Object.assign(new Error('fixture'),code.startsWith('HTTP')?{status:Number(code.slice(4))}:{code});return json(dujiao());};}};
  const options=()=>({manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  const first=await collectApprovedMerchants(ctx,options());const original=first.offers[0].capturedAt;
  assert.equal(networkOptions.timeoutMs,15000);assert.ok(networkOptions.totalTimeoutMs<=30000);
  t.mock.timers.tick(4*60000);await collectApprovedMerchants(ctx,options());assert.equal(attempts,1,'healthy catalogs stay cached before five minutes');
  t.mock.timers.tick(60000);failed=true;
  const failure=await collectApprovedMerchants(ctx,options());assert.equal(attempts,2);assert.equal(failure.offers[0].capturedAt,original);assert.equal(failure.offers[0].extra.quoteHealth.status,'stale');
  t.mock.timers.tick(4*60000);await collectApprovedMerchants(ctx,options());assert.equal(attempts,2);
  t.mock.timers.tick(60000);failed=false;let result=await collectApprovedMerchants(ctx,options());assert.equal(attempts,fast?3:2,code);
  if(fast){assert.equal(result.health[0].status,'active');assert.notEqual(result.offers[0].capturedAt,original);}
  else {assert.equal(result.offers[0].capturedAt,original);t.mock.timers.tick(25*60000);result=await collectApprovedMerchants(ctx,options());assert.equal(attempts,3);assert.equal(result.health[0].status,'active');}
 }
});

test('approved fixed targets also retry transient failure in five minutes without repeated early reads',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-19T00:00:00Z')});
 const f=fixture(t),db=openDb(':memory:');t.after(()=>db.close());f.save([merchant('https://aisou.pro/')]);let calls=0,fail=false;
 const ctx={...f,db,config:{sources:{'direct-shops':{targets:['aisou']}}},sleep:async()=>{},fetchImpl:async()=>{calls++;if(fail)throw Object.assign(new Error('fixture timeout'),{code:'ETIMEDOUT'});return json(kami());}};
 await pull(ctx);t.mock.timers.tick(30*60000);fail=true;await pull(ctx);const failedCalls=calls;
 t.mock.timers.tick(4*60000);await pull(ctx);assert.equal(calls,failedCalls);
 t.mock.timers.tick(60000);fail=false;await pull(ctx);assert.equal(calls,failedCalls+1);assert.equal(JSON.parse(metaGet(db,'health:direct-targets')).targets[0].status,'ok');
});

 test('new products in approved fixed and dynamic shops appear after five minutes without reapproval',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-21T00:00:00Z')});
 const f=fixture(t),db=openDb(':memory:');t.after(()=>db.close());f.save([merchant(),merchant('https://aisou.pro/')]);
 let expanded=false,staticReads=0,dynamicReads=0;
 const catalog=()=>{const p=dujiao();if(expanded){p.data.push({...p.data[0],id:2,title:'ChatGPT Pro 20X 月卡代充',skus:[{id:2,price_amount:1300,auto_stock_available:4}]});p.pagination.total=2;}return p;};
 const ctx={...f,db,sleep:async()=>{},config:{sources:{'direct-shops':{targets:['aisou']}}},fetchImpl:async()=>{staticReads++;const p=kami();if(expanded){p.data.push({...p.data[0],id:2,name:'ChatGPT Pro 20X 月卡代充',price:1300});p.total=2;}return json(p);},merchantFetchFactory:()=>async url=>{if(url.endsWith('/robots.txt')||url.endsWith('/'))return new Response('User-agent: *\nAllow: /');dynamicReads++;return json(catalog());}};
 let result=await pull(ctx);assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,2);
 expanded=true;t.mock.timers.tick(4*60000);result=await pull(ctx);assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,2);assert.equal(staticReads,1);assert.equal(dynamicReads,1);
 t.mock.timers.tick(60000);result=await pull(ctx);assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,4);assert.equal(staticReads,2);assert.equal(dynamicReads,2);
 assert.equal(readApprovedManifest(f.merchantBridgeDir).merchants[0].version,1);
});
test('existing numeric 16688 alias resolves for collection without changing its persisted identity',async t=>{
 const f=fixture(t),row=merchant('https://16688.com.cn/shop/S19988','16688');f.save([row]);const bodies=[];
 const ctx={...f,sleep:async()=>{},merchantFetchFactory:()=>async(url,init)=>{
 if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
 const body=JSON.parse(init.body);bodies.push(body.shop_no);
 return url.endsWith('/shop/detail')?json({code:1,data:{shop_no:'S454911',shop_alias:'S19988'}}):json({code:1,data:{list:[{goods_no:'G123',shop_no:'S454911',name:'ChatGPT Plus 月卡代充',price:100,stock_available_quantity:3}]}});
 }};
 const result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});assert.deepEqual(bodies,['S19988','S454911','S454911']);assert.equal(result.offers.length,1);
 assert.equal(result.offers[0].extra.resolvedShopNo,'S454911');assert.equal(merchantIdentityForOffer({...result.offers[0],source:'direct-shops'}),'shop:16688:S19988');assert.equal(readApprovedManifest(f.merchantBridgeDir).merchants[0].identity,row.identity);
});

test('round budget queues refreshes without dropping valid cached shops or renewing their timestamps',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-21T00:00:00Z')});
 const f=fixture(t),rows=['first','second','third'].map(s=>merchant(`https://${s}-shop.com/`));f.save(rows);
 let slow=false;const reads=[];
 const ctx={...f,sleep:async()=>{},merchantFetchFactory:origin=>async url=>{
  if(url.endsWith('/robots.txt')||url.endsWith('/'))return new Response('User-agent: *\nAllow: /');
  reads.push(origin);if(slow&&origin==='https://first-shop.com')t.mock.timers.tick(180000);
  return json(dujiao());
 }};
 const options=()=>({manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at(),maxCacheAgeMinutes:60});
 const initial=await collectApprovedMerchants(ctx,options()),original=initial.offers.find(o=>o.extra.merchantIdentity===rows[1].identity).capturedAt;
 t.mock.timers.tick(5*60000);slow=true;reads.length=0;
 let result=await collectApprovedMerchants(ctx,options());
 assert.equal(reads.length,1);assert.equal(result.offers.length,3,'queued stores retain usable quotes');
 const queued=result.health.find(h=>h.identity===rows[1].identity);
 assert.equal(queued.refreshQueued,true);assert.equal(queued.checkedAt,original);assert.equal(queued.lastSuccess,original);
 const cached=result.offers.find(o=>o.extra.merchantIdentity===rows[1].identity);
 assert.equal(cached.capturedAt,original);assert.equal(cached.extra.quoteHealth.status,'cached');
 slow=false;reads.length=0;result=await collectApprovedMerchants(ctx,options());
 assert.equal(reads[0],'https://second-shop.com','oldest unrefreshed shop gets the next turn');
 assert.equal(result.health.find(h=>h.identity===rows[1].identity).refreshQueued,undefined);
 t.mock.timers.tick(61*60000);slow=true;reads.length=0;
 result=await collectApprovedMerchants(ctx,options());
 assert.equal(result.offers.length,1,'expired queued quotes are not restored');
});

test('approved catalog work can continue beyond one minute while each shop stays bounded',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-21T00:00:00Z')});
 const f=fixture(t);f.save(['first','second','third','fourth','fifth'].map(s=>merchant(`https://${s}-shop.com/`)));
 let reads=0;
 const result=await collectApprovedMerchants({...f,sleep:async()=>{},merchantFetchFactory:(_origin,limits)=>{
  assert.ok(limits.totalTimeoutMs<=30000);
  return async url=>{if(url.endsWith('/robots.txt')||url.endsWith('/'))return new Response('User-agent: *\nAllow: /');reads++;t.mock.timers.tick(20000);return json(dujiao());};
 }},{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
 assert.equal(reads,5);assert.equal(result.offers.length,5);
});

test('a shop at the end of a nearly exhausted round waits with its original good quotes and leads the next round',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-28T00:00:00Z')});
 const f=fixture(t),rows=Array.from({length:7},(_,i)=>merchant(`https://budget-${i}.com/`));f.save(rows);
 let slow=false;const reads=[];
 const ctx={...f,sleep:async()=>{},merchantFetchFactory:(origin,limits)=>async url=>{
  if(limits.totalTimeoutMs<30000)throw Object.assign(new Error('fixture: truncated shop budget'),{code:'ETIMEDOUT'});
  if(url.endsWith('/robots.txt')||url.endsWith('/'))return new Response('User-agent: *\nAllow: /');
  reads.push(origin);if(slow)t.mock.timers.tick(29990);return json(dujiao());
 }};
 const options=()=>({manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
 const initial=await collectApprovedMerchants(ctx,options());
 const original=initial.offers.find(o=>o.extra.merchantIdentity===rows[6].identity).capturedAt;
 t.mock.timers.tick(5*60000);slow=true;reads.length=0;
 const result=await collectApprovedMerchants(ctx,options()),deferred=result.health.find(h=>h.identity===rows[6].identity);
 assert.equal(reads.length,6);
 assert.equal(deferred.status,'active');assert.equal(deferred.refreshQueued,true);
 assert.equal(deferred.checkedAt,original);assert.equal(deferred.lastSuccess,original);
 const offer=result.offers.find(o=>o.extra.merchantIdentity===rows[6].identity);
 assert.equal(offer.capturedAt,original);assert.equal(offer.extra.quoteHealth.status,'cached');
 slow=false;reads.length=0;await collectApprovedMerchants(ctx,options());
 assert.equal(reads[0],'https://budget-6.com','deferred shop keeps its priority instead of receiving a false failure timestamp');
});

test('new shops wait without failed cache when less than a complete request window remains',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-28T00:00:00Z')});
 const f=fixture(t),rows=Array.from({length:8},(_,i)=>merchant(`https://new-budget-${i}.com/`));f.save(rows);
 const attempted=[];
 const result=await collectApprovedMerchants({...f,sleep:async()=>{},merchantFetchFactory:(origin,limits)=>{
  attempted.push(origin);
  return async url=>{
   if(limits.totalTimeoutMs<30000)throw Object.assign(new Error('fixture: truncated shop budget'),{code:'ETIMEDOUT'});
   if(url.endsWith('/robots.txt')||url.endsWith('/'))return new Response('User-agent: *\nAllow: /');
   t.mock.timers.tick(29990);return json(dujiao());
  };
 }},{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
 assert.equal(attempted.length,6);
 for(const row of rows.slice(6)){
  const health=result.health.find(h=>h.identity===row.identity);
  assert.equal(health.status,'queued');assert.equal(health.lastSuccess,null);
  assert.equal(health.offerCount,0);assert.equal(health.reasonCode,undefined);
 }
});

// Ported from GitHub PR #5 (budget part only; live keeps catfk as its own shop:catfk identity).
test('ShopApi 预检使用独立预算，高于公开 HTML 上限',async()=>{
  const budgets=[];
  const factory=(origin,options)=>{budgets.push({origin,maxRequests:options.maxRequests,totalTimeoutMs:options.totalTimeoutMs});return async()=>new Response('missing',{status:404});};
  const probe=(m)=>probeMerchantCatalog(m,{merchantFetchFactory:factory},at(),Date.now()+60000).catch(error=>{if(!budgets.length)throw error;});
  await probe({id:'merchant-wzyp',identity:'shop:wzyp:Token_1',shopName:'链动店',shopUrl:'https://wzyp.cn/shop/Token_1'});
  assert.equal(budgets[0].origin,'https://wzyp.cn');
  assert.equal(budgets[0].maxRequests,SHOP_API_MAX_REQUESTS);
  assert.ok(budgets[0].totalTimeoutMs>30000&&budgets[0].totalTimeoutMs<=SHOP_API_TOTAL_TIMEOUT_MS);
  assert.ok(SHOP_API_MAX_REQUESTS>PUBLIC_HTML_MAX_REQUESTS);
  budgets.length=0;
  await probe({id:'merchant-html',identity:'domain:budget-shop.com',shopName:'独立店',shopUrl:'https://budget-shop.com/'});
  assert.equal(budgets[0].origin,'https://budget-shop.com');
  assert.equal(budgets[0].maxRequests,PUBLIC_HTML_MAX_REQUESTS);
  assert.ok(budgets[0].totalTimeoutMs<=30000);
});
