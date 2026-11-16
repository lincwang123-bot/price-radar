import {deliveryEvidence} from './delivery-evidence.mjs';

export const EDUCATION_VERIFICATION_ID='education-verification-service';
export const EDUCATION_VERIFICATION_NAME='教育资格 / 学生认证（非订阅）';
const normalize=value=>String(value||'').slice(0,4000).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const service=String.raw`(?:(?:学生|教育|学籍)\s*(?:身份\s*)?(?:认证|验证|资格(?:代办|申请|服务)?)|(?:student|education(?:al)?|academic)\s+(?:verification|eligibility(?:\s+service)?)|sheer[ -]?id\s*(?:认证|验证|verification|service))`;
function serviceText(value){
 return normalize(value)
  // A negated requirement or an already-verified account isn't the service.
  .replace(new RegExp(`(?:不需要|无需|不提供|不包含|不是|并非|非|已通过|已完成)\\s*${service}`,'g'),' ')
  .replace(new RegExp(`\\b(?:no|not|without|already completed)\\s+${service}`,'g'),' ');
}

/** Use this priced item's evidence, never a shop notice or a search category. */
export function isEducationVerificationService(offer={}){
 const title=normalize(offer.title);
 // Email products can advertise verification as a use, not a deliverable.
 if(/^(?:【|\[)?(?:教育邮箱|邮箱账号|gmail|outlook|hotmail|谷歌邮箱|微软邮箱)/.test(title))return false;
 let evidence={};
 try{evidence=deliveryEvidence((typeof offer.extra==='string'?JSON.parse(offer.extra):offer.extra)?.deliveryEvidence);}catch{}
 if(new RegExp(service).test(serviceText(evidence.skuTitle||title)))return true;
 // A description may correct a misleading short title only when explicitly
 // scoped to this exact product/SKU and stating what the service delivers.
 const sameProduct=normalize(evidence.productTitle)===title;
 const ownDescription=(evidence.descriptionScope==='product'&&!evidence.skuTitle&&sameProduct)
  ||(evidence.descriptionScope==='sku'&&!!evidence.skuTitle&&(sameProduct||title.includes(normalize(evidence.skuTitle))));
 if(!ownDescription||/本店|全店|主营业务|提供各类|常见问题|\bfaq\b/.test(normalize(evidence.description)))return false;
 return new RegExp(`(?:本商品|本服务|此商品|此服务|此链接)\\s*(?:仅|只)\\s*(?:提供|包含|帮助|帮过|负责|质保)?\\s*${service}`).test(serviceText(evidence.description));
}
