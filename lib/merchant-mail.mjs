// Private transactional outbox. SMTP acceptance is not proof of inbox delivery.
import { createHash } from 'node:crypto';

export function normalizeEmail(value) {
  if (typeof value !== 'string' || /[\r\n\u0000-\u0020\u007f]/.test(value)) return null;
  if (value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value)) return null;
  const [local, domain] = value.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.includes('..') || domain.split('.').some(x=>x.startsWith('-')||x.endsWith('-'))) return null;
  return local + '@' + domain.toLowerCase();
}
export const MAIL_STAGES = {
  received:['申请已收到','我们已收到你的店铺申请，将先检测公开商品目录，再进行人工审核。提交申请不会自动上架。'],
  testing:['正在检测接入','你的店铺已进入公开目录接入测试队列。测试仅判断是否能读取有效商品，不代表店铺已获批准。'],
  ready:['接入测试完成，等待审核','已读取到可供核对的商品样例，接下来由站方人工审核店铺归属、采集授权及商品信息。尚未正式收录。'],
  need_info:['需要补充或核对资料','当前申请需要进一步核对。请通过原联系渠道联系站方，并提供申请编号，以确认需要补充的店铺资料、邮箱或公开商品目录信息。请勿发送账号密码、验证码或 API Key。'],
  approved:['店铺审核通过','你的店铺审核已通过。系统将按正常采集周期接入，符合收录规则的有效报价采集成功后才会展示；通过审核不等于保证所有商品立即上线。'],
  rejected:['店铺审核未通过','本次店铺申请暂未通过审核。如需了解原因或补充资料，请通过原联系渠道联系站方并提供申请编号。'],
  paused:['店铺收录已暂停','你的店铺收录流程已暂停。请通过原联系渠道联系站方并提供申请编号，核对资料后再申请恢复。'],
};
export function initMerchantMailSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_mail_outbox (
    id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, application_id TEXT NOT NULL,
    recipient TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL, lease_until TEXT, accepted_at TEXT, error_code TEXT
  ); CREATE INDEX IF NOT EXISTS merchant_mail_due ON merchant_mail_outbox(status,next_attempt_at);
  CREATE TABLE IF NOT EXISTS merchant_email_actions (
    id INTEGER PRIMARY KEY, application_id TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS merchant_email_no_update BEFORE UPDATE ON merchant_email_actions
    BEGIN SELECT RAISE(ABORT,'merchant email audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS merchant_email_no_delete BEFORE DELETE ON merchant_email_actions
    BEGIN SELECT RAISE(ABORT,'merchant email audit is append-only'); END;`);
}
export function queueMerchantMail(db,{id,email,stage,eventKey,now=new Date()}) {
  if (!normalizeEmail(email)) return false; // Legacy records remain visibly missing email.
  if (!Object.hasOwn(MAIL_STAGES,stage) || typeof eventKey !== 'string' || eventKey.length>200 || !/^(?:MA|CO)-[A-Z0-9-]+$/.test(id)) throw new Error('Invalid merchant mail event');
  const stamp=new Date(now).toISOString();
  const inserted=db.prepare('INSERT OR IGNORE INTO merchant_mail_outbox(event_key,application_id,recipient,stage,created_at,next_attempt_at) VALUES(?,?,?,?,?,?)').run(eventKey,id,email,stage,stamp,stamp).changes;
  if (inserted) db.prepare("UPDATE merchant_mail_outbox SET status='superseded' WHERE application_id=? AND event_key<>? AND status IN ('queued','retry','failed')").run(id,eventKey);
  return !!inserted;
}
export function merchantMailStatus(db,id) {
  return {items:db.prepare('SELECT id,stage,status,attempts,created_at AS createdAt,accepted_at AS acceptedAt,error_code AS errorCode FROM merchant_mail_outbox WHERE application_id=? ORDER BY id DESC LIMIT 10').all(id)};
}
export function mailConfiguration(env=process.env) {
  const from=normalizeEmail(env.MERCHANT_MAIL_FROM), port=Number(env.MERCHANT_SMTP_PORT || 465);
  const configured=!!(env.MERCHANT_SMTP_HOST && env.MERCHANT_SMTP_USER && env.MERCHANT_SMTP_PASSWORD && from && [465,587].includes(port));
  return {configured,from,port};
}
export function merchantMailMessage(row,from) {
  const [title,body]=MAIL_STAGES[row.stage];
  const digest=createHash('sha256').update(row.event_key).digest('hex');
  return {from:{name:'AirRadar 店铺审核',address:from},to:row.recipient,
    messageId:`<merchant-${digest}@${from.split('@')[1]}>`,subject:`AirRadar：${title}`,
    text:`${title}\n\n申请编号：${row.application_id}\n\n${body}\n\n这是一封店铺申请进度通知，不是交易担保。若你未提交过申请，请忽略此邮件。`,
    disableFileAccess:true,disableUrlAccess:true};
}
export async function drainMerchantMail(db,{transport,from,now=new Date(),signal,env=process.env}={}) {
  const config=mailConfiguration(env);
  if (!transport && !config.configured) return {configured:false,processed:0};
  let owned=false;
  if (!transport) {
    const {default:nodemailer}=await import('nodemailer');
    transport=nodemailer.createTransport({host:env.MERCHANT_SMTP_HOST,port:config.port,secure:config.port===465,requireTLS:true,
      auth:{user:env.MERCHANT_SMTP_USER,pass:env.MERCHANT_SMTP_PASSWORD},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
      connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
      disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
    owned=true;
  }
  from=normalizeEmail(from||config.from);
  if (!from) throw new Error('Invalid sender');
  const stamp=new Date(now).toISOString(), lease=new Date(+new Date(now)+120000).toISOString();
  let processed=0;
  try {
    // A crash during SMTP DATA has uncertain delivery; do not silently resend.
    db.prepare("UPDATE merchant_mail_outbox SET status='uncertain',error_code='delivery_unknown' WHERE status='sending' AND lease_until<?").run(stamp);
    for (let n=0;n<3&&!signal?.aborted;n++) {
      db.exec('BEGIN IMMEDIATE');
      let row;
      try {
        row=db.prepare("SELECT * FROM merchant_mail_outbox WHERE status IN ('queued','retry') AND next_attempt_at<=? ORDER BY id LIMIT 1").get(stamp);
        if (row) {
          const today=new Date(+new Date(now)-86400000).toISOString();
          const count=db.prepare("SELECT COUNT(*) n FROM merchant_mail_outbox WHERE recipient=? COLLATE NOCASE AND created_at>=? AND attempts>0").get(row.recipient,today).n;
          if (count>=20) { db.prepare("UPDATE merchant_mail_outbox SET status='failed',error_code='recipient_limit' WHERE id=?").run(row.id); row=null; }
          else db.prepare("UPDATE merchant_mail_outbox SET status='sending',attempts=attempts+1,lease_until=? WHERE id=?").run(lease,row.id);
        }
        db.exec('COMMIT');
      } catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error;}
      if (!row) break;
      try {
        const message=merchantMailMessage(row,from);
        const replyTo=normalizeEmail(env.MERCHANT_MAIL_REPLY_TO);
        if(replyTo)message.replyTo=replyTo;
        const result=await transport.sendMail(message);
        if (!result.accepted?.some(email=>String(email).toLowerCase()===row.recipient.toLowerCase())) throw Object.assign(new Error('Recipient rejected'),{code:'EENVELOPE'});
        db.prepare("UPDATE merchant_mail_outbox SET status='accepted',accepted_at=?,lease_until=NULL,error_code=NULL WHERE id=?").run(new Date().toISOString(),row.id);
      } catch(error) {
        // Never persist SMTP error messages: servers often echo addresses/auth details.
        const permanent=['EAUTH','EENVELOPE','EMESSAGE'].includes(error.code)||Number(error.responseCode)>=500;
        const ambiguous=error.command==='DATA'||!['EAUTH','EENVELOPE','EMESSAGE','EDNS','ECONNECTION','ETIMEDOUT','ESOCKET','ETLS'].includes(error.code);
        const state=permanent?'failed':ambiguous?'uncertain':row.attempts>=3?'failed':'retry';
        const code=permanent?'provider_rejected':ambiguous?'delivery_unknown':'connection_failed';
        db.prepare('UPDATE merchant_mail_outbox SET status=?,error_code=?,next_attempt_at=?,lease_until=NULL WHERE id=?').run(state,code,new Date(+new Date(now)+Math.min(3600000,60000*2**row.attempts)).toISOString(),row.id);
      }
      processed++;
    }
  } finally {if(owned)transport.close();}
  return {configured:true,processed};
}
