import {randomBytes} from 'node:crypto';
import {RetentionError} from './retention-store.mjs';
import {accountProfile,initAccountProfileSchema} from './account-profile.mjs';

const SUPPORTED=/^\+861[3-9]\d{9}$/;
const fail=(message,status=422)=>{throw new RetentionError(message,status);};
const TTL=300,COOLDOWN=60,MAX_ATTEMPTS=5;
export function createPhoneVerification({store,provider,now=()=>new Date(),env={},signal}={}){
 const db=store.db;initAccountProfileSchema(db);
 db.exec(`CREATE TABLE IF NOT EXISTS reader_phone_challenges(
  id TEXT PRIMARY KEY,account_id TEXT NOT NULL,phone_hash TEXT NOT NULL,client_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,provider_request_id TEXT);
  CREATE INDEX IF NOT EXISTS reader_phone_account ON reader_phone_challenges(account_id,created_at);
  CREATE INDEX IF NOT EXISTS reader_phone_number ON reader_phone_challenges(phone_hash,created_at);
  CREATE INDEX IF NOT EXISTS reader_phone_client ON reader_phone_challenges(client_hash,created_at);
  CREATE INDEX IF NOT EXISTS reader_phone_created ON reader_phone_challenges(created_at);
  CREATE TABLE IF NOT EXISTS reader_phone_send_limits(
   id TEXT PRIMARY KEY,account_hash TEXT NOT NULL,phone_hash TEXT NOT NULL,client_hash TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS reader_phone_limit_account ON reader_phone_send_limits(account_hash,created_at);
  CREATE INDEX IF NOT EXISTS reader_phone_limit_number ON reader_phone_send_limits(phone_hash,created_at);
  CREATE INDEX IF NOT EXISTS reader_phone_limit_client ON reader_phone_send_limits(client_hash,created_at);
  CREATE INDEX IF NOT EXISTS reader_phone_limit_created ON reader_phone_send_limits(created_at);
  CREATE TRIGGER IF NOT EXISTS reader_phone_challenge_phone_changed AFTER UPDATE OF phone ON reader_profiles WHEN OLD.phone IS NOT NEW.phone BEGIN
   UPDATE reader_phone_challenges SET status='invalid' WHERE account_id=OLD.account_id AND status IN ('sending','sent','verifying');
  END;
  CREATE TRIGGER IF NOT EXISTS reader_phone_challenge_profile_deleted AFTER DELETE ON reader_profiles BEGIN
   DELETE FROM reader_phone_challenges WHERE account_id=OLD.account_id;
  END;`);
 const stamp=()=>now().toISOString(),phoneHash=phone=>store.digest('phone-verification|'+phone);
 const configured=!!provider?.configured;
 const configuredLimit=Number(env.AIRADAR_SMS_DAILY_LIMIT??100);
 const dailyLimit=Number.isSafeInteger(configuredLimit)&&configuredLimit>=1&&configuredLimit<=10000?configuredLimit:100;
 function profile(id){if(!store.account(id))fail('请先登录',401);const p=accountProfile(db,id);if(!p)fail('请先保存商家联系资料');return p;}
 function available(id){const p=profile(id);if(!SUPPORTED.test(p.phone))fail('目前仅支持中国大陆 +86 手机号');if(!configured)fail('短信验证暂未开通，请稍后再试',503);return p;}
 function atomic(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
 function readChallenge(id,challengeId){
  if(typeof challengeId!=='string'||! /^[a-f0-9]{48}$/.test(challengeId))fail('验证码无效或已过期，请重新获取');
  const row=db.prepare('SELECT * FROM reader_phone_challenges WHERE id=? AND account_id=?').get(challengeId,id),p=profile(id);
  if(!row||row.status!=='sent'||row.expires_at<=stamp()||row.attempts>=MAX_ATTEMPTS||row.phone_hash!==phoneHash(p.phone))fail('验证码无效或已过期，请重新获取');
  return {row,p};
 }
 return {
  configured,
  state(id){
   if(!store.account(id))fail('请先登录',401);const p=accountProfile(db,id);
   return {configured,hasProfile:!!p,supported:!!p&&SUPPORTED.test(p.phone),phoneVerified:!!p?.phoneVerified,phoneVerifiedAt:p?.phoneVerifiedAt||null};
  },
  async requestCode(id,client){
   const p=available(id);if(p.phoneVerified)fail('手机号已验证，无需重复发送',409);
   const challengeId=randomBytes(24).toString('hex'),createdAt=stamp(),numberHash=phoneHash(p.phone),clientHash=store.digest('phone-client|'+String(client)),accountHash=store.digest('phone-account|'+id);
   atomic(()=>{
    // Reserve every attempted send before I/O, across workers and restarts.
    const cutoff=new Date(+now()-86400000).toISOString(),recent=new Date(+now()-COOLDOWN*1000).toISOString();
    if(db.prepare('SELECT 1 FROM reader_phone_send_limits WHERE (account_hash=? OR phone_hash=?) AND created_at>? LIMIT 1').get(accountHash,numberHash,recent))fail('请等待 60 秒后再获取验证码',429);
    for(const [column,value,limit] of [['account_hash',accountHash,5],['phone_hash',numberHash,5],['client_hash',clientHash,20]]){
     if(db.prepare(`SELECT COUNT(*) n FROM reader_phone_send_limits WHERE ${column}=? AND created_at>=?`).get(value,cutoff).n>=limit)fail('今天的验证码发送次数已达上限，请稍后再试',429);
    }
    if(db.prepare('SELECT COUNT(*) n FROM reader_phone_send_limits WHERE created_at>=?').get(cutoff).n>=dailyLimit)fail('短信验证暂时繁忙，请稍后再试',429);
    // Keep only keyed digests for 24h even after account deletion, so deleting
    // and re-registering cannot reset paid SMS phone/IP/global budgets.
    db.prepare('INSERT INTO reader_phone_send_limits VALUES(?,?,?,?,?)').run(challengeId,accountHash,numberHash,clientHash,createdAt);
    db.prepare("UPDATE reader_phone_challenges SET status='invalid' WHERE (account_id=? OR phone_hash=?) AND status IN ('sending','sent','verifying')").run(id,numberHash);
    db.prepare("INSERT INTO reader_phone_challenges(id,account_id,phone_hash,client_hash,created_at,expires_at,status) VALUES(?,?,?,?,?,?,'sending')").run(challengeId,id,numberHash,clientHash,createdAt,new Date(+now()+TTL*1000).toISOString());
   });
   let result;
   try{result=await provider.send({phone:p.phone,outId:challengeId,signal});}
   catch(error){
    db.prepare("UPDATE reader_phone_challenges SET status=? WHERE id=? AND status='sending'").run(error?.uncertain===false?'failed':'uncertain',challengeId);
    fail('验证码发送未能确认，请稍后重新获取',503);
   }
   const current=accountProfile(db,id);
   if(!store.account(id)||current?.phone!==p.phone||db.prepare("UPDATE reader_phone_challenges SET status='sent',provider_request_id=? WHERE id=? AND status='sending' AND expires_at>?").run(result?.requestId||null,challengeId,stamp()).changes!==1)fail('联系资料已变化或验证码已过期，请重新获取',409);
   return {challengeId,expiresIn:TTL,retryAfter:COOLDOWN};
  },
  async verifyCode(id,{challengeId,code}={}){
   available(id);if(typeof code!=='string'||!/^\d{6}$/.test(code))fail('请输入 6 位数字验证码');
   const {row,p}=atomic(()=>{
    const current=readChallenge(id,challengeId);
    db.prepare("UPDATE reader_phone_challenges SET attempts=attempts+1,status='verifying' WHERE id=?").run(challengeId);
    return current;
   });
   let result;
   try{result=await provider.verify({phone:p.phone,code,outId:row.id,signal});}
   catch{
    db.prepare("UPDATE reader_phone_challenges SET status=CASE WHEN attempts>=? THEN 'invalid' ELSE 'sent' END WHERE id=? AND status='verifying'").run(MAX_ATTEMPTS,row.id);
    fail('验证码暂时无法核验，请稍后再试',503);
   }
   const outcome=atomic(()=>{
    const current=accountProfile(db,id),live=db.prepare('SELECT * FROM reader_phone_challenges WHERE id=? AND account_id=?').get(row.id,id);
    if(!store.account(id)||current?.phone!==p.phone||live?.status!=='verifying'||live.expires_at<=stamp()){
     db.prepare("UPDATE reader_phone_challenges SET status='invalid' WHERE id=? AND status='verifying'").run(row.id);return {stale:true};
    }
    if(result?.passed!==true){db.prepare("UPDATE reader_phone_challenges SET status=? WHERE id=?").run(live.attempts>=MAX_ATTEMPTS?'invalid':'sent',row.id);return {invalid:true};}
    const verifiedAt=stamp();
    db.prepare(`INSERT INTO reader_phone_verifications(account_id,phone,verified_at) VALUES(?,?,?)
     ON CONFLICT(account_id) DO UPDATE SET phone=excluded.phone,verified_at=excluded.verified_at`).run(id,p.phone,verifiedAt);
    db.prepare("UPDATE reader_phone_challenges SET status='used',provider_request_id=? WHERE id=?").run(result.requestId||null,row.id);
    return {ok:true,phoneVerified:true,phoneVerifiedAt:verifiedAt};
   });
   if(outcome.stale)fail('联系资料已变化或验证码已过期，请重新获取',409);
   return outcome;
  },
  purge(){
   db.prepare('DELETE FROM reader_phone_challenges WHERE created_at<?').run(new Date(+now()-7*86400000).toISOString());
   db.prepare('DELETE FROM reader_phone_send_limits WHERE created_at<?').run(new Date(+now()-86400000).toISOString());
  },
 };
}
