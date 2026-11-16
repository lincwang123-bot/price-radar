import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createGoogleLogin,googleLoginConfiguration,validateGoogleClaims} from '../lib/account-google.mjs';
const env={PUBLIC_ORIGIN:'https://airadar.vip',GOOGLE_CLIENT_ID:'123-test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only-not-live-client-secret'};
function setup(){
 const db=new DatabaseSync(':memory:');let time=new Date('2026-09-12T06:00:00Z'),payload,options;
 const store=createRetentionStore(db,{secret:'google-fixture-secret-'.repeat(3),now:()=>time});
 const client={generateAuthUrl:o=>{options=o;return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams(o);},getToken:async o=>{assert.ok(o.codeVerifier);return {tokens:{id_token:'signed-test-token',access_token:'never-store-this'}};},verifyIdToken:async o=>{assert.equal(o.audience,env.GOOGLE_CLIENT_ID);assert.equal(o.idToken,'signed-test-token');return {getPayload:()=>payload||{iss:'https://accounts.google.com',sub:'google-subject-1',aud:env.GOOGLE_CLIENT_ID,email:'reader@gmail.com',email_verified:true,nonce:options.nonce,iat:+time/1000,exp:+time/1000+3600}};}};
 const service=createGoogleLogin({store,env,now:()=>time,clientFactory:()=>client});
 return {db,store,service,get options(){return options;},setPayload:p=>{payload=p;},advance:()=>{time=new Date(+time+601000);}};
}
test('Google credentials missing fail closed; client secret never enters authorize URL; PKCE and nonce required',async()=>{
 assert.equal(googleLoginConfiguration({}).configured,false);
 const f=setup();try{
  const flow=await f.service.start('//evil.example');
  assert.ok(flow.url.startsWith('https://accounts.google.com/'));assert.ok(!flow.url.includes(env.GOOGLE_CLIENT_SECRET));
  assert.equal(f.options.scope,'openid email');assert.equal(f.options.code_challenge_method,'S256');assert.ok(f.options.nonce);
  const state=new URL(flow.url).searchParams.get('state');
  await assert.rejects(f.service.complete({state,code:'code',browserToken:'x'.repeat(64)}),/Google/);
  const r=await f.service.complete({state,code:'code',browserToken:flow.browserToken});
  assert.equal(r.next,'/account');assert.equal(r.account.email,'reader@gmail.com');assert.equal(r.account.email_enabled,0);
  assert.equal(f.store.session(r.token).id,r.account.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM reader_google_flows').get().n,0);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM reader_google_identities').all()).includes('never-store-this'));
  await assert.rejects(f.service.complete({state,code:'code',browserToken:flow.browserToken}),/Google/);
 }finally{f.db.close();}
});
test('Google verified subject reuses account and retains watches; expired or cancelled flows cannot sign in',async()=>{
 const f=setup();try{
  const first=await f.service.start('/shop?id=one#reviews'),state=new URL(first.url).searchParams.get('state');
  const a=await f.service.complete({state,code:'code',browserToken:first.browserToken});
  f.store.saveWatch(a.account.id,{productKey:'chatgpt-plus',mode:'off'},{products:[{key:'chatgpt-plus'}],groups:[]});
  const second=await f.service.start('/submit-shop');
  const b=await f.service.complete({state:new URL(second.url).searchParams.get('state'),code:'code',browserToken:second.browserToken});
  assert.equal(b.account.id,a.account.id);assert.equal(b.next,'/submit-shop');assert.equal(f.store.watches(b.account.id).length,1);
  const expired=await f.service.start('/account');f.advance();
  await assert.rejects(f.service.complete({state:new URL(expired.url).searchParams.get('state'),code:'code',browserToken:expired.browserToken}),/Google/);
  const cancelled=await f.service.start('/account');
  await assert.rejects(f.service.complete({state:new URL(cancelled.url).searchParams.get('state'),error:'access_denied',browserToken:cancelled.browserToken}),/Google/);
 }finally{f.db.close();}
});
test('Google claims reject forged audience, issuer, nonce, expired/unverified and non-authoritative mailbox identities',()=>{
 const now=new Date('2026-09-12T06:00:00Z'),good={iss:'https://accounts.google.com',sub:'subject',aud:env.GOOGLE_CLIENT_ID,email:'reader@gmail.com',email_verified:true,nonce:'nonce',iat:+now/1000,exp:+now/1000+3600};
 assert.equal(validateGoogleClaims(good,{clientId:env.GOOGLE_CLIENT_ID,nonce:'nonce',now}).email,'reader@gmail.com');
 for(const patch of [{iss:'evil.example'},{aud:'wrong'},{azp:'wrong'},{nonce:'wrong'},{exp:+now/1000-1},{iat:+now/1000+1000},{email_verified:false},{email:'reader@third-party.example'},{sub:''}])assert.throws(()=>validateGoogleClaims({...good,...patch},{clientId:env.GOOGLE_CLIENT_ID,nonce:'nonce',now}),/Google/);
});
test('real Google SDK rejects forged JWT signatures before any account or session is created',async()=>{
 const db=new DatabaseSync(':memory:'),store=createRetentionStore(db,{secret:'real-sdk-test-only-'.repeat(4)});
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=keys.publicKey.export({type:'spki',format:'pem'});
 let nonce='',forged=true;
 const service=createGoogleLogin({store,env,clientFactory:options=>{
  const client=new OAuth2Client(options),generate=client.generateAuthUrl.bind(client);
  client.generateAuthUrl=o=>{nonce=o.nonce;return generate(o);};
  client.getFederatedSignonCertsAsync=async()=>({certs:{fixture:publicKey},format:'PEM'});
  client.getToken=async()=>{
   const seconds=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
   const value=encode({alg:'RS256',kid:'fixture'})+'.'+encode({iss:'https://accounts.google.com',sub:'real-sdk-fixture',aud:env.GOOGLE_CLIENT_ID,email:'signed@gmail.com',email_verified:true,nonce,iat:seconds,exp:seconds+3600});
   const signature=sign('RSA-SHA256',Buffer.from(value),keys.privateKey);if(forged)signature[0]^=1;
   return {tokens:{id_token:value+'.'+signature.toString('base64url')}};
  };return client;
 }});
 try{
  const a=await service.start('/account');await assert.rejects(service.complete({state:new URL(a.url).searchParams.get('state'),code:'fixture',browserToken:a.browserToken}),/Google/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_accounts').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_sessions').get().n,0);
  forged=false;const b=await service.start('/account');const logged=await service.complete({state:new URL(b.url).searchParams.get('state'),code:'fixture',browserToken:b.browserToken});
  assert.equal(store.session(logged.token).email,'signed@gmail.com');
 }finally{db.close();}
});
