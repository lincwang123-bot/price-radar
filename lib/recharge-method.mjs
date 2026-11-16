import { deliveryEvidence } from './delivery-evidence.mjs';
import { offerDelivery } from './offer-spec.mjs';

export const RECHARGE_METHODS = Object.freeze([
  {kind:'ios',label:'iOS'}, {kind:'other',label:'其他'}, {kind:'unknown',label:'待确认'},
]);
export const normalizeRechargeMethod = value => RECHARGE_METHODS.some(item=>item.kind===value) ? value : 'all';
const result = (kind='unknown', conflict=false, excluded=new Set()) => ({kind, label:RECHARGE_METHODS.find(item=>item.kind===kind).label, known:kind!=='unknown', conflict, excluded});
const device = '(?:ios|android|安卓|苹果(?:设备|手机)?|谷歌|web|网页|windows|mac|pc)';
const devices = `${device}(?:\\s*[/、和及与+]?\\s*${device})*`;
const ios = /\bios(?=[^a-z]|$)|\bapp\s*store\b|苹果\s*(?:官方)?\s*(?:内购|渠道|代充|充值|直充|订阅|礼品卡)/;
const other = /\bandroid\b|安卓|\bgoogle\s*play\b|谷歌\s*(?:渠道|代充|充值|直充|正充|订阅|内购)|\bweb\b|网页|官网\s*(?:代充|充值|直充)/;
const normalize = value => String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();

function channelText(value) {
  let text=normalize(value);
  const excluded=new Set();
  // Compatibility/coverage describes where an existing subscription works,
  // not how this priced item is purchased. Keep separate explicit channel text.
  text=text
    .replace(new RegExp(`(?:可)?(?:覆盖|兼容|适用于)\\s*${devices}(?:设备|手机|端)?(?:使用|登录|通用|可用)?`,'g'),' ')
    .replace(new RegExp(`${devices}\\s*(?:设备|手机|端)?\\s*(?:通用|可用|均可用|均可使用|都能用|用户可用)`,'g'),' ')
    .replace(new RegExp(`(?:支持|可在)\\s*${devices}(?:设备|手机|端)?\\s*(?:使用|登录)`,'g'),' ')
    .replace(new RegExp(`(?:仅限|适用|在)\\s*${devices}(?:设备|手机|端)?\\s*(?:使用|登录)`,'g'),' ')
    .replace(new RegExp(`${devices}\\s*(?:设备|手机|用户)(?:上|端)?(?:使用|登录|可用)?`,'g'),' ')
    .replace(new RegExp(`\\b(?:supports?|compatible with|works? on|available on)\\s+${devices}\\b`,'g'),' ')
    .replace(new RegExp(`${devices}\\s+(?:compatible|supported|devices?)\\b`,'g'),' ')
    .replace(new RegExp(`支持\\s*${devices}(?=$|[，。；,;！!】\\] )])`,'g'),' ');
  const explicitlyNonIos=/(?:非|不是|不走|不通过)\s*(?:ios|app\s*store|苹果)\s*(?:渠道|充值|代充|内购)/.test(text);
  text=text.replace(/(?:不支持|不提供|不能|不是|并非|非|不走|不通过|\bnot\s+|\bwithout\s+)\s*(ios|app\s*store|苹果|android|安卓|google\s*play|谷歌|web|网页)(?:渠道|充值|代充|内购)?/g, (_match, name) => {
    excluded.add(/ios|app\s*store|苹果/.test(name)?'ios':'other');
    return ' ';
  });
  const hasIos=ios.test(text), hasOther=other.test(text)||explicitlyNonIos;
  if(hasIos&&hasOther) return result('unknown',true,excluded);
  const kind=hasIos?'ios':hasOther?'other':'unknown';
  return excluded.has(kind)?result('unknown',true,excluded):result(kind,false,excluded);
}

/** Public SKU evidence only. Never infer from price, store name or provenance. */
export function rechargeMethod(offer={}) {
  if(offerDelivery(offer).kind!=='recharge') return result();
  let extra={};
  try { extra=typeof offer.extra==='string'?JSON.parse(offer.extra):offer.extra||{}; } catch { /* No usable evidence. */ }
  const evidence=deliveryEvidence(extra?.deliveryEvidence);
  const sku=channelText(evidence.skuTitle), title=channelText(deliveryEvidence({productTitle:offer.title}).productTitle);
  // A shop-wide or multi-option description cannot identify the priced SKU.
  const description=['sku','product'].includes(evidence.descriptionScope)&&!/(?:\bfaq\b|常见问题|本店|全店|主营业务)/i.test(evidence.description)
    ? channelText(evidence.description) : result();
  const check=(candidate, ...constraints)=>constraints.some(item=>item.excluded.has(candidate.kind))||description.conflict||(description.known&&description.kind!==candidate.kind)
    ? result('unknown',true) : candidate;
  if(sku.conflict) return sku;
  if(sku.known) return check(sku,sku,description);
  if(title.conflict) return title;
  if(title.known) return check(title,sku,title,description);
  const parent=channelText(evidence.productTitle);
  if(parent.conflict||description.conflict) return result('unknown',true);
  if(parent.known) return check(parent,sku,title,parent,description);
  if(description.known) return check(description,sku,title,parent,description);
  return result();
}
