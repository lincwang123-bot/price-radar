import test from 'node:test';
import assert from 'node:assert/strict';
import {collectorFor,directTargets} from '../collectors/direct/registry.mjs';
import {offerSpec} from '../lib/offer-spec.mjs';

const target=directTargets(['zhanghao66'])[0];
const name='GPT GO 官方直充月卡【真实付费开通！保证正规充值】';
const option='卡充【不可覆盖】';
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const row={id:152,name,price:34,user_price:34,stock:'充足',stock_state:3,category:{name:'GPT'}};
const detail=(category={[option]:'36','iOS充【可覆盖】':'39'})=>`<script>setVar("_var_item",${JSON.stringify({id:152,name,config:{category}})});</script>`;
function mock({html=detail(),value='36.00',items=[row]}={}) {
  const requests=[];
  return {requests,fetchImpl:async (url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/commodity'))return json({data:items,total:items.length});
    if(String(url).endsWith('/valuation'))return json({code:200,data:{price:value}});
    return new Response(html,{headers:{'content-type':'text/html'}});
  }};
}

test('账号66 Go quotes the named retail channel instead of its stale catalogue base price',async()=>{
  const client=mock({items:[row,{id:260,name:'ChatGPT Plus 月卡',price:130,stock:1}]});
  const offers=await collectorFor(target)(target,{fetchImpl:client.fetchImpl,sleep:async()=>{}});
  assert.equal(target.kind,'kami');
  assert.equal(offers[0].price,36);
  assert.equal(offers[0].listedPrice,36);
  assert.match(offers[0].title,/卡充【不可覆盖】/);
  assert.equal(offers[0].extra.catalogPrice,34);
  assert.equal(offers[0].extra.selectedCategory,option);
  assert.equal(offerSpec(offers[0]).key.split(':')[0],'1m');
  assert.equal(offers[1].price,130);
  assert.deepEqual(client.requests.map(r=>new URL(r.url).pathname),['/user/api/index/commodity','/item/152','/user/api/index/valuation']);
  const valuation=client.requests.at(-1);
  assert.equal(valuation.init.method,'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(valuation.init.body)),{item_id:'152',num:'1',race:option});
});

test('账号66 cannot silently revert to the catalogue price when the chosen channel is missing or disagrees',async()=>{
  for(const settings of [{value:'39.00'},{html:detail({'iOS充【可覆盖】':'39'})},{html:detail().replace('"id":152','"id":999')},{html:'<h1>Login</h1>'}]) {
    const client=mock(settings);
    await assert.rejects(collectorFor(target)(target,{fetchImpl:client.fetchImpl,sleep:async()=>{}}),/渠道价格/);
  }
});

test('账号66 does not probe removed or sold-out Go products',async()=>{
  for(const items of [[],[{...row,stock:0}]]) {
    const client=mock({items});
    await collectorFor(target)(target,{fetchImpl:client.fetchImpl,sleep:async()=>{}});
    assert.equal(client.requests.length,1);
  }
});
