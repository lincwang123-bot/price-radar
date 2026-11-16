import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {saveAdminSponsor,sponsorItems} from '../lib/sponsor-service.mjs';
import {sponsorBlock} from '../lib/sponsor-ui.mjs';
import {sponsorAdminContent} from '../lib/sponsor-admin.mjs';
import {handleOutbound} from '../lib/outbound.mjs';
const date=new Date('2026-09-11T08:00:00Z');
const fields={id:'own-site',version:'0',action:'approve',reviewed:'true',campaign_kind:'website',destination_url:'https://merchant.example.test/',placement:'home',label:'Fictional sponsor',headline:'所需的服务，从容选好。',tagline:'Go / Plus / Pro · 选择适合你的方案',theme:'blue',amount_cny:'0',note:'站长自有推广，不收取广告费',start_at:'2026-09-11T16:00',end_at:'2026-10-11T16:00'};
function fixture(run){const db=openDb(':memory:'),analytics=openAnalytics(':memory:','website-sponsor-test-secret-32-characters',{now:date});try{run({db,analytics})}finally{analytics.close();db.close()}}
function follow(ctx,href,method='GET',now=date){const res={headers:{},setHeader(k,v){this.headers[k]=v},end(v){this.body=v}};handleOutbound({method,headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'}},res,new URL(href,'https://airadar.example.test'),{...ctx,now:now.getTime()});return res;}
function items(ctx,extra={}){return sponsorItems([],ctx.analytics,{db:ctx.db,placement:'sponsored_home',pageKey:'home',date,...extra})}
test('owned website campaign renders without catalog quotes, records activity and expires at the calendar month boundary',()=>fixture(ctx=>{
 saveAdminSponsor(ctx.db,ctx.analytics,fields,'site-owner',date);
 assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM offers').get().n,0);
 const list=items(ctx);assert.equal(list.length,1);assert.equal(list[0].campaign.amount_cny,0);assert.equal(list[0].offer.url,'https://merchant.example.test/');
 const html=sponsorBlock(list,{placement:'home'});assert.doesNotMatch(html,/站长自有|自有推广|不收取广告费/);assert.match(html,/访问网站/);assert.match(html,/nofollow sponsored/);assert.doesNotMatch(html,/在售|报价时间|价格以商家为准/);
 assert.equal(items(ctx,{placement:'sponsored_category',pageKey:'chatgpt'}).length,0);
 assert.equal(items(ctx,{date:new Date('2026-10-11T07:59:59Z')}).length,1);
 assert.equal(items(ctx,{date:new Date('2026-10-11T08:00:00Z')}).length,0);
 const href=list[0].href;assert.equal(follow(ctx,href).statusCode,200);assert.match(follow(ctx,href).body,/merchant.example.test/);assert.equal(ctx.analytics.outbound.report(30,date).length,0);
 const head=follow(ctx,href+'&ack=1','HEAD');assert.equal(head.statusCode,302);assert.equal(ctx.analytics.outbound.report(30,date).length,0);
 const click=follow(ctx,href+'&ack=1');assert.equal(click.statusCode,302);assert.equal(click.headers.Location,'https://merchant.example.test/');assert.equal(ctx.analytics.outbound.report(30,date)[0].clicks,1);
 const c=list[0].campaign,req={method:'GET',headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8'},socket:{remoteAddress:'127.0.0.1'}};
 assert.equal(ctx.analytics.outbound.recordImpression(req,c,date),true);assert.equal(ctx.analytics.outbound.recordVisible(req,c.id,ctx.analytics.outbound.viewToken(c,date),date),true);
 assert.equal(ctx.analytics.outbound.actions(c.id)[0].actor,'site-owner');
 assert.equal(follow(ctx,href+'&ack=1','GET',new Date('2026-10-11T08:00:00Z')).statusCode,404);
 const admin=sponsorAdminContent(ctx.db,ctx.analytics,new URL('https://airadar.example.test/admin/sponsors?id=own-site'),'csrf');assert.match(admin,/<option value="website" selected>/);assert.match(admin,/name="destination_url"[^>]*value="https:\/\/merchant.example.test\/"/);assert.doesNotMatch(admin,/name="offer_key" required/);
}));
test('website redirects reject tampering, pause and stale versions, and editable targets stay validated',()=>fixture(ctx=>{
 saveAdminSponsor(ctx.db,ctx.analytics,fields,'owner',date);const href=items(ctx)[0].href;
 for(const [key,value] of [['campaign','other'],['offer','other'],['product','other'],['snapshot','2'],['placement','home']]){const url=new URL(href,'https://airadar.example.test');url.searchParams.set(key,value);url.searchParams.set('ack','1');assert.equal(follow(ctx,url.pathname+url.search).statusCode,404,key)}
 assert.equal(follow(ctx,href+'&url=https://evil.example.test&ack=1').statusCode,400);
 assert.equal(follow(ctx,href+'&ack=1','POST').statusCode,405);
 saveAdminSponsor(ctx.db,ctx.analytics,{...fields,version:'1',destination_url:'https://merchant.example.test/#/shop'},'owner',date);
 assert.equal(follow(ctx,href+'&ack=1').statusCode,404);
 const updated=items(ctx)[0];assert.equal(follow(ctx,updated.href+'&ack=1').headers.Location,'https://merchant.example.test/#/shop');
 saveAdminSponsor(ctx.db,ctx.analytics,{id:fields.id,version:'2',action:'pause'},'owner',date);assert.equal(items(ctx).length,0);assert.equal(follow(ctx,updated.href+'&ack=1').statusCode,404);
}));
test('website campaign approval enforces safe targets, homepage scope and normal shared capacity',()=>fixture(ctx=>{
 for(const target of ['http://merchant.example.test','https://127.0.0.1','https://u:p@merchant.example.test','javascript:alert(1)'])assert.throws(()=>saveAdminSponsor(ctx.db,ctx.analytics,{...fields,destination_url:target},'owner',date));
 assert.throws(()=>saveAdminSponsor(ctx.db,ctx.analytics,{...fields,reviewed:'false'},'owner',date),/核对/);
 assert.throws(()=>saveAdminSponsor(ctx.db,ctx.analytics,{...fields,placement:'product'},'owner',date),/投放产品/);
 assert.doesNotThrow(()=>saveAdminSponsor(ctx.db,ctx.analytics,{...fields,id:'product-site',placement:'product',product_key:'chatgpt-plus'},'owner',date));
 assert.equal(items(ctx,{placement:'sponsored_product',pageKey:'chatgpt-plus'}).length,1);
 saveAdminSponsor(ctx.db,ctx.analytics,{id:'product-site',version:'1',action:'pause'},'owner',date);
 for(let i=0;i<4;i++)saveAdminSponsor(ctx.db,ctx.analytics,{...fields,id:'site'+i,destination_url:`https://site${i}.example.test`},'owner',date);
 assert.equal(items(ctx).length,4);assert.throws(()=>saveAdminSponsor(ctx.db,ctx.analytics,fields,'owner',date),/4/);
 const row=ctx.analytics.outbound.listCampaigns()[0];assert.throws(()=>ctx.analytics.outbound.saveCampaign({...row,id:'mismatch',version:0,destination_url:'https://other.example.test'}),/HTTPS/);
}));


test('website sponsors can target a category independently of home with scoped links and metrics',()=>fixture(ctx=>{
 saveAdminSponsor(ctx.db,ctx.analytics,fields,'owner',date);
 saveAdminSponsor(ctx.db,ctx.analytics,{...fields,id:'chatgpt-site',placement:'category',category_key:'chatgpt'},'owner',date);
 const home=items(ctx),category=items(ctx,{placement:'sponsored_category',pageKey:'chatgpt'});
 assert.equal(home.length,1);assert.equal(category.length,1);assert.equal(home[0].campaign.id,'own-site');assert.equal(category[0].campaign.id,'chatgpt-site');assert.equal(category[0].campaign.page_label,'ChatGPT');
 assert.equal(items(ctx,{placement:'sponsored_category',pageKey:'claude'}).length,0);
 assert.equal(items(ctx,{placement:'sponsored_product',pageKey:'chatgpt-plus'}).length,0);
 const href=category[0].href;assert.equal(follow(ctx,href+'&ack=1').headers.Location,'https://merchant.example.test/');assert.equal(ctx.analytics.outbound.report(30,date)[0].campaign_id,'chatgpt-site');
 const forged=new URL(href,'https://airadar.example.test');forged.searchParams.set('placement','sponsored_home');assert.equal(follow(ctx,forged.pathname+forged.search+'&ack=1').statusCode,404);
 const admin=sponsorAdminContent(ctx.db,ctx.analytics,new URL('https://airadar.example.test/admin/sponsors?id=chatgpt-site'),'csrf');assert.match(admin,/<option value="chatgpt" selected>ChatGPT<\/option>/);
 for(const category_key of ['', 'unknown','api-relay','chatgpt-plus'])assert.throws(()=>saveAdminSponsor(ctx.db,ctx.analytics,{...fields,id:'bad-category',placement:'category',category_key},'owner',date),/分类/);
 saveAdminSponsor(ctx.db,ctx.analytics,{id:'chatgpt-site',version:'1',action:'pause'},'owner',date);assert.equal(items(ctx).length,1);assert.equal(items(ctx,{placement:'sponsored_category',pageKey:'chatgpt'}).length,0);
}));
