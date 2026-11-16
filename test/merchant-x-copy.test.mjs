import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {claimContent} from '../lib/merchant-x-ui.mjs';

async function renderedCopy(){
 const nodes=new Map(),get=key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',hidden:false,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},focus(){},querySelector:s=>get(key+' '+s)});return nodes.get(key);};
 get('[data-x-start]').elements={shopId:{options:[],value:''}};
 get('[data-x-submit]').elements={proofType:get('proofType'),proofUrl:{required:true}};
 const token='b'.repeat(64),row={id:'a'.repeat(32),shopId:'c'.repeat(24),shopName:'合成店铺',shopUrl:'https://example.com/shop/'+('long-'.repeat(30)),xHandle:'test_owner_1234',code:'AIR-1234567890',status:'draft',expiresAt:new Date(Date.now()+86400000).toISOString()};let copied='';
 runInNewContext(readFileSync(new URL('../assets/merchant-x.js',import.meta.url),'utf8'),{
  document:{querySelector:()=>({querySelector:get})},location:{origin:'https://airadar.vip',hash:'#'+new URLSearchParams({id:row.id,token}),search:''},history:{replaceState(){}},localStorage:{getItem:()=>null,setItem(){}},URLSearchParams,Date,
  navigator:{clipboard:{writeText:async text=>{copied=text;}}},fetch:async()=>({ok:true,json:async()=>row})
 });
 await new Promise(setImmediate);return {get,row,token,copy:async()=>{await get('[data-x-copy-proof]').handlers.click();return copied;}};
}
test('X claim template promotes Airadar without pretending the application is already approved',async()=>{
 const f=await renderedCopy(),text=f.get('[data-x-proof-text]').value;
 assert.match(text,/找 AI 订阅、比较多家店铺报价，就上 Airadar/);
 assert.ok(text.endsWith('\nhttps://airadar.vip'));
 for(const value of [f.row.shopUrl,f.row.code,'@'+f.row.xHandle])assert.ok(text.includes(value),value);
 assert.doesNotMatch(text,/我的店铺页|https:\/\/airadar\.vip\/shop\?id=/);
 assert.equal(f.get('[data-x-shop]').href,'/shop?id='+f.row.shopId);
 assert.equal(new URL(f.get('[data-x-share]').href).searchParams.get('url'),'https://airadar.vip/shop?id='+f.row.shopId);
 assert.doesNotMatch(text,/已认证|已通过|官方认证|交易安全|信誉保证/);
 assert.ok(!text.includes(f.token));assert.ok(!text.includes('/claim-shop#'));
 const intent=new URL(f.get('[data-x-intent]').href);assert.equal(intent.origin,'https://twitter.com');assert.equal(intent.pathname,'/intent/tweet');assert.equal(intent.searchParams.get('text'),text);
 assert.equal(await f.copy(),text);
 // Conservative bound for this fixed plain CJK/ASCII template, not a general
 // twitter-text replacement. X counts detected URLs as 23 characters.
 const weighted=[...text.replace(/https:\/\/\S+/g,'x'.repeat(23))].reduce((n,c)=>n+(c.codePointAt(0)<128?1:2),0);assert.ok(weighted<=280,weighted);
});
test('claim page says promotion is editable and does not change approval requirements',()=>{
 const html=claimContent('csrf',[]);assert.match(html,/宣传内容不影响审核/);assert.match(html,/可在 X 中修改/);assert.match(html,/本站不会代发帖子/);assert.match(html,/option value="profile"/);
});
