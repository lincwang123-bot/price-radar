import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openSubmissionsDb,listSubmissions} from '../lib/submissions.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';
import {SPONSOR_RATE_VERSION} from '../lib/sponsor-plans.mjs';
import {hashAdminPassword} from '../lib/admin.mjs';
import {sponsorDirectory,sponsorEntries,sponsorOfferKey,saveAdminSponsor} from '../lib/sponsor-service.mjs';

async function fixture(run){
 const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:'),analytics=openAnalytics(':memory:','sponsor-route-fixture-secret-over-32-characters');
 const password='only-used-in-this-fixture-1234',origin='https://airadar.test';
 storeSnapshot(db,{source:'direct-shops',snapshotId:'sponsor-fixture',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[89,99,109,119,129].map((price,i)=>({offerId:'merchant'+i,title:'ChatGPT Plus 代充 1个月',storeName:'虚构店铺 '+i,price,currency:'CNY',status:'in_stock',stockCount:1,url:'https://sponsor'+i+'.test/product/1'}))}]});
 const app=createApp({db,submissionsDb,analytics,adminOptions:{username:'owner',passwordHash:await hashAdminPassword(password),origin}});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const get=(path,headers={})=>fetch(base+path,{redirect:'manual',headers});
  const post=(path,fields,cookie,extra={})=>fetch(base+path,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie,...extra},body:new URLSearchParams(fields)});
  const login=async()=>{const r=await get('/admin/login'),h=await r.text(),csrf=h.match(/name="csrf" value="([^"]+)"/)[1],cookie=r.headers.getSetCookie()[0].split(';')[0];const response=await post('/admin/login',{csrf,username:'owner',password},cookie);assert.equal(response.status,303);const session=response.headers.getSetCookie()[0].split(';')[0];const page=await(await get('/admin/sponsors',{cookie:session})).text();return {cookie:session,csrf:page.match(/name="csrf" value="([^"]+)"/)[1]}};
  const entries=sponsorEntries(sponsorDirectory(db));assert.equal(entries.length,5);
  const local=t=>new Date(t+8*3600000).toISOString().slice(0,16);
  const fields=(i,placement='product')=>({action:'approve',offer_key:sponsorOfferKey(entries[i]),placement,label:'测试赞助商 '+i,version:'0',reviewed:'true',start_at:local(Date.now()-60000),end_at:local(Date.now()+7*86400000),amount_cny:'99'});
  await run({db,submissionsDb,analytics,base,get,post,login,fields});
 }finally{if(app.listening)await new Promise(r=>app.close(r));analytics.close();submissionsDb.close();db.close()}
}

test('admin draft/approve/pause flow is authenticated, CSRF protected, scoped and capacity limited',()=>fixture(async({get,post,login,fields,analytics})=>{
 assert.equal((await get('/admin/sponsors')).status,303);assert.equal((await get('/admin/sponsors.csv')).status,303);
 const {cookie,csrf}=await login();assert.match(await(await get('/admin/sponsors',{cookie})).text(),/name="amount_cny"[^>]+value="299"/);const draft={...fields(0),csrf,action:'save'};
 assert.equal((await post('/admin/sponsors',fields(0),cookie)).status,403);
 assert.equal((await post('/admin/sponsors',draft,cookie,{origin:'https://evil.test'})).status,403);
 assert.equal((await post('/admin/sponsors',{...fields(0),csrf,reviewed:'false'},cookie)).status,422);
 assert.equal((await post('/admin/sponsors',draft,cookie)).status,303);
 let row=analytics.outbound.listCampaigns()[0];assert.equal(row.status,'draft');assert.equal(row.amount_cny,99);assert.match(await(await get('/admin/sponsors?id='+row.id,{cookie})).text(),/name="amount_cny"[^>]+value="99"/);
 const route='/?family=chatgpt&product=chatgpt-plus';assert.doesNotMatch(await(await get(route)).text(),/<article class="sponsor-card"/);
 assert.equal((await post('/admin/sponsors',{...fields(0),id:row.id,version:'1',csrf},cookie)).status,303);
 assert.equal(analytics.outbound.listCampaigns().find(c=>c.id===row.id).amount_cny,99);
 for(let i=1;i<4;i++)assert.equal((await post('/admin/sponsors',{...fields(i),csrf},cookie)).status,303);
 assert.equal((await post('/admin/sponsors',{...fields(4),csrf},cookie)).status,409);
 const html=await(await get(route)).text();assert.equal((html.match(/<article class="sponsor-card"/g)||[]).length,4);
 assert.ok(html.indexOf('<section class="surface sponsored-area')>html.indexOf('<div class="directory-quotes">'));
 assert.doesNotMatch(await(await get('/')).text(),/<article class="sponsor-card"/);
 assert.doesNotMatch(await(await get('/?family=chatgpt')).text(),/<article class="sponsor-card"/);
 assert.equal((await post('/admin/sponsors',{action:'pause',id:row.id,version:'1',csrf},cookie)).status,409);
 assert.equal((await post('/admin/sponsors',{action:'pause',id:row.id,version:'2',csrf},cookie)).status,303);
 assert.equal((await(await get(route)).text()).match(/<article class="sponsor-card"/g).length,3);
 assert.equal(analytics.outbound.actions(row.id).length,3);
 const csv=await get('/admin/sponsors.csv',{cookie});assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(await csv.text(),/测试赞助商 0/);
}));

test('home/category/product show their own sponsors only, current availability enforced and view endpoint signed',()=>fixture(async({db,analytics,fields,get,base})=>{
 for(const placement of ['home','category','product'])saveAdminSponsor(db,analytics,fields(0,placement),'fixture');
 for(const route of ['/','/?family=chatgpt','/?family=chatgpt&product=chatgpt-plus','/product?source=direct-shops&id=chatgpt-plus-recharge']){
  const html=await(await get(route)).text();assert.equal(html.match(/<article class="sponsor-card"/g).length,1,route);assert.match(html,/data-sponsor-token="\d{10}\.[a-f0-9]{64}"/);
  const href=html.match(/<article class="sponsor-card"[^>]*>[\s\S]*?href="([^"]+)"/)[1].replaceAll('&amp;','&');assert.equal((await get(href)).status,200);
 }
 assert.doesNotMatch(await(await get('/?family=claude')).text(),/<article class="sponsor-card"/);
 const c=analytics.outbound.listCampaigns().find(c=>c.placement==='sponsored_home'),token=analytics.outbound.viewToken(c);
 const send=(token,origin=base)=>fetch(base+'/api/sponsor-view',{method:'POST',headers:{origin,'content-type':'application/json','user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8'},body:JSON.stringify({id:c.id,token})});
 assert.equal((await send(token,'https://evil.test')).status,403);assert.equal((await get('/api/sponsor-view')).status,405);
 assert.equal((await send('forged')).status,200);assert.equal(analytics.outbound.report(7).length,0);
 assert.equal((await send(token)).status,200);assert.equal((await send(token)).status,200);assert.equal(analytics.outbound.report(7)[0].visible,1);
 db.prepare("UPDATE offers SET status='sold_out'").run();
 for(const route of ['/','/?family=chatgpt','/?family=chatgpt&product=chatgpt-plus'])assert.doesNotMatch(await(await get(route)).text(),/<article class="sponsor-card"/);
}));

test('12 public demos stay fictional, application calculates price on server and stores privately',()=>fixture(async({get,base,submissionsDb,analytics})=>{
 for(const placement of ['product','category','home'])for(const count of [1,2,3,4]){
  const html=await(await get(`/advertise?placement=${placement}&count=${count}`)).text();assert.equal(html.match(/<article class="sponsor-card"/g).length,count);assert.match(html,/虚构示例/);assert.doesNotMatch(html,/data-sponsor-token=/);
 }
 const page=await(await get('/submit?topic=sponsor_apply&placement=category&duration=14d')).text(),csrf=page.match(/name="csrf-token" content="([^"]+)"/)[1];assert.match(page,/¥899/);
 const payload={kind:'feedback',topic:'sponsor_apply',subject:'测试店铺申请',contextUrl:'https://merchant.test',contact:'private-fixture@example.test',details:'测试提交，验证人工处理的赞助申请与费用。',consent:true,metadata:{rateVersion:SPONSOR_RATE_VERSION,placement:'category',duration:'14d',targetPage:'/?family=chatgpt',amount:1}};
 const send=body=>fetch(base+'/api/submissions',{method:'POST',headers:{origin:base,'content-type':'application/json',cookie:'airadar_csrf='+csrf,'x-csrf-token':csrf},body:JSON.stringify(body)});
 assert.equal((await send({...payload,metadata:{...payload.metadata,targetPage:'https://evil.test'}})).status,422);
 for(const rateVersion of [undefined,'2026-09-09']){const rejected=await send({...payload,metadata:{...payload.metadata,rateVersion}});assert.equal(rejected.status,422);assert.match((await rejected.json()).error,/刷新页面/);}
 assert.equal(listSubmissions(submissionsDb,{kind:'feedback'}).length,0);
 assert.equal((await send(payload)).status,201);
 const row=listSubmissions(submissionsDb,{kind:'feedback'})[0];assert.match(row.details,/¥899/);assert.ok(row.details.includes('价目版本：'+SPONSOR_RATE_VERSION));assert.match(row.details,/目标页面：\/\?family=chatgpt/);
 assert.equal(analytics.outbound.listCampaigns().length,0);assert.doesNotMatch(await(await get('/advertise')).text(),/private-fixture/);
}));
