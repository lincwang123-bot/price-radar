const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const queueStatuses={pending:'待审核',approved:'已通过',rejected:'已拒绝',paused:'暂存 / 暂停'};
export function queueDispositionForm(app,csrf,{compact=false,page=1}={}) {
  if(!['pending','rejected','paused'].includes(app.status)||app.linkedApplication)return '';
  const pending=app.status==='pending';
  const body=`<form method="post" action="/admin/merchants/${encodeURIComponent(app.id)}" class="queue-decision">
    ${compact?'':'<h2>处理这条申请</h2>'}
    <input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="version" value="${esc(app.version)}"><input type="hidden" name="queueAction" value="true">
    ${compact?`<input type="hidden" name="returnStatus" value="${esc(app.status)}"><input type="hidden" name="returnPage" value="${esc(page)}">`:''}
    <label class="field"><span>我的处理意见（选填，仅内部可见）</span><textarea name="note" maxlength="1500" rows="3" placeholder="例如：产品不在收录范围；等待商家补充资料；暂时不处理"></textarea></label>
    <div class="actions">${pending?'<button type="submit" name="action" value="pause">移到暂存</button><button type="submit" name="action" value="reject" class="queue-reject">拒绝申请</button>':'<button type="submit" name="action" value="restore">恢复待审核</button>'}</div>
    <p class="muted">${pending?'拒绝和暂存都会移出待审核，可在对应分类找回。':'恢复后重新进入待审核，需重新检测和审核才能通过。'}处理意见与操作记录会保留，此处操作不发送邮件。</p>
  </form>`;
  return compact?`<details class="queue-controls"><summary>${pending?'填写意见 · 拒绝 / 暂存':'恢复待审核'}</summary>${body}</details>`:body;
}
export function intakeDecisionHistory(app) {
  return `<section class="panel"><h2>处理记录</h2>${app.actions?.length?[...app.actions].reverse().map(row=>`<div class="audit"><strong>${esc({reject:'拒绝申请',pause:'移到暂存',restore:'恢复待审核'}[row.action]||row.action)}</strong><p class="muted">${esc(row.actor)} · ${esc(new Date(row.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}（北京时间）</p><p>处理意见：${esc(row.note||'未填写')}</p></div>`).join(''):'<p class="muted">尚无处理记录。</p>'}</section>`;
}
