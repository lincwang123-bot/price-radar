import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../lib/db.mjs';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createAdmin, hashAdminPassword } from '../lib/admin.mjs';
import { getMerchantApplication } from '../lib/merchant-onboarding.mjs';

test('conversion routes protect authorization, preserve editable failures and only create pending applications', async () => {
  const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:'),origin='https://airadar.test',password='conversion-admin-fixture-password';
  for(const [n,topic]of [[1,'supply'],[2,'demand'],[3,'supply'],[4,'supply']])submissionsDb.prepare(`INSERT INTO cooperation_submissions(public_id,created_at,topic,subject,product_area,scale,assurance,settlement,source_url,details,contact,consent_at,content_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`CO-20260907-00000000000${n}`,new Date().toISOString(),topic,'供应广告标题不是店名','chatgpt','small','conditional','cny','https://conversion-shop.com/','原投稿说明','private-source@example.org',new Date().toISOString(),String(n));
  let aliasCalls=0;
  const admin=createAdmin({db,submissionsDb,origin,username:'owner',passwordHash:await hashAdminPassword(password),merchantUrlResolver:async url=>{aliasCalls++;assert.equal(url,'https://www.16688.com.cn/shop/XIAOQING2');return 'https://www.16688.com.cn/shop/S332568';}});
  const server=createServer(async(req,res)=>{try{if(!await admin(req,res,new URL(req.url,origin))){res.statusCode=404;res.end();}}catch{res.statusCode=500;res.end('unexpected failure');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,route='/admin/submission/CO-20260907-000000000001/merchant';
  const request=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
  const post=(url,fields,cookie,extra={})=>request(url,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie,...extra},body:new URLSearchParams(fields)});
  try {
    assert.equal((await request(route)).status,303);assert.equal((await post(route,{},'')).status,303);
    const login=await request('/admin/login'),loginHtml=await login.text(),csrfLogin=/name="csrf" value="([^"]+)"/.exec(loginHtml)[1];
    const signed=await post('/admin/login',{username:'owner',password,csrf:csrfLogin},login.headers.getSetCookie()[0].split(';')[0]);
    const cookie=signed.headers.getSetCookie()[0].split(';')[0],get=url=>request(url,{headers:{cookie}});
    const page=await get(route),html=await page.text();assert.equal(page.status,200);
    assert.match(html,/private-source@example.org/);assert.match(html,/name="shopName"[^>]*value=""/);
    const csrf=/name="csrf" value="([^"]+)"/.exec(html)[1];
    const fields={csrf,shopName:'已核实的店铺',shopUrl:'https://conversion-shop.com/',email:'owner@example.org',contact:'confirmed@example.org',details:'已补充核验材料',productAreas:'chatgpt',ownershipConfirmed:'true',permissionConfirmed:'true',note:'已核实归属及公开商品目录采集授权'};
    assert.equal((await post(route,fields,cookie,{origin:'https://evil.test'})).status,403);
    assert.equal((await post(route,{...fields,csrf:'forged'},cookie)).status,403);
    assert.equal((await post(route,{...fields,details:'x'.repeat(17000)},cookie)).status,413);
    for(const [url,status]of [['/admin/submission/CO-20260907-000000000002/merchant',422],['/admin/submission/FB-20260907-000000000001/merchant',404]]) {
      assert.equal((await get(url)).status,status);assert.equal((await post(url,fields,cookie)).status,status);
    }
    for(const change of [{ownershipConfirmed:'false'},{permissionConfirmed:'false'},{email:''},{email:'invalid'},{shopUrl:'https://127.0.0.1/'},{note:'no'}]) {
      const failed=await post(route,{...fields,...change},cookie);assert.equal(failed.status,422);
      const body=await failed.text();assert.match(body,/已核实的店铺/);assert.match(body,/已补充核验材料/);
      assert.doesNotMatch(body,/<input[^>]*type="checkbox"[^>]*checked/);
    }
    const secret='sk-abcdefghijklmnopqrstuvwxyz123456';
    const rejected=await post(route,{...fields,note:secret},cookie);assert.equal(rejected.status,422);assert.doesNotMatch(await rejected.text(),new RegExp(secret));
    const result=await post(route,fields,cookie);assert.equal(result.status,303);
    const destination=result.headers.get('location');assert.match(destination,/^\/admin\/merchants\/MA-/);
    const application=getMerchantApplication(submissionsDb,destination.split('/').at(-1));
    assert.equal(application.status,'pending');assert.equal(application.contact,'confirmed@example.org');
    const source=submissionsDb.prepare('SELECT status,contact FROM cooperation_submissions WHERE public_id=?').get('CO-20260907-000000000001');
    assert.equal(source.status,'new');assert.equal(source.contact,'private-source@example.org');
    assert.equal((await post(route,fields,cookie)).headers.get('location'),destination);
    assert.match(await(await get(route)).text(),new RegExp(destination));
    assert.match(await(await get(destination)).text(),/\/admin\/submission\/CO-20260907-000000000001/);
    const duplicate=await post('/admin/submission/CO-20260907-000000000003/merchant',{...fields,contact:'different@example.org'},cookie);
    assert.equal(duplicate.status,409);assert.match(await duplicate.text(),new RegExp(destination));
    assert.equal(submissionsDb.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,1);
    assert.equal(submissionsDb.prepare('SELECT COUNT(*) n FROM merchant_submission_links').get().n,1);
    assert.equal(submissionsDb.prepare('SELECT COUNT(*) n FROM merchant_preflight_requests').get().n,0);
    const aliasRoute='/admin/submission/CO-20260907-000000000004/merchant',aliasFields={...fields,shopUrl:'https://www.16688.com.cn/shop/XIAOQING2'};
    assert.equal((await post(aliasRoute,{...aliasFields,ownershipConfirmed:'false'},cookie)).status,422);assert.equal(aliasCalls,0);
    const aliasResult=await post(aliasRoute,aliasFields,cookie);assert.equal(aliasResult.status,303);assert.equal(aliasCalls,1);
    const aliasApplication=getMerchantApplication(submissionsDb,aliasResult.headers.get('location').split('/').at(-1));
    assert.equal(aliasApplication.shopUrl,'https://www.16688.com.cn/shop/S332568');assert.equal(aliasApplication.status,'pending');
    assert.equal((await post(aliasRoute,aliasFields,cookie)).headers.get('location'),aliasResult.headers.get('location'));assert.equal(aliasCalls,1);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();submissionsDb.close();}
});
