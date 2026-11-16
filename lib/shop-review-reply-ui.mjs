import {REVIEW_ADMIN_CSS} from './shop-review-ui.mjs';
import {REVIEW_DELIVERIES,REVIEW_STATUSES,REVIEW_REASONS} from './shop-reviews.mjs';
import {REVIEW_REPLY_STATUSES} from './shop-review-replies.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
const path=(base,id)=>base+encodeURIComponent(String(id??''));
const options=values=>Object.entries(values).map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join('');
const state=value=>REVIEW_REPLY_STATUSES[value]||'未知状态';
const historyPayload=value=>{try{const p=JSON.parse(value);return p&&typeof p==='object'?p:{};}catch{return {};}};
const actionNames={submit:'商家提交',edit:'商家修改',publish:'审核通过并展示',reject:'审核未通过',hide:'隐藏回复',withdraw:'商家撤回',erase:'账号注销'};

export function repliesAdminList(service,url,csrf){
 const data=service.queue({status:url.searchParams.get('status')||'pending',page:url.searchParams.get('page')});
 const pageLink=p=>'/admin/review-replies?'+new URLSearchParams({status:data.status,page:p});
 return REVIEW_ADMIN_CSS+`<div class="review-admin"><p><a href="/admin/reviews">← 返回用户评价</a></p><h2>商家回复审核</h2>
 <p class="review-policy">商家回复先审核后展示，修改后重新审核。仅核对客观性、隐私、广告和人身攻击，不因商家身份放宽标准；不能因低分或商家异议删除正常评价。回复审核不代表站方认定哪一方的叙述属实。</p>
 <nav aria-label="商家回复状态">${Object.entries(REVIEW_REPLY_STATUSES).map(([key,label])=>`<a href="/admin/review-replies?status=${esc(key)}"${key===data.status?' aria-current="page"':''}>${esc(label)}</a>`).join('')}</nav>
 ${data.items.map(r=>`<article><div class="review-row"><h2><a href="${esc(path('/admin/review-replies/',r.id))}">${esc(r.shop_name)}</a></h2><span>${esc(state(r.status))}</span></div><p>回复版本 ${esc(r.version)} · 针对评价版本 ${esc(r.review_version)}</p><p class="muted">提交时间：${esc(time(r.submitted_at))}</p><p><a href="${esc(path('/admin/reviews/',r.review_id))}">查看对应用户评价 →</a></p></article>`).join('')||'<section><p>暂无此状态的商家回复。</p></section>'}
 <nav class="review-pages" aria-label="商家回复分页">${data.page>1?`<a href="${esc(pageLink(data.page-1))}">上一页</a>`:''}<span>第 ${esc(data.page)} / ${esc(data.pages)} 页 · ${esc(data.total)} 条 · 每页 20 条</span>${data.page<data.pages?`<a href="${esc(pageLink(data.page+1))}">下一页</a>`:''}</nav></div>`;
}

export function replyAdminDetail(service,id,csrf){
 const r=service.detail(id);if(!r)return null;
 const review=r.review,current=!!review&&review.status==='published'&&review.version===r.review_version;
 const canModerate=['pending','rejected','hidden','published'].includes(r.status),history=r.history||[],actions=r.actions||[];
 return REVIEW_ADMIN_CSS+`<div class="review-admin"><p><a href="/admin/review-replies">← 返回商家回复</a> · <a href="${esc(path('/admin/reviews/',r.review_id))}">查看对应用户评价</a></p>
 <section><div class="review-row"><h2>${esc(r.shop_name)} · 商家回复</h2><span>${esc(state(r.status))}</span></div><p>回复版本 ${esc(r.version)} · 针对评价版本 ${esc(r.review_version)}</p><p class="review-body">${esc(r.body)||'回复正文已清除'}</p>${r.public_note?`<p>给商家的处理说明：${esc(r.public_note)}</p>`:''}<p class="review-policy">回复只解释商家立场，不能公开买家身份、完整订单号、联系方式或私密聊天；不能诱导用户删评。此页面不展示购买凭证。</p></section>
 <section><h2>${current?'对应公开评价':'当前评价对照'}</h2>${!current?'<p class="review-policy" role="status">原评价已更新或不再公开，这份回复不能直接发布。请商家阅读当前评价后重新提交；以下是当前评价版本，不是商家提交回复时的原文。</p>':''}
 ${review?`<p>${esc(REVIEW_STATUSES[review.status]||'未知状态')} · 当前版本 ${esc(review.version)} · ${esc(review.rating)} 星（满分 5 星）</p><p>${esc(review.product)} · ${esc(REVIEW_DELIVERIES[review.delivery]||review.delivery)}</p><p class="review-body">${esc(review.experience)||'评价正文已清除'}</p>`:'<p>原评价已不存在。</p>'}</section>
 ${canModerate?`<form method="post" action="${esc(path('/admin/review-replies/',r.id))}"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="version" value="${esc(r.version)}"><h2>审核决定</h2><p class="review-policy">只处理这份商家回复，不会改变用户评价或评分。商家修改或评价版本变化后，需要重新审核。</p><label class="review-check"><input type="checkbox" name="confirmed" value="true"><span>我已对照评价核对回复，按相同标准检查隐私、广告、人身攻击及明显虚构，没有以商家身份影响正常评价。</span></label><label>不通过 / 隐藏原因<select name="reason"><option value="">发布时无需选择</option>${options(REVIEW_REASONS)}</select></label><label>给商家的处理说明<textarea name="note" maxlength="1000" placeholder="发布时选填；不通过或隐藏时，至少填写 5 字说明具体问题。不要复制买家私密信息。"></textarea></label><div class="review-actions">${r.status==='published'?'<button name="action" value="hide">确认违规，隐藏回复</button>':`<button name="action" value="publish"${current?'':' disabled'}>通过并展示回复</button><button name="action" value="reject">不通过本次回复</button>`}</div></form>`:''}
 <details><summary>回复修改记录（${esc(history.length)}）</summary>${history.map(h=>{const p=historyPayload(h.payload);return `<article><strong>回复版本 ${esc(h.version)} · ${esc(time(h.created_at))}</strong><p>${esc(REVIEW_REPLY_STATUSES[p.status]||'正文已清除')}${p.reviewVersion?' · 针对评价版本 '+esc(p.reviewVersion):''}</p><p class="review-body">${esc(p.body||'')}</p></article>`;}).join('')||'<p>暂无修改记录。</p>'}</details>
 <section><h2>审核操作记录</h2>${actions.map(a=>`<p><strong>${esc(actionNames[a.action]||a.action)}</strong> · 回复版本 ${esc(a.version)} · ${esc(time(a.created_at))} · ${esc(a.actor)}${a.reason?'<br>原因：'+esc(REVIEW_REASONS[a.reason]||a.reason):''}${a.note?'<br>'+esc(a.note):''}</p>`).join('')||'<p>暂无操作记录。</p>'}</section></div>`;
}
