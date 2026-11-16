import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {englishResponse} from '../lib/english-public.mjs';
import {shopReviewsContent} from '../lib/shop-review-ui.mjs';
import {shopContent} from '../lib/merchant-x-ui.mjs';
import {englishReviewBrowsing} from '../lib/public-translation.mjs';

async function fixture(run){
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'direct-shops',snapshotId:'english-fixture',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:Array.from({length:23},(_,i)=>({offerId:'o'+i,storeName:i===0?'商店 <script>bad</script>':'Fixture Shop '+i,title:i===22?'ChatGPT Plus 成品号 1个月':'ChatGPT Plus '+(i%2?'菲律宾':'iOS')+' 代充 1个月 新开续费均可',price:100+i,currency:i===21?'USD':'CNY',status:'in_stock',stockCount:1,url:'https://shop'+i+'.example.com/product'}))}]});
 const app=createApp({db});
 try{await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;await run({db,get:(path,options)=>fetch(origin+path,options)});}
 finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
}
test('English browsing is server rendered, uses shared prices, and has real language alternatives',()=>fixture(async({get})=>{
 const home=await get('/en/');assert.equal(home.status,200);assert.equal(home.headers.get('content-language'),'en');const html=await home.text();
 assert.match(html,/<html lang="en">/);assert.match(html,/Compare AI subscriptions/);assert.match(html,/href="\/en\/prices\/chatgpt-plus"/);assert.match(html,/hreflang="zh-CN" href="https:\/\/airadar.vip\/"/);assert.match(html,/rel="canonical" href="https:\/\/airadar.vip\/en\/"/);
 const zh=await(await get('/')).text();assert.match(zh,/data-language-switch href="\/en\/"/);assert.match(zh,/hreflang="en" href="https:\/\/airadar.vip\/en\/"/);
 const quote=await(await get('/en/prices/chatgpt-plus')).text();assert.equal((quote.match(/data-directory-quote /g)||[]).length,10);assert.match(quote,/data-price="100" data-currency="CNY"/);assert.doesNotMatch(quote,/<script>bad/);assert.match(quote,/商店 &lt;script&gt;bad&lt;\/script&gt;/);assert.match(quote,/Buy a new account/);assert.match(quote,/Top up my account/);
 const zhQuote=await(await get('/prices/chatgpt-plus')).text();assert.match(zhQuote,/hreflang="en" href="https:\/\/airadar.vip\/en\/prices\/chatgpt-plus"/);
 assert.match(quote,/hreflang="zh-CN" href="https:\/\/airadar.vip\/prices\/chatgpt-plus"/);assert.match(quote,/"inLanguage":"en"/);
 const second=await(await get('/en/prices/chatgpt-plus?page=2')).text();assert.equal((second.match(/data-directory-quote /g)||[]).length,10);assert.match(second,/Page 2 of 3/);assert.match(second,/canonical" href="https:\/\/airadar.vip\/en\/prices\/chatgpt-plus\?page=2"/);
 const filtered=await(await get('/en/prices/chatgpt-plus?delivery=recharge&recharge=ios')).text();assert.match(filtered,/name="robots" content="noindex/);assert.doesNotMatch(filtered,/data-price="101"/);assert.match(filtered,/data-price="100"/);
 assert.match(filtered,/data-language-switch href="\/prices\/chatgpt-plus\?delivery=recharge&amp;recharge=ios"/);
 const account=await(await get('/en/prices/chatgpt-plus?delivery=account')).text();assert.equal((account.match(/data-directory-quote /g)||[]).length,1);assert.match(account,/data-price="122"/);
 const usd=await(await get('/en/prices/chatgpt-plus?currency=USD')).text();assert.match(usd,/data-price="121" data-currency="USD"/);assert.doesNotMatch(usd,/data-currency="CNY"/);
}));
test('English regional detail retains missing periods, original amounts, filters and reciprocal language links',()=>fixture(async({db,get})=>{
 const now=new Date().toISOString();
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'english-regions',products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:Array.from({length:12},(_,i)=>({offerId:'r'+i,storeName:'地区 '+i,title:'地区 '+i,price:140+i,currency:'CNY',status:'official',url:'https://cardnav.xyz/official-price/chatgpt-plus',extra:{officialPrice:{region:'地区 '+i,originalCurrency:'USD',originalPrice:'20.00',period:i===0?'unknown':'month',upstreamRefreshedAt:now}}}))}]});
 const path='/en/official-prices/chatgpt-plus',html=await(await get(path)).text();
 assert.match(html,/Period not provided/);assert.match(html,/FX date: Not provided/);assert.match(html,/<strong>20.00<\/strong><small>USD<\/small>/);assert.match(html,/地区 0/);
 assert.match(html,/hreflang="zh-CN" href="https:\/\/airadar.vip\/official-prices\/chatgpt-plus"/);
 const zh=await(await get('/official-prices/chatgpt-plus')).text();assert.match(zh,/hreflang="en" href="https:\/\/airadar.vip\/en\/official-prices\/chatgpt-plus"/);
 const page2=await(await get(path+'?page=2')).text();assert.match(page2,/Page 2 of 2/);assert.match(page2,/canonical" href="https:\/\/airadar.vip\/en\/official-prices\/chatgpt-plus\?page=2"/);
 const filtered=await(await get(path+'?period=unknown')).text();assert.match(filtered,/1 matching records/);assert.match(filtered,/name="robots" content="noindex/);
}));
test('English reviews render only the public DTO, original text and public images with the real count',()=>{
 const id='a'.repeat(24),shop={id,name:'Public Shop',identity:'site:https://fixture.example.com',url:'https://fixture.example.com/',entries:[]};
 const reviews={publicList:()=>({total:1,page:1,pages:1,items:[{author:'用户 abcdef',rating:2,product:'ChatGPT Plus',experience:'原文 <script>bad</script>',publishedAt:'2026-09-28T12:00:00Z',images:[{url:'/api/review-images/'+'b'.repeat(32)}]}]})};
 const shared=shopContent(shop,[],englishReviewBrowsing(shopReviewsContent(shop,reviews.publicList()),id));
 const result=englishResponse(new URL('https://airadar.vip/en/shop?id='+id),{directory:()=>[],render:()=>({status:200,html:'<html lang="zh-CN"><head><title>Public Shop · 店铺报价与评价</title></head><body>'+shared+'</body></html>'})});
 assert.equal(result.status,200);assert.match(result.html,/Reviews <span>1<\/span>/);assert.match(result.html,/用户 abcdef/);assert.match(result.html,/Original text · untranslated/);assert.match(result.html,/原文 &lt;script&gt;bad/);assert.doesNotMatch(result.html,/<script>bad/);assert.match(result.html,/User-uploaded review image 1/);
});
test('English shop search, detail and safe outbound stay usable without translating merchant claims',()=>fixture(async({get})=>{
 const search=await(await get('/en/?shop_q=shop0.example.com')).text();assert.match(search,/1 shop/);assert.match(search,/name="robots" content="noindex/);const link=search.match(/href="(\/en\/shop\?id=[a-f0-9]{24})"/)[1];
 const shop=await(await get(link)).text();assert.match(shop,/Reviews <span>0<\/span>/);assert.match(shop,/Write a review \(Chinese\)/);assert.match(shop,/商店 &lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(shop,/<script>bad/);
 const quotes=await(await get('/en/prices/chatgpt-plus')).text();const go=quotes.match(/href="(\/go\?[^\"]*lang=en)"/)[1].replaceAll('&amp;','&');const warning=await(await get(go)).text();assert.match(warning,/<html lang="en">/);assert.match(warning,/Continue to merchant/);assert.match(warning,/independent/);assert.match(warning,/lang=en&amp;ack=1/);
 const empty=await(await get('/en/?shop_q=nomatch.invalid')).text();assert.match(empty,/No matching shops/);
}));
test('English does not revive hidden quotes, accept private routes, or create indexable errors',()=>fixture(async({db,get})=>{
 for(const path of ['/en/no-such-page','/en/prices/no-such-product','/en/shop?id=bad','/en/official-prices?id=not-real','/en/admin']){const r=await get(path);assert.equal(r.status,404,path);assert.match(r.headers.get('x-robots-tag'),/noindex/);}
 assert.equal((await get('/en/',{method:'POST'})).status,405);assert.equal(await(await get('/en/',{method:'HEAD'})).text(),'');
 const slash=await get('/en',{redirect:'manual'});assert.equal(slash.status,301);assert.equal(slash.headers.get('location'),'/en/');
 const zhLogin=await(await get('/login')).text();assert.doesNotMatch(zhLogin,/rel="alternate" hreflang/);
 db.prepare("UPDATE offers SET status='out_of_stock'").run();assert.doesNotMatch(await(await get('/en/prices/chatgpt-plus')).text(),/data-directory-quote /);
}));
test('English official references retain currencies, dates, qualifications and vendor links',()=>fixture(async({get})=>{
 const r=await get('/en/official-prices'),html=await r.text();assert.equal(r.status,200);assert.match(html,/Official price references/);assert.match(html,/USD 20/);assert.match(html,/Last checked/);assert.match(html,/Visit official website/);assert.match(html,/limited testing/);assert.match(html,/not a live checkout/);
 const sitemap=await(await get('/sitemap.xml')).text();assert.match(sitemap,/<loc>https:\/\/airadar.vip\/en\/<\/loc>/);assert.match(sitemap,/<loc>https:\/\/airadar.vip\/en\/prices\/chatgpt-plus<\/loc>/);assert.doesNotMatch(sitemap,/<loc>[^<]*shop_q=/);
}));
