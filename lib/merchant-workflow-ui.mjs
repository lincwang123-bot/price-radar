import { safeExternalLink } from './admin-links.mjs';
import { MAIL_STAGES } from './merchant-mail.mjs';
import { preflightGuidance } from './merchant-preflight-guidance.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={pending:'等待自动测试',ready:'可读取商品，待人工审核',no_valid_offers:'目录可读，暂无有效报价',waiting_adapter:'需要适配',unavailable:'暂时读取失败',expired:'测试已过期',invalid:'测试结果无效'};
export function preflightSummary(preflight) {return labels[preflight?.status]||'自动检测待排队';}
export function mailSummary(mail={items:[]}) {
  const row=mail.items[0];
  return row?({queued:'等待发送',retry:'发送失败，等待重试',failed:'发送失败，请检查配置',uncertain:'发送结果不确定，需核查',accepted:'发送服务已接受',superseded:'已由新进度替代'}[row.status]||'等待发送'):'暂无通知';
}
export function publicReplyField(email,{required=false}={}) {
  return email ? `<label class="field"><span>发给用户的回复${required?'':'（选填）'}</span><textarea name="publicReply" maxlength="1500"${required?' required':''} placeholder="这段内容会随通知邮件发给对方，请勿填写内部备注或账号凭据。"></textarea></label>` : '<p class="muted">未填写有效邮箱，暂不能发送邮件回复；仍可保存内部处理记录。</p>';
}
export function notificationHistory(mail={items:[]}) {
  return `<section class="panel"><h2>通知记录</h2>${mail.items.map(item=>`<article><p>${esc(MAIL_STAGES[item.stage]?.[0]||item.stage)} · ${esc(mailSummary({items:[item]}))}</p>${item.publicReply?`<pre style="white-space:pre-wrap;overflow-wrap:anywhere">发给用户：${esc(item.publicReply)}</pre>`:''}</article>`).join('')||'<p>暂无通知</p>'}</section>`;
}
export function replyForm(app,csrf) {
  return app.email?`<form method="post" action="/admin/merchants/${encodeURIComponent(app.id)}"><h2>回复申请人</h2><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="version" value="${esc(app.version)}">${publicReplyField(app.email,{required:true})}<button name="action" value="reply">发送回复（不更改审核状态）</button></form>`:'';
}
export function mailPanel(app,mail,csrf,config={configured:false}) {
  return `<section class="panel"><h2>邮件通知</h2><p>${config.configured?'发件服务已配置；服务接受不等于邮件已进入收件箱。':'发件服务尚未配置：通知会保存在队列，不会实际发送。'}</p><p>${app.email?`通知邮箱：${esc(app.email)}（仅后台可见）`:'待补邮箱：原记录已保留，请向申请人索取，不从其他店铺推断。'}</p><p>${esc(mailSummary(mail))}</p>${mail.items.length?`<ul>${mail.items.map(item=>`<li>${esc(MAIL_STAGES[item.stage]?.[0]||item.stage)} · ${esc(mailSummary({items:[item]}))}</li>`).join('')}</ul>`:''}</section>
  <form method="post" action="/admin/merchants/${encodeURIComponent(app.id)}"><h2>${app.email?'更新通知邮箱':'补充通知邮箱'}</h2><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="version" value="${app.version}"><label class="field"><span>邮箱</span><input type="email" name="email" required maxlength="254" autocomplete="email" value="${esc(app.email||'')}"></label><label class="check"><input type="checkbox" name="emailConfirmed" value="true" required><span>邮箱由该申请人提供，我已核对接收对象。</span></label><button type="submit" name="action" value="save_email">保存邮箱</button></form>`;
}
export function supplyIntakeCards(items,preflights={}) {
  if(!items.length)return '';
  return `<section class="panel"><h2>供应投稿转入 · ${items.length} 条</h2><p class="muted">已进入店铺审核。原投稿保留，尚未确认店铺归属和采集授权；测试完成后再核对并创建正式申请。</p></section>${items.map(app=>`<article class="panel"><h2><a href="/admin/merchants/${encodeURIComponent(app.id)}">${esc(app.shopName)}</a></h2><p>${app.urlError?'待核对网址':safeExternalLink(app.shopUrl)}</p><span class="badge">${app.urlError?'网址格式需修正':app.existingApplication?'已有申请，请核对联系人':esc(preflightSummary(preflights[app.id]))}</span> <span class="badge">${app.email?'已填通知邮箱':'待补邮箱'}</span><p class="muted">供应投稿 · ${esc(app.id)}</p></article>`).join('')}`;
}
export function supplyIntakeReview(app,preflight,mail,csrf,config) {
  const guidance=preflightGuidance(preflight,app);
  return `<div class="merchant"><a href="/admin/merchants">← 返回店铺审核</a><section class="panel"><h2>${esc(app.shopName)}</h2><p>这是原供应投稿的标题，尚未作为正式店名核验。</p><p>${app.urlError?esc(app.urlError):safeExternalLink(app.shopUrl)}</p><dl><dt>联系方式</dt><dd>${esc(app.contact)}</dd><dt>原始说明</dt><dd>${esc(app.details)}</dd></dl><a href="/admin/submission/${encodeURIComponent(app.id)}">查看原投稿</a></section><section class="panel"><h2>自动接入检测</h2>${app.urlError?`<p>${esc(app.urlError)}。未发起网络请求。</p>`:app.existingApplication?`<p>已有同网址申请，未重复测试或合并联系人。</p><a href="/admin/merchants/${encodeURIComponent(app.existingApplication.id)}">查看现有申请并核对</a>`:`<p>${esc(preflightSummary(preflight))}</p><p>${esc(guidance.explanation)}</p><p>${esc(guidance.nextStep||'')}</p>${preflight?.result&&['ready','no_valid_offers'].includes(preflight.result.status)?`<p>有效报价 ${preflight.result.validCount} 条 / 原始解析 ${preflight.result.rawCount} 条</p>${preflight.result.samples.map(s=>`<p>${esc(s.title)} · ${esc(s.currency)} ${s.price} · ${safeExternalLink(s.url,'核对商品')}</p>`).join('')}`:''}`}<p class="muted">仅检测公开目录，不证明店铺归属，不授权上架，不保证交易。</p></section>${mailPanel(app,mail,csrf,config)}${replyForm(app,csrf)}${notificationHistory(mail)}<section class="panel"><h2>下一步：人工核验</h2><p>确认店名、店铺归属和公开商品采集授权后，转为正式待审核申请。已有申请的请先核对联系人，避免重复认领。</p><a href="/admin/submission/${encodeURIComponent(app.id)}/merchant">核对资料并转为正式申请 →</a></section></div>`;
}
