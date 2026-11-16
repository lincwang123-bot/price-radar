// Operator-requested, reversible exclusion. Historical records are retained for audit.
// 2026-11-12 站长批准，源站不可用，暂停展示，可逆。
const blockedHosts=new Set(['fk.10886.xyz','openzy.co','ai666.id','faka.redeemgpt.com']);
const blockedSourceIds=new Set(['fk10886','merchant-8e24ef59bd36ee07','ai666','redeemgpt']);
export function merchantUrlBlocked(value){
 try{return blockedHosts.has(new URL(value).hostname.toLowerCase().replace(/\.$/,'').replace(/^www\./,''));}
 catch{return false;}
}
export function merchantOfferBlocked(offer={}){
 return [offer.url,offer.source_url,offer.sourceUrl].some(merchantUrlBlocked)
  ||blockedSourceIds.has(offer.source_id)||blockedSourceIds.has(offer.sourceId);
}
