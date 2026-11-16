import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAizcProducts,collectAizcPublic,AIZC_ORIGIN as origin} from '../collectors/direct/aizc-public.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
const at='2026-11-16T00:00:00Z';
const target=()=>authorizeMerchantTarget({id:'aizc',name:'财宝ai资讯',origin});
const samples=[
 [7,'chatgpt-go-monthly-cdk','ChatGPT Go 月订阅 · 自助卡密',38,'auto','out_of_stock','16688-G37711667'],
 [6,'chatgpt-pro-100-ios-monthly','ChatGPT Pro 月订阅 · 美区 iOS 100 美元档',650,'manual','unlimited','16688-G22414932'],
 [5,'chatgpt-plus-official-monthly','ChatGPT Plus 正价月订阅 · VISA 直充',125,'manual','unlimited','16688-G23376773'],
 [1,'chatgpt-plus-visa直冲','ChatGPT Plus CDK（优惠档）',120,'auto','low_stock','DEFAULT'],
 [10,'claude-max-20x-monthly','Claude Max 20x 月订阅 · VISA 直充',1500,'manual','unlimited','16688-G31640183'],
 [9,'claude-max-5x-monthly','Claude Max 5x 月订阅 · VISA 直充',750,'manual','unlimited','16688-G45672813'],
 [8,'claude-pro-monthly','Claude Pro 月订阅 · VISA 直充',165,'manual','unlimited','16688-G11923014'],
 [11,'grok-premium-us-cdk','Grok Premium 美区订阅 · 自助卡密',212,'auto','out_of_stock','16688-G56407359'],
 [12,'residential-isp-g31841275','家宽｜美国·新上架IP｜独享住宅ISP｜10天/1IP',28,'manual','unlimited','16688-G31841275'],
];
const payload=()=>({status_code:0,data:samples.map(([id,slug,title,price,fulfillment_type,stock_status,sku_code])=>({id,slug,title:{'en-US':'English','zh-CN':title,'zh-TW':'繁體'},description:{'zh-CN':'公开商品说明'},price_amount:price.toFixed(2),fulfillment_type,stock_status,is_sold_out:stock_status==='out_of_stock',skus:[{id:id+100,sku_code,spec_values:{},price_amount:price.toFixed(2),is_active:true,stock_status,manual_stock_available:-1}]})),pagination:{page:1,page_size:100,total:9,total_page:1}});
const invalid=e=>e.code==='INVALID_CATALOG'&&e.message.startsWith('AIZC 公开目录：');
test('AIZC keeps localized public product titles, prices, inventory, delivery and ISP items',()=>{
 const rows=parseAizcProducts(payload(),target(),at);
 assert.deepEqual(rows.map(r=>r.title),samples.map(s=>s[2]));assert.deepEqual(rows.map(r=>r.price),samples.map(s=>s[3]));
 assert.deepEqual(rows.map(r=>r.deliveryMode),samples.map(s=>s[4]));
 assert.deepEqual(rows.map(r=>r.status),['out_of_stock','in_stock','in_stock','low_stock','in_stock','in_stock','in_stock','out_of_stock','in_stock']);
 assert.equal(new Set(rows.map(r=>r.offerId)).size,9);assert.equal(rows[0].offerId,'aizc:7:107');
 assert.equal(rows[3].url,origin+'/products/'+encodeURIComponent(samples[3][1]));
 assert.ok(rows.every(r=>r.currency==='CNY'&&r.stockCount===null&&!r.title.includes('16688-G')));
 assert.equal(rows[0].extra.deliveryEvidence.description,'公开商品说明');
});
test('AIZC rejects invalid prices, links, duplicate products and malformed envelopes',()=>{
 const mutations=[p=>{p.status_code=1;},p=>{delete p.status_code;},p=>{p.data={};},p=>{p.pagination.page=2;},p=>{p.pagination.page_size=10;},p=>{p.pagination.total=501;},p=>{p.pagination.total_page=11;},p=>{p.pagination.total=10;},p=>{p.data[1].slug=p.data[0].slug;},p=>{p.data[0].slug='../cart';},p=>{p.data[0].slug='https://evil.test';},p=>{p.data[0].slug='%2e%2e';},p=>{p.data[0].price_amount='39.00';}];
 for(const price of [undefined,null,0,-1,'1.001','bad',true])mutations.push(p=>{p.data[0].skus[0].price_amount=price;});
 for(const mutate of mutations){const p=payload();mutate(p);assert.throws(()=>parseAizcProducts(p,target(),at),invalid);}
 assert.throws(()=>parseAizcProducts(payload(),{...target()},at),invalid);
 assert.throws(()=>parseAizcProducts(payload(),authorizeMerchantTarget({origin:'https://aizc.club'}),at),invalid);
});
test('AIZC never uses inventory codes and requires explicit names for multiple variants',()=>{
 const p=payload();p.data[0].skus.push({...p.data[0].skus[0],id:999});assert.throws(()=>parseAizcProducts(p,target(),at),invalid);
 p.data[0].skus[0].title='16688-G123';assert.throws(()=>parseAizcProducts(p,target(),at),invalid);
 p.data[0].skus[0].title={'zh-CN':'ChatGPT Go 月卡'};p.data[0].skus[1].label='ChatGPT Go 年卡';
 assert.equal(parseAizcProducts(p,target(),at)[0].title,'ChatGPT Go 月卡');
});
const robots='User-agent: *\nAllow: /api/v1/public/\nDisallow: /api/\nDisallow: /admin/\nDisallow: /cart\nSitemap: https://www.aizc.club/sitemap.xml';
function fixture(t,rules=robots){
 t.mock.timers.enable({apis:['Date'],now:Date.parse(at)});const calls=[];
 const ctx={sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:()=>async(url,init)=>{
  const u=new URL(url);calls.push({url:u,method:init.method||'GET',agent:new Headers(init.headers).get('user-agent')});
  return u.pathname==='/robots.txt'?new Response(rules):Response.json(payload());
 }};
 return {calls,run:()=>probeMerchantCatalog({id:'aizc',shopName:'财宝ai资讯',shopUrl:origin+'/',identity:'domain:www.aizc.club',platform:'independent'},ctx,at,Date.now()+30000)};
}
test('probe reads robots and only the public list, with AiradarBot',async t=>{
 const f=fixture(t),result=await f.run();assert.equal(result.offers.length,9);assert.equal(result.offers[2].title,samples[2][2]);
 assert.deepEqual(f.calls.map(c=>c.url.pathname),['/robots.txt','/api/v1/public/products']);
 assert.equal(f.calls[1].url.search,'?page=1&page_size=100');assert.ok(f.calls.every(c=>c.method==='GET'&&c.agent.startsWith('AiradarBot/1.0')));
});
for(const rules of ['User-agent: *\nDisallow: /','User-agent: *\nDisallow: /api/v1/public/products'])test('robots denies API: '+rules,async t=>{
 const f=fixture(t,rules);await assert.rejects(f.run(),e=>e.code==='ROBOTS_DISALLOWED');assert.deepEqual(f.calls.map(c=>c.url.pathname),['/robots.txt']);
});
function pagePayload(page,total=101){
 const p=payload();p.pagination={page,page_size:100,total,total_page:Math.ceil(total/100)};
 p.data=Array.from({length:Math.min(100,total-(page-1)*100)},(_,i)=>({...payload().data[0],id:(page-1)*100+i,slug:`item-${(page-1)*100+i}`}));return p;
}
test('collector follows bounded pagination and rejects changing totals and cross-page duplicates',async()=>{
 for(const mode of ['ok','total','duplicate','page']){
  const calls=[];const rows=collectAizcPublic(target(),{capturedAt:at,fetchImpl:async url=>{
   const page=Number(new URL(url).searchParams.get('page'));calls.push(page);const p=pagePayload(page,mode==='total'&&page===2?102:101);
   if(page===2&&mode==='duplicate')p.data[0].slug='item-0';if(page===2&&mode==='page')p.pagination.page=1;
   return Response.json(p);
  }});
  if(mode==='ok')assert.equal((await rows).length,101);else await assert.rejects(rows,invalid);
  assert.deepEqual(calls,[1,2]);
 }
});
