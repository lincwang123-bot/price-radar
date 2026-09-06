import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {outboundHref,handleOutbound,safeMerchantUrl,resolveOutboundOffer} from '../lib/outbound.mjs';
import {merchantSummary} from '../lib/admin-analytics.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backupSubmissions} from '../lib/backup.mjs';
const date=new Date('2026-09-06T08:00:00Z');
function fixture(){const db=openDb(':memory:'),analytics=openAnalytics(':memory:','fixture-only-analytics-secret-32-chars',{now:date});storeSnapshot(db,{source:'fixture',snapshotId:'s1',fetchedAt:date.toISOString(),products:[{productId:'p',name:'fixture',offers:[{offerId:'o',sourceId:'merchant',price:10,currency:'CNY',status:'in_stock',url:'https://shop.example/buy'}]}]});return {db,analytics};}
const request=(over={})=>({method:'GET',url:'/go',headers:{'user-agent':'Mozilla/5.0 Chrome/120','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'},...over});
const offer={source:'fixture',snapshot_id:'s1',product_id:'p',offer_id:'o'};
test('existing analytics online backup includes campaigns and outbound tables without a fourth database',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'radar-commerce-backup-')),file=path.join(root,'analytics.sqlite'),directory=path.join(root,'backup');
 const a=openAnalytics(file,'fixture-only-analytics-secret-32-chars');
 try{
  a.outbound.saveCampaign({id:'fixture',merchant_id:'domain:shop.example',source:'fixture',product_id:'p',offer_id:'o',label:'fixture only',placement:'sponsored_product',start_at:'2026-09-01',end_at:'2026-10-01'});
  const b=await backupSubmissions(file,directory,{kind:'analytics'}),restored=new DatabaseSync(path.join(directory,b.file),{readOnly:true});
  try{assert.equal(restored.prepare('SELECT COUNT(*) n FROM campaigns').get().n,1);assert.equal(restored.prepare('SELECT COUNT(*) n FROM merchant_outbound_events').get().n,0);assert.equal(restored.prepare('PRAGMA quick_check').get().quick_check,'ok');}finally{restored.close();}
 }finally{a.close();rmSync(root,{recursive:true,force:true});}
});
test('merchant schema upgrade preserves pre-existing analytics totals and visitor rows',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'radar-commerce-upgrade-')),file=path.join(root,'analytics.sqlite');let a;
 try{
  const old=new DatabaseSync(file);old.exec("CREATE TABLE analytics_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE analytics_days(day TEXT PRIMARY KEY,pv INTEGER NOT NULL DEFAULT 0,uv INTEGER NOT NULL DEFAULT 0);CREATE TABLE analytics_visitors(day TEXT NOT NULL,visitor TEXT NOT NULL,PRIMARY KEY(day,visitor));INSERT INTO analytics_meta VALUES('started_at','2026-09-06T00:00:00Z');INSERT INTO analytics_days VALUES('2026-09-06',42,1);INSERT INTO analytics_visitors VALUES('2026-09-06','fixture-hash')");old.close();
  a=openAnalytics(file,'fixture-only-analytics-secret-32-chars',{now:date});assert.equal(a.report(7,date).pv,42);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM analytics_visitors').get().n,1);assert.equal(a.outbound.listCampaigns().length,0);
 }finally{a?.close();rmSync(root,{recursive:true,force:true});}
});
function follow(context,href=outboundHref(offer),req=request()){const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;}};handleOutbound(req,res,new URL(href+(href.includes('ack=')?'':'&ack=1'),'https://airadar.test'),{...context,now:date.getTime()});return res;}
test('redirect resolves exact current quote, rejects unsafe destinations and forged query fields',()=>{
 const ctx=fixture();try{
  const confirmation={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
  handleOutbound(request(),confirmation,new URL(outboundHref(offer),'https://airadar.test'),{...ctx,now:date.getTime()});
  assert.equal(confirmation.statusCode,200);assert.match(confirmation.body,/继续前往/);assert.match(confirmation.body,/ack=1/);assert.equal(ctx.analytics.outbound.report(30,date).length,0);
  assert.equal(follow(ctx).headers.Location,'https://shop.example/buy');
  assert.equal(follow(ctx,outboundHref({...offer,snapshot_id:'old'})).statusCode,404);
  assert.equal(follow(ctx,outboundHref(offer)+'&url=https://evil.example').statusCode,400);
  assert.equal(follow(ctx,outboundHref(offer)+'&offer=other').statusCode,400);
  assert.equal(follow(ctx,outboundHref(offer)+'&campaign=forged').statusCode,404);
  for(const target of ['http://shop.example','https://u:p@shop.example','https://localhost','https://127.1','https://2130706433','https://10.1.1.1','https://192.168.1.1','https://[::1]','https://[::ffff:127.0.0.1]','javascript:alert(1)']){
   assert.equal(safeMerchantUrl(target),null,target);ctx.db.prepare('UPDATE offers SET url=?').run(target);assert.equal(follow(ctx).statusCode,404);
  }
 }finally{ctx.analytics.close();ctx.db.close();}
});
test('outbound daily identities rotate and per-minute rates are bounded',()=>{
 const ctx=fixture();try{
  const row={source:'fixture',product_id:'p',offer_id:'o',merchant_id:'domain:shop.example'};
  for(let i=0;i<35;i++)ctx.analytics.outbound.recordClick(request(),{...row,offer_id:'o'+i},{placement:'product'},date);
  assert.equal(ctx.analytics.outbound.report(30,date)[0].clicks,30);
  const before=ctx.analytics.db.prepare('SELECT visitor FROM merchant_outbound_events LIMIT 1').get().visitor;
  const tomorrow=new Date(date.getTime()+86400000);ctx.analytics.outbound.recordClick(request(),row,{placement:'product'},tomorrow);
  const after=ctx.analytics.db.prepare('SELECT visitor FROM merchant_outbound_events WHERE day=?').get('2026-09-07').visitor;assert.notEqual(before,after);
 }finally{ctx.analytics.close();ctx.db.close();}
});
test('malformed DNS labels and stale merchant identity cannot redirect or impersonate a Sponsor',()=>{
 const ctx=fixture();try{
  for(const url of ['https://foo..example','https://bad_host.example','https://-bad.example','https://bad-.example'])assert.equal(safeMerchantUrl(url),null,url);
  ctx.db.prepare("UPDATE offers SET merchant_id='domain:other.example'").run();assert.equal(follow(ctx).statusCode,404);
 }finally{ctx.analytics.close();ctx.db.close();}
});
test('current quote rejects stock, expiry, no-warranty and stale-snapshot bypasses',()=>{
 const ctx=fixture();try{
  for(const [column,value] of [['status','sold_out'],['stock_count',0],['expires_at','2026-09-06T07:00:00Z'],['title','ChatGPT 无质保 无售后']]){
   ctx.db.prepare(`UPDATE offers SET ${column}=?`).run(value);assert.equal(follow(ctx).statusCode,404,column);
   ctx.db.prepare("UPDATE offers SET status='in_stock',stock_count=NULL,expires_at=NULL,title=NULL").run();
  }
  ctx.db.prepare("UPDATE snapshots SET fetched_at='2026-09-01T00:00:00Z'").run();assert.equal(follow(ctx).statusCode,404);
 }finally{ctx.analytics.close();ctx.db.close();}
});
test('shared-platform shops redirect with separate quote keys but cannot sponsor or open aggregator targets',()=>{
 const ctx=fixture();try{
  ctx.db.prepare("UPDATE offers SET url='https://16688.com.cn/shop/a',merchant_id='domain:16688.com.cn'").run();
  ctx.db.prepare("INSERT INTO offers(source,snapshot_id,product_id,offer_id,price,currency,status,url,merchant_id) VALUES('fixture','s1','p','o2',12,'CNY','in_stock','https://16688.com.cn/shop/b','domain:16688.com.cn')").run();
  assert.equal(follow(ctx).statusCode,302);assert.equal(follow(ctx,outboundHref({...offer,offer_id:'o2'})).statusCode,302);
  const rows=ctx.analytics.outbound.report(30,date);assert.equal(rows.length,2);assert.notEqual(rows[0].merchant_id,rows[1].merchant_id);assert.ok(rows.every(r=>r.merchant_id.startsWith('unresolved-quote:')));
  assert.match(merchantSummary(ctx.analytics),/未归属店铺（按报价隔离）/);
  for(const url of ['https://wzyp.cn/shop/a','https://www.16688.com.cn/shop/a','https://16688.com.cn./shop/a']){ctx.db.prepare('UPDATE offers SET url=? WHERE offer_id=?').run(url,'o');assert.equal(follow(ctx).statusCode,302);assert.match(resolveOutboundOffer(ctx.db,{source:'fixture',snapshot:'s1',product:'p',offer:'o'},date.getTime()).merchant_id,/^unresolved-quote:/);}
  assert.ok(ctx.analytics.outbound.report(30,date).every(r=>r.merchant_id.startsWith('unresolved-quote:')));
  const c={id:'shared',merchant_id:'domain:16688.com.cn',source:'fixture',product_id:'p',offer_id:'o',label:'fixture',placement:'sponsored_product',start_at:'2026-09-01T00:00:00Z',end_at:'2026-10-01T00:00:00Z'};
  assert.throws(()=>ctx.analytics.outbound.saveCampaign(c,{approve:true,now:date}),/requires verified/);
  assert.throws(()=>ctx.analytics.outbound.saveCampaign({...c,merchant_id:rows[0].merchant_id},{approve:true,now:date}),/requires verified/);
  ctx.analytics.db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(c.id,c.merchant_id,c.source,c.product_id,c.offer_id,c.label,c.placement,c.start_at,c.end_at,'approved',date.toISOString());
  assert.equal(ctx.analytics.outbound.campaignsFor({source:'fixture',productId:'p'},date).length,0);
  assert.equal(follow(ctx,outboundHref(offer,{}, {placement:'sponsored_product',campaignId:'shared'})).statusCode,404);
  for(const url of ['https://data.priceai.cc/item','https://goaihop.com/item','https://cardnav.xyz/item']){ctx.db.prepare('UPDATE offers SET url=? WHERE offer_id=?').run(url,'o');assert.equal(follow(ctx).statusCode,404);}
 }finally{ctx.analytics.close();ctx.db.close();}
});
test('clicks dedupe per day, ignore forged proxy/HEAD/bots/admin/prefetch and preserve only hashes',()=>{
 const ctx=fixture();try{
  for(const req of [request({method:'HEAD'}),request({socket:{remoteAddress:'8.8.4.4'}}),request({headers:{'user-agent':'curl','cf-connecting-ip':'8.8.8.8'}}),request({headers:{...request().headers,purpose:'prefetch'}}),request({headers:{...request().headers,cookie:'airadar_admin=fixture'}})])assert.equal(follow(ctx,undefined,req).statusCode,302);
  assert.equal(ctx.analytics.outbound.report(30,date).length,0);
  follow(ctx);follow(ctx);const rows=ctx.analytics.outbound.report(30,date);assert.equal(rows[0].clicks,1);
  const stored=ctx.analytics.db.prepare('SELECT * FROM merchant_outbound_events').get();assert.equal(stored.visitor.length,64);assert.ok(!JSON.stringify(stored).includes('8.8.8.8'));assert.ok(!JSON.stringify(stored).includes('Mozilla'));
  ctx.analytics.outbound.purge(new Date('2026-10-08'));assert.equal(ctx.analytics.db.prepare('SELECT COUNT(*) n FROM merchant_outbound_events').get().n,0);assert.equal(ctx.analytics.db.prepare('SELECT SUM(clicks) n FROM merchant_outbound_days').get().n,1);
 }finally{ctx.analytics.close();ctx.db.close();}
});
test('Sponsor requires explicit review, relevance, dates and server-derived identity; metrics failure still redirects',()=>{
 const ctx=fixture(),c={id:'c',merchant_id:'domain:shop.example',source:'fixture',product_id:'p',offer_id:'o',label:'<script>fixture</script>',placement:'sponsored_product',start_at:'2026-09-01T00:00:00Z',end_at:'2026-10-01T00:00:00Z'};
 try{
  ctx.analytics.outbound.saveCampaign(c,{now:date});assert.equal(ctx.analytics.outbound.campaignsFor({source:'fixture',productId:'p'},date).length,0);
  const href=outboundHref(offer,{}, {placement:'sponsored_product',campaignId:'c'});assert.equal(follow(ctx,href).statusCode,404);
  ctx.analytics.outbound.saveCampaign(c,{approve:true,now:date});assert.equal(ctx.analytics.outbound.campaignsFor({source:'fixture',productId:'wrong'},date).length,0);
  assert.equal(follow(ctx,href.replace('placement=sponsored_product','placement=home')).statusCode,404);
  assert.equal(follow(ctx,href.replace('campaign=c','campaign=forged')).statusCode,404);
  assert.equal(follow(ctx,href.replace('placement=sponsored_product','placement=unknown')).statusCode,400);
  assert.equal(ctx.analytics.outbound.report(30,date).length,0);
  ctx.analytics.outbound.recordImpression(request(),c,date);ctx.analytics.outbound.recordImpression(request(),c,date);assert.equal(follow(ctx,href).statusCode,302);
  const row=ctx.analytics.outbound.report(30,date)[0];assert.equal(row.clicks,1);assert.equal(row.impressions,1);assert.equal(row.ctr,1);
  assert.ok(!merchantSummary(ctx.analytics).includes('<script>fixture</script>'));assert.ok(merchantSummary(ctx.analytics).includes('&lt;script&gt;'));
  ctx.analytics.outbound.saveCampaign({...c,end_at:'2026-09-05T00:00:00Z'},{approve:true,now:date});assert.equal(follow(ctx,href).statusCode,404);
  ctx.analytics.outbound.saveCampaign({...c,merchant_id:'domain:other.example'},{approve:true,now:date});assert.equal(follow(ctx,href).statusCode,404);
  ctx.analytics.outbound.recordClick=()=>{throw new Error('fixture metrics failure');};assert.equal(follow(ctx).statusCode,302);
 }finally{ctx.analytics.close();ctx.db.close();}
});
