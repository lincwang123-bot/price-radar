import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';
import {sponsorDirectory,sponsorEntries,sponsorOfferKey,saveAdminSponsor,sponsorItems} from '../lib/sponsor-service.mjs';
import {sponsorBlock} from '../lib/sponsor-ui.mjs';
import {sponsorAdminContent} from '../lib/sponsor-admin.mjs';
import {sponsoredContent} from '../lib/commerce-ui.mjs';
import {handleOutbound,resolveOutboundOffer} from '../lib/outbound.mjs';

const targets={
 'chatgpt-pro-5x':'https://sponsor.test/store/products/chatgpt-pro-5x',
 'chatgpt-pro-20x':'https://sponsor.test/store/products/chatgpt-pro-20x-ios',
};
const local=t=>new Date(t+8*3600000).toISOString().slice(0,16);
function fixture(){
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','scheduled-sponsors-fixture-secret-long-enough'),now=new Date();
 storeSnapshot(db,{source:'direct-shops',snapshotId:'available',products:Object.entries(targets).map(([id,url])=>({productId:id,name:id,platform:'ChatGPT',currency:'CNY',offers:[{offerId:id+'-sku',title:'ChatGPT Pro '+(id.endsWith('5x')?'5X':'20X')+' 订阅 1个月',storeName:'测试商家',price:100,currency:'CNY',status:'in_stock',stockCount:1,url}]}))});
 const fields={};
 for(const e of sponsorEntries(sponsorDirectory(db))){
  const id=e.product.product_id;
  fields[id]={id:'SP-'+id,version:'0',action:'approve',reviewed:'true',offer_key:sponsorOfferKey(e),placement:'product',label:'测试商家',headline:'订阅服务',tagline:'查看订阅方案',theme:'blue',amount_cny:'0',start_at:local(now.getTime()-60000),end_at:local(now.getTime()+86400000)};
  saveAdminSponsor(db,analytics,fields[id],'fixture',now);
 }
 return {db,analytics,now,fields,close(){analytics.close();db.close();}};
}
const campaign=(ctx,id='chatgpt-pro-20x')=>ctx.analytics.outbound.listCampaigns().find(c=>c.id==='SP-'+id);
const items=(ctx,id='chatgpt-pro-20x',date=ctx.now)=>sponsorItems([],ctx.analytics,{db:ctx.db,placement:'sponsored_product',pageKey:id,date});
function follow(ctx,href,method='GET',now=ctx.now){
 const res={headers:{},setHeader(k,v){this.headers[k]=v},end(v){this.body=v}};
 handleOutbound({method,headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'}},res,new URL(href,'https://airadar.test'),{...ctx,now:now.getTime()});return res;
}

test('approval pins each exact target; missing catalog, stale quotes and sold-out stock do not hide scheduled ads',()=>{
 const ctx=fixture();try{
  for(const [id,target]of Object.entries(targets))assert.equal(campaign(ctx,id).destination_url,target);
  ctx.db.prepare("UPDATE offers SET status='out_of_stock',stock_count=0").run();
  ctx.db.prepare("UPDATE snapshots SET fetched_at='2000-01-01T00:00:00Z',stale=1").run();
  for(const id of Object.keys(targets)){
   assert.equal(resolveOutboundOffer(ctx.db,{source:'direct-shops',snapshot:'available',product:id,offer:id+'-sku'}),null,'natural links stay unavailable');
   assert.equal(items(ctx,id).length,1);
  }
  ctx.db.exec('DELETE FROM offers; DELETE FROM products; DELETE FROM snapshots');
  for(const [id,target]of Object.entries(targets)){
   const [item]=items(ctx,id);assert.ok(item,'ad survives removal of all quotes');
   const html=sponsorBlock([item]);assert.doesNotMatch(html,/在售|报价时间|class="money"/);assert.match(html,/价格、库存与交付条件以商家页面为准/);
   assert.equal(follow(ctx,item.href+'&ack=1','HEAD').headers.Location,target);
   assert.equal(ctx.analytics.outbound.reportCampaigns(7,ctx.now).length,0,'HEAD verification does not fabricate clicks');
  }
  const [item]=items(ctx);assert.match(sponsoredContent([], [campaign(ctx)],{product:{source:'direct-shops',product_id:'chatgpt-pro-20x'}}),/sponsor-card/);
  assert.equal(follow(ctx,item.href).statusCode,200);assert.equal(follow(ctx,item.href+'&ack=1').headers.Location,targets['chatgpt-pro-20x']);
  assert.equal(ctx.analytics.outbound.reportCampaigns(7,ctx.now)[0].clicks,1);
 }finally{ctx.close();}
});

test('pinned ads preserve page boundaries, click identity, pause and exact expiry',()=>{
 const ctx=fixture();try{
  const c=campaign(ctx),[item]=items(ctx);
  assert.ok(item);
  for(const [key,value]of [['campaign','SP-chatgpt-pro-5x'],['product','chatgpt-pro-5x'],['offer','other'],['snapshot','campaign-999'],['source','ldxp-goods'],['placement','sponsored_home']]){
   const u=new URL(item.href,'https://airadar.test');u.searchParams.set(key,value);u.searchParams.set('ack','1');assert.equal(follow(ctx,u.pathname+u.search).statusCode,404,key);
  }
  assert.equal(follow(ctx,item.href+'&url=https://evil.test&ack=1').statusCode,400);
  const before=new Date(Date.parse(c.end_at)-1),end=new Date(c.end_at);
  assert.equal(items(ctx,'chatgpt-pro-20x',before).length,1);assert.equal(items(ctx,'chatgpt-pro-20x',end).length,0);
  assert.equal(follow(ctx,item.href+'&ack=1','HEAD',end).statusCode,404);
  assert.equal(sponsorItems([],ctx.analytics,{db:ctx.db,placement:'sponsored_home',pageKey:'home',date:ctx.now}).length,0);
  ctx.analytics.outbound.setCampaignStatus(c.id,'paused',{version:c.version,now:ctx.now});assert.equal(items(ctx).length,0);assert.equal(follow(ctx,item.href+'&ack=1').statusCode,404);
 }finally{ctx.close();}
});

test('an approved quote campaign remains editable when its quote is unavailable, without silently replacing its target',()=>{
 const ctx=fixture();try{
  const c=campaign(ctx);ctx.db.exec('DELETE FROM offers');
  const admin=sponsorAdminContent(ctx.db,ctx.analytics,new URL('https://airadar.test/admin/sponsors?id='+c.id),'csrf');
  assert.match(admin,/<option value="quote" selected>/);assert.match(admin,/已确认落地页/);
  assert.ok(admin.includes('value="'+ctx.fields[c.product_id].offer_key+'" selected'));
  const updated={...ctx.fields[c.product_id],version:String(c.version),headline:'更新后的文案'};
  saveAdminSponsor(ctx.db,ctx.analytics,updated,'fixture',ctx.now);
  assert.equal(campaign(ctx).destination_url,targets[c.product_id]);assert.equal(campaign(ctx).headline,'更新后的文案');
  assert.throws(()=>saveAdminSponsor(ctx.db,ctx.analytics,{...updated,id:'NEW',version:'0'},'fixture',ctx.now),/不可用/,'new approval still requires a verified quote');
 }finally{ctx.close();}
});

test('pinned targets reject foreign merchant domains, unsafe URLs and unsupported sources',()=>{
 const ctx=fixture();try{
  const c=campaign(ctx);
  for(const destination_url of ['https://other.test/product','http://sponsor.test','https://127.0.0.1','https://user:password@sponsor.test'])
   assert.throws(()=>ctx.analytics.outbound.saveCampaign({...c,destination_url},{approve:true,now:ctx.now}),/HTTPS|落地页/);
  assert.throws(()=>ctx.analytics.outbound.saveCampaign({...c,source:'unknown',destination_url:targets[c.product_id]},{approve:true,now:ctx.now}),/HTTPS|落地页/);
 }finally{ctx.close();}
});

test('pinning an existing campaign preserves metrics and same-day visitor deduplication',()=>{
 const ctx=fixture();try{
  const initial=campaign(ctx),a=ctx.analytics.outbound;
  ctx.analytics.db.prepare("UPDATE campaigns SET destination_url='' WHERE id=?").run(initial.id);
  const old=campaign(ctx),req={method:'GET',headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'}};
  a.recordImpression(req,old,ctx.now);a.recordVisible(req,old.id,a.viewToken(old,ctx.now),ctx.now);a.recordClick(req,old,{placement:old.placement,campaign:old},ctx.now);
  const before=a.reportCampaigns(7,ctx.now);
  assert.deepEqual([before[0].impressions,before[0].visible,before[0].clicks],[1,1,1]);
  a.saveCampaign({...old,destination_url:targets[old.product_id]},{approve:true,now:ctx.now});
  assert.deepEqual(a.reportCampaigns(7,ctx.now),before);
  const current=campaign(ctx),[item]=items(ctx);
  assert.equal(current.id,old.id);assert.equal(current.version,old.version+1);
  a.recordImpression(req,current,ctx.now);a.recordVisible(req,current.id,a.viewToken(current,ctx.now),ctx.now);follow(ctx,item.href+'&ack=1');
  assert.deepEqual(a.reportCampaigns(7,ctx.now),before,'campaign version and snapshot changes must not double count');
 }finally{ctx.close();}
});

test('canonical product pages keep their own ads during a complete catalog outage and keep them after pagination',async()=>{
 const ctx=fixture();let app;try{
  app=createApp({db:ctx.db,analytics:ctx.analytics});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  ctx.db.exec('DELETE FROM offers; DELETE FROM products; DELETE FROM snapshots');
  for(const id of Object.keys(targets))for(const suffix of ['', '?page=2']){
   const response=await fetch('http://127.0.0.1:'+app.address().port+'/prices/'+id+suffix);
   const html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('data-sponsor-id="SP-'+id+'"'));assert.equal((html.match(/class="sponsor-card"/g)||[]).length,1);
   assert.doesNotMatch(html,/data-directory-quote data-price=/);
  }
 }finally{if(app?.listening)await new Promise(r=>app.close(r));ctx.close();}
});
