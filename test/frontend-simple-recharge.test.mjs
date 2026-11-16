import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('buying controls use short recharge choices, not full SKU descriptions',async()=>{
  const db=openDb(':memory:'),app=createApp({db});
  const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',stockCount:1,status:'in_stock',url:'https://'+id+'.example.com/product'});
  const prices=html=>[...html.matchAll(/data-directory-quote data-price="([^"]+)"/g)].map(m=>Number(m[1]));
  try{
    storeSnapshot(db,{source:'direct-shops',snapshotId:'simple-recharge',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[
      offer('ios','ChatGPT Plus iOS代充 1个月 仅限续费 质保30天',150),
      offer('web','ChatGPT Plus 网页代充 1个月 仅限续费 质保30天',110),
      offer('unknown','ChatGPT Plus 代充 1个月 仅限续费 质保30天',90),
      offer('account','ChatGPT Plus 成品号 1个月',30),
    ]}]});
    await new Promise(r=>app.listen(0,'127.0.0.1',r));
    const origin='http://127.0.0.1:'+app.address().port;
    const get=async path=>{const res=await fetch(new URL(path,origin));assert.equal(res.status,200);return res.text();};
    for(const path of ['/prices/chatgpt-plus','/prices/chatgpt-plus?delivery=recharge']){
      const html=await get(path),section=html.match(/<section[^>]*aria-label="充值类型"[^>]*>[\s\S]*?<\/section>/)?.[0];
      assert.ok(section);
      assert.deepEqual([...section.matchAll(/data-recharge-choice="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>[m[1],m[2]]),[['all','全部'],['ios','iOS'],['other','其他地区']]);
      assert.doesNotMatch(section,/续费|质保30天|更多明确规格|完整规格/);
      assert.equal((html.match(/data-recharge-choice="ios"/g)||[]).length,1);
    }
    const html=await get('/prices/chatgpt-plus?delivery=recharge&purchase=renewal&sort=price_desc&channel=unknown&currency=CNY&spec=stale-spec&page=9');
    const links=[...html.matchAll(/data-recharge-choice="([^"]+)"[^>]*href="([^"]+)"/g)].map(m=>[m[1],new URL(m[2].replaceAll('&amp;','&'),origin)]);
    for(const [kind,url] of links){
      assert.equal(url.searchParams.has('spec'),false);assert.equal(url.searchParams.has('page'),false);
      for(const [key,value] of Object.entries({purchase:'renewal',sort:'price_desc',channel:'unknown',currency:'CNY'}))assert.equal(url.searchParams.get(key),value);
      const selected=await get(url);
      assert.deepEqual(prices(selected),kind==='ios'?[150]:kind==='other'?[110]:[150,110,90]);
      assert.match(selected,new RegExp('data-recharge-choice="'+kind+'" aria-current="true"'));
    }
    const account=await get('/prices/chatgpt-plus?delivery=account');
    assert.doesNotMatch(account,/data-recharge-choice|选择适合你的完整规格/);
    assert.deepEqual(prices(account),[30]);
  }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
