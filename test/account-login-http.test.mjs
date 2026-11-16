import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createApp} from '../lib/web.mjs';

test('email-only HTTP signup and Google callback preserve session boundaries and merchant gate',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:');let authOptions;
 const env={PUBLIC_ORIGIN:'https://airadar.vip',MERCHANT_SMTP_HOST:'fixture.example',MERCHANT_SMTP_PORT:'465',MERCHANT_SMTP_USER:'test',MERCHANT_SMTP_PASSWORD:'test',MERCHANT_MAIL_FROM:'notice@airadar.vip',GOOGLE_CLIENT_ID:'123-test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'only-a-test-secret-not-live'};
 const googleClientFactory=()=>({generateAuthUrl:o=>{authOptions=o;return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams(o);},getToken:async()=>({tokens:{id_token:'fixture'}}),verifyIdToken:async()=>({getPayload:()=>({iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'one-google-subject',email:'reader@gmail.com',email_verified:true,nonce:authOptions.nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})})});
 const server=createApp({db,submissionsDb:privateDb,retentionOptions:{env,secret:'fixture-http-only'.repeat(4),googleClientFactory,mailTransport:{sendMail:async()=>assert.fail('no mail during test')}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,jar=new Map();let csrf;
 const remember=r=>{for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');jar.set(k,v);}};
 const cookie=()=>[...jar].map(([k,v])=>k+'='+v).join('; ');
 const get=async(path,cookieOverride)=>{const r=await fetch(base+path,{headers:{Cookie:cookieOverride??cookie()},redirect:'manual'});remember(r);return r;};
 const state=async()=>{const s=await(await get('/api/retention/state')).json();csrf=s.csrf;return s;};
 const post=async(action,body,headers={})=>{const r=await fetch(base+'/api/retention/'+action,{method:'POST',headers:{Origin:env.PUBLIC_ORIGIN,Cookie:cookie(),'Content-Type':'application/json','X-CSRF-Token':csrf,...headers},body:JSON.stringify(body)});remember(r);return r;};
 try{
  const anonymousHome=await get('/');assert.equal(anonymousHome.headers.get('x-price-radar-home-cache'),'MISS');await anonymousHome.text();
  assert.equal((await get('/')).headers.get('x-price-radar-home-cache'),'HIT');
  assert.equal((await state()).googleConfigured,true);
  const registration=await(await get('/register')).text();assert.match(registration,/data-google-login/);assert.match(registration,/使用 Google 账号登录/);assert.match(registration,/\/assets\/brands\/google-g\.png\?v=/);assert.ok(!registration.includes(env.GOOGLE_CLIENT_SECRET));
  assert.match((await get('/assets/brands/google-g.png')).headers.get('content-type'),/image\/png/);
  assert.equal((await post('request-code',{email:'reader@gmail.com',purpose:'email',consent:false})).status,400);
  const {requestId}=await(await post('request-code',{email:'reader@gmail.com',purpose:'email',consent:true})).json();
  const code=JSON.parse(privateDb.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+requestId).payload).code;
  const login=await post('email-login',{requestId,code});assert.equal(login.status,200);assert.match(login.headers.getSetCookie().find(c=>c.startsWith('airadar_reader=')),/HttpOnly; SameSite=Lax; Secure/);
  const reader=await state();assert.equal(reader.account.hasPassword,false);assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM reader_profiles').get().n,0);
  const signedHome=await get('/');assert.equal(signedHome.headers.get('x-price-radar-home-cache'),null);assert.match(await signedHome.text(),/data-reader-nav href="\/account"/);
  const anotherVisitor=await get('/','');assert.match(await anotherVisitor.text(),/data-reader-nav href="\/login"/);
  assert.equal(reader.account.googleLinked,false);
  assert.match(await(await get('/account')).text(),/可用登录方式<\/dt><dd>邮箱验证码<\/dd>/);
  assert.equal((await get('/submit-shop')).headers.get('location'),'/account?next=%2Fsubmit-shop');
  assert.equal((await get('/account?next=%2Fsubmit-shop')).status,200);
  const firstSession=jar.get('airadar_reader');
  assert.equal((await post('google-start',{consent:true},{Origin:'https://evil.example'})).status,403);
  assert.equal((await post('google-start',{consent:false})).status,400);
  const started=await post('google-start',{next:'/submit-shop',consent:true});assert.equal(started.status,200);assert.match(started.headers.getSetCookie()[0],/Max-Age=600; HttpOnly; SameSite=Lax; Secure/);
  const target=new URL((await started.json()).url),callback='/api/retention/google-callback?state='+target.searchParams.get('state')+'&code=fixture';
  // A different browser cannot consume this flow or rotate the existing login.
  const browserJar=cookie();assert.equal((await get(callback,'')).headers.get('location'),'/login?auth_error=google');
  for(const c of browserJar.split('; ')){const [k,v]=c.split('=');jar.set(k,v);}
  const completed=await get(callback);assert.equal(completed.status,303);assert.equal(completed.headers.get('location'),'/submit-shop');assert.notEqual(jar.get('airadar_reader'),firstSession);
  assert.equal((await state()).account.email,'reader@gmail.com');assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM retention_accounts').get().n,1);
  assert.equal((await state()).account.googleLinked,true);
  assert.match(await(await get('/account')).text(),/可用登录方式<\/dt><dd>Google \/ 邮箱验证码<\/dd>/);
  assert.equal((await(await get('/api/retention/state','airadar_reader='+firstSession)).json()).account,null);
  await state();assert.notEqual((await get('/admin')).status,200);
  assert.equal((await get(callback)).headers.get('location'),'/login?auth_error=google');
  assert.equal((await post('delete-account',{})).status,200);assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM reader_google_identities').get().n,0);
 }finally{await new Promise(r=>server.close(r));await server.retentionWorkflowDone();await server.merchantWorkflowDone();db.close();privateDb.close();}
});
