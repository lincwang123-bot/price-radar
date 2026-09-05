import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.mjs";
import { openSubmissionsDb, createSubmission } from "../lib/submissions.mjs";
import { createApp } from "../lib/web.mjs";
import { hashAdminPassword } from "../lib/admin.mjs";

const origin="https://airadar.test";
test("后台默认拒绝，认证/过期/退出/CSRF/审计/转义完整边界",async()=>{
  const db=openDb(":memory:"), submissionsDb=openSubmissionsDb(":memory:");let time=Date.now();
  const password="a-fixture-password-only-1234",passwordHash=await hashAdminPassword(password);
  const record=createSubmission(submissionsDb,{kind:"feedback",topic:"suggestion",subject:"<script>alert(1)</script>",details:"private fixture detail"});
  let app=createApp({db,submissionsDb});await new Promise(r=>app.listen(0,"127.0.0.1",r));
  const addr=()=>`http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(addr()+"/admin")).status,404);await new Promise(r=>app.close(r));
  app=createApp({db,submissionsDb,adminOptions:{username:"owner",passwordHash,origin,now:()=>time}});await new Promise(r=>app.listen(0,"127.0.0.1",r));
  const request=(p,options={})=>fetch(addr()+p,{redirect:"manual",...options});
  const post=(p,fields,cookies,extra={})=>request(p,{method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded",cookie:cookies,...extra},body:new URLSearchParams(fields)});
  async function login(){const r=await request("/admin/login"),text=await r.text(),csrf=/name="csrf" value="([^"]+)"/.exec(text)[1],cookie=r.headers.getSetCookie()[0].split(";")[0];const a=await post("/admin/login",{username:"owner",password,csrf},cookie);assert.equal(a.status,303);return a.headers.getSetCookie()[0].split(";")[0];}
  try{
    for(const cookie of ["","airadar_admin=forged"]){const r=await request("/admin/submission/"+record.id,{headers:{cookie}});assert.equal(r.status,303);assert.ok(!(await r.text()).includes("private fixture"));}
    let session=await login();let detail=await request("/admin/submission/"+record.id,{headers:{cookie:session}});const text=await detail.text();assert.ok(text.includes("&lt;script&gt;"));assert.ok(!text.includes("<script>"));const csrf=/name="csrf" value="([^"]+)"/.exec(text)[1];
    assert.equal((await post("/admin/submission/"+record.id,{status:"resolved",csrf},session,{origin:"https://evil.test"})).status,403);
    assert.equal((await post("/admin/submission/"+record.id,{status:"resolved"},session)).status,403);
    assert.equal(submissionsDb.prepare("select count(*) n from submission_actions").get().n,0);
    assert.equal((await post("/admin/submission/"+record.id,{status:"resolved",csrf,note:"<img onerror=alert(1)>"},session)).status,303);
    assert.equal(submissionsDb.prepare("select status from feedback_submissions").get().status,"resolved");assert.equal(submissionsDb.prepare("select count(*) n from submission_actions").get().n,1);
    // A failing audit insert must also roll back the status mutation.
    submissionsDb.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON submission_actions BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
    const {updateSubmissionStatus}=await import("../lib/submissions.mjs");assert.throws(()=>updateSubmissionStatus(submissionsDb,record.id,"closed"));assert.equal(submissionsDb.prepare("select status from feedback_submissions").get().status,"resolved");submissionsDb.exec("DROP TRIGGER reject_audit");
    assert.equal((await post("/admin/logout",{csrf},session)).status,303);assert.equal((await request("/admin",{headers:{cookie:session}})).status,303);
    session=await login();time+=3600_001;assert.equal((await request("/admin",{headers:{cookie:session}})).status,303);
    const publicPage=await(await request("/")).text();assert.ok(!publicPage.includes("private fixture"));assert.equal((await request("/api/submissions")).status,405);
    const lr=await request("/admin/login"),lt=await lr.text(),lc=lr.headers.getSetCookie()[0].split(";")[0],ct=/name="csrf" value="([^"]+)"/.exec(lt)[1];
    let errorText;for(let i=0;i<5;i++){const r=await post("/admin/login",{csrf:ct,username:i%2?"unknown":"owner",password:"bad"},lc);assert.equal(r.status,401);const t=await r.text();if(errorText)assert.equal(t,errorText);errorText=t;}assert.equal((await post("/admin/login",{csrf:ct,username:"owner",password},lc)).status,429);
  }finally{await new Promise(r=>app.close(r));db.close();submissionsDb.close();}
});
