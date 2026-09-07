import {createHash} from 'node:crypto';
import {mailConfiguration} from './merchant-mail.mjs';
export const RETENTION_ORIGIN='https://airadar.vip';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest=v=>createHash('sha256').update(v).digest('hex');
export function retentionMessage(store,row,market,from,{now=new Date()}={}){
 const payload=JSON.parse(row.payload);
 let subject,text;
 if(row.kind==='code'){
  const code=store.db.prepare('SELECT used,expires_at FROM retention_codes WHERE id=?').get(payload.requestId);
  if(!code||code.used||code.expires_at<=now.toISOString()||!/^\d{6}$/.test(payload.code||''))return null;
  subject='AirRadar 邮箱确认验证码';text=`你的验证码：${payload.code}\n\n10 分钟内有效。验证后可同步关注清单，并按你选择的条件接收提醒。\n如果不是你发起的请求，可以忽略本邮件。`;
 }else{
  const a=store.account(row.account_id);if(!a?.email_enabled||a.email!==row.recipient)return null;
  const notices=(payload.noticeIds||[]).slice(0,20).flatMap(id=>{
   const n=store.db.prepare('SELECT n.*,w.paused,w.mode,w.target_price,w.group_id,w.renewal_date FROM retention_notices n JOIN retention_watches w ON w.id=n.watch_id WHERE n.id=? AND n.account_id=?').get(id,a.id);
   if(!n||n.paused)return [];
   const p=JSON.parse(n.payload),g=market.groups.find(g=>g.id===n.group_id);
   if(n.kind==='renewal')return n.renewal_date===p.renewalDate&&p.renewalDate>=now.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})?[`${p.name}：你记录的到期日期为 ${p.renewalDate}。`]:[];
   if(n.mode==='off'||!g||g.state!=='available'||(n.kind==='target'&&(n.mode!=='target'||g.price>n.target_price))||(n.kind==='drop'&&(n.mode!=='changes'||g.price>p.price))||(n.kind==='restock'&&n.mode!=='restock')||(n.kind==='weekly'&&n.mode!=='weekly'))return [];
   return [`${g.name} · ${g.spec}\n当前已收录报价 ${g.currency} ${g.price} 起，${g.offerCount} 条符合规格的报价。\n观察时间：${new Date(g.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`];
  });
  if(!notices.length)return null;
  subject='你关注的 AI 产品有新动态';
  text=notices.join('\n\n')+'\n\n查看关注清单：'+RETENTION_ORIGIN+'/following?from=reminder\n\n价格与适用条件请在店铺结算页面核对。每个邮箱最多每天一封行情或续费汇总。\n管理提醒：'+RETENTION_ORIGIN+'/following\n退订所有提醒：'+RETENTION_ORIGIN+'/unsubscribe?token='+store.unsubscribeToken(a.id);
 }
 const message={from:{name:'AirRadar 提醒',address:from},to:row.recipient,subject,text,
  html:'<div style="font-family:system-ui,sans-serif;line-height:1.8;max-width:620px;margin:auto;overflow-wrap:anywhere"><h2>'+esc(subject)+'</h2>'+text.split('\n\n').map(p=>'<p>'+esc(p).replace(/\n/g,'<br>').replace(/https:\/\/airadar\.vip\/(?:following(?:\?from=reminder)?|unsubscribe\?token=[a-f0-9.]+)/g,url=>'<a style="color:#216854" href="'+url+'">'+(url.includes('/unsubscribe')?'退订所有邮箱提醒':'查看我的关注')+'</a>')+'</p>').join('')+'</div>',
  messageId:`<retention-${digest(row.event_key)}@${from.split('@')[1]}>`,disableFileAccess:true,disableUrlAccess:true};
 if(row.kind!=='code')message.headers={'List-Unsubscribe':`<${RETENTION_ORIGIN}/api/retention/unsubscribe?token=${store.unsubscribeToken(row.account_id)}>`, 'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
 return message;
}
export async function drainRetentionMail(store,market,{env=process.env,transport,from,now=new Date(),signal}={}){
 const config=mailConfiguration(env);if(!transport&&!config.configured)return {configured:false,processed:0};
 const db=store.db,stamp=now.toISOString();let owned=false,processed=0;
 try{
  if(!transport){
   const {default:nodemailer}=await import('nodemailer');
   transport=nodemailer.createTransport({host:env.MERCHANT_SMTP_HOST,port:config.port,secure:config.port===465,requireTLS:true,auth:{user:env.MERCHANT_SMTP_USER,pass:env.MERCHANT_SMTP_PASSWORD},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});owned=true;
  }
  from=from||config.from;
  db.prepare("UPDATE retention_mail SET status='uncertain',error_code='delivery_unknown' WHERE status='sending' AND lease_until<?").run(stamp);
  for(let n=0;n<3&&!signal?.aborted;n++){
   const row=db.prepare("SELECT * FROM retention_mail WHERE status IN ('queued','retry') AND next_at<=? ORDER BY CASE WHEN kind='code' THEN 0 ELSE 1 END,id LIMIT 1").get(stamp);if(!row)break;
   const message=retentionMessage(store,row,market,from,{now});
   if(!message){db.prepare("UPDATE retention_mail SET status='cancelled',payload='{}' WHERE id=?").run(row.id);continue;}
   const claimed=db.prepare("UPDATE retention_mail SET status='sending',attempts=attempts+1,lease_until=? WHERE id=? AND status IN ('queued','retry')").run(new Date(+now+120000).toISOString(),row.id).changes;if(!claimed)continue;
   if(env.MERCHANT_SMTP_HOST==='smtp.resend.com')message.headers={...message.headers,'Resend-Idempotency-Key':digest(row.event_key)};
   try{
    const result=await transport.sendMail(message);
    if(!result.accepted?.some(email=>String(email).toLowerCase()===row.recipient.toLowerCase()))throw Object.assign(new Error('Rejected'),{code:'EENVELOPE'});
    db.prepare("UPDATE retention_mail SET status='accepted',payload='{}',lease_until=NULL,error_code=NULL WHERE id=?").run(row.id);
   }catch(error){
    const permanent=['EAUTH','EENVELOPE','EMESSAGE'].includes(error.code)||Number(error.responseCode)>=500;
    const ambiguous=error.command==='DATA'||!['EAUTH','EENVELOPE','EMESSAGE','EDNS','ECONNECTION','ETIMEDOUT','ESOCKET','ETLS'].includes(error.code);
    const status=permanent?'failed':ambiguous?'uncertain':row.attempts>=2?'failed':'retry';
    db.prepare('UPDATE retention_mail SET status=?,error_code=?,next_at=?,lease_until=NULL WHERE id=?').run(status,permanent?'provider_rejected':ambiguous?'delivery_unknown':'connection_failed',new Date(+now+60000*2**row.attempts).toISOString(),row.id);
   }
   processed++;
  }
 }finally{if(owned)transport.close();}
 return {configured:true,processed};
}
