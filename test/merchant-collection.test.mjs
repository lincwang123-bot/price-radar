import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readApprovedManifest,collectApprovedMerchants} from '../lib/merchant-collection.mjs';
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
  f.save(Array.from({length:101},()=>row));assert.equal(readApprovedManifest(f.merchantBridgeDir).valid,false);
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
  assert.equal(merchantIdentityForOffer({...offer,source:'priceai'}),null);
  assert.equal(merchantIdentityForOffer({...offer,extra:{...offer.extra,shopNo:'S2'}}),null);
  assert.equal(merchantIdentityForOffer({...offer,url:'https://wzyp.cn/item/1'}),null);
});

test('自动识别新Dujiao/Kami；缓存按批准version隔离',async t=>{
  const f=fixture(t);let calls=0;
  const ctx={...f,merchantFetchFactory:()=>async url=>{calls++;return url.includes('/api/v1/')?json({},404):json(kami());}};
  const row=merchant();f.save([row]);
  let result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'active');assert.equal(result.offers.length,1);assert.equal(calls,2);
  assert.equal(result.offers[0].extra.merchantIdentity,row.identity);
  result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});assert.equal(calls,2);
  f.save([{...row,version:2}]);ctx.merchantFetchFactory=()=>async()=>{calls++;return json(dujiao());};
  result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.offers.length,1);assert.equal(calls,3);
});

test('未知系统仅探测两个公开API且WAF立即停止，无登录或挑战绕过',async t=>{
  const f=fixture(t);f.save([merchant()]);let calls=0;
  const ctx={...f,merchantFetchFactory:()=>async()=>{calls++;return json({data:[{id:1,email:'not-a-product'}]});}};
  let result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'waiting_adapter');assert.equal(calls,2);assert.equal(result.offers.length,0);
  f.save([merchant('https://blocked-shop.com/')]);calls=0;
  ctx.merchantFetchFactory=()=>async()=>{calls++;return json({message:'captcha required'},403);};
  result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.health[0].status,'unavailable');assert.equal(calls,1);
  assert.ok(!JSON.stringify(result.health).includes('captcha'));
});

test('新增16688与wzyp公开适配；不信任商品响应的跨源URL',async t=>{
  const f=fixture(t);f.save([merchant('https://16688.com.cn/shop/S987654','16688')]);
  let result=await collectApprovedMerchants({...f,merchantFetchFactory:()=>async()=>json({code:1,data:{list:[{goods_no:'G123',shop_no:'S987654',name:'ChatGPT Plus 月卡代充',price:100,stock_available_quantity:3}]}})}, {manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
  assert.equal(result.offers.length,1);assert.equal(result.offers[0].extra.shopNo,'S987654');
  f.save([merchant('https://wzyp.cn/shop/newtoken','ldxp')]);
  result=await collectApprovedMerchants({...f,merchantFetchFactory:()=>async url=>json(url.includes('categoryList')?{code:1,data:[{id:0,name:'全部'}]}:{code:1,data:{list:[{id:1,name:'ChatGPT Plus 月卡代充',price:100,stock:3,link:'https://evil.com/item/1'}],total:1}})}, {manifest:readApprovedManifest(f.merchantBridgeDir),capturedAt:at()});
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
  assert.equal(staticCalls,1);assert.equal(dynamicCalls,1);assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,2);
  assert.equal(JSON.parse(metaGet(db,'health:merchant-onboarding')).targets.length,2);
  f.save([]);result=await pull(ctx);
  assert.equal(result.snapshot.products.flatMap(p=>p.offers).length,1);assert.equal(staticCalls,1);assert.equal(dynamicCalls,1);
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

test('后续失败保留原核验时间并降级stale，过期报价不再发布',async t=>{
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
  assert.equal(result.offers.length,0);assert.equal(result.health[0].status,'unavailable');
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
