import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {englishResponse} from '../lib/english-public.mjs';
import {englishPublicHref} from '../lib/public-translation.mjs';

const origin='https://airadar.vip';
const schema=html=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m=>JSON.parse(m[1]));
const meta=(html,name)=>html.match(new RegExp('<meta (?:name|property)="'+name+'" content="([^"]*)"'))?.[1];
const canonical=html=>html.match(/rel="canonical" href="([^"]+)"/)?.[1].replaceAll('&amp;','&');
async function fixture(run){
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'direct-shops',snapshotId:'english-seo-quotes',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:Array.from({length:12},(_,i)=>({offerId:'q'+i,storeName:'SEO Shop '+i,title:'ChatGPT Plus 代充 1个月',price:100+i,currency:'CNY',status:'in_stock',url:'https://seo'+i+'.example.com/product'}))}]});
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'english-seo-regions',products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:Array.from({length:12},(_,i)=>({offerId:'r'+i,storeName:'地区 '+i,title:'地区 '+i,price:140+i,currency:'CNY',status:'official',url:'https://cardnav.xyz/official-price/chatgpt-plus',extra:{officialPrice:{region:'地区 '+i,originalCurrency:'USD',originalPrice:'20.00',period:'unknown',upstreamRefreshedAt:new Date().toISOString()}}}))}]});
 const app=createApp({db});
 try{await new Promise(r=>app.listen(0,'127.0.0.1',r));await run(async path=>{const response=await fetch('http://127.0.0.1:'+app.address().port+path);return {response,html:await response.text()};});}
 finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
}

test('English metadata describes each rendered page and preserves collection lists and publisher identity',()=>fixture(async get=>{
 const descriptions=new Set();
 for(const [path,expected] of [['/en/',/Compare.*subscription/i],['/en/catalog',/catalog/i],['/en/?family=chatgpt',/ChatGPT/],['/en/prices/chatgpt-plus',/ChatGPT Plus/],['/en/about',/Airadar.*sources|Airadar.*editorial/i],['/en/sources',/sources.*update|coverage.*update/i]]){
  const {response,html}=await get(path);assert.equal(response.status,200,path);
  const description=meta(html,'description');assert.match(description,expected,path);descriptions.add(description);
  assert.equal(meta(html,'og:description'),description);assert.equal(meta(html,'twitter:description'),description);
  assert.doesNotMatch(html.match(/<title>(.*?)<\/title>/s)[1],/[\u4e00-\u9fff]/,path);
  const graph=schema(html),page=graph.find(x=>['WebPage','CollectionPage'].includes(x['@type']));
  assert.equal(page.description,description);assert.equal(page.url,canonical(html));assert.equal(page.inLanguage,'en');
  assert.equal(graph.find(x=>x['@type']==='WebSite')['@id'],origin+'/en/#website');
  assert.equal(page.isPartOf['@id'],origin+'/en/#website');
  assert.equal(graph.find(x=>x['@type']==='Organization')['@id'],origin+'/#publisher');
  if(['/en/','/en/catalog'].includes(path)){
   assert.equal(page['@type'],'CollectionPage');
   assert.ok(graph.some(x=>x['@type']==='ItemList'&&x.itemListElement.some(item=>item.url===origin+'/en/prices/chatgpt-plus')));
  }
 }
 assert.equal(descriptions.size,6);
}));

test('English quote pagination keeps translated breadcrumbs, distinct canonical and source SSR quotes',()=>fixture(async get=>{
 const {html}=await get('/en/prices/chatgpt-plus?page=2'),{html:zh}=await get('/prices/chatgpt-plus?page=2');
 assert.equal(canonical(html),origin+'/en/prices/chatgpt-plus?page=2');
 assert.match(meta(html,'description'),/Page 2/);assert.match(html,/<title>[^<]*Page 2/);
 assert.equal((html.match(/data-directory-quote /g)||[]).length,(zh.match(/data-directory-quote /g)||[]).length);
 const crumbs=schema(html).find(x=>x['@type']==='BreadcrumbList').itemListElement;
 assert.deepEqual(crumbs.map(x=>x.item),[origin+'/en/',origin+'/en/catalog',canonical(html)]);
 assert.equal(crumbs[0].name,'Home');assert.equal(crumbs.at(-1).name,'ChatGPT Plus');
 const {html:filtered}=await get('/en/prices/chatgpt-plus?currency=CNY&page=2');
 assert.match(meta(filtered,'robots'),/^noindex/);assert.doesNotMatch(filtered,/rel="alternate" hreflang/);
 assert.equal(canonical(filtered),origin+'/en/prices/chatgpt-plus');
 const {response,html:missing}=await get('/en/prices/unknown-product');
 assert.equal(response.status,404);assert.match(meta(missing,'robots'),/^noindex/);
 assert.ok(!schema(missing).some(x=>['Dataset','ItemList','BreadcrumbList'].includes(x['@type'])));
}));

test('English official references keep Dataset provenance and limitations without inventing prices or dates',()=>fixture(async get=>{
 const path='/en/official-prices/chatgpt-plus?page=2', {html}=await get(path),{html:zh}=await get('/official-prices/chatgpt-plus?page=2');
 const dataset=schema(html).find(x=>x['@type']==='Dataset'),original=schema(zh).find(x=>x['@type']==='Dataset');
 assert.ok(dataset,'Dataset must remain available in the English SSR document');
 assert.equal(dataset.url,origin+path);assert.equal(dataset.inLanguage,'en');
 assert.match(dataset.name,/ChatGPT Plus.*App Store.*regional/i);assert.equal(dataset.description,meta(html,'description'));
 assert.match(dataset.measurementTechnique,/CardNav.*without.*checkout verification/i);
 assert.doesNotMatch(dataset.variableMeasured.join(' '),/[\u4e00-\u9fff]/);
 for(const key of ['creator','publisher','isBasedOn','isAccessibleForFree'])assert.deepEqual(dataset[key],original[key],key);
 for(const key of ['offers','price','aggregateRating'])assert.equal(dataset[key],undefined,key);
 assert.match(html,/Period not provided/);assert.match(html,/FX date: Not provided/);
 const {html:index}=await get('/en/official-prices');
 assert.ok(schema(index).find(x=>x['@type']==='ItemList').itemListElement.every(x=>x.url.startsWith(origin+'/en/official-prices/')));
 assert.match(meta(index,'description'),/official.*App Store|App Store.*official/i);
}));

test('Locale metadata preserves literal merchant names, source evidence and unrelated script bytes',()=>{
 const merchant='店铺 </script><script>bad</script> & Co',id='a'.repeat(24),url=origin+'/shop?id='+id;
 const esc=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const graph=[{'@context':'https://schema.org','@type':'WebPage',url,name:merchant+' · 店铺报价与评价',inLanguage:'zh-CN'}];
 const unrelated='<script type="application/json">{"original":"中文","source":"https://example.org/"}</script>';
 const html='<html lang="zh-CN"><head><title>'+esc(merchant)+' · 店铺报价与评价</title><link rel="canonical" href="'+url+'"><script type="application/ld+json">'+JSON.stringify(graph).replace(/</g,'\\u003c')+'</script>'+unrelated+'</head><body><h1 translate="no">'+esc(merchant)+'</h1></body></html>';
 const result=englishResponse(new URL(origin+'/en/shop?id='+id),{directory:()=>[],render:()=>({status:200,html})});
 assert.match(meta(result.html,'description'),/shop.*quotes|quotes.*shop/i);
 assert.ok(result.html.includes(unrelated));assert.doesNotMatch(result.html,/<script>bad<\/script>/);
 assert.equal(schema(result.html)[0].name,merchant+' · Shop quotes and reviews');
});

test('Translated catalog identities retain the service meaning and only map existing English URLs',()=>{
 const product='Gemini 权限激活服务',path='/?family=gemini&product=gemini-activation-service';
 const graph=[{'@context':'https://schema.org','@type':'CollectionPage',url:origin+path},
  {'@type':'ItemList',itemListElement:[{name:product,url:origin+path},{name:'Original source',url:origin+'/product?source=direct-shops&id=gemini-activation-service'},{name:'Official source',url:'https://example.org/original'}]}];
 const html='<html lang="zh-CN"><head><title>'+product+'公开报价与规格 · AI订阅价格雷达</title><link rel="canonical" href="'+origin+path+'"><script type="application/ld+json">'+JSON.stringify(graph)+'</script></head><body><section data-directory-family="gemini" data-directory-product="gemini-activation-service" data-directory-product-name="'+product+'"></section></body></html>';
 const result=englishResponse(new URL(origin+'/en/prices/gemini-activation-service'),{directory:()=>[{key:'gemini',products:[{key:'gemini-activation-service'}]}],render:()=>({status:200,html})});
 assert.match(result.html,/<title>Gemini activation service quotes and specifications · Airadar<\/title>/);
 assert.match(meta(result.html,'description'),/Gemini activation service/);
 const items=schema(result.html).find(x=>x['@type']==='ItemList').itemListElement;
 assert.deepEqual(items.map(x=>x.url),[origin+'/en/prices/gemini-activation-service',graph[1].itemListElement[1].url,'https://example.org/original']);
 assert.equal(items[0].name,'Gemini activation service');
 assert.equal(englishPublicHref('/prices/chatgpt-plus?currency=CNY#quote-results'),'/en/prices/chatgpt-plus?currency=CNY#quote-results');
 assert.equal(englishPublicHref('#quote-filters'),'#quote-filters');
});
