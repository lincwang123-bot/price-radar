import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createAccountAuth, safeAccountReturn} from '../lib/account-auth.mjs';
import {createApp} from '../lib/web.mjs';
import {openDb} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {retentionMessage,drainRetentionMail} from '../lib/retention-mail.mjs';

const password='a private test passphrase 73';
function setup(){
 const db=new DatabaseSync(':memory:');let time=new Date('2026-09-08T10:00:00Z');
 const store=createRetentionStore(db,{secret:'test-secret-'.repeat(8),now:()=>time});
 const auth=createAccountAuth(store,{now:()=>time});
 const code=(email='reader@example.com',purpose='register')=>{
  const {requestId}=auth.requestCode(email,'fixture',purpose);
  const payload=db.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+requestId);
  return {requestId,code:payload?JSON.parse(payload.payload).code:'000000'};
 };
 return {db,store,auth,code,advance:ms=>{time=new Date(+time+ms);}};
}
test('注册必须验证邮箱并设置密码；密码加盐存储，账号会话隔离',async()=>{
 const f=setup();try{
  const challenge=f.code();
  await assert.rejects(f.auth.register({...challenge,password:'short'}),/15/);
  await assert.rejects(f.auth.register({...challenge,code:'000000',password}),/验证码/);
  const a=await f.auth.register({...challenge,password});
  assert.equal(f.store.session(a.token).email,'reader@example.com');
  assert.equal(a.account.email_enabled,0,'registration must not opt into reminders');
  const saved=f.db.prepare('SELECT * FROM reader_credentials').get();
  assert.match(saved.password_hash,/^scrypt\$131072\$8\$1\$/);
  assert.ok(!saved.password_hash.includes(password));
  await assert.rejects(f.auth.register({...challenge,password}),/验证码/);
  const logged=await f.auth.login('READER@example.com',password,'local');
  assert.equal(logged.account.id,a.account.id);assert.notEqual(logged.token,a.token);
  await assert.rejects(f.auth.login('reader@example.com','incorrect password value','local'),/邮箱或密码不正确/);
  await assert.rejects(f.auth.login('missing@example.com',password,'local'),/邮箱或密码不正确/);
  assert.equal(f.store.watches(logged.account.id).length,0);
 }finally{f.db.close();}
});
test('重置码绑定用途、用后失效；重置撤销全部会话，不自动登录',async()=>{
 const f=setup();try{
  const first=await f.auth.register({...f.code(),password});
  f.advance(61000);const challenge=f.code('reader@example.com','reset');
  await assert.rejects(f.auth.register({...challenge,password}),/验证码/);
  assert.throws(()=>f.store.verifyCode(challenge.requestId,challenge.code),/验证码/);
  const result=await f.auth.reset({...challenge,password:password+' new'});
  assert.deepEqual(result,{ok:true});assert.equal(f.store.session(first.token),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM retention_sessions').get().n,0);
  await assert.rejects(f.auth.reset({...challenge,password}),/验证码/);
  await assert.rejects(f.auth.login('reader@example.com',password,'local'),/邮箱或密码/);
  assert.ok((await f.auth.login('reader@example.com',password+' new','local')).token);
 }finally{f.db.close();}
});
test('已有无密码邮箱账号设置密码时保留原 ID、关注和退订状态',async()=>{
 const f=setup();try{
  const r=f.store.requestCode('reader@example.com','legacy');
  const legacy=f.store.verifyCode(r.requestId,JSON.parse(f.db.prepare('SELECT payload FROM retention_mail').get().payload).code);
  f.store.setEmail(legacy.account.id,false);
  f.store.saveWatch(legacy.account.id,{productKey:'chatgpt-plus',mode:'off'},{products:[{key:'chatgpt-plus'}],groups:[]});
  f.advance(61000);
  const a=await f.auth.register({...f.code(),password});
  assert.equal(a.account.id,legacy.account.id);assert.equal(a.account.email_enabled,0);
  assert.equal(f.store.watches(a.account.id).length,1);assert.equal(f.store.session(legacy.token),null);
  f.advance(61000);
  await assert.rejects(f.auth.register({...f.code(),password:password+' other'}),/已设置密码/);
 }finally{f.db.close();}
});
test('验证码五次错误、过期、限流及并发提交不会重复创建账号或覆盖密码',async()=>{
 const f=setup();try{
  const bad=f.code();for(let i=0;i<5;i++)await assert.rejects(f.auth.register({...bad,code:'000000',password}),/验证码/);
  await assert.rejects(f.auth.register({...bad,password}),/验证码/);
  f.advance(61000);const expired=f.code();f.advance(601000);
  await assert.rejects(f.auth.register({...expired,password}),/验证码/);
  const good=f.code();const results=await Promise.allSettled([f.auth.register({...good,password}),f.auth.register({...good,password:password+'2'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM retention_accounts').get().n,1);
  assert.throws(()=>f.code(),e=>e.status===429);
 }finally{f.db.close();}
});
test('登录限流持久化，重置不存在的账号不会发信或创建账号',async()=>{
 const f=setup();try{
  await f.auth.register({...f.code(),password});
  for(let i=0;i<10;i++)await assert.rejects(f.auth.login('reader@example.com','wrong but long password','client'),e=>e.status===401);
  const restarted=createAccountAuth(f.store,{now:()=>new Date('2026-09-08T10:00:30Z')});
  await assert.rejects(restarted.login('reader@example.com',password,'client'),e=>e.status===429);
  const count=f.db.prepare('SELECT COUNT(*) n FROM retention_mail').get().n;
  f.auth.requestCode('unknown@example.com','another','reset');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM retention_mail').get().n,count);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM retention_accounts').get().n,1);
 }finally{f.db.close();}
});
test('登录后返回地址仅允许站内业务页，不接受跨站、控制字符或后台跳转',()=>{
 assert.equal(safeAccountReturn('/following?product=chatgpt-plus'),'/following?product=chatgpt-plus');
 for(const value of ['https://evil.example','//evil.example','/\\evil.example','/admin','/api/retention/logout','/login','/%2f%2fevil.example','/following\n'])assert.equal(safeAccountReturn(value),'/account');
});
test('HTTP 注册登录退出完整链路：CSRF、Cookie、安全头、旧接口关闭和后台权限隔离',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:');
 const env={PUBLIC_ORIGIN:'https://airadar.vip',MERCHANT_SMTP_HOST:'smtp.example.com',MERCHANT_SMTP_PORT:'465',MERCHANT_SMTP_USER:'test',MERCHANT_SMTP_PASSWORD:'test',MERCHANT_MAIL_FROM:'notice@airadar.vip'};
 const server=createApp({db,submissionsDb:privateDb,retentionOptions:{env,secret:'test-secret-'.repeat(8),mailTransport:{sendMail:async()=>assert.fail('no live mail in HTTP test')}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;const jar=new Map();let csrf;
 const remember=r=>{for(const item of r.headers.getSetCookie()){const [key,value]=item.split(';')[0].split('=');jar.set(key,value);}};
 const state=async()=>{const r=await fetch(origin+'/api/retention/state',{headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});remember(r);const value=await r.json();csrf=value.csrf;return value;};
 const post=async(action,input,headers={})=>{const r=await fetch(origin+'/api/retention/'+action,{method:'POST',headers:{Origin:env.PUBLIC_ORIGIN,'Content-Type':'application/json','X-CSRF-Token':csrf,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...headers},body:JSON.stringify(input)});remember(r);return r;};
 try{
  await state();
  let r=await fetch(origin+'/login');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(r.headers.get('content-security-policy'),/form-action 'self'/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.match(await r.text(),/type="password" autocomplete="current-password" required/);
  r=await fetch(origin+'/register');const html=await r.text();assert.match(html,/method="post" action="\/api\/retention\/register"/);assert.match(html,/name="password" type="password" autocomplete="new-password" required minlength="15"/);assert.ok(!html.includes('cloudflareinsights.com'));
  r=await fetch(origin+'/account',{redirect:'manual'});assert.equal(r.status,303);
  r=await post('login',{email:'reader@example.com',password},{Origin:'https://evil.example'});assert.equal(r.status,403);
  r=await post('request-code',{email:'reader@example.com',consent:true,purpose:'register'},{'X-CSRF-Token':'bad'});assert.equal(r.status,403);
  r=await post('request-code',{email:'reader@example.com',consent:true,purpose:'register'});assert.equal(r.status,200);const {requestId}=await r.json();
  const code=JSON.parse(privateDb.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+requestId).payload).code;
  r=await post('verify-code',{requestId,code});assert.equal(r.status,410);assert.equal((await state()).account,null);
  r=await post('register',{requestId,code,password});assert.equal(r.status,200);
  assert.match(r.headers.getSetCookie().find(c=>c.startsWith('airadar_reader=')),/HttpOnly; SameSite=Lax; Secure/);
  const firstToken=jar.get('airadar_reader');assert.equal((await state()).account.email,'reader@example.com');
  const cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');
  r=await fetch(origin+'/account',{headers:{Cookie:cookie}});assert.equal(r.status,200);const account=await r.text();assert.match(account,/我的账号/);assert.match(account,/reader@example.com/);assert.ok(!account.includes('scrypt$'));
  r=await fetch(origin+'/admin',{headers:{Cookie:cookie},redirect:'manual'});assert.notEqual(r.status,200,'reader session must not grant admin');
  r=await post('login',{email:'reader@example.com',password});assert.equal(r.status,200);assert.notEqual(jar.get('airadar_reader'),firstToken);await state();
  r=await fetch(origin+'/api/retention/state',{headers:{Cookie:'airadar_reader='+firstToken}});assert.equal((await r.json()).account,null);
  r=await post('logout',{});assert.equal(r.status,200);assert.equal((await state()).account,null);
 }finally{await new Promise(resolve=>server.close(resolve));await server.retentionWorkflowDone();await server.merchantWorkflowDone();db.close();privateDb.close();}
});
test('注册、重置邮件用途准确，不发送密码；第五次正确验证可完成',async()=>{
 const f=setup();try{
  const challenge=f.code();
  const row=f.db.prepare('SELECT * FROM retention_mail').get();
  const message=retentionMessage(f.store,row,{groups:[]},'notice@airadar.vip',{now:new Date('2026-09-08T10:00:00Z')});
  assert.match(message.subject,/AIradar.*注册/);assert.match(message.html,/验证码/);assert.ok(!message.text.includes(password));assert.ok(!message.headers?.['List-Unsubscribe']);
  let sent=0;
  const transport={sendMail:async mail=>{sent++;assert.match(mail.subject,/注册/);assert.ok(mail.text.includes(challenge.code));assert.ok(!mail.text.includes(password));return {accepted:[mail.to]};}};
  await drainRetentionMail(f.store,{groups:[]},{transport,from:'notice@airadar.vip',now:new Date('2026-09-08T10:00:00Z')});
  await drainRetentionMail(f.store,{groups:[]},{transport,from:'notice@airadar.vip',now:new Date('2026-09-08T10:00:00Z')});
  assert.equal(sent,1);assert.equal(f.db.prepare('SELECT payload FROM retention_mail').get().payload,'{}');
  for(let n=0;n<4;n++)await assert.rejects(f.auth.register({...challenge,password,code:'000000'}));
  await f.auth.register({...challenge,password});
  f.advance(61000);f.code('reader@example.com','reset');
  const reset=f.db.prepare('SELECT * FROM retention_mail ORDER BY id DESC LIMIT 1').get();
  assert.match(retentionMessage(f.store,reset,{groups:[]},'notice@airadar.vip',{now:new Date('2026-09-08T10:01:01Z')}).subject,/重置密码/);
 }finally{f.db.close();}
});
