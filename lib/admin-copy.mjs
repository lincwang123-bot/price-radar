import { createHash } from 'node:crypto';

// Fixed source only: user-provided text stays inside escaped readonly textareas.
export const ADMIN_COPY_SCRIPT = `(()=>{document.addEventListener('click',async event=>{const button=event.target.closest('button[data-copy-target]');if(!button)return;const field=document.getElementById(button.dataset.copyTarget);const status=document.getElementById(button.dataset.copyStatus);if(!(field instanceof HTMLTextAreaElement)||!field.readOnly||!status)return;try{if(!window.isSecureContext||!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');await navigator.clipboard.writeText(field.value);status.textContent='已复制，可粘贴后自行发送。'}catch{field.focus();field.select();status.textContent='自动复制不可用，文案已选中，请手动复制。'}})})();`;
export const ADMIN_COPY_HASH = 'sha256-' + createHash('sha256').update(ADMIN_COPY_SCRIPT).digest('base64');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function copyMessageContent(message, id) {
  return `<label class="field" for="${esc(id)}"><span>发给店主的文案</span></label><textarea class="merchant-copy-text" id="${esc(id)}" readonly rows="6">${esc(message)}</textarea><div class="actions"><button type="button" class="secondary" data-copy-target="${esc(id)}" data-copy-status="${esc(id)}-status">复制文案</button><span class="muted" id="${esc(id)}-status" role="status" aria-live="polite">可直接选中文案复制；请核对后自行发送。</span></div>`;
}
