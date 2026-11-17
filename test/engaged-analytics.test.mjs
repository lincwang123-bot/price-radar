import test from 'node:test';
import assert from 'node:assert/strict';
import {openAnalytics,engagedMode,analyticsCsv} from '../lib/analytics.mjs';
import {analyticsContent} from '../lib/admin-analytics.mjs';
const now=new Date('2026-10-11T08:00:00Z');
const req=()=>({method:'GET',url:'/',headers:{'user-agent':'Mozilla/5.0 Chrome/1','cf-connecting-ip':'203.0.113.8','sec-fetch-dest':'document'},socket:{remoteAddress:'127.0.0.1'}});
const open=()=>openAnalytics(':memory:','fixture-secret-with-at-least-32-characters',{now,clock:()=>now});
test('mode parser defaults and case handling',()=>{assert.equal(engagedMode(''),'report');assert.equal(engagedMode('invalid'),'report');for(const mode of ['report','filter','off'])assert.equal(engagedMode(mode.toUpperCase()),mode);});
test('parallel engagement deduplicates heartbeat and successful interaction without changing official writes',()=>{
 const a=open();try{const r=req();a.record(r,200);assert.equal(a.report(7,now).pv,1);assert.equal(a.report(7,now).engagedPv,0);
 assert.equal(a.recordEngaged(r),true);assert.equal(a.recordEngaged(r),false);
 a.growth.record({...r,url:'/official-prices/chatgpt-plus',headers:{...r.headers,referer:'https://airadar.vip/'}},200,{kind:'spec_selected',productKey:'chatgpt-plus'},now);
 assert.equal(a.report(7,now).engagedPv,1);assert.equal(a.report(7,now).engagedUv,1);
 a.record(r,200);assert.equal(a.report(7,now).pv,2);assert.match(analyticsCsv(a.report(7,now)),/有效浏览/);
 const tables=a.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'analytics_engaged_%'").all();
 for(const {name} of tables){assert.doesNotMatch(JSON.stringify(a.db.prepare(`PRAGMA table_info(${name})`).all()),/"name":"(?:ua|ip|path|url|referrer)"/);assert.doesNotMatch(JSON.stringify(a.db.prepare(`SELECT * FROM ${name}`).all()),/Mozilla|203\.0\.113|https:/);}
 assert.doesNotMatch(JSON.stringify(a.report(7,now)),/Mozilla|203\.0\.113/);
 }finally{a.close();}
});
test('successful growth interaction alone can engage',()=>{const a=open();try{a.growth.record({...req(),headers:{...req().headers,referer:'https://airadar.vip/'}},200,{kind:'spec_selected',productKey:'chatgpt-plus'},now);assert.equal(a.report(7,now).engagedPv,1);assert.equal(a.report(7,now).pv,0);}finally{a.close();}});
test('public filters reject both series',()=>{
 for(const change of [r=>r.headers['user-agent']='Mozilla/5.0 Headless',r=>r.headers['user-agent']='Browser',r=>r.headers['user-agent']='',r=>r.headers.cookie='airadar_admin=x',r=>r.headers.purpose='prefetch',r=>r.scrapeGuardAction='challenge',r=>delete r.headers['cf-connecting-ip'],r=>r.headers['sec-fetch-dest']='image',r=>r.socket.remoteAddress='203.0.113.9',r=>r.url='/admin',r=>r.method='POST']){
 const a=open();try{const r=req();change(r);a.record(r,200);a.recordEngaged(r);assert.equal(a.report(7,now).pv,0);assert.equal(a.report(7,now).engagedPv,0);}finally{a.close();}}
});
test('off leaves official accounting and legacy CSV/admin presentation intact',()=>{
 const previous=process.env.AIRADAR_ANALYTICS_ENGAGED;process.env.AIRADAR_ANALYTICS_ENGAGED='OFF';const a=open();try{a.record(req(),200);a.recordEngaged(req());a.growth.record(req(),200,{kind:'spec_selected',productKey:'chatgpt-plus'},now);const r=a.report(7,now);assert.equal(r.pv,1);assert.equal(r.engagedPv,undefined);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM analytics_engaged_days').get().n,0);assert.doesNotMatch(analyticsCsv(r),/有效/);assert.doesNotMatch(analyticsContent(a,7),/有效浏览/);}finally{a.close();if(previous===undefined)delete process.env.AIRADAR_ANALYTICS_ENGAGED;else process.env.AIRADAR_ANALYTICS_ENGAGED=previous;}
});
test('engaged endpoint validates requests and counts independently on origin and edge',async()=>{
 const {openDb}=await import('../lib/db.mjs');const {createApp}=await import('../lib/web.mjs');const db=openDb(':memory:'),a=open();const app=createApp({db,analytics:a,retentionOptions:{env:{},secret:'fixture-retention-secret'.repeat(3)}});
 try{await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 const headers={'content-type':'application/json',...req().headers,origin:base};
 for(const [options,status] of [[{},405],[{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{"p":"/"}'},403],[{method:'POST',headers,body:'{"p":"/admin"}'},400]]){const res=await fetch(base+'/api/public-engaged',options);assert.equal(res.status,status);assert.equal(res.headers.get('cache-control'),'no-store');assert.match(res.headers.get('x-robots-tag'),/noindex/);await res.text();}
 for(let i=0;i<2;i++){const res=await fetch(base+'/api/public-engaged',{method:'POST',headers,body:'{"p":"/"}'});assert.equal(res.status,204);}
 await new Promise(setImmediate);assert.equal(a.report(7,now).engagedPv,1);assert.equal(a.report(7,now).pv,0);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();a.close();db.close();}
});
test('engaged visitor retention purges only old identities, preserving daily aggregates',()=>{const a=open();try{a.recordEngaged(req(),now);a.report(30,new Date(+now+31*86400000));assert.equal(a.db.prepare('SELECT COUNT(*) n FROM analytics_engaged_visitors').get().n,0);assert.equal(a.db.prepare('SELECT SUM(pv) n FROM analytics_engaged_days').get().n,1);}finally{a.close();}});
test('engaged rate limits reject bursts without consuming official quota',()=>{const a=open();try{for(let i=0;i<61;i++)a.recordEngaged(req(),new Date(+now+i*500));assert.equal(a.report(7,now).engagedPv,1);for(let i=0;i<2;i++)a.record(req(),200,now);assert.equal(a.report(7,now).pv,2);}finally{a.close();}});
test('non-success and challenge responses cannot engage; all modes preserve official PV',()=>{
 const old=process.env.AIRADAR_ANALYTICS_ENGAGED;
 try{for(const mode of ['report','filter','off']){process.env.AIRADAR_ANALYTICS_ENGAGED=mode;const a=open();try{a.record(req(),404);a.recordEngaged(req(),now,404);a.record(req(),200,now,null,{scrapeGuardAction:'challenge'});a.recordEngaged(req(),now,200,{scrapeGuardAction:'challenge'});assert.equal(a.report(7,now).pv,0);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM analytics_engaged_days').get().n,0);a.record(req(),200);a.recordEngaged(req());a.record(req(),200);assert.equal(a.report(7,now).pv,2);assert.equal(a.report(7,now).uv,1);}finally{a.close();}}}finally{if(old===undefined)delete process.env.AIRADAR_ANALYTICS_ENGAGED;else process.env.AIRADAR_ANALYTICS_ENGAGED=old;}
});
