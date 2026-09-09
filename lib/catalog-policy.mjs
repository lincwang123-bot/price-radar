// Reversible business retirement: retain historical snapshots for audit, but
// exclude retired products from ingestion and every public projection.
import {deliveryEvidence} from './delivery-evidence.mjs';
const retiredIds = /^(?:verification-service|(?:[a-z0-9]+-)*phone-verification|(?:sms|otp)(?:-service|-verification|-receive)?)$/i;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/接(?:碼|馬|马|🐎)/gu,'接码').replace(/驗證/g,'验证').replace(/長效/g,'长效');
export function retiredCatalogItem(item = {}) {
  if ([item.product_id,item.productId,item.productKey,item.key,item.id].some(id=>retiredIds.test(String(id||'')))) return true;
  let title = normalize(item.title || item.name || item.productName || item.product_name);
  // Existing-account attributes are not a standalone code-receiving service.
  title = title.replace(/(?:已|未|无需|无须|不需要|免)接码/g,'');
  if (/账号|帳號|成品号|free号|free账号/.test(title)) title=title.replace(/双接码|可接码/g,'');
  if (/\bfree-ic\b/.test(title)) title=title.replace(/(?:^|[-\s])接码(?=[-\s]|$)/g,' ');
  if (/接码|短信(?:验证码|验证|代收|接收)|(?:代收|接收).{0,8}(?:短信|验证码)|\bsms\b|phone\s*(?:number|verify|verification)|(?:单次|一次性|短效|长效).{0,10}(?:手机|号码)验证|手机号\s*(?:验证|接收)/i.test(title)) return true;
  let evidence={};
  try {evidence=deliveryEvidence((typeof item.extra==='string'?JSON.parse(item.extra):item.extra)?.deliveryEvidence);} catch {}
  const category=normalize(item.category || (!evidence.skuTitle && evidence.productTitle===item.title ? evidence.category : ''));
  return /接码|\bsms\b/.test(category) && /手机号|实卡|验证码|\botp\b/.test(title) && /临时|单次|一次|短效|长效/.test(title);
}
export function filterCatalogSnapshot(snapshot) {
  return {...snapshot,products:(snapshot.products||[]).flatMap(product=>{
    if (retiredCatalogItem(product)) return [];
    const raw=product.offers||[],offers=raw.filter(offer=>!retiredCatalogItem(offer));
    if (raw.length && !offers.length) return [];
    if (offers.length===raw.length) return [product];
    // Do not retain the removed service's cheap aggregate price. The public
    // projection computes comparable prices from the remaining quotes.
    return [{...product,offers,offerCount:offers.length,lowestPrice:null,lowest_price:null}];
  })};
}
