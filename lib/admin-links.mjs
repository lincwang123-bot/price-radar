const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Only explicit HTTP(S) links become anchors; prose remains plain text.
export function safeExternalLink(value, label = value) {
  const text = String(value ?? '');
  try {
    if (/[\u0000-\u0020\u007f-\u009f]/.test(text) || !/^https?:\/\//i.test(text)) throw new Error('Invalid URL');
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
    return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="overflow-wrap:anywhere">${esc(label)} ↗</a>`;
  } catch { return `<span>${esc(label)}</span>`; }
}
