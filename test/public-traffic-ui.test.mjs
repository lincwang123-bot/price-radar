import test from 'node:test';
import assert from 'node:assert/strict';
import {publicTrafficHtml,PUBLIC_TRAFFIC_CSS} from '../lib/public-traffic-ui.mjs';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

const snapshot={totalPv:296645,monthPv:199230,monthUv:31120,startedAt:'2026-09-05T06:43:18.133Z',updatedAt:new Date().toISOString()};
const cloudflareSnapshot={source:'cloudflare',dayUv:6170,monthUv:45870,dayRequests:52950,monthRequests:2116323,dayStart:'2026-10-10T14:00:00Z',dayEnd:'2026-10-11T14:00:00Z',monthStart:'2026-09-11T14:00:00Z',monthEnd:'2026-10-11T14:00:00Z',updatedAt:'2026-10-11T14:05:00Z'};
test('Cloudflare traffic renders only its two unique-visitor metrics with source, cadence and exact UTC windows',()=>{
 const html=publicTrafficHtml(cloudflareSnapshot,'zh',Date.parse(cloudflareSnapshot.updatedAt));
 for(const text of ['6,170','45,870','近 24 小时唯一访问者','近 30 天唯一访问者','来源：Cloudflare','每 5 分钟同步','上次同步','IP 去重估算','机器人或自动化流量','不等于真实人数、广告曝光或成交'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/<dt>/g)||[]).length,2);
 assert.match(html,/href="\/advertise"/);
 assert.match(html,/class="public-traffic public-traffic--cloudflare"/);
 assert.match(html,/datetime="2026-10-10T14:00:00Z">2026-10-10 14:00:00<\/time>/);
 assert.match(html,/datetime="2026-09-11T14:00:00Z">2026-09-11 14:00:00<\/time>/);
 assert.match(html,/datetime="2026-10-11T14:00:00Z">2026-10-11 14:00:00<\/time>/);
 assert.match(html,/UTC/);
 assert.doesNotMatch(html,/累计浏览量|近 30 天浏览量|近 30 天估算访客|52,950|2,116,323|296,645|199,230|<script|iframe|visitor_hash/);
 assert.match(PUBLIC_TRAFFIC_CSS,/\.public-traffic--cloudflare \.public-traffic-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(PUBLIC_TRAFFIC_CSS,/\.public-traffic--cloudflare \.public-traffic-metrics>div:first-child\{grid-column:auto/);
});
test('Cloudflare English uses the same counts, stays distinct from local PV, and reports stale snapshots',()=>{
 const now=Date.parse(cloudflareSnapshot.updatedAt);
 const html=publicTrafficHtml(cloudflareSnapshot,'en',now);
 for(const text of ['6,170','45,870','Unique visitors · last 24 hours','Unique visitors · last 30 days','Source: Cloudflare','Synced every 5 minutes','Last synced','IP-based estimate','2026-09-11 14:00:00','2026-10-11 14:00:00','UTC','bots or automated traffic','not real people, ad impressions or sales'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/[\u3400-\u9fff]|Total pageviews|Pageviews ·|Estimated visitors|52,950|2,116,323/);
 assert.match(publicTrafficHtml(cloudflareSnapshot,'zh',now+11*60000),/更新延迟，展示上次统计/);
 assert.match(publicTrafficHtml(cloudflareSnapshot,'en',now+11*60000),/Update delayed; last snapshot shown/);
 assert.equal((publicTrafficHtml({...cloudflareSnapshot,dayUv:0,monthUv:0},'zh',now).match(/role="img" aria-label="0"/g)||[]).length,2);
});
test('public traffic labels distinguish pageviews from estimated visitors, with no scripts or private identifiers',()=>{
 const html=publicTrafficHtml(snapshot);
 for(const text of ['296,645','199,230','31,120','累计浏览量','近 30 天浏览量','近 30 天估算访客','统计口径','2026-09-05','每 5 分钟更新'])assert.ok(html.includes(text),text);
 assert.match(html,/href="\/advertise"/);
 assert.doesNotMatch(html,/实时更新|累计访问 IP|上线天数|<script|iframe|visitor_hash/);
 assert.equal(publicTrafficHtml(null),'');
 assert.match(publicTrafficHtml({...snapshot,totalPv:0,monthPv:0,monthUv:0}),/>0</);
 assert.match(publicTrafficHtml({...snapshot,updatedAt:'2026-01-01T00:00:00Z'}),/更新延迟/);
 const english=publicTrafficHtml(snapshot,'en');
 assert.match(english,/Estimated visitors/);assert.doesNotMatch(english,/[\u3400-\u9fff]/);
 assert.match(PUBLIC_TRAFFIC_CSS,/@media\(max-width:600px\)/);
 assert.doesNotMatch(PUBLIC_TRAFFIC_CSS,/position:\s*(fixed|sticky)|infinite/);
});

test('traffic numbers use accessible static digits with optional finite split-flap animation',()=>{
 const html=publicTrafficHtml(cloudflareSnapshot,'zh',Date.parse(cloudflareSnapshot.updatedAt));
 assert.equal((html.match(/data-traffic-flip/g)||[]).length,2);
 assert.match(html,/role="img" aria-label="6,170"/);
 assert.match(html,/role="img" aria-label="45,870"/);
 assert.equal((html.match(/class="traffic-digit"/g)||[]).length,9);
 assert.equal((html.match(/class="traffic-separator"/g)||[]).length,2);
 assert.match(html,/class="traffic-digit" aria-hidden="true"/);
 assert.match(html,/traffic-half--top/);assert.match(html,/traffic-half--bottom/);
 assert.match(PUBLIC_TRAFFIC_CSS,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(PUBLIC_TRAFFIC_CSS,/@keyframes traffic-flip-top/);
 assert.match(PUBLIC_TRAFFIC_CSS,/\.is-flipping/);
 assert.doesNotMatch(html,/aria-live|<script|style="[^"]*display:none/);
 const large=publicTrafficHtml({...cloudflareSnapshot,dayUv:123456789,monthUv:0});
 assert.match(large,/aria-label="123,456,789"/);assert.match(large,/aria-label="0"/);
});

test('home displays cached traffic in both languages without querying analytics per request, and other routes stay unchanged',async()=>{
 const db=openDb(':memory:');let reports=0;
 const analytics={report(){reports++;return {available:true,healthy:true,startedAt:snapshot.startedAt,historicalPv:snapshot.totalPv,pv:snapshot.monthPv,uv:snapshot.monthUv};},record(){}};
 const app=createApp({db,analytics});
 try{
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+app.address().port;
  for(const path of ['/','/en/','/','/en/']){
   const r=await fetch(origin+path),html=await r.text();assert.equal(r.status,200);
   assert.match(html,/<\/header><section class="public-traffic"/);
   assert.match(html,/296,645/);assert.match(html,/class="shop-search"/);assert.match(html,/id="choose-product"/);
   const script=html.match(/<script src="(\/assets\/public-traffic\.js\?v=[a-f0-9]+)" defer><\/script>/)?.[1];assert.ok(script);
   const asset=await fetch(origin+script);assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control'),/immutable/);
   const section=html.match(/<section class="public-traffic"[\s\S]*?<\/section>/)[0];
   if(path.startsWith('/en'))assert.doesNotMatch(section,/[\u3400-\u9fff]/);
  }
  assert.equal(reports,1);
  const privacy=await(await fetch(origin+'/privacy')).text();
  assert.match(privacy,/首页公开站点级浏览量和访客估算汇总/);assert.doesNotMatch(privacy,/统计只在受保护站长后台可见/);
  for(const path of ['/catalog','/?shop_q=missing'])assert.doesNotMatch(await(await fetch(origin+path)).text(),/class="public-traffic"|src="\/assets\/public-traffic\.js/);
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();}
});
test('engaged report/filter copy in both languages with legacy fallback',()=>{
 const base={totalPv:8,monthPv:6,monthUv:3,startedAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'};
 for(const locale of ['zh','en'])for(const mode of ['report','filter']){const html=publicTrafficHtml({...base,engagedMonthPv:2,engagedMonthUv:1,engagedMode:mode},locale);assert.match(html,locale==='en'?/suspected automated/:/疑似自动化/);assert.match(html,locale==='en'?/Engaged pageviews/:/有效浏览量/);if(mode==='filter')assert.ok(html.indexOf(locale==='en'?'Engaged pageviews':'有效浏览量')<html.indexOf(locale==='en'?'Raw ·':'原始 ·'));}
 assert.doesNotMatch(publicTrafficHtml({...base,engagedMode:'off',engagedMonthPv:2,engagedMonthUv:1}),/有效浏览/);
 assert.equal(publicTrafficHtml({...base,engagedMode:'filter'}),publicTrafficHtml(base));
});
