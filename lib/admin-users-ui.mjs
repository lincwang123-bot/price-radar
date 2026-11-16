const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value===null?'暂不可用':Number(value).toLocaleString('zh-CN');
const time=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
const status=value=>({pending:'待审核',approved:'已通过',rejected:'已拒绝',paused:'已暂停',published:'已公开',hidden:'已隐藏',withdrawn:'已撤回'}[value]||'未知状态');
const method=user=>user.hasPassword===null||user.hasGoogle===null?'登录方式暂不可用':
  ['邮箱验证码',...(user.hasPassword?['密码']:[]),...(user.hasGoogle?['Google']:[])].join(' · ');
const role=user=>user.applicationCount===null?'关联资料暂不可用':user.applicationCount?'商家（有申请）':'普通用户';
const maskedEmail=email=>{const at=email.lastIndexOf('@');return at<0?'***':email.slice(0,Math.min(2,at))+'***'+email.slice(at);};
const metric=(label,value,hint)=>`<div class="metric"><span class="metric-label">${esc(label)}</span><strong class="metric-value">${number(value)}</strong><span class="metric-hint">${esc(hint)}</span></div>`;
const unavailable='<section role="status"><h2>账号数据暂不可用</h2><p>请检查账号数据服务。暂不以 0 代替缺失数据。</p></section>';
const styles=`<style>
.user-admin .user-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.user-admin .user-metrics .metric{display:block;grid-column:auto}.user-admin .user-metrics .metric-value{margin:12px 0 6px;font-variant-numeric:tabular-nums}.user-admin .user-metrics .metric-hint{display:block}.user-admin .user-columns{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(270px,1fr);gap:18px;align-items:start}.user-admin .user-columns>section{min-width:0;margin:18px 0 0}.user-admin .user-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}.user-admin .user-section-heading h2{margin:0}.user-admin .user-subtitle{margin-top:-8px;margin-bottom:22px;color:#6c7a71}.user-admin .user-bars{display:grid;gap:10px;list-style:none;padding:0;margin:0}.user-admin .user-bars li{display:grid;grid-template-columns:48px minmax(0,1fr) 34px;align-items:center;gap:14px;font-size:13px;font-variant-numeric:tabular-nums}.user-admin .user-bars b{text-align:right}.user-admin .user-bar-track{height:16px;background:#f0f4f1;border-radius:4px;overflow:hidden}.user-admin .user-bar{height:100%;display:block;background:#388269;border-radius:4px}.user-admin .user-todos{display:grid;gap:4px}.user-admin .user-todo{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e7ece8;padding:14px 0;gap:16px}.user-admin .user-todo:last-child{border:0}.user-admin .user-todo strong{font-size:24px;font-variant-numeric:tabular-nums}.user-admin .user-filters{display:grid;grid-template-columns:minmax(200px,2fr) minmax(140px,1fr) minmax(140px,1fr) auto;gap:14px;align-items:end}.user-admin .user-filters label{display:grid;grid-template-columns:1fr;gap:7px;margin:0;font-size:13px}.user-admin .user-filters input,.user-admin .user-filters select{max-width:none;min-width:0}.user-admin .user-filters>button{margin:0}.user-admin .user-table{font-size:13px}.user-admin .user-table th,.user-admin .user-table td{padding:14px 9px}.user-admin .user-table td:first-child{max-width:230px;overflow-wrap:anywhere;white-space:normal}.user-admin .user-pagination{align-items:center;justify-content:space-between;margin-top:18px;font-size:13px}.user-admin .user-pagination div{display:flex;gap:16px}.user-admin .user-empty{padding:28px 0;color:#6c7a71;text-align:center}.user-admin .user-email{overflow-wrap:anywhere;font-size:21px;margin:0 0 10px}.user-admin .user-detail-list{list-style:none;padding:0;margin:0}.user-admin .user-detail-list li{padding:14px 0;border-bottom:1px solid #e7ece8;overflow-wrap:anywhere}.user-admin .user-detail-list li:last-child{border:0}.user-admin .user-detail-list small{display:block;margin-top:5px}.user-admin .user-pill{display:inline-block;border:1px solid #d5e4db;border-radius:6px;background:#eef5f0;color:#36644c;font-size:12px;padding:2px 8px}.user-admin .user-note{font-size:13px;color:#6c7a71;line-height:1.8}.user-admin .user-note a{text-decoration:underline}.user-admin .user-activity{font-size:13px;padding:12px 15px;background:#edf2ee;border-radius:8px}.user-admin .user-table caption{text-align:left;font-size:13px;color:#6c7a71;padding:0 0 12px}
@media(max-width:850px){.user-admin .user-columns{grid-template-columns:1fr}.user-admin .user-filters{grid-template-columns:1fr 1fr}.user-admin .user-filters label:first-child{grid-column:1/-1}}
@media(max-width:640px){.user-admin .user-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.user-admin .user-metrics .metric-value{font-size:28px}.user-admin .user-filters>button{grid-column:1/-1}.user-admin .user-section-heading .segments{margin:0}.user-admin .user-columns{gap:0}.user-admin .user-table{min-width:700px}.user-admin .user-email{font-size:18px}}
</style>`;
const shell=body=>styles+`<div class="user-admin">${body}</div>`;

export function overviewContent(report){
  if(!report.available)return shell(unavailable);
  const r=report,max=Math.max(1,...r.series.map(d=>d.count));
  const todo=(href,label,value)=>`<a class="user-todo" href="${href}"><span>${label} →</span><strong>${number(value)}</strong></a>`;
  return shell(`<p class="user-subtitle">先看用户增长，再处理审核待办。所有账号数据仅管理员可见。</p>
    <div class="metrics user-metrics">${metric('注册账号总数',r.accounts.total,'当前仍存在的账号')}${metric('今日新增',r.accounts.today,'北京时间 00:00 起')}${metric('近 7 天新增',r.accounts.last7,'含今天，共 7 个自然日')}${metric('近 30 天新增',r.accounts.last30,'含今天，共 30 个自然日')}</div>
    <p class="period-note">统计时间：${esc(time(r.checkedAt))}（北京时间） · <a href="/admin/users">查看全部用户 →</a></p>
    <div class="user-columns"><section><div class="user-section-heading"><h2>注册趋势</h2><nav class="segments" aria-label="注册趋势日期范围">${[7,30].map(n=>`<a href="/admin/overview?days=${n}"${r.days===n?' aria-current="page"':''}>最近 ${n} 天</a>`).join('')}</nav></div>
    <ol class="user-bars" aria-label="每日新增账号">${r.series.map(d=>`<li aria-label="${d.day}：${d.count} 个账号"><span>${d.day.slice(5).replace('-','/')}</span><span class="user-bar-track" aria-hidden="true"><i class="user-bar" style="width:${(d.count/max*100).toFixed(2)}%"></i></span><b>${number(d.count)}</b></li>`).join('')}</ol>
    <p class="user-note">按现存账号的注册日期统计；注销账号不计入，不代表包含已注销账号的历史累计注册量。</p></section>
    <section><h2>待处理</h2><div class="user-todos">${todo('/admin/merchants?status=pending','店铺申请',r.pendingMerchants)}${todo('/admin/reviews?status=pending','用户评价',r.pendingReviews)}${todo('/admin?kind=feedback&amp;status=new','新反馈',r.pendingFeedback)}</div>
    <h2 style="margin-top:26px">站内参与</h2><div class="user-todos">${todo('/admin/users?role=merchant','有关联店铺申请的账号',r.merchantAccounts)}${todo('/admin/merchants?status=approved','已通过的店铺申请',r.approvedApplications)}${todo('/admin/reviews?status=published','已公开评价',r.publishedReviews)}</div><p class="user-note">${number(r.followingAccounts)} 个账号保存了关注，包含已暂停的关注。</p></section></div>
    <section class="privacy-note"><h2>这些数字分别代表什么？</h2><p>注册账号不等于访客或真实人数。同一账号可同时使用邮箱验证码、密码和 Google 登录，不重复计数；一个账号可关联多条店铺申请。</p><p>最近登录、注册用户活跃度：未采集完整记录，本页不推算。浏览量与访客估算请查看 <a href="/admin/analytics">访问统计</a>。</p></section>`);
}

export function usersContent(result){
  if(!result.available)return shell(unavailable);
  const r=result;
  const option=(value,label,selected)=>`<option value="${value}"${value===selected?' selected':''}>${label}</option>`;
  const link=page=>'/admin/users?'+new URLSearchParams({q:r.q,role:r.role,login:r.login,page:String(page)});
  return shell(`<p class="user-subtitle">一个账号，一份记录。查看用户及其关联店铺、关注和评价，不修改账号资料。</p>
    <form class="user-filters" method="get" action="/admin/users"><label>搜索邮箱<input name="q" type="search" value="${esc(r.q)}" maxlength="254" placeholder="输入完整邮箱或部分关键词" autocomplete="off"></label>
    <label>用户类型<select name="role">${[['','全部用户'],['reader','普通用户（无关联申请）'],['merchant','商家（有关联申请）']].map(([v,l])=>option(v,l,r.role)).join('')}</select></label>
    <label>登录方式<select name="login">${[['','全部方式'],['google','已关联 Google'],['password','已设置密码'],['email_only','仅邮箱验证码']].map(([v,l])=>option(v,l,r.login)).join('')}</select></label><button>查询用户</button></form>
    <section><div class="user-section-heading"><h2>用户列表 <span class="muted">${number(r.total)} 个账号</span></h2><a href="/admin/users">清除筛选</a></div>
    ${r.items.length?`<div class="table" tabindex="0" role="region" aria-label="用户列表，可横向滚动"><table class="user-table"><caption>邮箱默认脱敏；点击查看详情。时间均为北京时间。</caption><thead><tr><th scope="col">邮箱</th><th scope="col">注册时间</th><th scope="col">用户类型</th><th scope="col">登录方式</th><th scope="col">店铺申请</th><th scope="col">关注</th><th scope="col">评价</th></tr></thead><tbody>${r.items.map(u=>`<tr><td><a href="/admin/users/${esc(u.id)}">${esc(maskedEmail(u.email))} →</a></td><td>${esc(time(u.createdAt))}</td><td><span class="user-pill">${role(u)}</span></td><td>${method(u)}</td><td>${number(u.applicationCount)}</td><td>${number(u.watchCount)}</td><td>${number(u.reviewCount)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="user-empty">没有匹配的账号，请尝试其他邮箱或清除筛选。</p>'}
    <nav class="user-pagination" aria-label="用户列表分页"><span>第 ${r.page} / ${r.pages} 页 · 每页最多 ${r.pageSize} 个账号</span><div>${r.page>1?`<a href="${esc(link(r.page-1))}">上一页</a>`:''}${r.page<r.pages?`<a href="${esc(link(r.page+1))}">下一页</a>`:''}</div></nav></section>
    <p class="user-note">“商家”表示此账号关联了店铺申请，不代表审核通过或信用认证。未关联账号的历史申请不会仅凭相同邮箱自动认领。普通用户无需填写商家联系资料。</p>`);
}

export function userDetailContent(user){
  const u=user;
  const list=(rows,total,render)=>rows===null?'<p>资料暂不可用</p>':!rows.length?'<p class="muted">暂无记录</p>':`<ul class="user-detail-list">${rows.map(render).join('')}</ul>${total>rows.length?'<p class="user-note">仅展示最近 20 条，完整记录请进入对应管理页面查看。</p>':''}`;
  return shell(`<p><a href="/admin/users">← 返回用户管理</a></p><section><h2 class="user-email">${esc(u.email)}</h2><p><span class="user-pill">${role(u)}</span></p><dl><dt>注册时间</dt><dd>${esc(time(u.createdAt))}（北京时间）</dd><dt>登录方式</dt><dd>${method(u)}</dd><dt>关注邮件开关</dt><dd>${u.emailEnabled?'已开启':'已关闭'}（不代表所有关注都会发信）</dd></dl><p class="user-activity">最近登录与账号活跃度尚未完整采集，暂不展示估算。此页只读，不显示密码、验证码、登录令牌或 Google 身份标识。</p></section>
    <section><h2>关联店铺申请 · ${number(u.applicationCount)}</h2>${list(u.applications,u.applicationCount,a=>`<li><a href="/admin/merchants/${esc(a.id)}">${esc(a.name)} →</a><small>${status(a.status)} · ${esc(time(a.createdAt))}</small></li>`)}</section>
    <section><h2>保存的关注 · ${number(u.watchCount)}</h2>${list(u.watches,u.watchCount,w=>`<li>${esc(w.product)}<small>${w.paused?'已暂停':w.mode==='off'?'仅关注，不发提醒':'提醒规则已设置'} · ${esc(time(w.createdAt))}</small></li>`)}</section>
    <section><h2>提交的评价 · ${number(u.reviewCount)}</h2>${list(u.reviews,u.reviewCount,r=>`<li><a href="/admin/reviews/${esc(r.id)}">${esc(r.name)} →</a><small>${status(r.status)} · ${Number(r.rating)} 星 · ${esc(time(r.createdAt))}</small></li>`)}</section>`);
}
