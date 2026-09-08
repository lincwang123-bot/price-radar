import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {normalizeEmail} from './merchant-mail.mjs';
import {RetentionError} from './retention-store.mjs';
import {initAccountProfileSchema,normalizeAccountProfile,saveAccountProfile} from './account-profile.mjs';

// Node 22's built-in memory-hard KDF; OWASP scrypt minimum N=2^17,r=8,p=1.
const derive=promisify(scrypt),cost={N:131072,r:8,p:1,maxmem:160*1024*1024};
const token=()=>randomBytes(32).toString('hex');
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(message,status=400)=>{throw new RetentionError(message,status);};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const dummy=`scrypt$131072$8$1$${randomBytes(16).toString('hex')}$${randomBytes(32).toString('hex')}`;
let activeKdfs=0;
async function kdf(password,salt){
 if(activeKdfs>=2)fail('登录服务正忙，请稍后重试',503);
 activeKdfs++;
 try{return (await derive(password,salt,32,cost)).toString('hex');}finally{activeKdfs--;}
}
function validatePassword(password){
 if(typeof password!=='string'||[...password].length<15||[...password].length>128||Buffer.byteLength(password)>512)fail('密码须为 15–128 个字符，支持中文和空格');
 if(/^\s+$/.test(password)||/^(.)\1+$/u.test(password)||/^(?:1234567890|123456|password|qwerty)+[!\d]*$/i.test(password))fail('这个密码太容易被猜到，请使用不重复的长密码');
}
async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `scrypt$131072$8$1$${salt}$${await kdf(password,salt)}`;}
async function matches(password,encoded){
 const parts=String(encoded||dummy).split('$');
 if(parts.length!==6||parts.slice(0,4).join('$')!=='scrypt$131072$8$1'||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{64}$/.test(parts[5]))return false;
 return equal(await kdf(password,parts[4]),parts[5]);
}
export function safeAccountReturn(value){
 if(typeof value!=='string'||value.length>2000||/[\\\s]/.test(value)||!value.startsWith('/')||value.startsWith('//'))return '/account';
 try{
  const url=new URL(value,'https://airadar.vip');
  if(url.origin!=='https://airadar.vip'||!['/','/following','/account','/product','/shop','/weekly','/submit','/submit-shop','/claim-shop'].includes(url.pathname))return '/account';
  return url.pathname+url.search+url.hash;
 }catch{return '/account';}
}
export function createAccountAuth(store,{now=()=>new Date()}={}){
 const db=store.db,at=()=>now().toISOString();
 initAccountProfileSchema(db);
 db.exec(`CREATE TABLE IF NOT EXISTS reader_credentials(account_id TEXT PRIMARY KEY,password_hash TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reader_login_attempts(id INTEGER PRIMARY KEY,email_hash TEXT NOT NULL,client_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS reader_login_at ON reader_login_attempts(created_at);`);
 const byEmail=email=>db.prepare('SELECT a.*,c.password_hash FROM retention_accounts a LEFT JOIN reader_credentials c ON c.account_id=a.id WHERE a.email=?').get(email);
 const issue=a=>{const value=token();db.prepare('INSERT INTO retention_sessions VALUES(?,?,?)').run(hash(value),a.id,new Date(+now()+30*86400000).toISOString());return {token:value,account:store.account(a.id)};};
 function readCode(input,purpose,countAttempt=true){
  const row=typeof input.requestId==='string'?db.prepare('SELECT * FROM retention_codes WHERE id=?').get(input.requestId):null;
  if(!row||row.purpose!==purpose||row.used||row.expires_at<=at()||row.attempts>(countAttempt?4:5))fail('验证码无效或已过期，请重新获取');
  if(countAttempt)db.prepare('UPDATE retention_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
  if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||!equal(store.digest(row.id+'|'+input.code),row.code_hash))fail('验证码不正确');
  return row;
 }
 function consume(email){
  db.prepare('UPDATE retention_codes SET used=1 WHERE email=?').run(email);
  db.prepare("UPDATE retention_mail SET payload='{}',status=CASE WHEN status IN ('queued','retry') THEN 'cancelled' ELSE status END WHERE kind='code' AND recipient=?").run(email);
 }
 async function setPassword(input,purpose){
  validatePassword(input.password);
  const profile=purpose==='register'?normalizeAccountProfile(input):null;
  const row=readCode(input,purpose);
  // Async expensive work occurs outside a transaction; recheck the challenge
  // afterwards so concurrent uses, resets or deletion cannot reuse it.
  const encoded=await passwordHash(input.password);
  db.exec('BEGIN IMMEDIATE');
  try{
   readCode(input,purpose,false);
   let a=byEmail(row.email);
   if(purpose==='register'&&a?.password_hash)fail('该邮箱已设置密码，请登录或使用“忘记密码”');
   if(purpose==='reset'&&!a)fail('验证码无效或已过期，请重新获取');
   if(!a){
    db.prepare('INSERT INTO retention_accounts(id,email,created_at,email_enabled) VALUES(?,?,?,0)').run(token().slice(0,32),row.email,at());
    a=byEmail(row.email);
   }
   db.prepare('INSERT INTO reader_credentials VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at').run(a.id,encoded,at());
   if(profile)saveAccountProfile(db,a.id,profile,at());
   consume(a.email);
   db.prepare('DELETE FROM retention_sessions WHERE account_id=?').run(a.id);
   // Mailbox recovery ends at password replacement; require ordinary login.
   const result=purpose==='register'?issue(a):{ok:true};
   store.event(a.id,'code_verified');db.exec('COMMIT');return result;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }
 return {
  hasPassword:id=>!!db.prepare('SELECT 1 FROM reader_credentials WHERE account_id=?').get(id),
  requestCode(email,client,purpose){
   if(!['register','reset'].includes(purpose))fail('请选择注册或重置密码');
   const normalized=normalizeEmail(email)?.toLowerCase();if(!normalized)fail('请输入有效邮箱');
   // Same response, cooldown and rate-limit accounting for existing and absent
   // accounts. Never expose registration status in a public lookup endpoint.
   return store.requestCode(normalized,client,{purpose,send:purpose==='register'||!!byEmail(normalized)});
  },
  register:input=>setPassword(input,'register'),reset:input=>setPassword(input,'reset'),
  async login(value,password,client){
   const email=normalizeEmail(value)?.toLowerCase();
   if(!email||typeof password!=='string'||!password||password.length>512)fail('邮箱或密码不正确',401);
   const cutoff=new Date(+now()-15*60000).toISOString();
   db.prepare('DELETE FROM reader_login_attempts WHERE created_at<?').run(cutoff);
   const emailHash=store.digest('login-email|'+email),clientHash=store.digest('login-client|'+client);
   const count=db.prepare('SELECT COUNT(*) total,SUM(email_hash=?) email,SUM(client_hash=?) client FROM reader_login_attempts WHERE created_at>=?').get(emailHash,clientHash,cutoff);
   if(count.total>=300||count.email>=10||count.client>=30)fail('登录尝试过多，请 15 分钟后重试',429);
   db.prepare('INSERT INTO reader_login_attempts(email_hash,client_hash,created_at) VALUES(?,?,?)').run(emailHash,clientHash,at());
   const a=byEmail(email),encoded=a?.password_hash;
   const valid=await matches(password,encoded);
   // Revocation/reset during an in-flight hash must prevent the old password
   // from creating a new session after all sessions were revoked.
   if(!valid||!encoded||byEmail(email)?.password_hash!==encoded)fail('邮箱或密码不正确；尚未设置密码可先验证邮箱设置',401);
   return issue(a);
  },
  purge(){db.prepare('DELETE FROM reader_login_attempts WHERE created_at<?').run(new Date(+now()-15*60000).toISOString());},
 };
}
