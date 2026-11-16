// Site-owned observations of the public projection, never merchant prose or URLs.
export const MAX_MERCHANT_QUOTE_DIAGNOSTIC_ITEMS = 20;
export const MERCHANT_QUOTE_DIAGNOSTIC_LABELS = Object.freeze({
  retired_business: '商品属于已停止展示的业务',
  non_subscription_tool: '商品被识别为账号管理工具',
  out_of_stock: '解析结果明确为缺货或库存为零',
  no_warranty: '商品范围内的说明明确为无质保或无售后',
  invalid_offer_id: '解析结果缺少商品标识',
  invalid_price: '解析价格不是有效正数',
  invalid_url: '解析商品地址不是有效 HTTP 或 HTTPS 链接',
  classification_unmatched: '当前品类规则未识别这条商品',
  duplicate_offer: '商品标识重复',
  grouping_rejected: '商品未通过目录分组规则，需站方核对',
  projection_rejected: '商品未通过公开展示投影，需站方核对',
  quote_stale: '报价已过期且不符合保留展示条件',
  inventory_unconfirmed: '解析结果未确认商品在售',
  unsafe_url: '商品地址未通过公开链接规则',
  directory_rule_rejected: '商品未通过公开目录规则，需站方核对',
  duplicate_quote: '公开目录已合并相同报价',
});

export function normalizeMerchantQuoteDiagnostics(value, {rawCount, validCount} = {}) {
  const invalid = () => { throw new Error('Invalid merchant quote diagnostics'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
      || !Number.isSafeInteger(value.rawCount) || value.rawCount < 0
      || !Number.isSafeInteger(value.validCount) || value.validCount < 0 || value.validCount > value.rawCount
      || rawCount !== undefined && value.rawCount !== rawCount
      || validCount !== undefined && value.validCount !== validCount
      || typeof value.truncated !== 'boolean' || value.truncated !== (value.rawCount > MAX_MERCHANT_QUOTE_DIAGNOSTIC_ITEMS)
      || !Array.isArray(value.items) || value.items.length !== Math.min(value.rawCount, MAX_MERCHANT_QUOTE_DIAGNOSTIC_ITEMS)) invalid();
  const items = value.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.index !== index
        || !Array.isArray(item.reasonCodes) || item.reasonCodes.length > 1
        || item.reasonCodes.some(code => typeof code !== 'string' || !Object.hasOwn(MERCHANT_QUOTE_DIAGNOSTIC_LABELS, code))) invalid();
    return {index, reasonCodes: [...item.reasonCodes]};
  });
  return {schemaVersion: 1, rawCount: value.rawCount, validCount: value.validCount, items, truncated: value.truncated};
}

export function merchantQuoteDiagnosticSummary(value, counts = {}) {
  let diagnostics;
  try { diagnostics = normalizeMerchantQuoteDiagnostics(value, counts); } catch { return null; }
  const reasons = new Map();
  for (const item of diagnostics.items) for (const code of item.reasonCodes) reasons.set(code, (reasons.get(code) || 0) + 1);
  return {...diagnostics, reasons: [...reasons].map(([code, count]) => ({code, count, label: MERCHANT_QUOTE_DIAGNOSTIC_LABELS[code]}))};
}
