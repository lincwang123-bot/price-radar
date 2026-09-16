import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {officialOffer,officialTimestamp,filterOfficialRows,officialPageData} from '../lib/official-prices.mjs';
import {parseCardnavPage} from '../sources/cardnav.mjs';

const now=Date.now(),iso=new Date(now).toISOString();
const snapshot={fetched_at:iso,stale:0};
const legacy={product_id:'chatgpt-plus',store_name:'印度 (IN)',title:'印度 (IN) ₹1,999 INR',price:164,currency:'CNY',captured_at:'2026-09-09T12:29:25',url:'https://cardnav.xyz/official-price/chatgpt-plus'};
test('reference records retain original amounts, preserve unknowns and repair only documented Beijing timestamps',()=>{
 const row=officialOffer(legacy,snapshot,Date.parse('2026-09-09T08:00:00Z'));
 assert.equal(row.originalPrice,'₹1,999');assert.equal(row.originalCurrency,'INR');assert.equal(row.cny,164);
 assert.equal(row.sourceAt,'2026-09-09T04:29:25.000Z');assert.equal(row.collectedAt,iso);assert.equal(row.period,'unknown');assert.equal(row.fxDate,null);assert.equal(row.stale,false);
 assert.equal(officialTimestamp('2026-09-09T12:29:25'),null);
 assert.equal(officialOffer({...legacy,price:null},snapshot,now).cny,null);
 assert.equal(officialOffer({...legacy,price:0},snapshot,now).cny,0);
 assert.equal(officialOffer({...legacy,price:NaN},snapshot,now).cny,null);
 assert.equal(officialOffer({...legacy,price:-1},snapshot,now).cny,null);
 assert.equal(officialOffer({...legacy,currency:'USD'},snapshot,now).cny,null);
 assert.equal(officialOffer({...legacy,captured_at:null},snapshot,now).stale,true);
 assert.equal(officialOffer(legacy,snapshot,Date.parse('2026-09-13T08:00:00Z')).stale,true);
 const rupiah=officialOffer({...legacy,store_name:'印度尼西亚',title:'印度尼西亚 Rp 349ribu IDR'},snapshot,now);
 assert.equal(rupiah.originalPrice,'Rp 349ribu');assert.equal(rupiah.originalCurrency,'IDR');
 for(const url of ['javascript:alert(1)','https://cardnav.xyz.evil.test/official-price/chatgpt-plus','https://cardnav.xyz/official-price/chatgpt-go','https://user@cardnav.xyz/official-price/chatgpt-plus'])assert.equal(officialOffer({...legacy,url},snapshot,now).sourceUrl,null,url);
 assert.equal(officialOffer({...legacy,extra:'invalid json'},snapshot,now).period,'unknown');
});
test('filters never treat an unknown period as monthly and put stale records after current references',()=>{
 const base=officialOffer(legacy,snapshot,now),rows=[{...base,region:'美国 (US)',period:'month',originalCurrency:'USD',cny:50,stale:false},{...base,region:'印度 (IN)',period:'unknown',cny:20,stale:false},{...base,region:'印度 (IN)',period:'month',cny:1,stale:true}];
 assert.deepEqual(filterOfficialRows(rows,new URL('https://airadar.vip/product')).map(r=>r.cny),[20,50,1]);
 assert.deepEqual(filterOfficialRows(rows,new URL('https://airadar.vip/product?period=month&currency=INR&region=in')).map(r=>r.cny),[1]);
 assert.equal(filterOfficialRows(rows,new URL('https://airadar.vip/product?period=invalid')).length,0);
});
test('CardNav parser preserves local price notation, records Beijing offset and leaves absent fields out of inference',()=>{
 const html='最近刷新（北京时间）：2026-09-09 12:29:25<tr data-sort-sequence="1"><td data-label="国家/地区">印度尼西亚 (ID)</td><td data-label="本地标价">Rp 349ribu</td><td data-label="币种">IDR</td><td data-label="折合人民币 (CNY)">¥145.00</td></tr>';
 const p=parseCardnavPage(html,'chatgpt-plus');assert.equal(p.refreshedAt,'2026-09-09T12:29:25+08:00');assert.equal(p.rows[0].localPrice,'Rp 349ribu');assert.equal(p.rows[0].cny,145);
 assert.equal(parseCardnavPage(html.replace('最近刷新（北京时间）：2026-09-09 12:29:25',''),'chatgpt-plus').refreshedAt,null);
});
function fixture(){
 const db=openDb(':memory:');
 storeSnapshot(db,{source:'cardnav-official',snapshotId:'reference',fetchedAt:iso,products:[['chatgpt-plus','ChatGPT Plus','ChatGPT'],['chatgpt-go','ChatGPT Go','ChatGPT'],['claude-pro','Claude Pro','Claude']].map(([id,name,platform])=>({productId:id,name:name+'（官方区价）',platform,currency:'CNY',offers:Array.from({length:23},(_,i)=>({offerId:id+i,storeName:'地区 '+i,title:'地区 '+i+' $'+(i+1)+' USD',price:i===22?null:i,currency:'CNY',status:'official',url:'https://cardnav.xyz/official-price/'+id,capturedAt:iso,extra:{officialPrice:{period:i<12?'month':null,exchangeRateDate:null}}}))}))});
 return db;
}
test('official pages render references, filter and paginate independently, retain legacy URLs and use matching metadata',async()=>{
 const db=fixture(),app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port;
 const get=path=>fetch(origin+path,{redirect:'manual'}),detail='/product?source=cardnav-official&id=chatgpt-plus';
 try{
  const home=await(await get('/')).text();assert.match(home,/<title>AI订阅比价与降价提醒/);assert.match(home,/href="\/official-prices"/);
  const index=await(await get('/official-prices')).text();assert.match(index,/<h1>AI 官方订阅地区价格<\/h1>/);assert.equal((index.match(/<article class="official-card"/g)||[]).length,3);
  const schemas=h=>JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(schemas(index).find(x=>x['@type']==='ItemList').itemListElement.length,3);
  const only=await(await get('/official-prices?brand=Claude')).text();assert.equal((only.match(/<article class="official-card"/g)||[]).length,1);assert.equal(schemas(only).find(x=>x['@type']==='ItemList').itemListElement[0].name,'Claude Pro');
  const empty=await(await get('/official-prices?q=nonexistent')).text();assert.match(empty,/没有匹配的套餐/);assert.ok(!schemas(empty).some(x=>x['@type']==='ItemList'));
  for(const [suffix,page,count] of [['',1,10],['&page=2',2,10],['&page=999',3,3],['&page=NaN',1,10],['&page=-1',1,10]]){
   const response=await get(detail+suffix);assert.equal(response.status,200);const html=await response.text();
   assert.match(html,new RegExp('data-official-page="'+page+'"'));assert.equal((html.match(/<th scope="row">/g)||[]).length,count);
   const canonical=html.match(/rel="canonical" href="([^"]+)"/)[1].replaceAll('&amp;','&');assert.equal(canonical,'https://airadar.vip'+detail+(page>1?'&page='+page:''));
   assert.match(html,/<title>ChatGPT Plus 官方地区价格/);assert.match(html,/汇率日期未提供/);assert.match(html,/未经本站逐条结账核验/);
   const content=html.split('<section class="official-page"')[1].split('</main>')[0];assert.doesNotMatch(content,/店主认领|name="channel"|历史价格走势|data-store-risk/);
   const dataset=schemas(html).find(x=>x['@type']==='Dataset');assert.equal(dataset.isBasedOn,'https://cardnav.xyz/official-price/chatgpt-plus');assert.equal(dataset.offers,undefined);assert.equal(dataset.dateModified,undefined);
  }
  const filtered=await(await get(detail+'&period=month&page=2')).text();assert.equal((filtered.match(/<th scope="row">/g)||[]).length,2);assert.match(filtered,/period=month/);
  const none=await(await get(detail+'&period=year')).text();assert.match(none,/没有符合条件的地区记录/);assert.doesNotMatch(none,/<th scope="row">/);
  const attack=await(await get(detail+'&region='+encodeURIComponent('"><script>alert(1)</script>'))).text();assert.doesNotMatch(attack,/<script>alert\(1\)<\/script>/);assert.match(attack,/&lt;script&gt;/);
  const missing=await get('/product?source=cardnav-official&id=missing');assert.equal(missing.status,404);assert.match(await missing.text(),/noindex/);
  const map=await(await get('/sitemap.xml')).text();assert.match(map,/<loc>https:\/\/airadar.vip\/official-prices<\/loc>/);assert.doesNotMatch(map,/period=|region=/);
  const head=await fetch(origin+'/official-prices',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const slash=await get('/official-prices/?q=x');assert.equal(slash.status,301);assert.equal(slash.headers.get('location'),'/official-prices?q=x');
  assert.equal((await fetch(origin+'/official-prices',{method:'POST'})).status,405);
  const data=officialPageData(db,new URL('https://airadar.vip'+detail+'&page=2'));assert.equal(data.page,2);assert.equal(data.shown.length,10);
 }finally{await new Promise(r=>app.close(r));db.close();}
});
