import {merchantIdForOffer} from './offer-provenance.mjs';
import {readFileSync} from 'node:fs';

export const GEMINI_DELIVERIES = [
  ['account','成品账号'],['recharge','用户自有账号代充/开通'],['family','家庭组邀请'],
  ['shared','共享账号'],['other','其他已确认方式'],['unknown','待核验'],
].map(([kind,label])=>({kind,label}));
export const GEMINI_ELIGIBILITIES = [
  ['paid','普通付费订阅'],['student','学生优惠'],['promotion','其他优惠/试用'],
  ['organization','组织授权（企业/教育）'],['other','其他已确认资格'],['unknown','待核验'],
].map(([kind,label])=>({kind,label}));
export const isGemini = product => /^gemini-/.test(product?.key||'');
export const geminiReviewKey = entry => JSON.stringify([entry.list.source,entry.product.product_id,String(entry.offer.offer_id)]);
export function readGeminiReviews() {
  return JSON.parse(readFileSync(new URL('../config/gemini-reviews.json',import.meta.url),'utf8'));
}
function dimension(record, choices) {
  const known=choices.find(item=>item.kind===record?.kind&&item.kind!=='unknown');
  return known&&record.status==='confirmed'&&record.basis?.trim()&&validTime(record.verifiedAt)
    ? {...known,status:'confirmed',basis:record.basis,verifiedAt:record.verifiedAt}
    : {...choices.at(-1),status:'unknown',basis:record?.basis||'',verifiedAt:record?.verifiedAt||null};
}
const validTime = value => typeof value==='string'&&Number.isFinite(Date.parse(value));
// Only this operator-maintained ledger is trusted. Collector/title/price metadata
// never grants classification or grouping authority.
export function geminiClassification(entry, reviews) {
  const record=reviews.findLast(row=>row.key===geminiReviewKey(entry));
  return {delivery:dimension(record?.delivery,GEMINI_DELIVERIES),eligibility:dimension(record?.eligibility,GEMINI_ELIGIBILITIES),review:record};
}
export function validateGeminiReview(record) {
  const key=JSON.parse(record.key);
  if(!Array.isArray(key)||key.length!==3||key.some(v=>typeof v!=='string'||!v)||!/^gemini-/.test(record.productKey)||!record.actor?.trim()||!record.reason?.trim()||!validTime(record.recordedAt))throw Error('Invalid review identity/audit fields');
  for(const [field,choices] of [['delivery',GEMINI_DELIVERIES],['eligibility',GEMINI_ELIGIBILITIES]]){
    const value=record[field];
    if(value&&(!choices.some(c=>c.kind===value.kind)||!['confirmed','unknown','conflict'].includes(value.status)||typeof value.basis!=='string'||value.status==='confirmed'&&(value.kind==='unknown'||!value.basis.trim()||!validTime(value.verifiedAt))))throw Error('Invalid '+field+' evidence');
  }
  if(record.sameSource&&!['confirmed','paused','split'].includes(record.sameSource.status))throw Error('Invalid group status');
  if(record.sameSource?.status==='confirmed'&&(!record.plan?.trim()||!/^([1-9]\d*)[md]$/.test(record.term||'')||!sourceIdentity(record.sameSource)))throw Error('Missing verifiable same-source evidence');
  return record;
}
function sourceIdentity(evidence) {
  if(evidence?.status!=='confirmed'||!evidence.basis?.trim()||!evidence.reference?.trim()||!validTime(evidence.verifiedAt))return '';
  const fields={upstream:['sourceId','goodsId'],integration:['supplierId','sku'],merchant:['sourceId','crossCheckId']}[evidence.type];
  if(!fields||fields.some(key=>typeof evidence[key]!=='string'||!evidence[key].trim()))return '';
  return [evidence.type,...fields.map(key=>evidence[key].trim())];
}
export function geminiDisplayRows(entries, product, evidenceEntries = entries) {
  if(!isGemini(product))return entries.map(entry=>({entry,members:[entry]}));
  const groups=new Map(),rows=[];
  entries.forEach((entry,originalPosition)=>{
    const c=entry.gemini,review=c?.review,evidence=sourceIdentity(review?.sameSource);
    const term=entry.offer.purchase_conditions?.subscriptionTerm;
    const spec=entry.offer.comparison_key;
    // Unknown/conflicting classification, plan or duration never forms a group.
    const eligible=!entry.reference&&evidence&&c.delivery.status==='confirmed'&&c.eligibility.status==='confirmed'
      &&review.productKey===product.key&&review.plan?.trim()&&review.term===term&&term&&/^[1-9]\d*[md]$/.test(term)
      &&entry.offer.comparison_known===true&&entry.offer.comparison_eligible!==false&&spec&&spec!=='mixed';
    const key=eligible?JSON.stringify([product.key,c.delivery.kind,c.eligibility.kind,review.plan,term,spec,entry.offer.currency||entry.product.currency,evidence]):null;
    let row=key&&groups.get(key);
    if(!row){row={entry,members:[],originalPosition};rows.push(row);if(key)groups.set(key,row);}
    row.members.push(entry);
  });
  // Conflicting declarations for one source identity suspend the entire group.
  const signatures=new Map();
  for(const entry of evidenceEntries){
    const c=entry.gemini,r=c?.review;
    const source=sourceIdentity({...r?.sameSource,status:'confirmed'});
    if(!source)continue;
    const key=JSON.stringify(source),set=signatures.get(key)||new Set();
    set.add(JSON.stringify([c.delivery.kind,c.eligibility.kind,r.plan,r.term,entry.offer.purchase_conditions?.subscriptionTerm,entry.offer.comparison_key]));
    if(!r.plan?.trim()||r.term!==entry.offer.purchase_conditions?.subscriptionTerm||r.sameSource.status!=='confirmed'||c.delivery.status!=='confirmed'||c.eligibility.status!=='confirmed')set.add('blocked');
    signatures.set(key,set);
  }
  return rows.flatMap(row=>{
    const source=sourceIdentity(row.entry.gemini?.review?.sameSource);
    const shopIds=row.members.map(entry=>merchantIdForOffer({...entry.offer,source:entry.list.source}));
    const shops=new Set(shopIds.filter(Boolean));
    if(row.members.length>1&&(shopIds.some(id=>!id)||shops.size<2||signatures.get(JSON.stringify(source))?.size>1))return row.members.map(entry=>({entry,members:[entry],originalPosition:entries.indexOf(entry),shopCount:1}));
    return [{...row,shopCount:shops.size}];
  }).sort((a,b)=>a.originalPosition-b.originalPosition);
}

// Native details keeps every full quote/link in SSR and works without JavaScript.
export function geminiQuoteGroupHtml(row, renderQuote) {
  const quotes=row.members.map(renderQuote).join('');
  return row.members.length>1?'<details class="gemini-same-source"><summary>共 '+row.shopCount+' 家店报价 · '+row.members.length+' 条 · 同货源依据已核验 · 展开查看</summary>'+quotes+'</details>':quotes;
}
