// The new unified subscription is a separate product, not a rename of
// X Premium, SuperGrok or Cursor. Identity belongs to the priced product/SKU;
// category labels and shop-wide marketing never establish a subscription.
import {deliveryEvidence} from './delivery-evidence.mjs';

const normalized=value=>String(value??'').normalize('NFKC').toLowerCase()
  .replace(/[\u2010-\u2015_/|【】()[\]（）·:：,，-]+/g,' ').replace(/\s+/g,' ').trim();
const englishIdentity=/\b(?:the\s+)?x\s+subscription\b/;
const chineseIdentity=/(?:融合|联合|统一)\s*(?:订阅|会员)/;
const shortChineseIdentity=/\bx\s*(?:新版\s*)?订阅/;
const bundleMarker=/三合一|\b3\s*in\s*1\b/;
const components=text=>/\bgrok\b/.test(text)&&/\bcursor\b/.test(text)&&/\bx\b|\btwitter\b|推特/.test(text);
const fullIdentity=text=>englishIdentity.test(text)||shortChineseIdentity.test(text)
  ||chineseIdentity.test(text)&&/\bx\b|\btwitter\b|推特/.test(text)
  ||bundleMarker.test(text)&&components(text);
// A shortened, explicitly *new* bundle must not leak into legacy Grok while
// awaiting its exact public product detail. This hint alone supplies no tier.
const newBundleHint=text=>/\bgrok\b/.test(text)&&/(?:新版\s*)?(?:三合一|3\s*in\s*1)/.test(text);
const titleOf=value=>normalized(value&&typeof value==='object'?value.title:value);
const leadingStatement=description=>description.replace(/^本(?:商品|套餐|订阅)\s*(?:是|为)?\s*/,'').split(/[。；;]/,1)[0];

function sameProductDescription(value,title){
  if(!value||typeof value!=='object')return '';
  let evidence;
  try{const extra=typeof value.extra==='string'?JSON.parse(value.extra):value.extra;evidence=deliveryEvidence(extra?.deliveryEvidence);}catch{return '';}
  // Multi-SKU parent descriptions and inferred SKU title concatenation cannot
  // prove the selected SKU. Single-product detail requires exact title binding.
  if(evidence.descriptionScope!=='product'||evidence.skuTitle||normalized(evidence.productTitle)!==title)return '';
  return normalized(evidence.description);
}

export function isXSubscription(value){
  const text=titleOf(value);
  return fullIdentity(text)||newBundleHint(text);
}

export function xSubscriptionTier(value){
  const title=titleOf(value);
  if(!isXSubscription(title))return null;
  // Kami-style Grok 三合一 umbrella parent: public parent commodity is the
  // Premium SKU; Plus/Super/Ultra are sibling drafts (FB-00000000-4634a1895d1a00be-EXAMPLE).
  if(newBundleHint(title)&&/\bgrok\s+premium\b/.test(title)&&!/\bgrok\s+(?:plus|super|ultra)\b/.test(title))return 'premium';
  if(newBundleHint(title)&&/plus\s*(?:\/\s*)?premium\s*(?:\/\s*)?super\s*(?:\/\s*)?ultra/.test(title)
    &&/(?:四档|可选)/.test(title)&&!/\bgrok\s+(?:plus|super|ultra)\b/.test(title))return 'premium';
  const description=sameProductDescription(value,title);
  const titleTier=readTier(title,{shortened:newBundleHint(title)});
  if(!titleTier)return null;
  if(!fullIdentity(title)){
    // Require a leading, unambiguous statement about this exact product, not
    // an upsell, general store text, a comparison, or another tier in its FAQ.
    const statement=leadingStatement(description);
    if(!/^(?:(?:the\s+)?x\s+subscription\b|x\s*(?:新版\s*)?(?:订阅|(?:融合|联合|统一)\s*(?:订阅|会员)))/.test(statement)
      ||!components(`${title} ${description}`)||readTier(statement)!==titleTier)return null;
  }
  // Detail may narrow or invalidate title evidence, but never replace a clear
  // title's tier. Reject a conflicting explicit bundle statement or exclusions.
  if(description){
    if(!eligibleText(`${title} ${description}`))return null;
    const statement=leadingStatement(description);
    if(fullIdentity(statement)&&readTier(statement)!==titleTier)return null;
    const stated=[...description.matchAll(/(?:\bx\s+subscription|\bx\s*(?:新版\s*)?订阅|(?:融合|联合|统一)\s*(?:订阅|会员))\s+(plus|premium|super|ultra)\b/g)].map(match=>match[1]);
    if(stated.some(tier=>tier!==titleTier))return null;
  }
  return titleTier;
}

function eligibleText(text){
  // The bundle classifier runs before standalone-brand matching, so preserve
  // the catalog's non-subscription exclusions here as well. A genuine paid
  // plan may include instructions; instructions alone never establish one.
  if(/补差价|差价专用|月年卡|月卡\s*年卡|全家桶|多合一/.test(text))return false;
  if(/教程|教学|攻略|邀请额度/.test(text)&&!/直充|代充|卡密|成品|月卡|年卡|会员|账号/.test(text))return false;
  if(/^\s*(?:邀请推广|接马推广|推广)/.test(text)&&/返利/.test(text)&&/可提现/.test(text))return false;
  if(/额度\s*(?:自动\s*)?(?:重置|恢复)/.test(text)
      &&!/月卡|年卡|季卡|周卡|日卡|\d+\s*(?:个?月|年|天)\s*(?:订阅|会员|套餐)/.test(text)
      &&/(?:重置|恢复)\s*服务|联系客服|确认.*资格/.test(text))return false;
  // A subscription's shared usage pool is not a shared account. Explicitly
  // excluded API usage is likewise a boundary note, not the item being sold.
  const service=text.replace(/共享\s*(?:用量|额度|预算)(?:池)?|(?:用量|额度|预算)\s*共享|\bshared\s+(?:usage|allowance|credits?|pool)\b/g,' ')
    .replace(/(?:不含|不包含|不提供|非|无需)\s*api(?:\s*(?:用量|额度|服务))?/g,' ');
  // The first release supports personal subscriptions, not business seats,
  // shared access, signup/eligibility services, or free/ordinary accounts.
  if(/团队|多人|合租|共享|拼车|席位|车位|\bteams?\b|\bbusiness\b|\bshared\b|\bseats?\b|(?:[2-9]\d*|1\d+)\s*(?:人|个?账号|个?账户|accounts?)|普通账号|普通账户|免费版|免费账号|非会员|(?:不含|不包含|不带)\s*(?:会员|订阅)|普号|白号|\bfree\b|\btrial\b|仅\s*(?:开通|订阅)?资格|资格服务|权限激活|代注册|注册服务/.test(service))return false;
  if(/\bapi\b|中转|镜像|余额|积分\s*(?:充值|兑换)|(?:购买|充值|兑换)\s*(?:tokens?|点数|额度)|(?:tokens?|点数|额度)\s*(?:充值|兑换)/.test(service))return false;
  if(/chat\s*gpt|\bgpt\b|openai|claude|gemini|suno|perplexity|notion|manus|copilot|midjourney|\bmuse\b/.test(text))return false;
  if(/多档|多套餐|(?:plus|premium|super|ultra|pro).{0,24}(?:任选|可选|二选一|三选一)|(?:任选|可选|二选一|三选一).{0,24}(?:plus|premium|super|ultra|pro)/.test(text))return false;
  return true;
}

function readTier(text,{shortened=false}={}){
  if(!eligibleText(text))return null;
  // Component benefits can mention X Premium+ or Cursor Pro. Those words
  // must not supply or override the main unified-subscription tier.
  const main=text.split(/(?:包含|内含|附带|附赠|赠送|含有|含|权益|\bincludes?\b|\bincluding\b|\bwith\b)/,1)[0];
  const tier=main.match(/\b(?:the\s+)?x\s+subscription\s+(plus|premium|super|ultra)\b/)?.[1]
    || main.match(/(?:融合|联合|统一)\s*(?:订阅|会员)\s*(plus|premium|super|ultra)\b/)?.[1]
    || main.match(/\bx\s*(?:新版\s*)?订阅\s*(plus|premium|super|ultra)\b/)?.[1]
    || main.match(/\bx\s+(plus|premium|super|ultra)\s*(?:新版\s*)?(?:融合|联合|统一)\s*(?:订阅|会员)/)?.[1]
    || (bundleMarker.test(main)&&components(text)?main.match(/(?:三合一|\b3\s*in\s*1)\s*(?:会员|订阅|套餐)?\s*(plus|premium|super|ultra)\b/)?.[1]:null)
    || (shortened?main.match(/\bgrok\s+(plus|premium|super|ultra)\b/)?.[1]:null);
  if(!tier)return null;
  if(/\b(?:pro|basic|platinum|max|heavy)\b/.test(main.replace(/\bcursor\s+pro\b/g,'').replace(/\bsuper\s*grok\s*(?:heavy)?\b/g,'')))return null;
  const candidates=new Set([...main.replace(/\bsuper\s*grok\b/g,'').matchAll(/\b(plus|premium|super|ultra)\b/g)].map(match=>match[1]));
  if(candidates.size!==1||!candidates.has(tier)||/\b(?:plus|premium|super|ultra)\s*[+➕]/.test(main))return null;
  return tier;
}
