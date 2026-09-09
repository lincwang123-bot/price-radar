import test from 'node:test';import assert from 'node:assert/strict';
import {openAnalytics} from '../lib/analytics.mjs';
import {sponsorQuote} from '../lib/sponsor-plans.mjs';
const date=new Date('2026-09-09T10:00:00Z');
const campaign=(id,extra={})=>({id,merchant_id:'domain:'+id+'.test',source:'direct-shops',product_id:'chatgpt-plus-recharge',offer_id:id,label:id,placement:'sponsored_product',page_key:'chatgpt-plus',start_at:'2026-09-09T00:00:00Z',end_at:'2026-09-16T00:00:00Z',...extra});
test('published sponsor rates are computed by server, by placement and duration',()=>{assert.equal(sponsorQuote('product','7d').amount,99);assert.equal(sponsorQuote('category','14d').amount,359);assert.equal(sponsorQuote('home','28d').amount,999);assert.equal(sponsorQuote('site','7d'),null)});
test('four simultaneous sponsors per page, duplicate merchants and stale edits rejected',()=>{
 const a=openAnalytics(':memory:','test-sponsor-capacity-secret-long-enough');try{
 for(let i=0;i<4;i++)a.outbound.saveCampaign(campaign('s'+i),{approve:true,now:date});
 assert.throws(()=>a.outbound.saveCampaign(campaign('fifth'),{approve:true,now:date}),/4/);
 assert.throws(()=>a.outbound.saveCampaign(campaign('same',{merchant_id:'domain:s0.test'}),{approve:true,now:date}),/商家/);
 assert.equal(a.outbound.saveCampaign(campaign('other',{page_key:'claude-pro'}),{approve:true,now:date}).status,'approved');
 assert.throws(()=>a.outbound.saveCampaign(campaign('s0',{version:0}),{approve:true,now:date}),/更新/);
 a.outbound.setCampaignStatus('s0','paused',{version:1,now:date,actor:'fixture'});
 assert.equal(a.outbound.saveCampaign(campaign('fifth'),{approve:true,now:date}).status,'approved');
 assert.equal(a.outbound.listCampaigns().filter(c=>c.id==='fifth').length,1);
 }finally{a.close()}
});
test('capacity checks simultaneous occupancy, allows nonoverlapping bookings and other placements',()=>{
 const a=openAnalytics(':memory:','test-sponsor-capacity-secret-long-enough');try{
 for(let i=0;i<3;i++){a.outbound.saveCampaign(campaign('early'+i,{end_at:'2026-09-12T00:00:00Z'}),{approve:true,now:date});a.outbound.saveCampaign(campaign('late'+i,{start_at:'2026-09-12T00:00:00Z'}),{approve:true,now:date})}
 assert.equal(a.outbound.saveCampaign(campaign('whole'),{approve:true,now:date}).status,'approved');
 assert.equal(a.outbound.saveCampaign(campaign('home',{placement:'sponsored_home',page_key:'home'}),{approve:true,now:date}).status,'approved');
 }finally{a.close()}
});
test('viewability requires signed active campaign and deduplicates daily visitor estimates',()=>{
 const a=openAnalytics(':memory:','test-sponsor-visibility-secret-long-enough');try{
 a.outbound.saveCampaign(campaign('visible'),{approve:true,now:date});const c=a.outbound.listCampaigns()[0];
 const req={method:'POST',headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'}};
 assert.equal(a.outbound.recordVisible(req,c.id,'forged',date),false);const token=a.outbound.viewToken(c,date);
 assert.equal(a.outbound.recordVisible(req,c.id,token,date),true);assert.equal(a.outbound.recordVisible(req,c.id,token,date),false);
 assert.equal(a.outbound.report(7,date)[0].visible,1);
 a.outbound.setCampaignStatus(c.id,'paused',{version:1,now:date});assert.equal(a.outbound.recordVisible(req,c.id,token,date),false);
 }finally{a.close()}
});
