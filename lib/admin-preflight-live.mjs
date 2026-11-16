import { createHash } from 'node:crypto';
// Static, hash-authorized script; no merchant data is interpolated into code.
export const ADMIN_PREFLIGHT_SCRIPT = String.raw`(() => {
  let timer, pollingSince = Date.now(), inFlight = false;
  const root = () => document.getElementById('merchant-preflight-live');
  function message(text) {
    const node = root()?.querySelector('[data-preflight-status]');
    if (node) node.textContent = text;
  }
  function show(data) {
    const current = root();
    if (!current || typeof data.html !== 'string') throw new Error('invalid');
    const template = document.createElement('template');
    template.innerHTML = data.html;
    const next = template.content.firstElementChild;
    if (next?.id !== 'merchant-preflight-live') throw new Error('invalid');
    current.replaceWith(next);
    // Update only eligibility; never submit approval or reset the review form.
    const approve = document.querySelector('button[name="action"][value="approve"]');
    if (approve) approve.disabled = !data.canApprove;
    const hint = approve?.closest('form')?.querySelector('.message');
    if (hint) hint.hidden = !!data.canApprove;
  }
  async function read(response) {
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('login');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '请求未完成，请刷新后重试。');
    return data;
  }
  function schedule() {
    clearTimeout(timer);
    if (root()?.dataset.poll !== '1') return;
    if (Date.now() - pollingSince > 90000) {
      message('暂未取得最终结果，已停止自动刷新。请刷新结果或检查即时检测服务；未自动批准店铺。');
      return;
    }
    timer = setTimeout(poll, 1500);
  }
  async function poll() {
    if (inFlight || !root()) return;
    inFlight = true;
    try { show(await read(await fetch(root().dataset.statusUrl, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) }))); }
    catch (error) { message(error.message === 'login' ? '登录可能已过期，请刷新页面重新登录。' : '结果暂时无法更新，请点击“刷新结果”；不会重复发起测试。'); return; }
    finally { inFlight = false; }
    schedule();
  }
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id !== 'merchant-preflight') return;
    event.preventDefault();
    if (inFlight) return;
    clearTimeout(timer); inFlight = true; pollingSince = Date.now();
    const button = form.querySelector('button[type="submit"]');
    const body = new URLSearchParams(new FormData(form));
    body.set('action', 'auto_test');
    if (button) { button.disabled = true; button.textContent = '正在启动…'; }
    message('正在启动这家店铺的接入测试…');
    // name="action" is a submit control: use the attribute, not the clobberable
    // HTMLFormElement.action property.
    try { show(await read(await fetch(form.getAttribute('action'), { method: 'POST', headers: { accept: 'application/json' }, body, signal: AbortSignal.timeout(10000) }))); }
    catch (error) {
      message(error.message === 'login' ? '登录可能已过期，请刷新页面重新登录。' : error.name === 'TimeoutError' ? '启动结果未确认，请先刷新结果，不要连续重复点击。' : error.message === 'Failed to fetch' ? '网络暂时不可用，请先刷新结果后再试。' : error.message);
      if (button?.isConnected) { button.disabled = false; button.textContent = '立即测试接入'; }
    } finally { inFlight = false; }
    schedule();
  });
  window.addEventListener('pagehide', () => clearTimeout(timer));
  schedule();
})();`;
export const ADMIN_PREFLIGHT_HASH = 'sha256-' + createHash('sha256').update(ADMIN_PREFLIGHT_SCRIPT).digest('base64');
