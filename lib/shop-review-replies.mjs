import {randomBytes} from 'node:crypto';
import {SubmissionError} from './submissions.mjs';
import {reviewMailbox,REVIEW_REASONS} from './shop-reviews.mjs';

export const REVIEW_REPLY_STATUSES={pending:'待审核',published:'已展示',rejected:'未通过',hidden:'已隐藏',withdrawn:'已撤回',erased:'已注销'};
const fail=(status,message)=>{throw new SubmissionError(status,message);};
const uuid=()=>randomBytes(16).toString('hex');
const idValid=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const shopValid=id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id);
const boundedPage=(value,total)=>Math.min(Math.max(1,Math.ceil(total/20)),/^[1-9]\d{0,6}$/.test(String(value))?Number(value):1);
function field(value,label,min,max){
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(422,label+'格式不正确或过长');
 const text=value.trim();if([...text].length<min)fail(422,label+'至少填写 '+min+' 个字');
 if(/(?:password|api[_ -]?key|access[_ -]?token|secret|密码|口令|验证码|卡密)\s*[:=：]\s*\S+|\bsk-[\w-]{16,}|-----BEGIN .*PRIVATE KEY-----/i.test(text))fail(422,'请先移除密码、验证码、卡密、密钥或访问令牌');
 return text;
}
const schema=`
CREATE TABLE IF NOT EXISTS shop_review_replies(id TEXT PRIMARY KEY,review_id TEXT NOT NULL UNIQUE,review_version INTEGER NOT NULL,shop_id TEXT NOT NULL,shop_name TEXT NOT NULL,author_key TEXT NOT NULL,account_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,submitted_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','hidden','withdrawn','erased')),version INTEGER NOT NULL,body TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',public_note TEXT NOT NULL DEFAULT '',published_at TEXT);
CREATE INDEX IF NOT EXISTS shop_review_reply_queue ON shop_review_replies(status,submitted_at);
CREATE INDEX IF NOT EXISTS shop_review_reply_author ON shop_review_replies(author_key,shop_id);
CREATE TABLE IF NOT EXISTS shop_review_reply_history(reply_id TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(reply_id,version));
CREATE TABLE IF NOT EXISTS shop_review_reply_actions(id INTEGER PRIMARY KEY,reply_id TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,previous_status TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,reason TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '');
CREATE TRIGGER IF NOT EXISTS shop_review_reply_actions_no_update BEFORE UPDATE ON shop_review_reply_actions BEGIN SELECT RAISE(ABORT,'reply audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS shop_review_reply_actions_no_delete BEFORE DELETE ON shop_review_reply_actions BEGIN SELECT RAISE(ABORT,'reply audit is append-only'); END;
CREATE TABLE IF NOT EXISTS shop_review_reply_events(id INTEGER PRIMARY KEY,author_key TEXT NOT NULL,client_hash TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shop_review_reply_event_author ON shop_review_reply_events(author_key,created_at);
CREATE INDEX IF NOT EXISTS shop_review_reply_event_client ON shop_review_reply_events(client_hash,created_at);
`;

export function createShopReviewReplies({db,digest,shopById,isMerchant,now=()=>new Date()}={}){
 db?.exec(schema);
 const at=()=>now().toISOString(),cut=ms=>new Date(+now()-ms).toISOString();
 const available=()=>{if(!db||typeof digest!=='function')fail(503,'商家回复暂不可用，请稍后重试');};
 function account(value){
  available();const a=value?.id&&db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(value.id);
  if(!a)fail(401,'请先登录并验证邮箱');return a;
 }
 const author=a=>digest('review-reply-author|'+reviewMailbox(a.email));
 const raw=id=>idValid(id)?db?.prepare('SELECT * FROM shop_review_replies WHERE id=?').get(id)||null:null;
 // The ownership resolver must explicitly affirm a verified association. No
 // user-supplied account, email or shop fields can grant reply permission.
 const merchant=(a,s)=>!!a&&!!s&&typeof isMerchant==='function'&&isMerchant(a,s)===true;
 function ownedShop(a,id){const s=shopValid(id)&&shopById?.(id);if(!s)fail(404,'店铺不存在');if(!merchant(a,s))fail(403,'仅已核验的本店店主可以回复评价');return s;}
 const review=id=>idValid(id)?db.prepare('SELECT id,shop_id,shop_name,status,version,rating,product,delivery,experience,published_at FROM shop_reviews WHERE id=?').get(id)||null:null;
 const ownDto=r=>r?{id:r.id,reviewId:r.review_id,reviewVersion:r.review_version,shopId:r.shop_id,status:r.status,version:r.version,body:r.body,reason:r.reason,publicNote:r.public_note,updatedAt:r.updated_at,publishedAt:r.published_at}:null;
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
 function snapshot(r){db.prepare('INSERT INTO shop_review_reply_history VALUES(?,?,?,?)').run(r.id,r.version,at(),JSON.stringify({body:r.body,status:r.status,reviewVersion:r.review_version}));}
 function audit(r,action,previous,actor,reason='',note=''){
  db.prepare('INSERT INTO shop_review_reply_actions(reply_id,created_at,actor,action,previous_status,status,version,reason,note) VALUES(?,?,?,?,?,?,?,?,?)').run(r.id,at(),actor,action,previous,r.status,r.version,reason,note);
 }
 function purge(){if(db)db.prepare('DELETE FROM shop_review_reply_events WHERE created_at<?').run(cut(48*3600000));}
 function rate(key,client){
  purge();const last=db.prepare('SELECT created_at FROM shop_review_reply_events WHERE author_key=? ORDER BY id DESC LIMIT 1').get(key);
  if(last&&last.created_at>cut(60000)||db.prepare('SELECT COUNT(*) n FROM shop_review_reply_events WHERE author_key=? AND created_at>?').get(key,cut(86400000)).n>=20)fail(429,'回复操作较频繁，请稍后再试');
  const network=client?digest('review-reply-network|'+String(client).slice(0,256)):null;
  if(network&&db.prepare('SELECT COUNT(*) n FROM shop_review_reply_events WHERE client_hash=? AND created_at>?').get(network,cut(3600000)).n>=30)fail(429,'回复操作较频繁，请稍后再试');
  db.prepare('INSERT INTO shop_review_reply_events(author_key,client_hash,created_at) VALUES(?,?,?)').run(key,network,at());
 }
 const service={
  purge,
  canReply(value,shopId){
   if(!value||!db||!shopValid(shopId))return false;
   const a=value.id&&db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(value.id);return merchant(a,shopById?.(shopId));
  },
  own(value,shopId){
   if(!service.canReply(value,shopId))return [];
   const a=account(value);return db.prepare('SELECT * FROM shop_review_replies WHERE author_key=? AND shop_id=? ORDER BY updated_at DESC,id LIMIT 100').all(author(a),shopId).map(ownDto);
  },
  submit(value,input,{client=''}={}){
   const a=account(value);
   if(!input||input.consent!==true||input.website)fail(422,'请确认回复真实、客观，不包含客户隐私或诱导删评');
   if(!Number.isSafeInteger(input.version)||input.version<0||!Number.isSafeInteger(input.reviewVersion)||input.reviewVersion<1)fail(422,'回复或评价版本无效，请刷新页面');
   const body=field(input.body,'商家回复',5,1500),key=author(a);
   return transaction(()=>{
    const r=review(input.reviewId);if(!r||r.status!=='published')fail(404,'当前评价不可回复，请刷新页面');
    const s=ownedShop(a,r.shop_id);if(r.version!==input.reviewVersion)fail(409,'评价已更新，请阅读新版本后重新回复');
    const prior=db.prepare('SELECT * FROM shop_review_replies WHERE review_id=?').get(r.id);
    if(prior&&prior.author_key!==key)fail(403,'该评价已有其他已关联店主提交的回复，请由原提交人修改或联系站方处理');
    if(prior?.status==='erased')fail(403,'这份回复已随账号注销，不能重新发布，请联系站方处理');
    if((prior?.version||0)!==input.version)fail(409,'回复已更新，请刷新后再提交');
    if(prior&&prior.review_version===r.version&&prior.body===body&&['pending','published'].includes(prior.status))return ownDto(prior);
    rate(key,client);const id=prior?.id||uuid(),version=(prior?.version||0)+1;
    if(prior)db.prepare("UPDATE shop_review_replies SET review_version=?,account_id=?,shop_name=?,updated_at=?,submitted_at=?,status='pending',version=?,body=?,reason='',public_note='',published_at=NULL WHERE id=?").run(r.version,a.id,s.name,at(),at(),version,body,id);
    else db.prepare("INSERT INTO shop_review_replies(id,review_id,review_version,shop_id,shop_name,author_key,account_id,created_at,updated_at,submitted_at,status,version,body) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)").run(id,r.id,r.version,s.id,s.name,key,a.id,at(),at(),at(),version,body);
    const row=raw(id);snapshot(row);audit(row,prior?'edit':'submit',prior?.status||'','merchant');return ownDto(row);
   });
  },
  withdraw(value,input){
   const a=account(value);return transaction(()=>{
    const r=raw(input?.id);if(!r||r.author_key!==author(a))fail(404,'回复不存在');ownedShop(a,r.shop_id);
    if(r.version!==input.version)fail(409,'回复已更新，请刷新页面');
    if(['withdrawn','erased'].includes(r.status))fail(422,'当前回复已不可展示');
    db.prepare("UPDATE shop_review_replies SET status='withdrawn',version=version+1,updated_at=?,published_at=NULL WHERE id=?").run(at(),r.id);
    const row=raw(r.id);snapshot(row);audit(row,'withdraw',r.status,'merchant');return ownDto(row);
   });
  },
  publicForReviews(reviewIds=[]){
   const result=new Map(),ids=[...new Set(reviewIds.filter(idValid))];if(!db)return result;
   for(let offset=0;offset<ids.length;offset+=100){
    const batch=ids.slice(offset,offset+100);
    const rows=db.prepare("SELECT p.review_id,p.shop_id,p.account_id,p.body,p.published_at FROM shop_review_replies p JOIN shop_reviews r ON r.id=p.review_id AND r.version=p.review_version WHERE p.status='published' AND r.status='published' AND p.review_id IN ("+batch.map(()=>'?').join(',')+")").all(...batch);
    for(const r of rows){
     const a=r.account_id&&db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(r.account_id);
     if(merchant(a,shopById?.(r.shop_id)))result.set(r.review_id,{body:r.body,publishedAt:r.published_at,label:'商家回复'});
    }
   }
   return result;
  },
  moderate(id,input,{actor='admin'}={}){
   available();if(!input||!['publish','reject','hide'].includes(input.action))fail(422,'审核操作无效');
   const note=field(input.note||'','审核说明',input.action==='publish'?0:5,1000),reason=input.action==='publish'?'':input.reason;
   if(input.action==='publish'?input.confirmed!==true:!Object.hasOwn(REVIEW_REASONS,reason))fail(422,'请确认统一审核标准，或选择具体违规原因并说明');
   return transaction(()=>{
    const r=raw(id);if(!r)fail(404,'回复不存在');if(r.version!==input.version)fail(409,'回复已更新，请刷新后重新审核');
    const allowed=input.action==='hide'?['published']:['pending','rejected','hidden'];if(!allowed.includes(r.status))fail(422,'当前状态不能执行此操作');
    if(input.action==='publish'){
     const target=review(r.review_id),a=r.account_id&&db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(r.account_id);
     if(!target||target.status!=='published'||target.version!==r.review_version)fail(422,'原评价已更新或不再公开，请让商家阅读当前评价后重新提交');
     if(!merchant(a,shopById?.(r.shop_id)))fail(422,'回复账号已不存在或不再是已核验店主，不能发布');
    }
    const status={publish:'published',reject:'rejected',hide:'hidden'}[input.action];
    db.prepare('UPDATE shop_review_replies SET status=?,version=version+1,updated_at=?,reason=?,public_note=?,published_at=? WHERE id=?').run(status,at(),reason,note,status==='published'?at():null,id);
    const row=raw(id);snapshot(row);audit(row,input.action,r.status,String(actor).slice(0,100),reason,note);return ownDto(row);
   });
  },
  queue({status='pending',page=1}={}){
   available();if(!Object.hasOwn(REVIEW_REPLY_STATUSES,status))status='pending';
   const total=db.prepare('SELECT COUNT(*) n FROM shop_review_replies WHERE status=?').get(status).n,p=boundedPage(page,total);
   const items=db.prepare('SELECT id,review_id,review_version,shop_id,shop_name,status,version,submitted_at FROM shop_review_replies WHERE status=? ORDER BY submitted_at,id LIMIT 20 OFFSET ?').all(status,(p-1)*20);
   return {items,total,status,page:p,pages:Math.max(1,Math.ceil(total/20))};
  },
  detail(id){
   available();const r=raw(id);if(!r)return null;
   return {...r,review:review(r.review_id),history:db.prepare('SELECT * FROM shop_review_reply_history WHERE reply_id=? ORDER BY version DESC').all(id),actions:db.prepare('SELECT * FROM shop_review_reply_actions WHERE reply_id=? ORDER BY id DESC').all(id)};
  },
  eraseAccount(value){
   const a=account(value),key=author(a);
   // Called inside account deletion's transaction. Audit metadata is retained,
   // but reply text, revision content and account links are removed.
   for(const r of db.prepare('SELECT * FROM shop_review_replies WHERE author_key=?').all(key)){
    db.prepare("UPDATE shop_review_replies SET account_id=NULL,status='erased',version=version+1,body='',reason='',public_note='',published_at=NULL,updated_at=? WHERE id=?").run(at(),r.id);
    db.prepare("UPDATE shop_review_reply_history SET payload='{}' WHERE reply_id=?").run(r.id);audit(raw(r.id),'erase',r.status,'merchant');
   }
   db.prepare('DELETE FROM shop_review_reply_events WHERE author_key=?').run(key);
  },
 };
 return service;
}
