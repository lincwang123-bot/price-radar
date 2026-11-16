import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {get as httpGet} from 'node:http';
import {openDb} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';

test('HTTP guide cache preserves reads, canonical HTML, session navigation and CSRF boundaries',async()=>{
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:'),analytics=openAnalytics(':memory:','content-cache-http-only'.repeat(3));
 let app;
 try{
  app=createApp({db,submissionsDb:privateDb,analytics,
   adminOptions:{merchantBridgeDir:'',merchantPreflightResultsDir:''},
   retentionOptions:{env:{},secret:'content-cache-session-only'.repeat(3)},
   adsenseEnv:{ADSENSE_PUBLISHER_ID:'pub-1234567890123456',ADSENSE_MODE:'guide',ADSENSE_GUIDE_SLOT:'123456',ADSENSE_PILOT_READY:'true'}});
  const accountId='1'.repeat(32),session='a'.repeat(64),sessionCookie='airadar_reader='+session,email='cache-reader@example.com';
  privateDb.prepare('INSERT INTO retention_accounts(id,email,created_at,email_enabled) VALUES(?,?,?,1)').run(accountId,email,new Date().toISOString());
  privateDb.prepare('INSERT INTO retention_sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),accountId,new Date(Date.now()+86400000).toISOString());
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.address().port,path='/guides/chatgpt-plus-delivery';
  const get=(target=path,headers={},method='GET')=>fetch(base+target,{method,redirect:'manual',headers:{'user-agent':'Mozilla/5.0 Chrome/125','cf-connecting-ip':'8.8.8.8',...headers}});
  const read=async(target=path,headers={},method='GET')=>{const response=await get(target,headers,method);return {response,html:await response.text()};};
  const assertPublic=result=>{
   assert.equal(result.response.status,200);assert.equal(result.response.headers.get('cache-control'),'no-store');
   assert.equal(result.response.headers.get('set-cookie'),null);assert.equal(result.response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(result.response.headers.get('x-frame-options'),'DENY');
   assert.match(result.html,/<link rel="canonical" href="https:\/\/airadar\.vip\/guides\/chatgpt-plus-delivery"/);
   assert.match(result.html,/data-reader-nav href="\/login"/);assert.doesNotMatch(result.html,/<meta[^>]+name="csrf-token"/);
   assert.doesNotMatch(result.html,/cache-reader@example\.com/);
  };
  const first=await read();assertPublic(first);assert.equal(first.response.headers.get('x-price-radar-content-cache'),'MISS');
  assert.match(first.html,/data-ad-client="ca-pub-1234567890123456"/,'the static ad slot survives caching without generating a sponsor token');
  const hit=await read(path,{'cf-connecting-ip':'1.1.1.1','x-forwarded-proto':'https'});assertPublic(hit);
  assert.equal(hit.response.headers.get('x-price-radar-content-cache'),'HIT');assert.equal(hit.html,first.html);
  assert.equal(hit.response.headers.get('strict-transport-security'),'max-age=15552000','per-request security headers still run before a cache hit');
  const head=await read(path,{},'HEAD');assert.equal(head.response.headers.get('x-price-radar-content-cache'),'HIT');
  assert.equal(head.html,'');assert.equal(head.response.headers.get('cache-control'),'no-store');
  await new Promise(setImmediate);
  assert.equal(analytics.report().pv,2);assert.equal(analytics.report().uv,2);
  assert.equal(analytics.contentReport().rows.find(row=>row.path===path).views,2,'both GET requests count, and HEAD does not');

  const signed=await read(path,{cookie:sessionCookie});
  assert.equal(signed.response.headers.get('x-price-radar-content-cache'),null);assert.equal(signed.response.headers.get('cache-control'),'no-store');
  assert.match(signed.html,/data-reader-nav href="\/account"/);assert.doesNotMatch(signed.html,/data-reader-nav href="\/login"/);
  const anonymous=await read();assertPublic(anonymous);assert.equal(anonymous.response.headers.get('x-price-radar-content-cache'),'HIT');assert.equal(anonymous.html,first.html);
  await new Promise(setImmediate);assert.equal(analytics.report().pv,4);assert.equal(analytics.contentReport().rows.find(row=>row.path===path).views,4);
  for(const headers of [{cookie:'airadar_admin=fixture'},{cookie:'airadar_csrf=fixture'},{cookie:'airadar_reader_csrf=fixture'},{authorization:'Bearer fixture'}]){
   const bypass=await read(path,headers);assert.equal(bypass.response.headers.get('x-price-radar-content-cache'),null);assertPublic(bypass);
  }

  // State responses generate independent CSRF cookies and never enter HTML caching.
  const stateA=await get('/api/retention/state'),stateBodyA=await stateA.json();
  const stateB=await get('/api/retention/state'),stateBodyB=await stateB.json();
  for(const response of [stateA,stateB]){assert.equal(response.headers.get('x-price-radar-content-cache'),null);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('set-cookie'),/airadar_reader_csrf=/);}
  assert.equal(stateBodyA.account,null);assert.equal(stateBodyB.account,null);assert.notEqual(stateBodyA.csrf,stateBodyB.csrf);
  const csrfCookie=stateA.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const stateSigned=await get('/api/retention/state',{cookie:sessionCookie+'; '+csrfCookie});
  assert.equal((await stateSigned.json()).account.email,email);assert.equal(stateSigned.headers.get('set-cookie'),null);
  const csrfBypass=await read(path,{cookie:csrfCookie});assertPublic(csrfBypass);assert.equal(csrfBypass.response.headers.get('x-price-radar-content-cache'),null);
  for(const headers of [{Origin:base},{Origin:'https://other.example','X-CSRF-Token':stateBodyA.csrf}]){
   const rejected=await fetch(base+'/api/retention/email',{method:'POST',headers:{Cookie:sessionCookie+'; '+csrfCookie,'Content-Type':'application/json',...headers},body:JSON.stringify({enabled:false})});
   await rejected.text();assert.equal(rejected.status,403);assert.equal(rejected.headers.get('x-price-radar-content-cache'),null);
  }
  assert.equal(privateDb.prepare('SELECT email_enabled FROM retention_accounts WHERE id=?').get(accountId).email_enabled,1);

  const query=await read(path+'?utm_source=fixture');assertPublic(query);assert.equal(query.response.headers.get('x-price-radar-content-cache'),null);
  for(const [target,headers,location] of [[path+'/',{},path],[path,{'x-forwarded-proto':'http'},'https://airadar.vip'+path]]){
   const redirect=await read(target,headers);assert.equal(redirect.response.status,301,JSON.stringify({target,headers}));assert.equal(redirect.response.headers.get('location'),location);assert.equal(redirect.response.headers.get('x-price-radar-content-cache'),null);
  }
  // Node fetch can normalize Host; use a loopback HTTP request to exercise the
  // actual forwarded host without contacting the public website.
  const hostRedirect=await new Promise((resolve,reject)=>{
   httpGet(base+path,{headers:{Host:'www.airadar.vip'},agent:false},response=>{response.resume();response.once('end',()=>resolve({status:response.statusCode,headers:response.headers}));}).once('error',reject);
  });
  assert.equal(hostRedirect.status,301);assert.equal(hostRedirect.headers.location,'https://airadar.vip'+path);assert.equal(hostRedirect.headers['x-price-radar-content-cache'],undefined);
  const missing=await read('/guides/not-published');assert.equal(missing.response.status,404);assert.equal(missing.response.headers.get('x-price-radar-content-cache'),null);
  const coldHead=await read('/help/compare-prices',{},'HEAD');assert.equal(coldHead.html,'');assert.equal(coldHead.response.headers.get('x-price-radar-content-cache'),null);
  const help=await read('/help/compare-prices');assert.equal(help.response.headers.get('x-price-radar-content-cache'),'MISS');assert.doesNotMatch(help.html,/data-ad-client=/);
  assert.equal((await read('/help/compare-prices')).response.headers.get('x-price-radar-content-cache'),'HIT');
  assert.equal((await read()).html,first.html,'bypassed requests and CSRF responses never replace anonymous guide HTML');
 }finally{
  if(app?.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));assert.equal(app.listening,false);assert.equal(app.address(),null);}
  await app?.retentionWorkflowDone?.();await app?.merchantWorkflowDone?.();await new Promise(setImmediate);
  analytics.close();privateDb.close();db.close();
 }
});
