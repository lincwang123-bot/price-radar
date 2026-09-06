import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAikaShop,collectAikaShop} from '../collectors/direct/aikashop.mjs';
import {groupDirectOffers} from '../collectors/direct/catalog.mjs';
const target={id:'aikashop',origin:'https://aikashop.com'};
test('明确SKU按月季年独立解析，未知库存不得冒充可售',()=>{
 const rows=['Pro 月卡','Pro 季卡','Pro 年卡','Premier 月卡','Premier 季卡','Premier 年卡'].map((name,i)=>({name,cny:50+i,usdt:7}));
 const html=`<script type="application/json" id="plansData" data-product="Suno">${JSON.stringify(rows)}</script>`;
 const offers=parseAikaShop(html,target);assert.equal(offers.length,6);assert.ok(offers.every(o=>o.status==='unknown'));assert.equal(groupDirectOffers(offers).length,6);assert.ok(groupDirectOffers(offers).every(p=>p.lowestPrice===null));
 assert.throws(()=>parseAikaShop(html,{...target,origin:'https://other.example'}),/未登记/);
});
test('WAF403立即停止，robots禁止则不请求商品页',async()=>{
 for(const [status,body] of [[403,'blocked'],[200,'User-agent: *\nDisallow: /']]){let calls=0;await assert.rejects(collectAikaShop(target,{fetchImpl:async()=>{calls++;return new Response(body,{status});}}));assert.equal(calls,1);}
});
