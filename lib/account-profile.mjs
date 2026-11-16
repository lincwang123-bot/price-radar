import {RetentionError} from './retention-store.mjs';

export const CONTACT_TYPES={wechat:'微信',telegram:'TG',qq:'QQ'};
const fail=message=>{throw new RetentionError(message,422);};
export function normalizeAccountProfile(input){
 if(typeof input?.phone!=='string'||input.phone.length>32)fail('请填写手机号');
 let phone=input.phone.trim().replace(/[\s()-]/g,'');
 if(/^00/.test(phone))phone='+'+phone.slice(2);
 if(/^1[3-9]\d{9}$/.test(phone))phone='+86'+phone;
 if(!/^\+[1-9]\d{7,14}$/.test(phone)||phone.startsWith('+86')&&!/^\+861[3-9]\d{9}$/.test(phone))fail('请填写有效手机号；海外号码请带 +国家区号');
 const contactType=input.contactType;
 if(!Object.hasOwn(CONTACT_TYPES,contactType))fail('请选择微信、TG、QQ 中的一种联系方式');
 let contactValue=typeof input.contactValue==='string'?input.contactValue.trim():'';
 if(contactType==='telegram')contactValue=contactValue.replace(/^@/,'');
 if(!contactValue||contactValue.length>64||/[\s<>\u0000-\u001f\u007f]/.test(contactValue))fail('请填写有效的联系账号');
 if(contactType==='qq'&&!/^[1-9]\d{4,11}$/.test(contactValue))fail('请填写 QQ 号码');
 if(contactType==='telegram'&&!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(contactValue))fail('请填写 TG 用户名，例如 @username');
 if(contactType==='wechat'&&!/^[A-Za-z0-9_-]{3,64}$/.test(contactValue))fail('请填写微信号');
 return {phone,contactType,contactValue,phoneVerified:false};
}
export function initAccountProfileSchema(db){
 // Keep the historical five-column table compatible with old release writes.
 // Triggers also revoke proof when a rolled-back release changes/deletes it.
 db.exec(`CREATE TABLE IF NOT EXISTS reader_profiles(account_id TEXT PRIMARY KEY,phone TEXT NOT NULL,contact_type TEXT NOT NULL,contact_value TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reader_phone_verifications(account_id TEXT PRIMARY KEY,phone TEXT NOT NULL,verified_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS reader_phone_verification_phone_changed AFTER UPDATE OF phone ON reader_profiles WHEN OLD.phone IS NOT NEW.phone BEGIN
  DELETE FROM reader_phone_verifications WHERE account_id=OLD.account_id;
 END;
 CREATE TRIGGER IF NOT EXISTS reader_phone_verification_profile_deleted AFTER DELETE ON reader_profiles BEGIN
  DELETE FROM reader_phone_verifications WHERE account_id=OLD.account_id;
 END;`);
}
export function accountProfile(db,id){
 const row=db.prepare(`SELECT p.phone,p.contact_type,p.contact_value,v.verified_at FROM reader_profiles p
  LEFT JOIN reader_phone_verifications v ON v.account_id=p.account_id AND v.phone=p.phone WHERE p.account_id=?`).get(id);
 if(!row)return null;
 try{return {...normalizeAccountProfile({phone:row.phone,contactType:row.contact_type,contactValue:row.contact_value}),phoneVerified:!!row.verified_at,phoneVerifiedAt:row.verified_at||null};}catch{return null;}
}
export function saveAccountProfile(db,id,input,at=new Date().toISOString()){
 const profile=normalizeAccountProfile(input);
 if(!db.prepare('SELECT 1 FROM retention_accounts WHERE id=?').get(id))throw new RetentionError('请先登录',401);
 const owned=!db.isTransaction;if(owned)db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare(`INSERT INTO reader_profiles(account_id,phone,contact_type,contact_value,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET phone=excluded.phone,contact_type=excluded.contact_type,contact_value=excluded.contact_value,updated_at=excluded.updated_at`).run(id,profile.phone,profile.contactType,profile.contactValue,at);
  const result=accountProfile(db,id);if(owned)db.exec('COMMIT');return result;
 }catch(error){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
export const profileContact=profile=>CONTACT_TYPES[profile.contactType]+'：'+profile.contactValue;
