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
 db.exec(`CREATE TABLE IF NOT EXISTS reader_profiles(account_id TEXT PRIMARY KEY,phone TEXT NOT NULL,contact_type TEXT NOT NULL,contact_value TEXT NOT NULL,updated_at TEXT NOT NULL);`);
}
export function accountProfile(db,id){
 const row=db.prepare('SELECT phone,contact_type,contact_value FROM reader_profiles WHERE account_id=?').get(id);
 if(!row)return null;
 try{return normalizeAccountProfile({phone:row.phone,contactType:row.contact_type,contactValue:row.contact_value});}catch{return null;}
}
export function saveAccountProfile(db,id,input,at=new Date().toISOString()){
 const profile=normalizeAccountProfile(input);
 if(!db.prepare('SELECT 1 FROM retention_accounts WHERE id=?').get(id))throw new RetentionError('请先登录',401);
 db.prepare(`INSERT INTO reader_profiles VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET phone=excluded.phone,contact_type=excluded.contact_type,contact_value=excluded.contact_value,updated_at=excluded.updated_at`).run(id,profile.phone,profile.contactType,profile.contactValue,at);
 return profile;
}
export const profileContact=profile=>CONTACT_TYPES[profile.contactType]+'：'+profile.contactValue;
