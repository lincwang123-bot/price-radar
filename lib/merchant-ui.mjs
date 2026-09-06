const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import { safeExternalLink as shopLink } from './admin-links.mjs';
const statuses = {pending:'待审核', approved:'已通过', rejected:'已拒绝', paused:'已暂停'};
const platforms = {auto:'自动识别', '16688':'16688', ldxp:'链动小铺', independent:'独立站'};
const areas = {chatgpt:'ChatGPT',claude:'Claude',gemini:'Gemini',grok_x:'Grok / X',api_relay:'API 中转',mail_verify:'邮箱 / 验证',other:'其他'};
const beijingTime = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function formatTime(value) {
  try {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? `${beijingTime.format(date)}（北京时间）` : '—';
  } catch { return '—'; }
}
function collectionLabel(app, health) {
  if (app.status !== 'approved') return '未接入';
  const state = app.collectionStatus ?? health?.collectionStatus ?? health?.status;
  if (state === 'unsupported' || state === 'needs_adapter' || state === 'waiting_adapter') return '待适配';
  if (state === 'error' || state === 'failed' || state === 'unavailable') return '采集暂不可用';
  if (state === 'no_valid_offers') return '目录可读取 / 暂无有效报价';
  if (state === 'active' || state === 'ok' || state === 'connected') return Number(health?.validCount ?? health?.offerCount) > 0 ? '已接入' : '目录可读取 / 暂无有效报价';
  return '等待采集';
}
const style = `<style>
.merchant{max-width:850px;margin:28px auto;color:#263b32;line-height:1.7;overflow-wrap:anywhere}.merchant *{box-sizing:border-box}.merchant h1{font-size:clamp(27px,5vw,38px);line-height:1.2;letter-spacing:-.04em;margin:8px 0 18px}.merchant h2{font-size:19px;margin:0 0 12px}.merchant .eyebrow{color:#27634e;font-size:13px;font-weight:700;letter-spacing:.06em}.merchant .muted{color:#687b70;font-size:13px}.merchant .panel,.merchant form{border:1px solid #dce5de;border-radius:14px;background:#fff;padding:26px;margin:20px 0}.merchant .intro{max-width:670px}.merchant label.field{display:block;margin:20px 0}.merchant label.field>span{display:block;font-weight:600;margin-bottom:7px}.merchant input:not([type=checkbox]),.merchant select,.merchant textarea{width:100%;max-width:none;padding:11px 12px;border:1px solid #cbd8ce;border-radius:8px;background:#fff;color:#263b32;min-height:44px;font:inherit}.merchant textarea{min-height:112px;resize:vertical}.merchant fieldset{min-width:0;border:0;padding:0;margin:20px 0}.merchant legend{font-weight:600;padding:0;margin-bottom:9px}.merchant .choices{display:flex;gap:10px 18px;flex-wrap:wrap}.merchant label.check{display:flex;grid-template-columns:none;align-items:flex-start;gap:9px;margin:5px 0;font-size:14px}.merchant input[type=checkbox]{width:18px;height:18px;min-height:18px;flex:0 0 18px;margin:4px 0 0;accent-color:#28634b}.merchant button{font:inherit;min-height:44px;padding:10px 20px;border-radius:8px;border:1px solid #28634b;background:#28634b;color:white;cursor:pointer;margin-left:0}.merchant button:disabled{opacity:.6;cursor:wait}.merchant a{color:#27634e}.merchant :focus-visible{outline:2px solid #438c70;outline-offset:3px}.merchant .trap{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.merchant .message{padding:14px;border-radius:8px;background:#eef5ef;margin:16px 0}.merchant .message[hidden]{display:none}.merchant .message.error{background:#fff2ec;color:#843e2d}.merchant .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.merchant .tabs a{padding:8px 13px;background:#eaf0eb;border-radius:8px;text-decoration:none}.merchant .tabs a[aria-current=page]{background:#28634b;color:white}.merchant .row{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.merchant .badge{display:inline-block;padding:3px 8px;background:#edf4ed;color:#365e42;border-radius:6px;font-size:12px}.merchant dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:12px 20px}.merchant dt{color:#687b70;font-size:13px}.merchant dd{margin:0;white-space:pre-wrap}.merchant .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.merchant .secondary{background:white;color:#40564a;border-color:#cbd8ce}.merchant .audit{padding:14px 0;border-bottom:1px solid #e5ebe5}.merchant .audit:last-child{border:0}.merchant .audit p{white-space:pre-wrap}.merchant .pagination{display:flex;justify-content:space-between;gap:16px;margin-top:20px}@media(max-width:600px){.merchant{margin:20px auto}.merchant .panel,.merchant form{padding:18px}.merchant .row{display:block}.merchant dl{grid-template-columns:1fr;gap:5px}.merchant dd{margin-bottom:12px}.merchant .actions button{flex:1}.merchant .tabs a{padding:8px 10px}}
.merchant header.intro{display:block}.merchant .actions button{padding:10px 12px;white-space:nowrap}
</style>`;

export function merchantSubmissionContent(csrfToken, {shopName = '', shopUrl = ''} = {}) {
  return `${style}<div class="merchant"><header class="intro"><p class="eyebrow">店铺收录申请</p><h1>提交店铺</h1><p>先审核，再收录。让正在比较价格的人找到你的店铺。</p><p class="muted">审核通过且采集成功后展示有效报价。提交不保证收录，也不会立即上线。</p></header>
<form id="merchant-submission" action="/api/merchant-applications" method="post">
<input type="hidden" name="csrf" value="${esc(csrfToken)}">
<label class="field"><span>店铺名称</span><input name="shopName" value="${esc(shopName)}" required minlength="2" maxlength="100" autocomplete="organization"></label>
<label class="field"><span>店铺网址</span><input name="shopUrl" type="url" value="${esc(shopUrl)}" required pattern="https://.*" maxlength="500" placeholder="https://你的店铺网址" aria-describedby="url-help"><small id="url-help" class="muted">仅接受 HTTPS 公开店铺页面，请勿填写带登录凭据或私密令牌的链接。</small></label>
<label class="field"><span>店铺平台</span><select name="platform">${['auto','16688','ldxp','independent'].map(key=>`<option value="${key}"${key==='auto'?' selected':''}>${platforms[key]}</option>`).join('')}</select></label>
<fieldset><legend>主营产品 <span class="muted">（可多选）</span></legend><div class="choices">${Object.entries(areas).map(([key,label])=>`<label class="check"><input type="checkbox" name="productAreas" value="${key}"> ${label}</label>`).join('')}</div></fieldset>
<label class="field"><span>联系渠道</span><input name="contact" required minlength="3" maxlength="128" placeholder="邮箱或其他可联系到你的方式" aria-describedby="contact-help"><small id="contact-help" class="muted">仅供审核联系，不在公开页面展示。请勿提交密码、验证码、API Key 或其他账号凭据。</small></label>
<label class="field"><span>补充说明 <span class="muted">（选填）</span></span><textarea name="details" maxlength="1500" placeholder="可说明店铺归属、主营产品或希望核实的事项"></textarea></label>
<div class="trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="check"><input type="checkbox" name="consent" value="true" required><span>我确认有权代表该店铺提交申请，同意站方联系我核验店铺归属，并授权采集、展示店铺公开商品目录和报价。</span></label>
<p class="muted">店主已核验不代表交易担保。暂不支持的平台会保留申请，待适配并通过接入测试后再审核收录。</p>
<div id="merchant-message" class="message" role="status" aria-live="polite" tabindex="-1" hidden></div><button type="submit">提交审核</button>
</form></div>
<script>(()=>{const form=document.getElementById('merchant-submission');const message=document.getElementById('merchant-message');const areaInputs=Array.from(form.querySelectorAll('input[name=productAreas]'));const validateAreas=()=>areaInputs[0].setCustomValidity(areaInputs.some(input=>input.checked)?'':'请至少选择一个主营产品');areaInputs.forEach(input=>input.addEventListener('change',validateAreas));validateAreas();form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button[type=submit]');const data=new FormData(form);const payload={shopName:data.get('shopName'),shopUrl:data.get('shopUrl'),platform:data.get('platform'),productAreas:data.getAll('productAreas'),contact:data.get('contact'),details:data.get('details'),consent:data.get('consent')==='true',website:data.get('website')};button.disabled=true;button.textContent='正在提交…';message.hidden=true;try{const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':data.get('csrf')},credentials:'same-origin',body:JSON.stringify(payload)});let result;try{result=await response.json()}catch{throw new Error('暂时无法提交，请稍后重试。')}if(!response.ok)throw new Error(typeof result.error==='string'?result.error:typeof result.message==='string'?result.message:'提交未成功，请检查填写内容后重试。');const id=result.id||result.application?.id||result.applicationId;message.className='message';message.textContent='申请已提交'+(id?'，申请编号：'+id:'')+'。我们会先审核店铺归属与采集权限，审核通过且采集成功后才会展示有效报价。';form.reset();validateAreas()}catch(error){message.className='message error';message.textContent=error.message||'网络连接失败，请稍后重试。'}finally{message.hidden=false;message.focus();button.disabled=false;button.textContent='提交审核'}})})();</script>`;
}

export function merchantInboxContent({items = [], total = 0, page = 1, pageSize = 30, status = 'pending', counts = {}, health = {}} = {}) {
  const selected = Object.hasOwn(statuses,status) ? status : 'pending';
  const p = Math.max(1, Number(page) || 1);
  return `${style}<div class="merchant"><p class="intro">审核店铺归属与采集权限后，再接入公开报价。审核通过与采集成功是两个独立状态。</p><nav class="tabs" aria-label="申请状态">${Object.entries(statuses).map(([key,label])=>`<a href="/admin/merchants?status=${key}"${key===selected?' aria-current="page"':''}>${label}${Number.isFinite(counts[key])?` · ${esc(counts[key])}`:key===selected?` · ${esc(total)}`:''}</a>`).join('')}</nav>
${items.length?items.map(app=>`<article class="panel"><div class="row"><div><h2><a href="/admin/merchants/${encodeURIComponent(app.id)}">${esc(app.shopName)}</a></h2><p>${shopLink(app.shopUrl)}</p></div><div><span class="badge">${esc(statuses[app.status]??app.status)}</span> <span class="badge">${esc(collectionLabel(app,health[app.id]??health))}</span></div></div><p class="muted">${esc(app.id)} · ${esc(platforms[app.platform]??app.platform)} · ${esc(formatTime(app.createdAt))}</p></article>`).join(''):'<div class="panel"><h2>暂无申请</h2><p class="muted">此状态下还没有店铺申请。</p></div>'}
<nav class="pagination" aria-label="分页">${p>1?`<a href="/admin/merchants?status=${selected}&amp;page=${p-1}">上一页</a>`:'<span></span>'}<span class="muted">第 ${p} 页 · 共 ${esc(total)} 条</span>${p*pageSize<total?`<a href="/admin/merchants?status=${selected}&amp;page=${p+1}">下一页</a>`:'<span></span>'}</nav></div>`;
}

function preflightContent(app, preflight, csrfToken) {
  const state = preflight?.status;
  const result = preflight?.result;
  const labels = {pending:'等待测试',queued:'等待测试',expired:'测试已过期',invalid:'测试结果无效',ready:'测试完成',no_valid_offers:'暂无可收录报价',waiting_adapter:'需要适配',unavailable:'测试暂不可用'};
  const help = {
    pending:'已排队，等待下轮采集（通常 5 分钟）。稍后点击刷新结果。',
    queued:'已排队，等待下轮采集（通常 5 分钟）。稍后点击刷新结果。',
    expired:'结果已过期或申请已更新，请重新测试后再批准。',
    invalid:'未取得有效测试结果，请重新测试；若持续失败，请检查采集服务。',
    ready:'请打开商品页，核对样例价格、时长与规格后再批准。',
    no_valid_offers:'目录已读取，但没有符合收录规则的报价。请核对商品价格、规格及商品页，修正目录或适配规则后重测。',
    waiting_adapter:'当前平台尚未支持，请先补充采集适配后重新测试。',
    unavailable:'请检查店铺网址及公开目录是否可访问；若仍失败，请排查采集服务后重测。'
  };
  const samples = Array.isArray(result?.samples) ? result.samples.slice(0,5) : [];
  return `<section class="panel"><h2>接入测试</h2><p><span class="badge">${esc(labels[state] || '尚未测试')}</span></p><p>${esc(help[state] || '先确认店铺归属与公开目录采集授权，再提交接入测试。')}</p>${result ? `<p><strong>可收录报价：${esc(result.validCount ?? 0)} 条</strong> · 原始解析：${esc(result.rawCount ?? 0)} 条</p><p class="muted">测试时间：${esc(formatTime(result.checkedAt))}</p>${result.message ? `<p>${esc(result.message)}</p>` : ''}${samples.length ? `<h3>商品样例</h3>${samples.map(sample=>`<div class="audit"><strong>${esc(sample.title)}</strong><p>${esc(sample.currency)} ${esc(sample.price)} · ${shopLink(sample.url, '打开商品页')}</p></div>`).join('')}` : ''}` : ''}<p class="muted">测试只读取公开目录，不自动发布报价，也不验证真实交易。0 条有效报价不能视为接入成功。</p><div class="actions"><a class="secondary" href="/admin/merchants/${encodeURIComponent(app.id)}">刷新结果</a></div></section>
<form action="/admin/merchants/${encodeURIComponent(app.id)}" method="post" id="merchant-preflight"><h2>${preflight ? '重新测试' : '提交测试'}</h2><input type="hidden" name="csrf" value="${esc(csrfToken)}"><input type="hidden" name="version" value="${esc(app.version)}"><label class="check"><input type="checkbox" name="ownershipConfirmed" value="true" required><span>已核实申请人有权代表该店铺，并已确认店铺归属。</span></label><label class="check"><input type="checkbox" name="permissionConfirmed" value="true" required><span>已确认允许采集及展示该店铺的公开商品与报价。</span></label><div class="actions"><button name="action" value="test" type="submit">${preflight ? '重新测试接入' : '测试接入'}</button></div></form>`;
}

export function merchantReviewContent({application:app, actions = [], csrfToken = '', health = {}, preflight = null, preflightCanApprove}) {
  const approved = app.status === 'approved';
  const canApprove = preflightCanApprove ?? preflight?.canApprove ?? false;
  return `${style}<div class="merchant"><a href="/admin/merchants?status=${Object.hasOwn(statuses,app.status)?app.status:'pending'}">← 返回店铺申请</a><section class="panel"><div class="row"><h2>${esc(app.shopName)}</h2><div><span class="badge">${esc(statuses[app.status]??app.status)}</span> <span class="badge">${esc(collectionLabel(app,health))}</span>${approved&&app.identityVerifiedAt?' <span class="badge">店主已核验</span>':''}</div></div><dl><dt>申请编号</dt><dd>${esc(app.id)}</dd><dt>店铺网址</dt><dd>${shopLink(app.shopUrl)}</dd><dt>店铺平台</dt><dd>${esc(platforms[app.platform]??app.platform)}</dd><dt>主营产品</dt><dd>${esc((Array.isArray(app.productAreas)?app.productAreas:[]).map(a=>areas[a]??a).join('、'))}</dd><dt>联系渠道</dt><dd>${esc(app.contact)}</dd><dt>补充说明</dt><dd>${esc(app.details||'未填写')}</dd><dt>提交时间</dt><dd>${esc(formatTime(app.createdAt))}</dd><dt>更新时间</dt><dd>${esc(formatTime(app.updatedAt))}</dd></dl><p class="muted">店主已核验不代表交易担保；该标识不代表广告推荐或商家直连。审核通过且采集成功后展示有效报价。暂不支持的平台需要人工适配。</p></section>
${preflightContent(app, preflight, csrfToken)}
<form action="/admin/merchants/${encodeURIComponent(app.id)}" method="post"><h2>审核决定</h2><input type="hidden" name="csrf" value="${esc(csrfToken)}"><input type="hidden" name="version" value="${esc(app.version)}"><label class="field"><span>审核说明（必填）</span><textarea name="note" required minlength="5" maxlength="1500" placeholder="记录核验依据、拒绝原因或暂停原因，供后续追溯"></textarea></label><p class="muted">批准前需完成以下核验；勾选情况会随审核决定一同提交。</p><label class="check"><input type="checkbox" name="ownershipConfirmed" value="true"><span>已核实申请人有权代表该店铺，并已确认店铺归属。</span></label><label class="check"><input type="checkbox" name="permissionConfirmed" value="true"><span>已确认允许采集及展示该店铺的公开商品与报价。</span></label><label class="check"><input type="checkbox" name="sampleReviewed" value="true"><span>已核对样例价格与规格。</span></label>${canApprove?'':'<p class="message">需先完成接入测试，取得当前申请的有效报价结果后才能批准。</p>'}<div class="actions"><button name="action" value="approve" type="submit"${canApprove?'':' disabled'}>确认批准</button><button name="action" value="reject" type="submit" class="secondary">确认拒绝</button><button name="action" value="pause" type="submit" class="secondary">确认暂停</button></div><p class="muted">批准会进入采集接入流程；拒绝或暂停后不作为已批准店铺展示。</p></form>
<section class="panel"><h2>审核记录</h2>${actions.length?actions.map(action=>`<div class="audit"><strong>${esc({approve:'批准',reject:'拒绝',pause:'暂停'}[action.action]??action.action)}</strong><span class="muted"> · ${esc(formatTime(action.createdAt))}</span><p>${esc(action.note)}</p></div>`).join(''):'<p class="muted">尚无审核记录。</p>'}</section></div>`;
}
