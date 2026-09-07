import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {normalizeEmail} from './merchant-mail.mjs';

export const retentionDay=value=>new Date(+new Date(value)+8*3600000).toISOString().slice(0,10);
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class RetentionError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status)=>{throw new RetentionError(message,status);};
export const retentionSchema=`
CREATE TABLE IF NOT EXISTS retention_accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,created_at TEXT NOT NULL,email_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS retention_codes(id TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,client_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS retention_code_email ON retention_codes(email,created_at);
CREATE TABLE IF NOT EXISTS retention_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS retention_watches(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,product_key TEXT NOT NULL,group_id TEXT NOT NULL DEFAULT '',mode TEXT NOT NULL,target_price REAL,drop_pct REAL NOT NULL DEFAULT 5,paused INTEGER NOT NULL DEFAULT 0,renewal_date TEXT NOT NULL DEFAULT '',lead_days INTEGER NOT NULL DEFAULT 3,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,baseline TEXT,last_notice_at TEXT,UNIQUE(account_id,product_key,group_id));
CREATE INDEX IF NOT EXISTS retention_watch_account ON retention_watches(account_id);
CREATE TABLE IF NOT EXISTS retention_notices(id TEXT PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,account_id TEXT NOT NULL,watch_id TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,mailed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS retention_mail(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,account_id TEXT,recipient TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,next_at TEXT NOT NULL,lease_until TEXT,error_code TEXT);
CREATE INDEX IF NOT EXISTS retention_mail_due ON retention_mail(status,next_at);
CREATE TABLE IF NOT EXISTS retention_events(day TEXT NOT NULL,visitor TEXT NOT NULL,kind TEXT NOT NULL,entity TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(day,visitor,kind,entity));
CREATE TABLE IF NOT EXISTS retention_event_days(day TEXT NOT NULL,kind TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,kind));
CREATE TABLE IF NOT EXISTS retention_market(id TEXT PRIMARY KEY,product_key TEXT NOT NULL,payload TEXT NOT NULL,observed_at TEXT NOT NULL,fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS retention_market_daily(day TEXT NOT NULL,group_id TEXT NOT NULL,low REAL NOT NULL,high REAL NOT NULL,last_price REAL NOT NULL,first_at TEXT NOT NULL,last_at TEXT NOT NULL,observations INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(day,group_id));
CREATE TABLE IF NOT EXISTS retention_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
`;
const publicWatch=w=>({id:w.id,productKey:w.product_key,groupId:w.group_id,mode:w.mode,targetPrice:w.target_price,dropPct:w.drop_pct,paused:w.paused,renewalDate:w.renewal_date,leadDays:w.lead_days,createdAt:w.created_at});
export function evaluateWatch(w,previous,current){
 if(w.paused||!current||!previous||current.id!==w.group_id||previous.id!==current.id||current.state!=='available')return null;
 if(w.mode==='restock'&&previous.state==='unavailable')return {kind:'restock',price:current.price};
 if(previous.state!=='available'||!Number.isFinite(previous.price))return null;
 if(w.mode==='target'&&current.price<=w.target_price&&previous.price>w.target_price)return {kind:'target',price:current.price};
 const drop=(previous.price-current.price)/previous.price*100;
 if(w.mode==='changes'&&drop>=w.drop_pct&&current.price<previous.price)return {kind:'drop',price:current.price,previousPrice:previous.price,drop};
 return null;
}
export function createRetentionStore(db,{secret,now=()=>new Date()}={}){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Retention secret unavailable');
 db.exec(retentionSchema);
 db.prepare("INSERT OR IGNORE INTO retention_meta VALUES('started_at',?)").run(now().toISOString());
 const digest=value=>createHmac('sha256',secret).update(value).digest('hex');
 const at=()=>now().toISOString();
 const account=id=>db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(id)||null;
 const event=(identity,kind,entity='')=>{
  if(!['follow','unfollow','visit','notice_visit','pause','resume','email_off','email_on','renewal','share','code_verified'].includes(kind)||typeof identity!=='string'||identity.length>128)return;
  const day=retentionDay(now()),visitor=digest('events|'+identity);
  const added=db.prepare('INSERT OR IGNORE INTO retention_events VALUES(?,?,?,?,?)').run(day,visitor,kind,String(entity).slice(0,100),at()).changes;
  if(added)db.prepare('INSERT INTO retention_event_days VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET n=n+1').run(day,kind);
 };
 const queueMail=(key,accountId,recipient,kind,payload)=>db.prepare('INSERT OR IGNORE INTO retention_mail(event_key,account_id,recipient,kind,payload,created_at,next_at) VALUES(?,?,?,?,?,?,?)').run(key,accountId,recipient,kind,JSON.stringify(payload),at(),at());
 const api={db,secret,digest,account,event,
  requestCode(value,client){
   const email=normalizeEmail(value)?.toLowerCase();if(!email)fail('请输入有效邮箱');
   const hour=new Date(+now()-3600000).toISOString(),clientHash=digest('limit|'+String(client));
   const count=db.prepare('SELECT COUNT(*) n FROM retention_codes WHERE created_at>=? AND (email=? OR client_hash=?)').get(hour,email,clientHash).n;
   const all=db.prepare('SELECT COUNT(*) n FROM retention_codes WHERE created_at>=?').get(hour).n;
   if(count>=5||all>=200)fail('验证码请求较多，请稍后再试',429);
   if(db.prepare('SELECT 1 FROM retention_codes WHERE email=? AND created_at>?').get(email,new Date(+now()-60000).toISOString()))fail('请间隔一分钟再获取验证码',429);
   const id=token(),code=String(randomInt(100000,1000000));
   db.prepare('INSERT INTO retention_codes(id,email,code_hash,created_at,expires_at,client_hash) VALUES(?,?,?,?,?,?)').run(id,email,digest(id+'|'+code),at(),new Date(+now()+10*60000).toISOString(),clientHash);
   queueMail('code:'+id,null,email,'code',{requestId:id,code});
   return {requestId:id};
  },
  verifyCode(id,code){
   const row=typeof id==='string'?db.prepare('SELECT * FROM retention_codes WHERE id=?').get(id):null;
   if(!row||row.used||row.expires_at<=at()||row.attempts>=5)fail('验证码无效或已过期，请重新获取');
   db.prepare('UPDATE retention_codes SET attempts=attempts+1 WHERE id=?').run(id);
   if(!equal(digest(id+'|'+String(code)),row.code_hash))fail('验证码不正确');
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('UPDATE retention_codes SET used=1 WHERE email=?').run(row.email);
    db.prepare('INSERT OR IGNORE INTO retention_accounts VALUES(?,?,?,1)').run(token().slice(0,32),row.email,at());
    const a=db.prepare('SELECT * FROM retention_accounts WHERE email=?').get(row.email),session=token();
    db.prepare('INSERT INTO retention_sessions VALUES(?,?,?)').run(hash(session),a.id,new Date(+now()+30*86400000).toISOString());
    db.prepare("UPDATE retention_mail SET payload='{}',status=CASE WHEN status IN ('queued','retry') THEN 'cancelled' ELSE status END WHERE kind='code' AND recipient=?").run(row.email);
    event(a.id,'code_verified');db.exec('COMMIT');return {token:session,account:a};
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  },
  session(value){if(!/^[a-f0-9]{64}$/.test(value||''))return null;return db.prepare('SELECT a.* FROM retention_sessions s JOIN retention_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(value),at())||null;},
  logout(value){db.prepare('DELETE FROM retention_sessions WHERE token_hash=?').run(hash(value||''));},
  watches(id){return db.prepare('SELECT * FROM retention_watches WHERE account_id=? ORDER BY created_at,id').all(id).map(publicWatch);},
  saveWatch(id,input,market){
   if(!account(id))fail('请先确认邮箱',401);
   const product=market.products.find(p=>p.key===input.productKey),groupId=String(input.groupId||'');
   if(!product)fail('该产品暂不可关注，请重新选择');
   const group=groupId?market.groups.find(g=>g.id===groupId&&g.productKey===product.key):null;
   if(groupId&&!group)fail('该规格暂不可用，请重新选择');
   const mode=input.mode||'off';if(!['off','target','restock','changes','weekly'].includes(mode))fail('提醒类型无效');
   if(mode!=='off'&&!group)fail('请先选择明确的期限和交付规格');
   const price=input.targetPrice==null||input.targetPrice===''?null:Number(input.targetPrice),drop=Number(input.dropPct??5);
   if(mode==='target'&&(!(price>0)||price>1000000))fail('目标价格应在 0 到 1000000 之间');
   if(!Number.isFinite(drop)||drop<1||drop>90)fail('降价幅度应在 1% 到 90% 之间');
   const date=String(input.renewalDate||''),lead=Number(input.leadDays??3);
   if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<'2020-01-01'||date>String(now().getUTCFullYear()+5)+'-12-31'))fail('请选择有效到期日期');
   if(![0,1,3,7].includes(lead))fail('请选择有效提醒天数');
   const existing=input.id?db.prepare('SELECT * FROM retention_watches WHERE id=? AND account_id=?').get(input.id,id):db.prepare('SELECT * FROM retention_watches WHERE account_id=? AND product_key=? AND group_id=?').get(id,product.key,groupId);
   if(input.id&&!existing)fail('关注不存在',404);
   if(!existing&&api.watches(id).length>=40)fail('最多关注 40 个规格');
   const watchId=existing?.id||token().slice(0,32),paused=input.paused?1:0;
   const duplicate=db.prepare('SELECT id FROM retention_watches WHERE account_id=? AND product_key=? AND group_id=? AND id<>?').get(id,product.key,groupId,watchId);if(duplicate)fail('已关注此规格，请修改原有关注');
   db.prepare(`INSERT INTO retention_watches(id,account_id,product_key,group_id,mode,target_price,drop_pct,paused,renewal_date,lead_days,created_at,updated_at,baseline)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_key=excluded.product_key,group_id=excluded.group_id,mode=excluded.mode,target_price=excluded.target_price,drop_pct=excluded.drop_pct,paused=excluded.paused,renewal_date=excluded.renewal_date,lead_days=excluded.lead_days,updated_at=excluded.updated_at,baseline=excluded.baseline`).run(watchId,id,product.key,groupId,mode,mode==='target'?price:null,drop,paused,date,lead,existing?.created_at||at(),at(),group?JSON.stringify(group):null);
   if(!existing)event(id,'follow',watchId);else if(existing.paused!==paused)event(id,paused?'pause':'resume',watchId);
   if(date&&existing?.renewal_date!==date)event(id,'renewal',watchId);
   return publicWatch(db.prepare('SELECT * FROM retention_watches WHERE id=?').get(watchId));
  },
  removeWatch(id,watchId){const removed=db.prepare('DELETE FROM retention_watches WHERE id=? AND account_id=?').run(watchId,id).changes;if(!removed)fail('关注不存在',404);event(id,'unfollow',watchId);},
  unsubscribeToken(id){return id+'.'+digest('unsubscribe|'+id);},
  unsubscribe(value){const [id,sig]=String(value||'').split('.');if(!/^[a-f0-9]{32}$/.test(id||'')||!equal(digest('unsubscribe|'+id),sig)||!account(id))fail('退订链接无效');api.setEmail(id,false);},
  setEmail(id,enabled){if(!account(id))fail('请先确认邮箱',401);db.prepare('UPDATE retention_accounts SET email_enabled=? WHERE id=?').run(enabled?1:0,id);if(!enabled)db.prepare("UPDATE retention_mail SET status='cancelled',payload='{}' WHERE account_id=? AND kind<>'code' AND status IN ('queued','retry')").run(id);event(id,enabled?'email_on':'email_off');},
  notices(id){return db.prepare('SELECT id,kind,created_at,payload FROM retention_notices WHERE account_id=? ORDER BY created_at DESC LIMIT 40').all(id).map(r=>({...r,payload:JSON.parse(r.payload)}));},
  observe(market){
   const groups=new Map(market.groups.map(g=>[g.id,g]));
   for(const w of db.prepare('SELECT * FROM retention_watches').all()){
    const current=groups.get(w.group_id),previous=w.baseline?JSON.parse(w.baseline):null;
    let change=evaluateWatch(w,previous,current);
    if(!w.paused&&w.mode==='weekly'&&+now()-Date.parse(w.last_notice_at||w.created_at)>=7*86400000&&current?.state==='available')change={kind:'weekly',price:current.price};
    const cooling=w.last_notice_at&&+now()-Date.parse(w.last_notice_at)<86400000;
    if(change&&!cooling){
     const payload={...change,watchId:w.id,productKey:w.product_key,name:current.name,spec:current.spec,currency:current.currency,groupId:current.id,observedAt:current.observedAt};
     db.prepare('INSERT OR IGNORE INTO retention_notices VALUES(?,?,?,?,?,?,?,0)').run(token().slice(0,32),`${w.id}:${change.kind}:${retentionDay(now())}`,w.account_id,w.id,change.kind,at(),JSON.stringify(payload));
     db.prepare('UPDATE retention_watches SET last_notice_at=? WHERE id=?').run(at(),w.id);
    }
    if(current&&current.state!=='unknown'){
     // Price-drop watches keep their last notified baseline so gradual drops count.
     if(w.mode!=='changes'||!previous||change&&!cooling||current.price>previous.price||current.state!==previous.state)db.prepare('UPDATE retention_watches SET baseline=? WHERE id=?').run(JSON.stringify(current),w.id);
    }
    if(!w.paused&&w.renewal_date){
     const days=Math.round((Date.parse(w.renewal_date)-Date.parse(retentionDay(now())))/86400000);
     if(days>=0&&days<=w.lead_days){
      const p=market.products.find(p=>p.key===w.product_key);
      db.prepare('INSERT OR IGNORE INTO retention_notices VALUES(?,?,?,?,?,?,?,0)').run(token().slice(0,32),`${w.id}:renewal:${w.renewal_date}:${w.lead_days}`,w.account_id,w.id,'renewal',at(),JSON.stringify({watchId:w.id,productKey:w.product_key,name:p?.name||w.product_key,spec:current?.spec||'',renewalDate:w.renewal_date,kind:'renewal'}));
     }
    }
   }
   for(const a of db.prepare('SELECT * FROM retention_accounts WHERE email_enabled=1').all()){
    if(db.prepare("SELECT 1 FROM retention_mail WHERE account_id=? AND kind='digest' AND created_at>? AND status NOT IN ('cancelled','failed')").get(a.id,new Date(+now()-86400000).toISOString()))continue;
    const notices=db.prepare('SELECT n.* FROM retention_notices n JOIN retention_watches w ON w.id=n.watch_id WHERE n.account_id=? AND n.mailed=0 AND w.paused=0 AND n.created_at>? ORDER BY n.created_at DESC LIMIT 20').all(a.id,new Date(+now()-7*86400000).toISOString());
    if(!notices.length)continue;
    const queued=queueMail(`digest:${a.id}:${retentionDay(now())}`,a.id,a.email,'digest',{noticeIds:notices.map(n=>n.id)});
    if(queued.changes)for(const n of notices)db.prepare('UPDATE retention_notices SET mailed=1 WHERE id=?').run(n.id);
   }
  },
  purge(){
   db.prepare('DELETE FROM retention_codes WHERE created_at<?').run(new Date(+now()-86400000).toISOString());
   db.prepare('DELETE FROM retention_sessions WHERE expires_at<=?').run(at());
   db.prepare('DELETE FROM retention_events WHERE day<?').run(retentionDay(new Date(+now()-30*86400000)));
   db.prepare('DELETE FROM retention_notices WHERE created_at<?').run(new Date(+now()-90*86400000).toISOString());
   db.prepare("UPDATE retention_mail SET payload='{}' WHERE kind='code' AND created_at<?").run(new Date(+now()-10*60000).toISOString());
   db.prepare('DELETE FROM retention_mail WHERE created_at<?').run(new Date(+now()-31*86400000).toISOString());
  },
 };
 return api;
}
