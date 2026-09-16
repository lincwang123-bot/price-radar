// Private operator-only intake. Authentication is attested after checking Gmail's trusted headers;
// never accept this object from a public form, email body, or unauthenticated webhook.
import {createHash} from 'node:crypto';
import {normalizeEmail,initMerchantMailSchema,queueMerchantMail} from './merchant-mail.mjs';
import {merchantMailGroup,reconcileMerchantMailPolicy} from './merchant-mail-policy.mjs';
import {getMerchantApplication} from './merchant-onboarding.mjs';
import {getSupplyIntake} from './merchant-intake.mjs';
import {publicHttpsUrl} from './public-network-fetch.mjs';

export function initMerchantReplySchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS merchant_reply_rounds (
  id INTEGER PRIMARY KEY, application_id TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL, sender TEXT NOT NULL, authentication TEXT NOT NULL,
  application_version INTEGER NOT NULL, received_at TEXT NOT NULL, created_at TEXT NOT NULL,
  summary TEXT NOT NULL, public_urls TEXT NOT NULL, fingerprint TEXT NOT NULL, actor TEXT NOT NULL,
  UNIQUE(application_id,fingerprint)
 );
 CREATE INDEX IF NOT EXISTS merchant_reply_application ON merchant_reply_rounds(application_id,id);
 CREATE TRIGGER IF NOT EXISTS merchant_reply_no_update BEFORE UPDATE ON merchant_reply_rounds
  BEGIN SELECT RAISE(ABORT,'merchant reply audit is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS merchant_reply_no_delete BEFORE DELETE ON merchant_reply_rounds
  BEGIN SELECT RAISE(ABORT,'merchant reply audit is append-only'); END;`);
}
const exists=db=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='merchant_reply_rounds'").get();
const project=row=>row?({id:row.id,applicationId:row.application_id,messageId:row.message_id,threadId:row.thread_id,
 applicationVersion:row.application_version,receivedAt:row.received_at,createdAt:row.created_at,
 summary:row.summary,publicUrls:JSON.parse(row.public_urls)}):null;
export function listMerchantReplies(db,id){
 if(!exists(db))return [];
 const ids=merchantMailGroup(db,id)?.ids||[id];
 return db.prepare(`SELECT * FROM merchant_reply_rounds WHERE application_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id DESC LIMIT 20`).all(...ids).map(project);
}
export const latestMerchantReply=(db,id)=>listMerchantReplies(db,id)[0]||null;
const CLARIFICATIONS={
 public_read_blocked:'已收到您提供的商品链接及访问频率说明。但本次读取该平台的公开页面时仍返回 403（访问被平台拦截），因此没有继续请求商品，暂时无法核对这些商品与申请店铺的对应关系。这不代表店铺主页不存在。\n\n请联系您的建站平台，确认是否有允许自动读取的公开商品目录入口，再把该入口和所属店铺的完整 HTTPS 主页回复给我们。您已提供的访问频率说明会保留，无需重复填写；不需要关闭防护、交出后台账号或提供密钥。',
 shop_relationship:'已收到您补充的商品链接，但暂时无法确认这些商品与原申请店铺的对应关系。这不是判断店铺无法打开，也不是一次接入失败测试。\n\n请直接回复：①这些商品所属店铺的完整 HTTPS 主页；②商品页面中能看到店铺名称或进入该店铺的位置。若原申请网址已更换，请写明旧地址和新地址，我们核对后再重测。',
 public_access_scope:'已收到补充资料，但现有读取方式还不能确认满足您提供的公开范围或访问频率，暂未继续测试，不代表店铺不存在。\n\n请直接回复：①允许公开读取的商品列表链接；②允许访问的范围和最高频率。若只允许测试您给出的样例，请注明。我们会按这些限制核对适配，不需要您关闭防护。',
};
export function queueReplyClarification(db,id,{replyId,reason,now=new Date()}={}){
 if(!Object.hasOwn(CLARIFICATIONS,reason))throw new Error('补充资料通知原因无效');
 const owned=!db.isTransaction;if(owned)db.exec('BEGIN IMMEDIATE');
 try{
  const group=merchantMailGroup(db,id),key=group?.key;
  const app=key?.startsWith('MA-')?getMerchantApplication(db,key):key?.startsWith('CO-')?getSupplyIntake(db,key):null;
  const reply=latestMerchantReply(db,key||id);
  if(!app||app.status!=='pending'||!reply||reply.id!==replyId||reply.applicationVersion!==app.version){if(owned)db.exec('COMMIT');return false;}
  const publicReply=CLARIFICATIONS[reason]+'\n\n不会操作时，可将本邮件全文转发给建站服务商或 AI，请对方核对公开页面，整理可直接回复给 AIradar 的链接与说明。无法确认的项目请写“无法确认”，不要猜测接口或修改防护。不要发送密码、验证码、密钥、订单或客户信息。';
  const queued=queueMerchantMail(db,{id:key,email:app.email,stage:'need_info',replyRoundId:reply.id,eventKey:`${key}:reply-clarification:${reply.id}:${reason}`,publicReply,now});
  if(owned)db.exec('COMMIT');return queued;
 }catch(error){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
const clean=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export function recordMerchantReply(db,input,{now=new Date(),actor='codex:verified-gmail'}={}){
 initMerchantMailSchema(db);
 const {applicationId,messageId,threadId,sender,authentication,expectedVersion,receivedAt,summary,publicUrls=[]}=input;
 if(!/^(?:MA|CO)-[A-Z0-9-]+$/.test(applicationId)||!clean(messageId,100)||!clean(threadId,100)
  ||!/^[a-zA-Z0-9_-]+$/.test(messageId)||!/^[a-zA-Z0-9_-]+$/.test(threadId)
  ||!['gmail-aligned','gmail-trusted-arc'].includes(authentication)||!clean(summary,1500)||!clean(actor,100)
  ||!Array.isArray(publicUrls)||publicUrls.length>5)throw new Error('回复资料或认证依据无效');
 if(/(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|密码|口令)\s*[:=：]\s*\S+|\bsk-[\w-]{16,}|-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+/i.test(summary))throw new Error('补充资料不得保存凭据');
 const stamp=new Date(now).toISOString(),received=new Date(receivedAt);
 if(!Number.isFinite(+received)||+received>+new Date(now)+60000)throw new Error('来信时间无效');
 const urls=[...new Set(publicUrls.map(value=>{
  const url=publicHttpsUrl(value);
  if(!url||url.search||url.hash||url.href.length>500||/(?:^|\/)(?:admin|login|order|orders|account)(?:\/|$)/i.test(url.pathname))throw new Error('仅保存不含凭据的公开 HTTPS 链接');
  return url.href;
 }))].sort();
 const owned=!db.isTransaction;if(owned)db.exec('BEGIN IMMEDIATE');
 try{
  const group=merchantMailGroup(db,applicationId);
  const id=group?.key;
  const app=id?.startsWith('MA-')?getMerchantApplication(db,id):id?.startsWith('CO-')?getSupplyIntake(db,id):null;
  if(!app||app.status!=='pending'||app.version!==expectedVersion||!normalizeEmail(sender)
   ||!app.email||sender.toLowerCase()!==app.email.toLowerCase())throw new Error('申请状态、版本或原申请邮箱不匹配');
  if(+received<Date.parse(app.createdAt||app.sourceCreatedAt))throw new Error('来信早于申请');
  const fingerprint=createHash('sha256').update(JSON.stringify({summary:summary.trim().replace(/\s+/g,' '),urls})).digest('hex');
  const prior=db.prepare(`SELECT * FROM merchant_reply_rounds WHERE message_id=? OR (application_id IN (${group.ids.map(()=>'?').join(',')}) AND fingerprint=?) ORDER BY id LIMIT 1`).get(messageId,...group.ids,fingerprint);
  if(prior){
   if(!group.ids.includes(prior.application_id))throw new Error('同一来信不得关联不同申请');
   if(owned)db.exec('COMMIT');return {created:false,reply:project(prior)};
  }
  // Do not replay older correspondence as a fresh communication round.
  const latest=latestMerchantReply(db,id);
  if(latest&&+received<Date.parse(latest.receivedAt))throw new Error('旧来信不自动开启新一轮');
  const result=db.prepare(`INSERT INTO merchant_reply_rounds(application_id,message_id,thread_id,sender,authentication,application_version,received_at,created_at,summary,public_urls,fingerprint,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,messageId,threadId,sender.toLowerCase(),authentication,app.version,received.toISOString(),stamp,summary.trim(),JSON.stringify(urls),fingerprint,actor);
  reconcileMerchantMailPolicy(db,id);
  const reply=project(db.prepare('SELECT * FROM merchant_reply_rounds WHERE id=?').get(result.lastInsertRowid));
  if(owned)db.exec('COMMIT');return {created:true,reply};
 }catch(error){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
