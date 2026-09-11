import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {articleForPath} from '../lib/guides.mjs';
import {buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';

const paths=['/guides/chatgpt-pro-5x-vs-20x','/guides/grok-trial-and-subscription','/help/compare-prices','/help/price-alerts','/help/data-and-ranking','/guides/chatgpt-plus-delivery','/guides/why-prices-differ','/guides/renewal-checklist','/guides/claude-pro-buying','/guides/gemini-membership-options','/guides/chatgpt-plus-trial-day-pass','/guides/cursor-discount-links','/guides/chatgpt-go-vs-plus','/guides/official-subscription-channels','/guides/regional-price-total-cost'];
test('public articles are readable without JavaScript, linked, canonical and discoverable',async()=>{
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'direct-shops',snapshotId:'guides-fixture',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'guide-offer',title:'ChatGPT Plus 1个月代充',price:100,currency:'CNY',status:'in_stock',stockCount:1,url:'https://example.com/plus'}]},{productId:'super-grok',name:'Super Grok',currency:'CNY',offers:[{offerId:'grok-direct-fixture',title:'Super Grok 7天成品账号',price:10,currency:'CNY',status:'in_stock',url:'https://example.com/grok'}]}]});
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'cursor-guides-fixture',products:[['cursor-pro','Cursor Pro'],['cursor-pro-plus','Cursor Pro+'],['cursor-ultra','Cursor Ultra'],['cursor-account','Cursor 账号'],['chatgpt-go','ChatGPT Go'],['chatgpt-plus','ChatGPT Plus'],['claude-pro','Claude Pro'],['chatgpt-pro-5x','ChatGPT Pro 5x'],['chatgpt-pro-20x','ChatGPT Pro 20x']].map(([productId,name])=>({productId,name,currency:'USD',offers:[{offerId:productId+'-fixture',title:name,price:20,currency:'USD',status:'official',url:'https://example.com/'+productId}]}))});
 storeSnapshot(db,{source:'priceai',snapshotId:'new-guides-fixture',products:[['chatgpt-pro-5x','ChatGPT Pro 5x'],['chatgpt-pro-20x','ChatGPT Pro 20x'],['super-grok','Super Grok']].map(([productId,name])=>({productId,name,currency:'CNY',offers:[{offerId:productId+'-fixture',title:name+' 1个月代充',price:100,currency:'CNY',status:'in_stock',url:'https://example.com/'+productId}]}))});
 const app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.address().port}`;
 try{
  const map=await(await fetch(origin+'/sitemap.xml')).text();
  for(const path of ['/guides','/help',...paths]){
   const response=await fetch(origin+path+'?utm_source=fixture');assert.equal(response.status,200,path);
   const html=await response.text();
   assert.match(html,new RegExp('rel="canonical" href="https://airadar.vip'+path+'"'));
   assert.match(html,/<meta name="robots" content="index, follow/);
   assert.ok(map.includes('<loc>https://airadar.vip'+path+'</loc>'));
   assert.equal([...html.matchAll(/<h1\b/g)].length,1);
   if(paths.includes(path)){
    assert.match(html,/<article\b/);assert.ok(html.includes('datetime="'+articleForPath(path).updated+'"'));assert.match(html,/依据与相关说明/);
    const json=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    const article=json.find(s=>s['@type']==='Article');assert.equal(article.url,'https://airadar.vip'+path);assert.ok(article.headline);assert.equal(article.author.name,'AI订阅雷达');
    const body=html.split('<article')[1].split('</article>')[0];
    assert.ok(body.replace(/<[^>]+>/g,'').length>600,path+' must contain an actual guide');
    for(const match of body.matchAll(/href="(\/[^"#]*)"/g)){
     const linked=await fetch(origin+match[1].replaceAll('&amp;','&'));assert.equal(linked.status,200,match[1]);await linked.body?.cancel();
    }
   }
  }
  const quote=await(await fetch(origin+'/?family=chatgpt&product=chatgpt-plus')).text();assert.match(quote,/href="\/guides\/chatgpt-plus-delivery"/);assert.match(quote,/href="\/help\/compare-prices"/);
  assert.match(quote,/href="\/guides\/chatgpt-plus-trial-day-pass"/);
  for(const product of ['cursor-pro','cursor-pro-plus','cursor-ultra','cursor-account']){
   const response=await fetch(origin+'/?family=cursor&product='+product);assert.equal(response.status,200);
   assert.ok((await response.text()).includes('href="/guides/cursor-discount-links"'),product+' must link its buying guide');
  }
  const go=await(await fetch(origin+'/?family=chatgpt&product=chatgpt-go')).text();assert.match(go,/href="\/guides\/chatgpt-go-vs-plus"/);
  for(const [family,key,guide] of [['chatgpt','chatgpt-pro-5x','chatgpt-pro-5x-vs-20x'],['chatgpt','chatgpt-pro-20x','chatgpt-pro-5x-vs-20x'],['grok','super-grok','grok-trial-and-subscription']]){
   for(const path of ['/?family='+family+'&product='+key,'/product?source=priceai&id='+key,...(family==='chatgpt'?['/product?source=cardnav-official&id='+key]:[])]){
    const response=await fetch(origin+path);assert.equal(response.status,200,path);const html=await response.text();
    assert.ok(html.includes('href="/guides/'+guide+'"'),path+' must link to its relevant guide');
    const note=html.indexOf('<aside class="guide-takeaway"'),offers=html.indexOf(path.includes('cardnav-official')?'class="official-observation"':path.startsWith('/product')?'id="offers"':'class="directory-quotes"');
    assert.ok(note>=0&&offers>note,path+' must explain buying conditions before quotes');
    if(key.startsWith('chatgpt-pro-'))assert.match(html,/暂停 Pro 20x 新订阅和升级/);
    if(key==='chatgpt-pro-5x'&&path.startsWith('/?'))assert.match(html,/<title>ChatGPT Pro 5x 价格比较：期限、地区与充值渠道/);
   }
  }
  const follows=await(await fetch(origin+'/following')).text();assert.match(follows,/href="\/help\/price-alerts"/);
 }finally{await new Promise(r=>app.close(r));db.close();}
});
test('content routes retain HTTP semantics and unknown articles are genuine noindex 404s',async()=>{
 const db=openDb(':memory:'),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.address().port}`;
 try{
  for(const path of ['/guides','/help',...paths]){
   const head=await fetch(origin+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
   const slash=await fetch(origin+path+'/?utm_source=x',{redirect:'manual'});assert.equal(slash.status,301);assert.equal(slash.headers.get('location'),path+'?utm_source=x');
  }
  for(const path of ['/guides/missing','/help/missing']){
   const missing=await fetch(origin+path);assert.equal(missing.status,404);assert.match(missing.headers.get('x-robots-tag'),/noindex/);assert.doesNotMatch(await missing.text(),/"@type":"Article"/);
  }
  assert.equal((await fetch(origin+paths[0],{method:'POST'})).status,405);
 }finally{await new Promise(r=>app.close(r));db.close();}
});
test('legacy reference keys remain usable as filters without exposing internal keys as labels',()=>{
 const p=buildProductDirectory([{source:'cardnav-official',products:[{product_id:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[{offer_id:'reference',title:'ChatGPT Plus 官方参考',comparison_known:true,price:100,currency:'CNY',status:'official',url:'https://example.com/plus',comparison_key:'other:CNY',comparison_label:''}]}]}]).find(c=>c.key==='chatgpt').products[0];
 const quotes=directoryQuotes(p);assert.equal(quotes.specs[0].key,'other:CNY');assert.equal(quotes.specs[0].label,'参考报价 · 规格待确认');assert.equal(directoryQuotes(p,{spec:'other:CNY'}).total,1);
});
