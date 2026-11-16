import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initMerchantAnalytics} from '../lib/merchant-analytics.mjs';
import {openDb} from '../lib/db.mjs';
import {sponsorAdminContent,exportSponsors} from '../lib/sponsor-admin.mjs';

const dayOf=date=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
function fixture(run){
 const db=new DatabaseSync(':memory:'),market=openDb(':memory:');
 try{const outbound=initMerchantAnalytics(db,'test-sponsor-report-secret');return run({db,market,outbound});}
 finally{market.close();db.close();}
}
function add(db,{day,id='',product='test-product',clicks=0,impressions=0,visible=0}){
 db.prepare('INSERT INTO merchant_outbound_days(day,merchant_id,product_id,placement,campaign_id,clicks,impressions,visible) VALUES(?,?,?,?,?,?,?,?)')
  .run(day,'domain:test.test',product,id?'sponsored_product':'product',id,clicks,impressions,visible);
}
function save(outbound,id,now){
 outbound.saveCampaign({id,merchant_id:'domain:test.test',source:'direct-shops',product_id:id,offer_id:id,label:id,
  placement:'sponsored_product',page_key:id,start_at:new Date(now.getTime()-86400000).toISOString(),end_at:new Date(now.getTime()+86400000).toISOString()});
}

test('sponsor reporting includes all campaigns beyond the mixed traffic top 200',()=>fixture(({db,outbound})=>{
 const now=new Date('2026-09-15T15:00:00Z'),day=dayOf(now);
 for(let i=0;i<201;i++)add(db,{day,product:'organic-'+i,clicks:99});
 for(let i=0;i<205;i++)add(db,{day,id:'sponsor-'+i,clicks:i===204?0:1,impressions:20,visible:10});
 const general=outbound.report(30,now);
 assert.equal(general.length,200);assert.ok(general.every(row=>row.campaign_id===''));
 const sponsored=outbound.reportCampaigns(30,now);
 assert.equal(sponsored.length,205);assert.ok(sponsored.every(row=>row.campaign_id));
 assert.deepEqual({...sponsored.find(row=>row.campaign_id==='sponsor-204')},{merchant_id:'domain:test.test',product_id:'test-product',placement:'sponsored_product',campaign_id:'sponsor-204',clicks:0,impressions:20,visible:10,ctr:0});
}));

test('sponsor reports aggregate days with Beijing 7 and 30 day boundaries',()=>fixture(({db,outbound})=>{
 const now=new Date('2026-09-15T16:30:00Z'); // Beijing September 16.
 for(const [day,clicks] of [['2026-08-17',128],['2026-08-18',1],['2026-09-09',2],['2026-09-10',4],['2026-09-16',8],['2026-09-17',64]])
  add(db,{day,id:'boundary',clicks,impressions:clicks*10,visible:clicks*2});
 for(const [days,total] of [[7,12],[30,15]]){
  const [row]=outbound.reportCampaigns(days,now);
  assert.equal(row.clicks,total);assert.equal(row.impressions,total*10);assert.equal(row.visible,total*2);
 }
}));

test('admin table and CSV show low traffic sponsor totals even when natural traffic fills the report',()=>fixture(({db,market,outbound})=>{
 const now=new Date(),day=dayOf(now);
 for(let i=0;i<201;i++)add(db,{day,product:'organic-'+i,clicks:99});
 for(const id of ['SP-LOW-5X','SP-LOW-20X','SP-NO-EVENTS'])save(outbound,id,now);
 add(db,{day,id:'SP-LOW-5X',clicks:3,impressions:117,visible:55});
 add(db,{day,id:'SP-LOW-20X',clicks:4,impressions:135,visible:64});
 const analytics={outbound},html=sponsorAdminContent(market,analytics,new URL('https://airadar.test/admin/sponsors'),'test-csrf');
 for(const [id,values] of [['SP-LOW-5X',[117,55,3]],['SP-LOW-20X',[135,64,4]],['SP-NO-EVENTS',[0,0,0]]]){
  const row=html.match(/<tr>[\s\S]*?<\/tr>/g).find(row=>row.includes('<small>'+id+'</small>'));
  const cells=[...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
  assert.deepEqual(cells.slice(3,6),values.map(String),id+' admin metrics');
 }
 for(const days of [7,30]){
  let csv='';exportSponsors({setHeader(){},end(value){csv=value;}},analytics,days);
  for(const [id,values] of [['SP-LOW-5X',[117,55,3]],['SP-LOW-20X',[135,64,4]],['SP-NO-EVENTS',[0,0,0]]]){
   const row=csv.split('\r\n').find(row=>row.includes('"'+id+'"'));
   assert.deepEqual(row.split(',').slice(5,8),values.map(value=>'"'+value+'"'),id+' CSV '+days+' days');
  }
 }
}));
