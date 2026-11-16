import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('recharge subfilter preserves sort/platform/pagination and clears on other deliveries',async()=>{
  const db=openDb(':memory:'),app=createApp({db}),now=new Date().toISOString();
  const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',stockCount:1,status:'in_stock',url:`https://merchant-${id}.com/product`,capturedAt:now});
  const prices=html=>[...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>Number(m[1]));
  try {
    storeSnapshot(db,{source:'ldxp-goods',snapshotId:'recharge-method-ui',fetchedAt:now,products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[...Array.from({length:25},(_,i)=>offer('ios'+i,'ChatGPT Plus iOS代充 1个月',150+i)),offer('web','ChatGPT Plus 网页代充 1个月',110),offer('unknown','ChatGPT Plus 代充 1个月',90),offer('account','ChatGPT Plus 成品号 1个月',30)]}]});
    await new Promise(r=>app.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.address().port,route='/?family=chatgpt&product=chatgpt-plus&delivery=recharge';
    const html=await(await fetch(base+route)).text();
    assert.match(html,/aria-label="充值渠道"/); assert.match(html,/data-recharge-choice="ios"[^>]*>iOS<\/a>/);
    assert.match(html,/data-recharge-choice="other"[^>]*>其他地区<\/a>/); assert.doesNotMatch(html,/data-recharge-choice="unknown"/);
    for(const [method,expected] of [['other',[110]],['unknown',[90]]]) {
      const filtered=await(await fetch(base+route+'&recharge='+method)).text(); assert.deepEqual(prices(filtered),expected);
      if(method==='unknown')assert.match(filtered,/当前为旧链接中的待确认报价/);
      else assert.match(filtered,new RegExp('data-recharge-choice="'+method+'" aria-current="true"'));
    }
    const filtered=await(await fetch(base+route+'&recharge=ios&sort=price_desc&channel=unknown&currency=CNY')).text();
    assert.deepEqual(prices(filtered),Array.from({length:10},(_,i)=>174-i));
    const links=[...filtered.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).filter(h=>(h.startsWith('/?')||h.startsWith('/prices/'))).map(h=>new URL(h,base));
    const next=links.find(u=>u.searchParams.get('page')==='2');assert.ok(next);
    for(const [key,value] of Object.entries({recharge:'ios',delivery:'recharge',sort:'price_desc',channel:'unknown',currency:'CNY'})) assert.equal(next.searchParams.get(key),value);
    assert.deepEqual(prices(await(await fetch(next)).text()),Array.from({length:10},(_,i)=>164-i));const last=new URL(next);last.searchParams.set('page','3');assert.deepEqual(prices(await(await fetch(last)).text()),[154,153,152,151,150]);
    for(const choice of ['recharge=other','sort=price_asc']) {
      const [key,value]=choice.split('=');const link=key==='sort'?new URL(filtered.match(/data-sort-choice="price_asc"[^>]*href="([^"]+)"/)[1].replaceAll('&amp;','&'),base):links.find(u=>u.searchParams.get(key)===value);assert.ok(link);assert.equal(link.searchParams.has('page'),false);if(key==='sort')assert.equal(link.searchParams.has('sort'),false);
      if(key!=='recharge')assert.equal(link.searchParams.get('recharge'),'ios');
    }
    const allChannels=new URL(filtered.match(/href="([^"]+)">全部渠道<\/a>/)[1].replaceAll('&amp;','&'),base);assert.equal(allChannels.searchParams.has('channel'),false);assert.equal(allChannels.searchParams.has('page'),false);assert.equal(allChannels.searchParams.get('recharge'),'ios');
    const account=links.find(u=>u.searchParams.get('delivery')==='account');assert.equal(account.searchParams.has('recharge'),false);
    const accountHtml=await(await fetch(account)).text();assert.deepEqual(prices(accountHtml),[30]);assert.doesNotMatch(accountHtml,/aria-label="充值渠道"/);
    const home=await(await fetch(base+'/')).text();assert.doesNotMatch(home,/data-recharge-choice/);
    const invalid=await(await fetch(base+route+'&recharge=oops')).text();assert.match(invalid,/data-recharge-choice="all" aria-current="true"/);
  } finally { if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close(); }
});
