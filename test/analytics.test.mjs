import test from "node:test";
import assert from "node:assert/strict";
import { openAnalytics, analyticsCsv } from "../lib/analytics.mjs";
import { openDb } from "../lib/db.mjs";
import { createApp } from "../lib/web.mjs";
const now=new Date("2026-09-05T06:00:00Z");
const secret="fixture-secret-with-at-least-32-characters";
function request(address="203.0.113.1",patch={}){return{method:"GET",url:"/product?private=never-store",socket:{remoteAddress:"127.0.0.1"},headers:{"cf-connecting-ip":address,"user-agent":"Mozilla/5.0 Chrome/150 Safari/537.36","sec-fetch-dest":"document"},...patch};}
test("统计区间去重而非相加日UV，缺历史不造零，去标识不落原始请求",()=>{
 const a=openAnalytics(":memory:",secret,{now:new Date("2026-09-04T06:00:00Z")});
 try{a.record(request(),200,new Date("2026-09-04T06:00:00Z"));a.record(request(),200,now);a.record(request("203.0.113.2"),200,now);
 const r=a.report(7,now);assert.equal(r.pv,3);assert.equal(r.uv,2);assert.equal(r.series.at(-1).uv,2);assert.equal(r.series.at(-2).uv,1);assert.equal(r.series[0].pv,null);
 const rows=a.db.prepare("select * from analytics_visitors").all();assert.ok(rows.every(v=>/^[a-f0-9]{64}$/.test(v.visitor)));assert.ok(!JSON.stringify(rows).includes("203.0.113"));assert.ok(!JSON.stringify(rows).includes("private"));assert.match(analyticsCsv(r),/尚未开始统计/);
 }finally{a.close();}
});
test("统计排除机器人、后台、API、HEAD、错误、预取、无可信IP和管理员",()=>{
 const a=openAnalytics(":memory:",secret,{now});
 try{for(const url of ["/admin","/admin/login","/api/submissions","/health","/submit","/favicon.ico"])a.record(request(undefined,{url}),200,now);
 a.record(request(undefined,{method:"HEAD"}),200,now);a.record(request(),404,now);
 for(const ua of ["curl/8","Mozilla/5.0 Googlebot","Mozilla/5.0 PriceRadarQA","Mozilla/5.0 HeadlessChrome"])a.record(request(undefined,{headers:{"user-agent":ua,"cf-connecting-ip":"203.0.113.1"}}),200,now);
 a.record(request(undefined,{headers:{...request().headers,purpose:"prefetch"}}),200,now);
 a.record(request(undefined,{headers:{...request().headers,cookie:"airadar_admin=fixture"}}),200,now);
 a.record(request(undefined,{headers:{"user-agent":request().headers['user-agent'],"x-forwarded-for":"203.0.113.1"}}),200,now);
 a.record(request(undefined,{socket:{remoteAddress:"203.0.113.5"}}),200,now);
 assert.equal(a.report(7,now).pv,0);
 }finally{a.close();}
});
test("31天明细过期、按日聚合保留、单访客限额及故障隔离",()=>{
 const a=openAnalytics(":memory:",secret,{now:new Date("2026-08-01")});
 try{a.record(request(),200,new Date("2026-08-01"));for(let i=0;i<80;i++)a.record(request(),200,now);assert.equal(a.report(7,now).pv,60);assert.equal(a.db.prepare("select count(*) n from analytics_visitors where day < '2026-08-06'").get().n,0);assert.equal(a.report(30,now).historicalPv,61);
 a.db.exec("PRAGMA query_only=ON");assert.doesNotThrow(()=>a.record(request("203.0.113.2"),200,new Date(now.getTime()+60000)));assert.equal(a.report(7,now).healthy,false);
 }finally{a.close();}
});
test("统计异常不影响公开响应，私有库没有公开下载路由",async()=>{
 const db=openDb(":memory:"),app=createApp({db,analytics:{record(){throw new Error("fixture");}}});await new Promise(r=>app.listen(0,"127.0.0.1",r));
 try{const base=`http://127.0.0.1:${app.address().port}`;assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+"/analytics/analytics.sqlite")).status,404);assert.equal((await fetch(base+"/privacy")).status,200);await new Promise(r=>setImmediate(r));}
 finally{await new Promise(r=>app.close(r));db.close();}
});
