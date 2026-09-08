import {createHash} from 'node:crypto';
import {mailConfiguration} from './merchant-mail.mjs';
export const RETENTION_ORIGIN='https://airadar.vip';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest=v=>createHash('sha256').update(v).digest('hex');
export function retentionMessage(store,row,market,from,{now=new Date()}={}){
 const payload=JSON.parse(row.payload);
 let subject,text;
 if(row.kind==='code'){
  const code=store.db.prepare('SELECT used,expires_at,purpose FROM retention_codes WHERE id=?').get(payload.requestId);
  if(!code||code.used||code.expires_at<=now.toISOString()||!/^\d{6}$/.test(payload.code||''))return null;
  const reset=code.purpose==='reset',register=code.purpose==='register';
  subject=reset?'Airadar：重置密码验证码':register?'Airadar：注册与设置密码验证码':'Airadar：邮箱确认验证码';
  text=`你好，\n\n${reset?'我们收到了重置 Airadar 账号密码的请求。':register?'你正在注册 Airadar 账号，或为之前已验证的邮箱设置密码。':'你正在验证 Airadar 邮箱。'}\n\n你的验证码：${payload.code}\n\n请回到 Airadar 页面输入验证码，10 分钟内有效，只能使用一次。${reset?'重置完成后，所有设备上的旧登录将失效，请用新密码重新登录。':register?'验证并设置密码后，你可以用邮箱和密码登录，原有关注会保留。':''}\n\n请勿将验证码或密码提供给任何人。Airadar 不会通过邮件索要你的密码。\n如果不是你发起的请求，请忽略本邮件，账号不会因此发生改变。`;
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
 const message={from:{name:'Airadar 通知',address:from},to:row.recipient,subject,text,
  html:'<div style="font-family:system-ui,sans-serif;line-height:1.8;max-width:620px;margin:auto;overflow-wrap:anywhere"><h2>'+esc(subject)+'</h2>'+text.split('\n\n').map(p=>'<p>'+esc(p).replace(/\n/g,'<br>').replace(/https:\/\/airadar\.vip\/(?:following(?:\?from=reminder)?|unsubscribe\?token=[a-f0-9.]+)/g,url=>'<a style="color:#216854" href="'+url+'">'+(url.includes('/unsubscribe')?'退订所有邮箱提醒':'查看我的关注')+'</a>')+'</p>').join('')+'</div>',
  messageId:`<retention-${digest(row.event_key)}@${from.split('@')[1]}>`,disableFileAccess:true,disableUrlAccess:true};
 if(row.kind==='code')message.html='<div style="background:#f3f6f3;padding:32px 16px;font-family:Arial,sans-serif;line-height:1.8;color:#233c30"><div style="max-width:560px;margin:auto"><div style="font-size:30px;font-weight:700;color:#27674f;margin-bottom:20px">Airadar<span style="color:#76a68e">.</span></div><div style="background:#fff;border:1px solid #dbe4df;border-top:5px solid #27674f;border-radius:12px;padding:28px"><h1 style="font-size:22px;margin:0 0 16px">'+esc(subject.replace('Airadar：',''))+'</h1>'+text.split('\n\n').map(p=>p.startsWith('你的验证码：')?'<div style="background:#edf5ef;border-radius:8px;padding:18px;text-align:center;font-size:34px;letter-spacing:8px;font-weight:bold;color:#27674f">'+esc(payload.code)+'</div>':'<p style="font-size:15px;margin:16px 0">'+esc(p).replace(/\n/g,'<br>')+'</p>').join('')+'</div><p style="font-size:12px;color:#6b7d72">airadar.vip · 此邮件仅用于账号验证，不包含营销内容。</p></div></div>';
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
  for(const row of db.prepare("SELECT account_id FROM retention_mail WHERE kind='digest' AND status='sending' AND lease_until<?").all(stamp))store.noteDigestAt(row.account_id,stamp);
  db.prepare("UPDATE retention_mail SET status='uncertain',error_code='delivery_unknown' WHERE status='sending' AND lease_until<?").run(stamp);
  for(let n=0;n<3&&!signal?.aborted;n++){
   const row=db.prepare("SELECT * FROM retention_mail WHERE status IN ('queued','retry') AND next_at<=? ORDER BY CASE WHEN kind='code' THEN 0 ELSE 1 END,id LIMIT 1").get(stamp);if(!row)break;
   const last=row.kind==='digest'?store.lastDigestAt(row.account_id):null;
   if(last&&+now-Date.parse(last)<86400000){db.prepare('UPDATE retention_mail SET next_at=? WHERE id=?').run(new Date(Date.parse(last)+86400001).toISOString(),row.id);continue;}
   const message=retentionMessage(store,row,market,from,{now});
   if(!message){db.prepare("UPDATE retention_mail SET status='cancelled',payload='{}' WHERE id=?").run(row.id);continue;}
   const claimed=db.prepare("UPDATE retention_mail SET status='sending',attempts=attempts+1,lease_until=? WHERE id=? AND status IN ('queued','retry')").run(new Date(+now+120000).toISOString(),row.id).changes;if(!claimed)continue;
   if(env.MERCHANT_SMTP_HOST==='smtp.resend.com')message.headers={...message.headers,'Resend-Idempotency-Key':digest(row.event_key)};
   try{
    const result=await transport.sendMail(message);
    if(!result.accepted?.some(email=>String(email).toLowerCase()===row.recipient.toLowerCase()))throw Object.assign(new Error('Rejected'),{code:'EENVELOPE'});
    db.prepare("UPDATE retention_mail SET status='accepted',payload='{}',lease_until=NULL,error_code=NULL WHERE id=?").run(row.id);
    if(row.kind==='digest')store.noteDigestAt(row.account_id,stamp);
   }catch(error){
    const permanent=['EAUTH','EENVELOPE','EMESSAGE'].includes(error.code)||Number(error.responseCode)>=500;
    const ambiguous=error.command==='DATA'||!['EAUTH','EENVELOPE','EMESSAGE','EDNS','ECONNECTION','ETIMEDOUT','ESOCKET','ETLS'].includes(error.code);
    const status=permanent?'failed':ambiguous?'uncertain':row.attempts>=2?'failed':'retry';
    db.prepare('UPDATE retention_mail SET status=?,error_code=?,next_at=?,lease_until=NULL WHERE id=?').run(status,permanent?'provider_rejected':ambiguous?'delivery_unknown':'connection_failed',new Date(+now+60000*2**row.attempts).toISOString(),row.id);
    if(row.kind==='digest'&&status==='uncertain')store.noteDigestAt(row.account_id,stamp);
   }
   processed++;
  }
 }finally{if(owned)transport.close();}
 return {configured:true,processed};
}
