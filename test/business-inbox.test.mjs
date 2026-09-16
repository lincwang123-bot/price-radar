import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.mjs';
import {openSubmissionsDb,createSubmission} from '../lib/submissions.mjs';
import {createApp} from '../lib/web.mjs';
import {hashAdminPassword} from '../lib/admin.mjs';

test('商务合作独立收件箱保留历史申请，分类、分页、筛选和详情处理一致',async()=>{
 const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:');
 const feedback=createSubmission(submissionsDb,{kind:'feedback',topic:'suggestion',subject:'普通反馈保留',details:'这是普通反馈内容'});
 const sample={kind:'feedback',topic:'sponsor_apply',contextUrl:'https://merchant.test',contact:'X @synthetic_merchant',details:'合成商家希望了解广告位置与合作档期，仅用于自动测试。',consent:true,metadata:{placement:'product',duration:'1m'}};
 const historical=[];for(let i=0;i<27;i++)historical.push(createSubmission(submissionsDb,{...sample,subject:'历史商务申请 '+i},{clientAddress:'business-fixture-'+i}));
 submissionsDb.prepare("UPDATE feedback_submissions SET status='contacted' WHERE public_id=?").run(historical[0].id);
 const password='synthetic-business-inbox-password',origin='https://airadar.test';
 const app=createApp({db,submissionsDb,adminOptions:{username:'qa',passwordHash:await hashAdminPassword(password),origin},retentionOptions:{env:{}}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const get=(path,cookie='')=>fetch(base+path,{headers:{cookie},redirect:'manual'});
 const post=(path,fields,cookie)=>fetch(base+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'});
 try{
  assert.equal((await get('/admin/business')).status,303);
  const login=await get('/admin/login'),html=await login.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1],loginCookie=login.headers.getSetCookie()[0].split(';')[0];
  const authenticated=await post('/admin/login',{username:'qa',password,csrf},loginCookie);assert.equal(authenticated.status,303);
  const cookie=authenticated.headers.getSetCookie()[0].split(';')[0];
  const business=await get('/admin/business',cookie),businessHtml=await business.text();
  assert.equal(business.status,200);assert.match(business.headers.get('x-robots-tag'),/noindex/);assert.match(businessHtml,/<h1>商务合作<\/h1>/);assert.match(businessHtml,/共 27 条/);
  assert.equal((businessHtml.match(/<article>/g)||[]).length,25);assert.match(businessHtml,/href="\/admin\/business\?status=&amp;page=2"/);assert.ok(!businessHtml.includes('普通反馈保留'));
  const normal=await(await get('/admin?kind=feedback',cookie)).text();assert.match(normal,/共 1 条/);assert.ok(normal.includes(feedback.id));assert.ok(!normal.includes('历史商务申请'));
  const second=await(await get('/admin/business?page=2',cookie)).text();assert.equal((second.match(/<article>/g)||[]).length,2);assert.ok(second.includes(historical[0].id));
  const filtered=await(await get('/admin?kind=business&status=contacted',cookie)).text();assert.match(filtered,/共 1 条/);assert.ok(filtered.includes(historical[0].id));
  const empty=await(await get('/admin/business?status=accepted',cookie)).text();assert.match(empty,/暂无商务合作申请/);
  const detailPath='/admin/submission/'+historical[1].id,detail=await(await get(detailPath,cookie)).text();assert.match(detail,/<h1>商务合作申请<\/h1>/);assert.match(detail,/返回商务合作/);assert.ok(detail.includes(sample.contact));
  const actionCsrf=detail.match(/name="csrf" value="([^"]+)"/)[1];assert.equal((await post(detailPath,{csrf:actionCsrf,status:'contacted',note:'已核对本次合成申请的合作意向'},cookie)).status,303);
  assert.equal(submissionsDb.prepare('SELECT COUNT(*) n FROM submission_actions WHERE public_id=?').get(historical[1].id).n,1);
  assert.match(await(await get('/admin/business?status=contacted',cookie)).text(),/共 2 条/);
  assert.equal(submissionsDb.prepare('SELECT COUNT(*) n FROM feedback_submissions').get().n,28);
  assert.ok(!(await(await get('/advertise')).text()).includes(sample.contact));
 }finally{await new Promise(r=>app.close(r));await app.merchantWorkflowDone?.();await app.retentionWorkflowDone?.();submissionsDb.close();db.close();}
});
