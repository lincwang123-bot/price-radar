import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {saveAdminSponsor} from '../lib/sponsor-service.mjs';
import {createApp} from '../lib/web.mjs';

test('cached homepage preserves visit and sponsor counts; quote edits wait for TTL and campaign edits invalidate immediately',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:'),analytics=openAnalytics(':memory:','homepage-cache-test-secret'.repeat(3));
 const date=new Date(),iso=date.toISOString();
 storeSnapshot(db,{source:'direct-shops',snapshotId:'home-fixture',fetchedAt:iso,products:[{productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[{offerId:'one',title:'ChatGPT Plus iOS 代充 1个月',price:129,status:'in_stock',currency:'CNY',url:'https://fixture.example/buy/1',capturedAt:iso}]}]});
 const localDate=offset=>new Date(date.getTime()+offset+8*3600000).toISOString().slice(0,16);
 saveAdminSponsor(db,analytics,{id:'home-cache-sponsor',version:'0',action:'approve',reviewed:'true',campaign_kind:'website',destination_url:'https://fixture.example/',placement:'home',label:'Fixture',headline:'Homepage sponsor fixture',tagline:'Independent visitors',theme:'blue',amount_cny:'0',note:'Test only',start_at:localDate(-86400000),end_at:localDate(86400000)},'test',date);
 const app=createApp({db,submissionsDb:privateDb,analytics,retentionOptions:{env:{},secret:'cache-only-test'.repeat(4)}});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=(path='/',extra={})=>fetch(base+path,{headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8',...extra}});
  const first=await get(),html=await first.text();assert.equal(first.status,200);assert.equal(first.headers.get('x-accel-expires'),'30');assert.equal(first.headers.get('x-price-radar-home-cache'),'MISS');assert.match(html,/Homepage sponsor fixture/);
  const hit=await get('/',{'cf-connecting-ip':'1.1.1.1'});assert.equal(hit.headers.get('x-price-radar-home-cache'),'HIT');assert.equal(await hit.text(),html);assert.equal(hit.headers.get('cache-control'),'no-store');assert.equal(hit.headers.get('set-cookie'),null);
  await new Promise(setImmediate);assert.equal(analytics.report().pv,2);assert.equal(analytics.report().uv,2);assert.equal(analytics.outbound.reportCampaigns(7)[0].impressions,2);
  const tracked=await get('/?utm_source=fixture&gclid=example');assert.equal(tracked.headers.get('x-price-radar-home-cache'),'HIT');assert.equal(tracked.headers.get('x-accel-expires'),'30');await tracked.text();
  const advertise=await get('/advertise');assert.equal(advertise.status,200);assert.equal(advertise.headers.get('x-price-radar-home-cache'),null);assert.equal(advertise.headers.get('x-price-radar-page-cache'),null);assert.equal(advertise.headers.get('cache-control'),'no-store');await advertise.text();
  const originalEnd=analytics.db.prepare('SELECT end_at FROM campaigns WHERE id=?').get('home-cache-sponsor').end_at;
  analytics.db.prepare('UPDATE campaigns SET end_at=? WHERE id=?').run(new Date(Date.now()+15000).toISOString(),'home-cache-sponsor');
  const boundary=await get();assert.equal(boundary.headers.get('x-accel-expires'),'0');await boundary.text();
  analytics.db.prepare('UPDATE campaigns SET end_at=? WHERE id=?').run(originalEnd,'home-cache-sponsor');
  const stable=await get();assert.equal(stable.headers.get('x-accel-expires'),'30');await stable.text();
  db.prepare('UPDATE offers SET price=141').run();const changed=await get();assert.equal(changed.headers.get('x-price-radar-home-cache'),'HIT','quote edits stay cached until the TTL');await changed.text();
  const detail=await get('/prices/chatgpt-plus');assert.match(await detail.text(),/data-price="141"/);assert.equal(detail.headers.get('x-price-radar-home-cache'),null);
  const priceHit=await get('/prices/chatgpt-plus?utm_source=fixture',{'cf-connecting-ip':'198.51.100.101'});assert.equal(priceHit.status,200);assert.equal(priceHit.headers.get('x-price-radar-page-cache'),'HIT');assert.equal(priceHit.headers.get('x-accel-expires'),'30');const priceHtml=await priceHit.text();
  await new Promise(setImmediate);assert.equal(analytics.outbound.report(7).filter(row=>row.placement==='product').reduce((n,row)=>n+row.impressions,0),2);
  const organicHref=priceHtml.match(/href="(\/go\?[^" ]*placement=product[^" ]*)"/)?.[1]?.replaceAll('&amp;','&');assert.ok(organicHref);
  const click=await fetch(base+organicHref+'&ack=1',{redirect:'manual',headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'198.51.100.101'}});assert.equal(click.status,302);await click.text();
  assert.equal(analytics.outbound.report(7).find(row=>row.placement==='product').clicks,1);
  assert.equal((await get()).headers.get('x-price-radar-home-cache'),'HIT');
  privateDb.exec('CREATE TABLE cache_revision_fixture(n INTEGER); INSERT INTO cache_revision_fixture VALUES(1)');assert.equal((await get()).headers.get('x-price-radar-home-cache'),'HIT','private database writes do not bust the public TTL');
  saveAdminSponsor(db,analytics,{id:'home-cache-sponsor',version:'1',action:'pause'},'test',new Date());const paused=await get();assert.equal(paused.headers.get('x-price-radar-home-cache'),'MISS');assert.doesNotMatch(await paused.text(),/Homepage sponsor fixture/);
  for(const cookie of ['airadar_reader=fixture','airadar_admin=fixture']){const privateResponse=await get('/',{cookie});assert.equal(privateResponse.headers.get('x-price-radar-home-cache'),null);await privateResponse.text();}
  const english=await get('/en/');assert.equal(english.headers.get('x-price-radar-home-cache'),'MISS');const enHtml=await english.text();const enHit=await get('/en/');assert.equal(enHit.headers.get('x-price-radar-home-cache'),'HIT');assert.equal(enHit.headers.get('content-language'),'en');assert.equal(await enHit.text(),enHtml);
 }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();await new Promise(setImmediate);analytics.close();privateDb.close();db.close();}
});
