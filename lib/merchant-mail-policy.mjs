// One receipt + one initial outcome; each verified new merchant reply opens one outcome round.
// Keep delivery history intact. SMTP attempts reserve a slot conservatively, even if delivery is unknown.
import {latestMerchantReply} from './merchant-replies.mjs';
const receipts=new Set(['received','submission_received']);
const allowed=new Set([...receipts,'approved','need_info']);
const pending=new Set(['queued','retry','failed']);
const attempted=row=>row.attempts>0||['accepted','sending','uncertain'].includes(row.status);
const kind=row=>receipts.has(row.stage)?'receipt':'outcome';
const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export function merchantMailGroup(db,id){
 const link=tableExists(db,'merchant_submission_links')
  ?db.prepare('SELECT source_submission_id,application_id FROM merchant_submission_links WHERE application_id=? OR source_submission_id=?').get(id,id):null;
 if(link)return {key:link.application_id,ids:[link.source_submission_id,link.application_id]};
 if(id.startsWith('MA-'))return {key:id,ids:[id]};
 if(id.startsWith('CO-')&&tableExists(db,'cooperation_submissions')
  &&db.prepare("SELECT 1 FROM cooperation_submissions WHERE public_id=? AND topic='supply'").get(id))return {key:id,ids:[id]};
 return null; // Feedback and demand notifications retain their separate workflow.
}
export const merchantAutomaticStageAllowed=stage=>allowed.has(stage);

function reconcileGroup(db,group){
 const rows=db.prepare(`SELECT id,stage,status,attempts,recipient,reply_round_id FROM merchant_mail_outbox WHERE application_id IN (${group.ids.map(()=>'?').join(',')}) AND stage<>'reply' ORDER BY id`).all(...group.ids);
 const currentRound=latestMerchantReply(db,group.key)?.id||0;
 const app=tableExists(db,'merchant_applications')?db.prepare('SELECT status,email FROM merchant_applications WHERE public_id=?').get(group.key):null;
 const state=app?.status;
 const validStage=row=>allowed.has(row.stage)&&(receipts.has(row.stage)||!state
  ||(state==='pending'&&row.stage==='need_info')||(state==='approved'&&row.stage==='approved'));
 const recipientMatches=row=>!app||!!app.email&&row.recipient.toLowerCase()===app.email.toLowerCase();
 const eligible=row=>validStage(row)&&recipientMatches(row)
  &&(kind(row)==='receipt'?row.reply_round_id===0:row.reply_round_id===currentRound);
 const keep=new Set();
 for(const round of new Set([0,currentRound])){
 const spent=rows.filter(row=>row.reply_round_id===round&&attempted(row));
 const limit=round?1:2;
 let remaining=Math.max(0,limit-spent.length);
 for(const slot of round?['outcome']:['receipt','outcome']){
  const used=spent.filter(row=>kind(row)===slot);
  if(used.length){
   // Only the first event in a slot can continue a safe connection retry.
   if(spent.indexOf(used[0])<limit&&eligible(used[0]))keep.add(used[0].id);
  }else if(remaining){
   const candidates=rows.filter(row=>row.reply_round_id===round&&pending.has(row.status)&&eligible(row)&&kind(row)===slot&&!attempted(row));
   // Preserve the original receipt; use the latest still-unsent result.
   const selected=slot==='receipt'?candidates[0]:candidates.at(-1);
   if(selected){keep.add(selected.id);remaining--;}
  }
 }
 }
 let suppressed=0;
 for(const row of rows){
  if(pending.has(row.status)&&!keep.has(row.id)){
   const spent=rows.filter(other=>other.reply_round_id===row.reply_round_id&&attempted(other));
   const code=!eligible(row)?'mail_policy_stage':attempted(row)||spent.some(other=>kind(other)===kind(row))||spent.length>=(row.reply_round_id?1:2)?'mail_policy_limit':'mail_policy_replaced';
   suppressed+=Number(db.prepare("UPDATE merchant_mail_outbox SET status='superseded',error_code=?,lease_until=NULL WHERE id=? AND status IN ('queued','retry','failed')").run(code,row.id).changes);
  }
 }
 return suppressed;
}

// May also be run once on legacy queues before restarting the mail worker. No network calls.
export function reconcileMerchantMailPolicy(db,id){
 const owned=!db.isTransaction;if(owned)db.exec('BEGIN IMMEDIATE');
 try{
  const ids=id?[id]:db.prepare("SELECT DISTINCT application_id FROM merchant_mail_outbox WHERE status IN ('queued','retry','failed')").all().map(row=>row.application_id);
  const seen=new Set();let suppressed=0;
  for(const appId of ids){const group=merchantMailGroup(db,appId);if(!group||seen.has(group.key))continue;seen.add(group.key);suppressed+=reconcileGroup(db,group);}
  if(owned)db.exec('COMMIT');return {suppressed};
 }catch(error){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
