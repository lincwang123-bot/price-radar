import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {RetentionError} from './retention-store.mjs';
import {normalizeEmail} from './merchant-mail.mjs';
import {safeAccountReturn} from './account-auth.mjs';

const token=()=>randomBytes(32).toString('hex');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message='Google 登录验证未完成，请重试或使用邮箱验证码',status=401)=>{throw new RetentionError(message,status);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function googleLoginConfiguration(env={}){
 const clientId=String(env.GOOGLE_CLIENT_ID||''),clientSecret=String(env.GOOGLE_CLIENT_SECRET||'');
 let origin;try{const u=new URL(env.PUBLIC_ORIGIN);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw new Error();origin=u.origin;}catch{}
 const configured=!!origin&&/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)&&clientSecret.length>=16;
 return {configured,clientId,clientSecret,redirectUri:origin?origin+'/api/retention/google-callback':null};
}
// Called only after Google's SDK has verified the ID token signature.
export function validateGoogleClaims(p,{clientId,nonce,now=new Date()}){
 const email=normalizeEmail(p?.email)?.toLowerCase(),seconds=+now/1000;
 if(!p||!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||p.aud!==clientId||(p.azp&&p.azp!==clientId)||!same(p.nonce,nonce)||p.email_verified!==true||!email||typeof p.sub!=='string'||!p.sub||p.sub.length>255||!Number.isFinite(p.exp)||p.exp<=seconds||!Number.isFinite(p.iat)||p.iat>seconds+300)fail();
 // Google is not authoritative for a personal Google account using an
 // arbitrary third-party mailbox. Such users must verify that mailbox here.
 if(!email.endsWith('@gmail.com')&&!email.endsWith('@googlemail.com')&&!(typeof p.hd==='string'&&p.hd&&p.hd.toLowerCase()===email.split('@')[1]))fail('Google 无法确认此第三方邮箱当前的归属，请使用邮箱验证码登录');
 return {subject:p.sub,email};
}
export function createGoogleLogin({store,env={},now=()=>new Date(),clientFactory}={}){
 const db=store.db,config=googleLoginConfiguration(env),at=()=>now().toISOString();let client;
 db.exec(`CREATE TABLE IF NOT EXISTS reader_google_flows(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,next_path TEXT NOT NULL,expires_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reader_google_identities(subject TEXT PRIMARY KEY,account_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS reader_google_flow_expiry ON reader_google_flows(expires_at);`);
 async function sdk(){
  if(!config.configured)fail('Google 登录尚未配置，请使用邮箱验证码',503);
  if(!client){
   const options={clientId:config.clientId,clientSecret:config.clientSecret,redirectUri:config.redirectUri,transporterOptions:{timeout:10000,retry:false}};
   client=clientFactory?clientFactory(options):new (await import('google-auth-library')).OAuth2Client(options);
  }
  return client;
 }
 const purge=()=>db.prepare('DELETE FROM reader_google_flows WHERE expires_at<=?').run(at());
 return {
  configured:config.configured,purge,
  async start(next){
   const c=await sdk();purge();
   if(db.prepare('SELECT COUNT(*) n FROM reader_google_flows').get().n>=300)fail('Google 登录请求较多，请稍后重试',429);
   const state=token(),browserToken=token(),verifier=token(),nonce=token();
   const url=c.generateAuthUrl({response_type:'code',scope:'openid email',redirect_uri:config.redirectUri,state,nonce,prompt:'select_account',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
   db.prepare('INSERT INTO reader_google_flows VALUES(?,?,?,?,?,?)').run(hash(state),hash(browserToken),verifier,nonce,safeAccountReturn(next),new Date(+now()+600000).toISOString());
   return {url,browserToken};
  },
  async complete({state,code,browserToken,error}={}){
   if(!config.configured||!/^[a-f0-9]{64}$/.test(state||'')||!/^[a-f0-9]{64}$/.test(browserToken||''))fail();
   const row=db.prepare('SELECT * FROM reader_google_flows WHERE state_hash=?').get(hash(state));
   if(!row||row.expires_at<=at()||!same(row.browser_hash,hash(browserToken)))fail();
   // Consume before network I/O: callbacks, including cancelled flows, are one-use.
   db.prepare('DELETE FROM reader_google_flows WHERE state_hash=?').run(row.state_hash);
   if(error||typeof code!=='string'||!code||code.length>4096)fail();
   let identity;
   try{
    const c=await sdk();const {tokens}=await c.getToken({code,codeVerifier:row.verifier,redirect_uri:config.redirectUri});
    if(!tokens.id_token)fail();
    const ticket=await c.verifyIdToken({idToken:tokens.id_token,audience:config.clientId});
    identity=validateGoogleClaims(ticket.getPayload(),{clientId:config.clientId,nonce:row.nonce,now:now()});
   }catch(error){if(error instanceof RetentionError)throw error;fail();}
   db.exec('BEGIN IMMEDIATE');
   try{
    const linked=db.prepare('SELECT a.* FROM reader_google_identities g JOIN retention_accounts a ON a.id=g.account_id WHERE g.subject=?').get(identity.subject);
    if(linked&&linked.email.toLowerCase()!==identity.email)fail('Google 账号邮箱已变化，请先使用原邮箱登录并联系站方');
    let account=linked||db.prepare('SELECT * FROM retention_accounts WHERE email=?').get(identity.email);
    if(!account){db.prepare('INSERT INTO retention_accounts(id,email,created_at,email_enabled) VALUES(?,?,?,0)').run(token().slice(0,32),identity.email,at());account=db.prepare('SELECT * FROM retention_accounts WHERE email=?').get(identity.email);}
    const previous=db.prepare('SELECT subject FROM reader_google_identities WHERE account_id=?').get(account.id);
    if(previous&&previous.subject!==identity.subject)fail();
    db.prepare('INSERT OR IGNORE INTO reader_google_identities VALUES(?,?,?)').run(identity.subject,account.id,at());
    const session=token();db.prepare('INSERT INTO retention_sessions VALUES(?,?,?)').run(hash(session),account.id,new Date(+now()+30*86400000).toISOString());
    db.exec('COMMIT');return {token:session,account,next:row.next_path};
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  },
 };
}
