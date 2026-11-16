import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseDawnformProducts,DAWNFORM_ORIGIN as origin} from '../collectors/direct/dawnform-public.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const at='2026-09-25T13:21:12.149Z';
const target=()=>authorizeMerchantTarget({id:'merchant-dawnform',name:'凌越穹顶',origin});
const payload=()=>({updated_at:'2026-09-25T13:20:01.849Z',site_key:'self_b',currency:'CNY',products:[
 {title:'【老订阅续费】ChatGPT Pro 20x 续订服务 #045',price_cny:'1040.00',quantity:1,available:true,url:origin+'/products/pro-20x-renewal'},
 {title:'【正规秒充】ChatGPT Pro 5x 官方充值 #039',price_cny:'650.00',quantity:1,available:true,url:origin+'/products/pro-5x-recharge'},
 {title:'【正规秒充】ChatGPT Plus 官方充值（须账号为Free状态） #029',price_cny:'114.00',quantity:1,available:true,url:origin+'/products/16688-g40326089'},
 {title:'【正规秒充】ChatGPT Pro 20x 官方充值 #045',price_cny:'1040.00',quantity:1,available:true,url:origin+'/products/16688-g82461501'},
 {title:'Codex 自动或手动接马服务｜卡密自助提交｜codex 接马',price_cny:'1.00',quantity:1,available:true,url:origin+'/products/16688-g56377610'},
]});
const merchant={id:'merchant-dawnform',shopName:'凌越穹顶',shopUrl:origin+'/',identity:'domain:faka.dawnform.top',platform:'independent'};
function fixture(t,robots='User-agent: *\nDisallow: /api/\nAllow: /public-products.json',{status=200}={}){
 const dataDir=mkdtempSync(path.join(tmpdir(),'dawnform-test-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
 t.mock.timers.enable({apis:['Date'],now:Date.parse(at)});
 const calls=[],ctx={dataDir,sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:()=>async(url,init)=>{
  calls.push({path:new URL(url).pathname,at:Date.now(),method:init.method||'GET',agent:new Headers(init.headers).get('user-agent')});
  return url.endsWith('/robots.txt')?new Response(robots,{status,headers:{'content-type':'text/plain'}}):new Response(JSON.stringify(payload()),{headers:{'content-type':'application/json'}});
 }};
 return {calls,run:()=>probeMerchantCatalog(merchant,ctx,new Date().toISOString(),Date.now()+30000)};
}
test('merchant static catalogue keeps all five records but only the four subscription quotes, without inventing inventory',()=>{
 const rows=parseDawnformProducts(payload(),target(),at),summary=summarizeMerchantOffers(rows,{now:Date.parse(at)});
 assert.equal(rows.length,5);assert.equal(summary.validCount,4);
 assert.ok(rows.every(r=>r.stockCount===null&&r.status==='in_stock'));
 assert.deepEqual(rows.map(r=>r.price),[1040,650,114,1040,1]);
 assert.equal(new Set(rows.map(r=>r.offerId)).size,5);
 assert.equal(rows[0].title,payload().products[0].title);
 const sold=payload();sold.products[1].available=false;
 assert.equal(summarizeMerchantOffers(parseDawnformProducts(sold,target(),at),{now:Date.parse(at)}).validCount,3);
});
test('untrusted static catalogue rejects bad prices, cross-origin/private links, variants, missing state, duplicates and stale feeds',()=>{
 for(const patch of [{price_cny:'1040oops'},{price_cny:0},{price_cny:-1},{price_cny:'1.001'},{available:undefined},{url:'https://evil.example.org/products/a'},
  {url:origin+'/api/orders'},{url:origin+'/products/a?token=secret'},{url:origin+'/products/a#frag'},{variants:[{price:1}]}]){
  const p=payload();Object.assign(p.products[0],patch);assert.throws(()=>parseDawnformProducts(p,target(),at),e=>e.code==='INVALID_CATALOG');
 }
 for(const patch of [{currency:'USD'},{site_key:'other'},{updated_at:'2026-09-25T12:00:00Z'},{updated_at:'2026-09-25T14:00:00Z'},{products:[payload().products[0],payload().products[0]]}])
  assert.throws(()=>parseDawnformProducts({...payload(),...patch},target(),at),e=>e.code==='INVALID_CATALOG');
 assert.throws(()=>parseDawnformProducts(payload(),{...target()},at),/未授权/);
});
test('probe reads only robots and supplied static JSON, sharing 10s cooldown across fresh probe instances',async t=>{
 const f=fixture(t);assert.equal((await f.run()).offers.length,5);assert.equal((await f.run()).offers.length,5);
 assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt','/public-products.json','/robots.txt','/public-products.json']);
 for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].at-f.calls[i-1].at>=10000);
 assert.ok(f.calls.every(c=>c.method==='GET'&&c.agent.startsWith('AiradarBot/1.0')));
});
test('stricter robots crawl delay applies even after waiting on persisted cooldown',async t=>{
 const f=fixture(t,'User-agent: *\nAllow: /\nCrawl-delay: 12');await f.run();await f.run();
 for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].at-f.calls[i-1].at>=12000);
});
test('denied robots never triggers static or guessed endpoints',async t=>{
 const f=fixture(t,'User-agent: *\nDisallow: /');await assert.rejects(f.run(),e=>e.code==='ROBOTS_DISALLOWED');
 assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt']);
});
test('access protection on rules stops requests without retry',async t=>{
 const f=fixture(t,'blocked',{status:403});await assert.rejects(f.run());assert.equal(f.calls.length,1);
});
