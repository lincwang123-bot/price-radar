import { deliveryEvidence } from './delivery-evidence.mjs';

export const PRICING_TYPES = Object.freeze([
  { kind: 'regular', label: '正价' },
  { kind: 'promo', label: '优惠 / 半价' },
  { kind: 'all', label: '全部' },
]);

export const normalizePricingType = value => PRICING_TYPES.some(item => item.kind === value) ? value : 'all';

// Promo/half-price and similar deal wording only. "0元" must be a standalone
// zero: "100元/月" is a regular price, not a zero-yuan deal. Shared/carpool and
// regional card top-ups stay regular unless they also name a promo deal.
const PROMO_RE = /半价(?:资格)?|资格号|(?<![\d.])0\s*元|首月|促销|试用|特价|优惠开通|优惠账号|限时(?:钜惠|特价|优惠)|half[\s-]?price|free\s*trial|\bpromo(?:tion)?\b/i;

function parsedExtra(extra) {
  try {
    const value = typeof extra === 'string' ? JSON.parse(extra) : extra;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function promoText(value) {
  return String(value || '').normalize('NFKC');
}

/** Classify listed-price deal type for directory display filters only. */
export function offerPricingType(offer = {}) {
  const evidence = deliveryEvidence(parsedExtra(offer.extra).deliveryEvidence || {});
  const text = [offer.title, evidence.skuTitle, evidence.productTitle]
    .map(promoText)
    .filter(Boolean)
    .join(' ');
  if (!text.trim()) return 'unknown';
  if (PROMO_RE.test(text)) return 'promo';
  return 'regular';
}

export function matchesPricingType(kind, filter) {
  const active = normalizePricingType(filter);
  if (active === 'all') return true;
  if (active === 'promo') return kind === 'promo';
  // Regular view keeps unmarked quotes so incomplete titles are not hidden.
  return kind !== 'promo';
}
