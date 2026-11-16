import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createApp} from '../lib/web.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createAccountAuth} from '../lib/account-auth.mjs';
import {normalizeAccountProfile,accountProfile} from '../lib/account-profile.mjs';

const profile={phone:'10000000000',contactType:'telegram',contactValue:'@fixture_owner'},password='merchant profile password 73';
test('商家资料单独校验，手机号仅格式检查，旧注册接口提供资料时仍验证完整性',async()=>{
 const db=openSubmissionsDb(':memory:'),store=createRetentionStore(db,{secret:'fixture-profile-secret'.repeat(3)}),auth=createAccountAuth(store);
 try{
  for(const invalid of [{},{...profile,phone:'123'},{...profile,phone:'10000000000<script>'},{...profile,phone:'12000138000'},{...profile,contactType:'email'},{...profile,contactValue:''},{...profile,contactType:'qq',contactValue:'abc'}])assert.throws(()=>normalizeAccountProfile(invalid),e=>e.status===422);
  assert.deepEqual(normalizeAccountProfile(profile),{phone:'10000000000',contactType:'telegram',contactValue:'fixture_owner',phoneVerified:false});
  assert.equal(normalizeAccountProfile({...profile,phone:'+1 (415) 555-2671'}).phone,'+10000000000');
  const challenge=auth.requestCode('merchant@example.org','fixture','register'),code=JSON.parse(db.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+challenge.requestId).payload).code;
  await assert.rejects(auth.register({...challenge,code,password,...profile,contactValue:''}),/联系账号/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reader_profiles').get().n,0);
  const a=await auth.register({...challenge,code,password,...profile});
  assert.deepEqual(accountProfile(db,a.account.id),{...normalizeAccountProfile(profile),phoneVerifiedAt:null});
  assert.equal(a.account.email,'merchant@example.org');
 }finally{db.close();}
});
test('商家提交要求登录和完整资料，忽略伪造联系信息；旧账号补资料、会话失效和删除路径',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:');
 const server=createApp({db,submissionsDb:privateDb,retentionOptions:{env:{},secret:'fixture-profile-secret'.repeat(3)}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const store=createRetentionStore(privateDb,{secret:'fixture-profile-secret'.repeat(3)}),auth=createAccountAuth(store);
 const cookies=new Map();let readerCsrf;
 const cookie=()=>[...cookies].map(([k,v])=>k+'='+v).join('; ');
 const remember=r=>{for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');cookies.set(k,v);}};
 const state=async()=>{const r=await fetch(base+'/api/retention/state',{headers:{cookie:cookie()}});remember(r);const value=await r.json();readerCsrf=value.csrf;return value;};
 const postProfile=body=>fetch(base+'/api/retention/profile',{method:'POST',headers:{cookie:cookie(),origin:base,'content-type':'application/json','x-csrf-token':readerCsrf},body:JSON.stringify(body)});
 const submission={shopName:'账号测试商店',shopUrl:'https://account-fixture.com/',productAreas:['chatgpt'],platform:'auto',consent:true,email:'forged@example.org',contact:'forged_contact',phone:'10000000000',applicantAccountId:'forged-id'};
 let csrf;
 const send=()=>fetch(base+'/api/merchant-applications',{method:'POST',headers:{cookie:cookie(),origin:base,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(submission)});
 try{
  assert.equal((await fetch(base+'/')).status,200);
  let r=await fetch(base+'/submit-shop?shop=demo',{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login?next=%2Fsubmit-shop%3Fshop%3Ddemo');
  const guestForm=await fetch(base+'/submit');remember(guestForm);csrf=(await guestForm.text()).match(/name="csrf-token" content="([^"]+)"/)[1];
  r=await send();assert.equal(r.status,401);assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,0);
  const challenge=auth.requestCode('merchant@example.org','fixture','email'),code=JSON.parse(privateDb.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+challenge.requestId).payload).code;
  const registered=auth.emailLogin({...challenge,code});cookies.set('airadar_reader',registered.token);
  assert.equal(auth.hasPassword(registered.account.id),false);assert.equal(accountProfile(privateDb,registered.account.id),null);
  r=await fetch(base+'/submit-shop',{headers:{cookie:cookie()},redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/account?next=%2Fsubmit-shop');
  r=await send();assert.equal(r.status,422);
  await state();r=await postProfile({...profile,phone:'123'});assert.equal(r.status,422);
  r=await postProfile({...profile,accountId:'someone-else'});assert.equal(r.status,200);assert.equal(accountProfile(privateDb,'someone-else'),null);
  r=await send();assert.equal(r.status,422,'unverified account cannot submit while verification is required');
  r=await postProfile({...profile,phone:'+1 (202) 555-0123'});assert.equal(r.status,200);
  r=await send();assert.equal(r.status,422,'non-mainland number cannot submit through the existing SMS flow');
  r=await postProfile(profile);assert.equal(r.status,200);
  privateDb.prepare('INSERT INTO reader_phone_verifications(account_id,phone,verified_at) VALUES(?,?,?)').run(registered.account.id,'10000000000',new Date().toISOString());
  const accountState=await state();assert.ok(!JSON.stringify(accountState).includes('10000000000'),'general state endpoint need not distribute private contact data');
  r=await fetch(base+'/submit-shop',{headers:{cookie:cookie()}});remember(r);const html=await r.text();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.ok(html.includes('10000000000'));assert.ok(html.includes('readonly value="merchant@example.org"'));assert.ok(!html.includes('cloudflareinsights.com'));
  csrf=html.match(/name="csrf-token" content="([^"]+)"/)[1];r=await send();assert.equal(r.status,201);
  const row=privateDb.prepare('SELECT * FROM merchant_applications').get();assert.equal(row.applicant_account_id,registered.account.id);assert.equal(row.phone,'10000000000');assert.equal(row.email,'merchant@example.org');assert.equal(row.contact,'TG：fixture_owner');
  assert.ok(!(await(await fetch(base+'/')).text()).includes('fixture_owner'));
  await state();r=await fetch(base+'/api/retention/delete-account',{method:'POST',headers:{cookie:cookie(),origin:base,'content-type':'application/json','x-csrf-token':readerCsrf},body:'{}'});assert.equal(r.status,200);
  assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM reader_profiles').get().n,0);assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM merchant_applications').get().n,1);
  r=await send();assert.equal(r.status,401);assert.equal((await state()).account,null);
 }finally{await new Promise(r=>server.close(r));await server.retentionWorkflowDone();await server.merchantWorkflowDone();db.close();privateDb.close();}
});
