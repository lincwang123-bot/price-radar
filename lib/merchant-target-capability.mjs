// Process-local authority: JSON/payload flags cannot opt into dynamic adapters.
// Only the approved-manifest worker issues capabilities, and always supplies
// the DNS-pinned fetch implementation for the same origin.
const approved = new WeakSet();
export function authorizeMerchantTarget(target) { approved.add(target); return target; }
export function isAuthorizedMerchantTarget(target) { return !!target && approved.has(target); }
export function inheritMerchantTarget(target, normalized) {
  if (isAuthorizedMerchantTarget(target)) approved.add(normalized);
  return normalized;
}
