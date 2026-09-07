// Operator-requested, reversible exclusion. Historical records are retained for audit.
const blockedHosts=new Set(['fk.10886.xyz']);
export function merchantUrlBlocked(value){
 try{return blockedHosts.has(new URL(value).hostname.toLowerCase().replace(/\.$/,'').replace(/^www\./,''));}
 catch{return false;}
}
export function merchantOfferBlocked(offer={}){
 return [offer.url,offer.source_url,offer.sourceUrl].some(merchantUrlBlocked)
  ||offer.source_id==='fk10886'||offer.sourceId==='fk10886';
}
