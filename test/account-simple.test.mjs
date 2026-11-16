import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createAccountAuth} from '../lib/account-auth.mjs';
import {loginContent,accountContent} from '../lib/account-ui.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');let time=new Date('2026-09-12T06:00:00Z');
 const store=createRetentionStore(db,{secret:'simple-auth-test-secret-'.repeat(3),now:()=>time});
 const auth=createAccountAuth(store,{now:()=>time});
 const code=(email='simple@example.com',purpose='email')=>{
  const challenge=auth.requestCode(email,'test-client',purpose);
  return {...challenge,code:JSON.parse(db.prepare('SELECT payload FROM retention_mail WHERE event_key=?').get('code:'+challenge.requestId).payload).code};
 };
 return {db,store,auth,code,advance:()=>{time=new Date(+time+61000);}};
}
test('邮箱验证码创建普通用户，不采集商家资料、不强制密码、不订阅营销',()=>{
 const f=fixture();try{
  const challenge=f.code();assert.throws(()=>f.auth.emailLogin({...challenge,code:'000000'}),/验证码/);
  const a=f.auth.emailLogin(challenge);
  assert.equal(a.account.email,'simple@example.com');assert.equal(a.account.email_enabled,0);
  assert.equal(f.auth.hasPassword(a.account.id),false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM reader_profiles').get().n,0);
  assert.equal(f.store.session(a.token).id,a.account.id);
  assert.throws(()=>f.auth.emailLogin(challenge),/验证码/);
  f.advance();const again=f.auth.emailLogin(f.code());assert.equal(again.account.id,a.account.id);
 }finally{f.db.close();}
});
test('邮箱登录保留已有密码、资料、关注；验证码用途隔离和五次错误限制',async()=>{
 const f=fixture();try{
  const a=await f.auth.register({...f.code('simple@example.com','register'),password:'Keep-password-82!'});
  f.store.saveWatch(a.account.id,{productKey:'chatgpt-plus',mode:'off'},{products:[{key:'chatgpt-plus'}],groups:[]});
  f.advance();const challenge=f.code();
  await assert.rejects(f.auth.reset({...challenge,password:'New-password-92!'}),/验证码/);
  const logged=f.auth.emailLogin(challenge);assert.equal(logged.account.id,a.account.id);
  assert.equal(f.store.watches(a.account.id).length,1);
  assert.equal((await f.auth.login('simple@example.com','Keep-password-82!','client')).account.id,a.account.id);
  f.advance();const bad=f.code();for(let i=0;i<5;i++)assert.throws(()=>f.auth.emailLogin({...bad,code:'000000'}),/验证码/);
  assert.throws(()=>f.auth.emailLogin(bad),/验证码/);
 }finally{f.db.close();}
});
test('普通注册只展示邮箱和验证码；商家入口独立，账号页默认不要求商家资料',()=>{
 const html=loginContent('register',new URL('https://airadar.vip/register'));
 assert.match(html,/用户注册/);assert.match(html,/商家入驻/);assert.match(html,/name="email"/);assert.match(html,/name="code"/);
 assert.doesNotMatch(html,/name="phone"|name="contactType"|name="contactValue"|name="password"/);
 const account=accountContent({email:'simple@example.com'},false);
 assert.doesNotMatch(account,/data-profile-form|name="phone"/);
 assert.match(accountContent({email:'simple@example.com'},false,null,'/submit-shop'),/data-profile-form/);
});
