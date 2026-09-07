// Only explicitly selected public product/SKU fields enter this evidence object.
// Callers must never pass shop notices, private fulfillment payloads or secrets.
function plainText(value, limit) {
  if (typeof value !== 'string') return '';
  let text = value.slice(0, 64 * 1024)
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (entity, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    })
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, entity => ({'&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'"}[entity.toLowerCase()]))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:p|div|br|li|h[1-6]|tr|section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ').trim();
  // Fail closed for an accidentally exposed credential, rather than retaining
  // part of its value or copying a long arbitrary response into the database.
  if (/\bsk-[\w-]{16,}|\bgh[pousr]_[\w]{20,}|\bxox[baprs]-[\w-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[\w.~+/=-]{16,}|(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|私钥|密码|口令|卡密(?:内容)?)\s*[:=：]\s*\S+/i.test(text)) return '';
  return text.slice(0, limit);
}

export function deliveryEvidence(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return { productTitle: plainText(value.productTitle, 500), skuTitle: plainText(value.skuTitle, 500),
    category: plainText(value.category, 500), description: plainText(value.description, 4000),
    ...(['sku', 'product', 'product_multi'].includes(value.descriptionScope) ? { descriptionScope: value.descriptionScope } : {}) };
}
