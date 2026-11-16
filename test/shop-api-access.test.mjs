import test from 'node:test';
import assert from 'node:assert/strict';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {safeFetchText} from '../lib/safe-fetch.mjs';
import {classifyPreflightError,preflightGuidance,preflightAiPrompt} from '../lib/merchant-preflight-guidance.mjs';

function fixture(t,{origin='https://wzyp.cn',policy='User-agent: *\nAllow: /',robotsStatus=200,challenge,failCategoryOnce=false}={}) {
  t.mock.timers.enable({apis:['Date'],now:10000});
  const calls=[];let categories=0;
  const merchant={id:'merchant-fixture',identity:`shop:${origin.includes('pay.')?'ldxp-pay':'wzyp'}:public-shop`,shopName:'样例店',shopUrl:origin+'/shop/public-shop',platform:'ldxp'};
  const ctx={sleep:async ms=>t.mock.timers.tick(ms),merchantFetchFactory:()=>async(url,init)=>{
    calls.push({path:new URL(url).pathname,start:Date.now(),headers:new Headers(init.headers),body:init.body});
    if(url.endsWith('/robots.txt'))return challenge?.()||new Response(policy,{status:robotsStatus,headers:{'content-type':'text/plain'}});
    assert.equal(JSON.parse(init.body).token,'public-shop');
    if(url.endsWith('categoryList')){
      if(failCategoryOnce&&categories++===0)return Response.json({}, {status:500});
      return Response.json({code:1,data:[{id:0,name:'全部'}]});
    }
    return Response.json({code:1,data:{list:[{goods_key:'g1',name:'ChatGPT Plus 月卡代充',price:122,stock:3}],total:1}});
  }};
  return {calls,run:()=>probeMerchantCatalog(merchant,ctx,new Date().toISOString(),Date.now()+30000)};
}

for(const origin of ['https://wzyp.cn','https://pay.ldxp.cn'])test(`ShopApi follows public policy and identifies itself on ${origin}`,async t=>{
  const f=fixture(t,{origin});const r=await f.run();
  assert.equal(r.offers.length,1);assert.equal(r.offers[0].price,122);
  assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt','/shopApi/Shop/categoryList','/shopApi/Shop/goodsList']);
  assert.ok(f.calls.every(c=>c.headers.get('user-agent')==='AiradarBot/1.0 (+https://airadar.vip)'));
  for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].start-f.calls[i-1].start>=1100);
});

test('ShopApi obeys specific bot rules and crawl delay on retried reads',async t=>{
  const f=fixture(t,{policy:'User-agent: *\nDisallow: /\nUser-agent: AiradarBot\nAllow: /\nCrawl-delay: 3',failCategoryOnce:true});
  assert.equal((await f.run()).offers.length,1);
  assert.deepEqual(f.calls.map(c=>c.start),[10000,13000,16000,19000]);
});

test('ShopApi stops at a forbidden goods endpoint after the permitted category read',async t=>{
  const f=fixture(t,{policy:'User-agent: *\nDisallow: /shopApi/Shop/goodsList'});
  await assert.rejects(f.run(),e=>e.code==='ROBOTS_DISALLOWED');
  assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt','/shopApi/Shop/categoryList']);
});

test('ShopApi can use a public catalog when robots is absent',async t=>{
  const f=fixture(t,{robotsStatus:404});assert.equal((await f.run()).offers.length,1);assert.equal(f.calls.length,3);
});

test('HTTP 200 WAF on policy stops ShopApi without retrying or requesting products',async t=>{
  const f=fixture(t,{challenge:()=>new Response('<html>verification</html>',{headers:{'x-tengine-error':'denied by http_custom','content-type':'text/html'}})});
  await assert.rejects(f.run(),e=>{
    assert.deepEqual(classifyPreflightError(e),{reasonCode:'security_challenge',httpStatus:200});return true;
  });
  assert.deepEqual(f.calls.map(c=>c.path),['/robots.txt']);
});

test('security challenge has accurate UI and AI guidance without blaming the catalog parser',async()=>{
  let observed;
  try {await safeFetchText('https://public-shop.com/robots.txt',{allowedOrigins:['https://public-shop.com'],fetchImpl:async()=>new Response('<script>window._waf_is_mobile=false</script>',{headers:{'content-type':'text/html'}})});}catch(e){observed=e;}
  const reason=classifyPreflightError(observed);assert.equal(reason.reasonCode,'security_challenge');
  const result={status:'unavailable',...reason,checkedAt:new Date().toISOString()};
  const guidance=preflightGuidance(result);
  assert.match(guidance.title,/安全防护/);assert.match(guidance.explanation,/并非商品目录/);
  const prompt=preflightAiPrompt({status:'unavailable',result},{shopName:'样例店',shopUrl:'https://wzyp.cn/shop/public-shop'});
  assert.match(prompt,/平台运营方/);assert.match(prompt,/AiradarBot/);assert.match(prompt,/不要关闭全站防护/);
  assert.deepEqual(classifyPreflightError(Object.assign(new Error('safe-fetch: HTTP 403'),{status:403,code:'ACCESS_DENIED'})),{reasonCode:'access_denied',httpStatus:403});
  assert.deepEqual(classifyPreflightError(new Error('网站说明 security_challenge captcha')),{reasonCode:'unknown'});
});
