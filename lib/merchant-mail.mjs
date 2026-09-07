// Private transactional outbox. SMTP acceptance is not proof of inbox delivery.
import { createHash } from 'node:crypto';
import { MAIL_STAGES, notificationContent } from './notification-template.mjs';
import {merchantMailGroup,merchantAutomaticStageAllowed,reconcileMerchantMailPolicy} from './merchant-mail-policy.mjs';
export { MAIL_STAGES } from './notification-template.mjs';

export function normalizeEmail(value) {
  if (typeof value !== 'string' || /[\r\n\u0000-\u0020\u007f]/.test(value)) return null;
  if (value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value)) return null;
  const [local, domain] = value.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.includes('..') || domain.split('.').some(x=>x.startsWith('-')||x.endsWith('-'))) return null;
  return local + '@' + domain.toLowerCase();
}
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
  if (!db.prepare('PRAGMA table_info(merchant_mail_outbox)').all().some(row=>row.name==='public_reply')) db.exec("ALTER TABLE merchant_mail_outbox ADD COLUMN public_reply TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS merchant_mail_application ON merchant_mail_outbox(application_id,id)');
}
export function queueMerchantMail(db,{id,email,stage,eventKey,publicReply='',now=new Date()}) {
  if (!normalizeEmail(email)) return false; // Legacy records remain visibly missing email.
  if (!Object.hasOwn(MAIL_STAGES,stage) || typeof eventKey !== 'string' || eventKey.length>200 || !/^(?:MA|CO|FB)-[A-Z0-9-]+$/.test(id) || typeof publicReply!=='string' || publicReply.length>1500) throw new Error('Invalid merchant mail event');
  const stamp=new Date(now).toISOString();
  const owned=!db.isTransaction;if(owned)db.exec('BEGIN IMMEDIATE');
  try{
  const merchant=merchantMailGroup(db,id);
  if(merchant&&stage!=='reply'&&!merchantAutomaticStageAllowed(stage)){
    reconcileMerchantMailPolicy(db,id);
    if(owned)db.exec('COMMIT');return false;
  }
  const inserted=db.prepare('INSERT OR IGNORE INTO merchant_mail_outbox(event_key,application_id,recipient,stage,created_at,next_attempt_at,public_reply) VALUES(?,?,?,?,?,?,?)').run(eventKey,id,email,stage,stamp,stamp,publicReply).changes;
  // Merchant receipts/outcomes share a lifetime budget; unrelated feedback keeps its existing supersession.
  if(merchant)reconcileMerchantMailPolicy(db,id);
  else if (inserted && !['received','submission_received','reply'].includes(stage)) db.prepare("UPDATE merchant_mail_outbox SET status='superseded' WHERE application_id=? AND event_key<>? AND stage NOT IN ('received','submission_received','reply') AND (public_reply='' OR event_key LIKE ?) AND (?<>'published' OR stage<>'approved') AND status IN ('queued','retry','failed')").run(id,eventKey,id+':auto-preflight:%',stage);
  const queued=!!inserted&&db.prepare('SELECT status FROM merchant_mail_outbox WHERE event_key=?').get(eventKey).status==='queued';
  if(owned)db.exec('COMMIT');return queued;
  }catch(error){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
export function merchantMailStatus(db,id) {
  const ids=merchantMailGroup(db,id)?.ids||[id];
  return {items:db.prepare(`SELECT id,stage,status,attempts,created_at AS createdAt,accepted_at AS acceptedAt,error_code AS errorCode,public_reply AS publicReply FROM merchant_mail_outbox WHERE application_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id DESC LIMIT 10`).all(...ids)};
}
export function mailConfiguration(env=process.env) {
  const from=normalizeEmail(env.MERCHANT_MAIL_FROM), port=Number(env.MERCHANT_SMTP_PORT || 465);
  const configured=!!(env.MERCHANT_SMTP_HOST && env.MERCHANT_SMTP_USER && env.MERCHANT_SMTP_PASSWORD && from && [465,587].includes(port));
  return {configured,from,port};
}
export function merchantMailMessage(row,from,{replyEnabled=false}={}) {
  const digest=createHash('sha256').update(row.event_key).digest('hex');
  return {from:{name:'Airadar 通知',address:from},to:row.recipient,
    messageId:`<merchant-${digest}@${from.split('@')[1]}>`,...notificationContent(row,{replyEnabled}),
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
        reconcileMerchantMailPolicy(db);
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
        const replyTo=normalizeEmail(env.MERCHANT_MAIL_REPLY_TO);
        const message=merchantMailMessage(row,from,{replyEnabled:!!replyTo});
        if(replyTo)message.replyTo=replyTo;
        if(env.MERCHANT_SMTP_HOST==='smtp.resend.com')message.headers={'Resend-Idempotency-Key':createHash('sha256').update(row.event_key).digest('hex')};
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
