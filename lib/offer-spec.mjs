import { deliveryEvidence } from './delivery-evidence.mjs';

const DELIVERY_LABELS = Object.freeze({ recharge: '代充', account: '成品号', shared: '共享或合租', seat: '席位', code: '卡密（用途待确认）', unknown: '交付待确认' });
const LEGACY_LABELS = Object.freeze({ recharge: '代充', account: '成品账号', shared: '共享', seat: '席位', code: '卡密', unknown: '交付未注明' });
const result = (kind = 'unknown', conflict = false) => ({ kind, label: DELIVERY_LABELS[kind], known: !conflict && !['unknown', 'code'].includes(kind), conflict });
const normalizedDeliveryText = value => typeof value === 'string' ? value.slice(0, 4000).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() : '';
const parsedExtra = extra => { try { const value = typeof extra === 'string' ? JSON.parse(extra) : extra; return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
const GENERAL_DESCRIPTION = /\bfaq\b|常见问题|本店|全店|提供各类|主营业务/;

// Preserve explicit exclusions independently of positive matching: an excluded
// SKU must not regain a delivery type from a lower-priority parent heading.
function excludedDeliveryKinds(value) {
  const text = normalizedDeliveryText(value), excluded = new Set();
  const buyerRequirements = text.replace(/(?:无需|不需要)\s*(?:自行)?\s*(?:自备|自带|提供|填写|提交|输入)\s*(?:自己的?|您的?|你的?)?\s*(?:账号|账户)(?:及?密码)?/g, ' ');
  if (/(?:不提供|不包含|不含|不带|不是|非)\s*(?:(?:独享|成品|独立)(?:账号|账户|号)?|账号|账户)|\b(?:not|no|without)\s+(?:an?\s+)?(?:(?:dedicated|exclusive|pre[- ]?made|ready[- ]?made)\s+)?accounts?\b/.test(text)) excluded.add('account');
  if (/(?:自备|自带|自有|自己(?:注册)?的?|(?:买家|用户|客户|您|你)(?:的)?(?:现有|已有|原有)(?:的)?)\s*(?:账号|账户)|(?:请|需要|需|要求)\s*(?:您|你|用户|买家|客户)?\s*(?:提供|填写|提交|输入)\s*(?:您的?|你的?)?\s*(?:账号|账户)/.test(buyerRequirements)) excluded.add('account');
  if (/(?:不提供|不包含|不含|不是|禁止|不得|请勿|非|不)\s*(?:多人)?\s*(?:共享|合租|拼车)|\b(?:not|no|without)\s+(?:a\s+)?shared\b/.test(text)) excluded.add('shared');
  // “不是充值有问题” disputes a problem, not the advertised delivery method.
  if (/(?:不提供|不含)\s*(?:代充|充值|直充)|(?:不是|并非|非|不)\s*(?:代充|充值|直充)(?:商品|服务|套餐)?(?=$|[\s，。；,;！!])|\b(?:not|no|without)\s+(?:recharge|top[ -]?up)\b/.test(text)) excluded.add('recharge');
  if (/(?:不提供|不含|不是|非)\s*(?:席位|车位)/.test(text)) excluded.add('seat');
  return excluded;
}

function deliveryText(value, { description = false } = {}) {
  let text = normalizedDeliveryText(value);
  if (!text || (description && GENERAL_DESCRIPTION.test(text))) return result();
  // Negative labels, complimentary goods and usage notes are not deliverables.
  text = text
    .replace(/(?:避免|禁止|不得|不要|请勿|不允许|严禁)\s*(?:频繁切换地区或\s*)?(?:多人|与他人|和他人|与别人|和别人)?\s*(?:共享|合租|拼车)(?:账号|账户|号)?/g, ' ')
    .replace(/(?:不提供|不包含|不赠送|不支持|不出售|不售卖|不属于|不是|不含|不带|不卖|无需|不需要|禁止|非|不)\s*(?:成品(?:账号|账户|号)?|(?:独享|独立)(?:账号|账户|号)|共享(?:账号|账户|号)?|合租(?:账号|账户|号)?|代充|充值|账号|账户)/g, ' ')
    .replace(/\b(?:not|no|without)\s+(?:an?\s+)?(?:pre[- ]?made\s+accounts?|ready[- ]?made\s+accounts?|(?:dedicated|exclusive)\s+accounts?|shared(?:\s+accounts?)?|accounts?|recharge|top[- ]?up)\b/g, ' ')
    .replace(/(?:附|附带|赠送|送)\s*(?:free|免费|普号|白号)(?:\s*账号|号)?/g, ' ')
    .replace(/(?:附赠?|附带|赠送)?\s*(?:充值|代充|直[充冲]|卡[充冲])\s*(?:教程|教学|攻略)/g, ' ')
    .replace(/(?:一个|每个|每一个|一|1个?)\s*账号\s*一张\s*信用卡/g, ' ')
    .replace(/(?:账号|账户)\s*(?:使用须知|使用说明|要求|注意事项)\s*[:：]?/g, ' ')
    .replace(/(?:请|需要|需|要求)\s*(?:您|你|用户|买家|客户)?\s*(?:先)?\s*(?:提供|填写|提交|输入)\s*(?:您的?|你的?)?\s*(?:账号|账户)(?:及?密码)?/g, ' ')
    .replace(/(?:买家|客户|用户|您|你)\s*(?:需|需要|自行)?\s*(?:提供|填写|提交|输入)\s*(?:自己的?|您的?|你的?)?\s*(?:账号|账户)(?:及?密码)?/g, ' ')
    .replace(/\b(?:account\s+upgrade|upgrade\s+(?:your\s+)?account)\b/g, ' ')
    .replace(/(?:可|支持|允许)\s*(?:自行)?\s*充值/g, ' ');
  const code = /卡密|\bcd[k]?\b|兑换(?:码)?|redemption\s+code|redeem\s+code/.test(text);
  const recharge = /代充|直[充冲]|卡[充冲]|充值|充到|充至|充(?:你|您)?(?:自己|自有|本人|个人)(?:的)?(?:账号|账户|号)|\brecharge\b|\btop[ -]?up\b/.test(text);
  const ownAccount = /(?:自有|自带|自备|个人|本人|自己(?:注册|拥有|使用)?|您(?:的)?(?:现有|已有|原有)?|你(?:的)?(?:现有|已有|原有)?|已有|现有|原有|买家|客户|用户)(?:的)?\s*(?:账号|账户|号)|\b(?:your|own|existing)\s+(?:(?:own|existing|personal)\s+)?account\b/.test(text);
  const strongAccount = /成品|独享(?:账号|账户|号)|(?:交付|发放|发货|出售|售卖)\s*(?:新的?|独立的?)?\s*(?:账号|账户)|(?:提供|购买)\s*(?:新的?|独立的?)?\s*(?:账号密码|账号及密码|账户密码)|\b(?:pre[- ]?made|ready[- ]?made|dedicated|exclusive)\s+accounts?\b/.test(text);
  const account = strongAccount || /账号|账户|\baccounts?\b/.test(text);
  const accountCondition = /(?:账号|账户)(?:的)?\s*(?:地区|属地|状态|资格|不可用|需符合|需满足|必须)/.test(text);
  const shared = /共享|合租|拼车|镜像|\bshared\b|\bsharing\b/.test(text);
  const seat = /席位|车位|\bseats?\b/.test(text);
  const choice = /或|任选|二选|可选|选项|[\/|]|\bor\b|成品\s*\+\s*\d/.test(text);
  const incidentalRecharge = strongAccount && !ownAccount && !choice && !/代充|直[充冲]|卡[充冲]|\brecharge\b|\btop[ -]?up\b/.test(text);
  if ((strongAccount && recharge && !incidentalRecharge) || (strongAccount && (shared || seat) && choice) || (shared && seat) || ((shared || seat) && recharge && (choice || ownAccount || /代充|\brecharge\b|\btop[ -]?up\b/.test(text)))) return result('unknown', true);
  if (shared) return result('shared');
  if (seat) return result('seat');
  if (strongAccount) return result('account');
  // An account mentioned next to recharge is its destination, not proof that
  // credentials are being sold. Strong delivered-account evidence was handled above.
  if (recharge) return result('recharge');
  if (account && !ownAccount && !accountCondition && !description) return result('account');
  if (code) return result('code');
  return result();
}

/** Classify what this priced SKU delivers, not how its order is dispatched. */
export function offerDelivery(value) {
  const offer = typeof value === 'string' ? { title: value } : value && typeof value === 'object' ? value : {};
  const evidence = deliveryEvidence(parsedExtra(offer.extra).deliveryEvidence || {});
  const sku = deliveryText(evidence.skuTitle);
  const title = deliveryText(offer.title);
  // Multi-SKU parent descriptions can describe a different option. Never use
  // them as if they were the selected SKU's delivery statement.
  const descriptionText = evidence.descriptionScope === 'product_multi' || GENERAL_DESCRIPTION.test(normalizedDeliveryText(evidence.description)) ? '' : evidence.description;
  const description = deliveryText(descriptionText, { description: true });
  const skuExcluded = excludedDeliveryKinds(evidence.skuTitle), titleExcluded = excludedDeliveryKinds(offer.title), descriptionExcluded = excludedDeliveryKinds(descriptionText);
  const blocked = (candidate, ...sets) => candidate.known && sets.some(set => set.has(candidate.kind));
  if (sku.conflict) return sku;
  if (sku.known) {
    // A selected SKU resolves alternatives in the parent heading. A contradictory
    // same-SKU delivery description still makes this quote unverified.
    return blocked(sku, skuExcluded, descriptionExcluded) || description.conflict || (description.known && description.kind !== sku.kind) ? result('unknown', true) : sku;
  }
  if (title.conflict) return title;
  if (title.known) return blocked(title, skuExcluded, titleExcluded, descriptionExcluded) || description.conflict || (description.known && description.kind !== title.kind) ? result('unknown', true) : title;
  const supplemental = [deliveryText(evidence.productTitle), deliveryText(offer.category), deliveryText(evidence.category), description];
  if (supplemental.some(row => row.conflict)) return result('unknown', true);
  const kinds = new Set(supplemental.filter(row => row.known).map(row => row.kind));
  if (kinds.size > 1) return result('unknown', true);
  if (kinds.size === 1) { const candidate = result([...kinds][0]); return blocked(candidate, skuExcluded, titleExcluded, descriptionExcluded,
    excludedDeliveryKinds(evidence.productTitle), excludedDeliveryKinds(offer.category), excludedDeliveryKinds(evidence.category)) ? result('unknown', true) : candidate; }
  return [sku, title, ...supplemental].some(row => row.kind === 'code') ? result('code') : result();
}

// Keep old comparison-key labels stable; all consumers share the new decision.
export function deliveryForm(value) { return LEGACY_LABELS[offerDelivery(value).kind]; }

// Eligibility and fulfilment windows are not purchased subscription time.
// Strip only explicit timing contexts; an unqualified 3-day plan stays 3 days.
function withoutTimingConditions(title) {
  const number = '(?:\\d+|[一二两三四五六七八九十]+)';
  const window = `${number}\\s*(?:[-~至]\\s*${number}\\s*)?(?:天|日)`;
  return title
    .replace(new RegExp(`${window}\\s*(?:以内|内)\\s*(?:即将)?(?:到期|过期)`, 'g'), '')
    .replace(new RegExp(`(?:剩余|还剩|余期|到期前|过期前)\\s*${window}(?:\\s*(?:以内|内))?`, 'g'), '')
    .replace(new RegExp(`提前\\s*${window}\\s*(?:预约|预定|预订|下单|续费|充值|购买)`, 'g'), '')
    .replace(new RegExp(`${window}\\s*(?:以内|内|后)\\s*(?:发货|到账|处理|完成|开通)`, 'g'), '');
}

// 商品标题是报价粒度的证据；目录 ID、质保与分类名不能替代 SKU 期限。
export function offerSpec(offer, product = {}) {
  const delivery = offerDelivery(offer);
  const deliveryFields = { delivery_kind: delivery.kind, delivery_label: delivery.label, delivery_known: delivery.known, delivery_conflict: delivery.conflict };
  const title = String(offer.title || '').normalize('NFKC').toLowerCase();
  const termTitle = withoutTimingConditions(title);
  const units = [...title.matchAll(/(?:\d+|十二|一|二|两|三|六)\s*(?:张|份|套|枚|人|席位|个账号|个号|个账户|个卡密|accounts?|seats?)|\d+(?:\.\d+)?\s*(?:tb|gb|credits?|积分|额度)/g)].map(m=>m[0].replace(/\s/g,'')).sort().join(',');
  const unresolvedBundle = /永久|终身|lifetime|全家桶|多合一|组合套餐|套餐组合|任选|二选一|三选一|买\s*\d+\s*送\s*\d+|月年卡|月\/年|\d+\s*[/、~\-至]\s*\d+\s*(?:个)?(?:月|年|天|日)/.test(termTitle.replace(/(?:永久|终身)(?:质保|售后)|(?:质保|售后)(?:永久|终身)/g,''));
  const freeAccount = /(?:免费(?:版|账号)|普号|白号|\bfree\b)/.test(title) && !/plus|\bpro\b|premium|ultra|\bmax\b|代充|直充|充值|赠送/.test(title);
  const subscription = /chatgpt|gpt|claude|gemini|grok|premium|cursor|perplexity|notion|suno/i.test(`${title} ${product.product_id || product.id || ''}`) && !/api|额度|积分|接码|邮箱|辅助服务|activation-service|claim-link|verification-service|email-accounts|(?:^|-)free(?:-|$)/.test(`${product.product_type || product.productType || ''} ${product.product_id || product.id || ''}`) && !freeAccount;
  if (!subscription) return { key: `other:${freeAccount?'free-account:':''}${units}:${offer.currency || product.currency || '币种未注明'}`, label: unresolvedBundle?'组合或永久权益待确认':units, known: !unresolvedBundle, ...deliveryFields };
  const clean = termTitle.replace(/(?:质保|保修|售后|warranty)\s*(?:期)?\s*(?:\d+|十二|一|二|两|三|六)\s*(?:个)?\s*(?:个月|月|年|天|日|days?|months?|years?)/g, '').replace(/(?:\d+|十二|一|二|两|三|六)\s*(?:个)?\s*(?:天|日|个月|月|年)\s*(?:质保|保修|售后)/g, '').replace(/(?:囤卡|超过|超|退款|不退|保障|保证|保)\s*\d+\s*(?:天|日)/g,'');
  const nums = { 一:1, 二:2, 两:2, 三:3, 六:6, 十二:12 };
  const periods = new Set();
  for (const m of clean.matchAll(/(\d+|十二|一|二|两|三|六)?\s*(?:个)?(月|年)(?:卡)?/g)) periods.add(`${(nums[m[1]] || Number(m[1] || 1)) * (m[2] === '年' ? 12 : 1)}m`);
  for (const m of clean.matchAll(/(\d+|十二|一|二|两|三|六)\s*(天|日)(?:卡)?/g)) periods.add(`${nums[m[1]] || Number(m[1])}d`);
  for (const m of clean.matchAll(/\b(\d+)\s*(months?|years?|days?)\b/g)) periods.add(`${Number(m[1]) * (m[2].startsWith('year') ? 12 : 1)}${m[2].startsWith('day') ? 'd' : 'm'}`);
  if (/\bmonthly\b/.test(clean)) periods.add('1m');
  if (/\bannual(?:ly)?\b|\byearly\b/.test(clean)) periods.add('12m');
  const term = unresolvedBundle ? 'ambiguous' : periods.size === 1 ? [...periods][0] : periods.size > 1 ? 'ambiguous' : 'unknown';
  const form = LEGACY_LABELS[delivery.kind];
  const variantTitle = title.replace(/(?:顶尖|极致|流畅|丝滑|完整|优质|更好)体验/g, '');
  const variant = /试用|体验|trial|日抛|周抛/.test(variantTitle) ? '试用/短期' : /教育|学生|student|education/.test(title) ? '教育优惠' : '常规';
  const aliases={美区:'美国',美国:'美国',菲区:'菲律宾',菲律宾:'菲律宾',土区:'土耳其',土耳其:'土耳其',印区:'印度',印度:'印度',尼区:'尼日利亚',尼日利亚:'尼日利亚',港区:'香港',香港:'香港',日区:'日本',日本:'日本',国区:'中国',中国:'中国',全球:'全球'};
  const regions = new Set([...title.matchAll(/美区|美国|菲区|菲律宾|土区|土耳其|印区|印度|尼区|尼日利亚|港区|香港|日区|日本|全球|国区|中国/g)].map(m=>aliases[m[0]]));
  const region=[...regions].sort().join(',');
  const tier = /(?:20\s*x|x\s*20)/.test(title)?'20x':/(?:5\s*x|x\s*5)/.test(title)?'5x':/premium\s*(?:\+|plus)/.test(title)?'premium+':/pro\s*(?:\+|plus)/.test(title)?'pro+':/ultra/.test(title)?'ultra':/heavy/.test(title)?'heavy':/\bpremier\b/.test(title)?'premier':/\bmax\b/.test(title)?'max':/\bpro\b/.test(title)?'pro':/plus/.test(title)?'plus':/premium/.test(title)?'premium':'';
  const label = `${term === 'unknown' ? '期限未注明' : term === 'ambiguous' ? '期限/组合待确认' : term.replace('m',' 个月').replace('d',' 天')} · ${form}${variant==='常规'?'':` · ${variant}`}${region?` · ${region}`:''}${units?` · ${units}`:''}`;
  return { key: `${term}:${tier}:${form}:${variant}:${region || '地区未注明'}:${units || '单位未注明'}:${offer.currency || product.currency || '币种未注明'}`, label, known: delivery.known && !['unknown','ambiguous'].includes(term) && regions.size <= 1, ...deliveryFields };
}
