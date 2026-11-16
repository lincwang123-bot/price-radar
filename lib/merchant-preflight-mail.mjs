import {createHash} from 'node:crypto';
import {preflightGuidance,isPreflightReasonCode,isPreflightHttpStatus} from './merchant-preflight-guidance.mjs';
import {normalizeEmail,queueMerchantMail} from './merchant-mail.mjs';
import {latestMerchantReply} from './merchant-replies.mjs';
import {merchantQuoteDiagnosticSummary} from './merchant-quote-diagnostics.mjs';

// These checklists are owned copy, never merchant HTML, transport errors or private evidence.
const CATALOG_REQUESTS=[
 '公开商品列表及 1–2 个无需登录的在售商品详情页链接。',
 '建站系统及版本（不清楚可注明）；如有公开只读接口，请附说明。',
];
// collector_limit is our read budget (page/request/size caps). It must stay out of
// this map so the notice stage is collection_failed, not a merchant need_info email.
// robots_disallowed, invalid_catalog and no_valid_quotes stay here when the shop
// itself blocked, returned an unreadable catalogue, or had no displayable quotes.
const REQUESTS={
 not_found:CATALOG_REQUESTS,
 unsupported_platform:CATALOG_REQUESTS,
 invalid_catalog:[...CATALOG_REQUESTS,'样例的真实价格、库存和规格。'],
 login_required:['无需登录的公开商品目录或公开只读接口说明，不要提供登录账号。'],
 access_denied:['允许自动读取的公开目录、访问频率及 1–2 个商品详情页；无需关闭安全防护。'],
 robots_disallowed:['允许自动读取的公开目录路径及规则说明；规则允许前暂停采集。'],
 no_valid_quotes:['1–2 个在售商品链接及真实价格、币种、库存、时长、交付方式（代充或成品号等）和质保。不要求修改实际商品条件。'],
 redirect_disallowed:['最终 HTTPS 店铺网址（保留 www）及公开商品列表；我们核对后重测，无需关闭跳转。'],
 rate_limited:['公开目录允许的请求频率或限流说明，无需关闭安全防护。'],
};
// Only new tests gain the additional failure notice; never bulk-mail historical failures.
const FAILURE_NOTICE_SINCE=Date.parse('2026-09-28T10:00:00.000Z');
const formatTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function preflightFailureNotice(application,preflight,{reply=null}={}){
 const known=preflight.status==='no_valid_offers'?{...preflight,result:{...preflight.result,reasonCode:'no_valid_quotes'}}:preflight;
 const guidance=preflightGuidance(known,application);
 let requests=REQUESTS[guidance.code];
 // Only a stored, version-matched verified reply is passed by the caller. Its
 // prose cannot mechanically prove every field; existing sample URLs mean the
 // next step is site review, not asking for the same complete checklist again.
 const supplied=!!reply&&reply.applicationVersion===application.version&&Array.isArray(reply.publicUrls)&&reply.publicUrls.length>0;
 const reviewSupplied=supplied&&['invalid_catalog','no_valid_quotes'].includes(guidance.code);
 const diagnostics=guidance.code==='no_valid_quotes'?merchantQuoteDiagnosticSummary(preflight.result?.diagnostics,{rawCount:preflight.result?.rawCount,validCount:preflight.result?.validCount}):null;
 const reasons=diagnostics?.reasons||[];
 const observed=reasons.length?`\n解析规则记录${diagnostics.truncated?'（仅前 20 条）':''}：${reasons.slice(0,3).map(row=>`${row.label}（${row.count} 条）`).join('；')}。`:'';
 if(reviewSupplied)requests=null;
 else if(diagnostics&&reasons.length){
  const assistance={out_of_stock:'请仅确认已提供样例的实际在售状态；真实缺货无需修改。',inventory_unconfirmed:'请仅确认样例的实际在售状态，服务类商品可说明是否需要卡密库存。',no_warranty:'请仅确认样例实际适用的售后或质保条款，不要求增加原本不存在的保障。',invalid_price:'请仅确认样例的实际成交价格及币种；我们会核对解析结果。'};
  // Only a complete set of observed, actionable reasons can reduce the list to
  // specific fields. Mixed/partial or unclassified results belong to site review.
  requests=!diagnostics.truncated&&reasons.every(row=>Object.hasOwn(assistance,row.code))?reasons.map(row=>assistance[row.code]):null;
 }
 const checked=new Date(preflight.result?.checkedAt);
 const when=Number.isFinite(+checked)?`检测时间：${formatTime.format(checked)}（北京时间）\n`:'';
 const http=isPreflightHttpStatus(preflight.result?.httpStatus)?`（HTTP ${preflight.result.httpStatus}）`:'';
 const next=reviewSupplied?'已收到您补充的公开商品链接。我们会先核对现有资料与解析规则；如仍需协助，再说明具体缺项。您暂时无需重复提交已有资料或修改店铺配置。'
  :requests?'请回复：'+requests.join(' ')
  :diagnostics&&reasons.length?'由我们先核对解析结果与展示规则。您暂时无需补交已有资料或修改店铺配置。'
  :guidance.nextStep+' 您暂时无需补交已有资料或修改店铺配置。';
 return {code:guidance.code,stage:requests?'need_info':'collection_failed',publicReply:
  `${when}检测结果：${guidance.title}${http}\n${guidance.explanation}${observed}\n\n下一步：${next}\n\n回复请保留申请编号。不要发送密码、验证码、卡密、私钥或 API Key。`};
}

export function queuePreflightResultMail(db,application,preflight,{now=new Date()}={}){
 if(application.status!=='pending'||!normalizeEmail(application.email)||!preflight?.fresh
  ||preflight.status!==preflight.result?.status||!['ready','waiting_adapter','unavailable','no_valid_offers'].includes(preflight.status))return false;
 const reply=latestMerchantReply(db,application.id);
 // A reply is not a reason to resend an old result: only a check started after its intake qualifies.
 if(reply&&(preflight.applicationVersion!==application.version
  ||!Number.isFinite(Date.parse(preflight.requestedAt))||Date.parse(preflight.requestedAt)<Date.parse(reply.createdAt)))return false;
 const ready=preflight.status==='ready';
 const notice=ready?{stage:'ready',publicReply:''}:preflightFailureNotice(application,preflight,{reply});
 // A successful test still waits for manual approval before its outcome mail.
 if(ready){
  db.prepare("UPDATE merchant_mail_outbox SET status='superseded',error_code='mail_policy_stage' WHERE application_id=? AND event_key LIKE ? AND status IN ('queued','retry','failed')").run(application.id,application.id+':auto-preflight:%');
  return false;
 }
 // A missing historical reason is not evidence for a new failure notification.
 if(notice.stage==='collection_failed'&&(!isPreflightReasonCode(preflight.result.reasonCode)
   ||!Number.isFinite(Date.parse(preflight.requestedAt))||Date.parse(preflight.requestedAt)<FAILURE_NOTICE_SINCE))return false;
 const recipientKey=createHash('sha256').update(application.email.toLowerCase()).digest('hex').slice(0,20);
 // Same application version + reason + confirmed recipient: one automatic notice, even after a retest.
 const eventKey=`${application.id}:auto-preflight:v1:${application.version}:${notice.code}:${recipientKey}${reply?':reply:'+reply.id:''}`;
 const owned=!db.isTransaction;
 if(owned)db.exec('BEGIN IMMEDIATE');
 try{
  // Shared policy limits each verified reply round to one outcome, even across retests.
  const queued=queueMerchantMail(db,{id:application.id,email:application.email,stage:notice.stage,publicReply:notice.publicReply,eventKey,replyRoundId:reply?.id||0,now});
  if(owned)db.exec('COMMIT');
  return queued;
 }catch(error){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
