import {isGemini,readGeminiReviews,geminiClassification,GEMINI_DELIVERIES,GEMINI_ELIGIBILITIES,geminiDisplayRows} from './gemini-eligibility.mjs';
import { classifyDirectOffer, directOfferExclusionReason } from '../collectors/direct/catalog.mjs';
import { safeMerchantUrl } from './outbound.mjs';
import { merchantIdForOffer } from './offer-provenance.mjs';
import { offerChannel } from './channels.mjs';
import { isListed, quoteOrder } from './market-view.mjs';
import { offerDelivery } from './offer-spec.mjs';
import {quoteIdentityKey,quoteDestinationKey as destinationKey} from './quote-identity.mjs';
import {matchesPurchase} from './purchase-conditions.mjs';
import { retiredCatalogItem, retiredCatalogSource } from './catalog-policy.mjs';
import { rechargeMethod, RECHARGE_METHODS, normalizeRechargeMethod } from './recharge-method.mjs';
import { OFFICIAL_BASELINES } from './official-baselines.mjs';
import { EDUCATION_VERIFICATION_ID, EDUCATION_VERIFICATION_NAME } from './education-verification.mjs';
import {checkoutQuote,compareCheckoutPrices} from './checkout-price.mjs';
import {isXSubscription} from './x-subscription-products.mjs';
import {offerPricingType, matchesPricingType, normalizePricingType, PRICING_TYPES} from './pricing-type.mjs';
import {CHATGPT_PRO_PUBLIC_NAMES} from './chatgpt-pro-names.mjs';

export const DIRECTORY_DELIVERIES = Object.freeze([
  {kind:'recharge',label:'代充'},{kind:'account',label:'成品号'},{kind:'shared',label:'共享或合租'},
  {kind:'seat',label:'席位'},{kind:'code',label:'卡密（用途待确认）'},{kind:'unknown',label:'交付待确认'},
]);
const deliveryEnabled = definition => definition.category==='gemini' || !['mail','other'].includes(definition.category) && !/credits|service|claim-link/.test(definition.key);

export const DIRECTORY_CATEGORIES = Object.freeze([
  ['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'],
  ['grok', 'Grok'], ['x', 'X'], ['x-subscription', 'X 融合订阅'], ['mail', '邮箱'],
  ['muse', 'Muse'], ['suno', 'Suno'], ['cursor', 'Cursor'], ['perplexity', 'Perplexity'],
  ['notion', 'Notion AI'], ['manus', 'Manus'], ['microsoft', 'Microsoft'], ['other', '其他'],
].map(([key, label], index) => Object.freeze({ key, label, primary: index < 7 })));

// Directory membership is intentionally bounded. A directory group describes a
// product family, never an assertion that its different delivery specs compare.
const definitions = [
  ['muse', 'muse-account-10b', 'Muse 成品号 · 10 亿 token'],
  ['muse', 'muse-account-300b', 'Muse 成品号 · 300 亿+ token'],
  ['muse', 'muse-account', 'Muse 账号 · 其他/未标注'],
  ['muse', 'muse-power', 'Muse Power'],
  ['muse', 'muse-max', 'Muse Maximum', 'muse-maximum'],
  ['chatgpt', 'chatgpt-go', 'ChatGPT Go'],
  ['chatgpt', 'chatgpt-plus', 'ChatGPT Plus', 'chatgpt-plus-recharge', 'chatgpt-plus-recharge-12m'],
  ['chatgpt', 'chatgpt-pro-5x', CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-5x']],
  ['chatgpt', 'chatgpt-pro-20x', CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-20x']],
  ['chatgpt', 'chatgpt-pro-25x', CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-25x']],
  ['chatgpt', 'chatgpt-team-business', 'ChatGPT Team / Business'],
  ['claude', 'claude-pro', 'Claude Pro', 'claude-pro-month'],
  ['claude', 'claude-max-5x', 'Claude Max（原 Max 5x）'],
  ['claude', 'claude-max-20x', 'Claude Ultra（原 Max 20x）'],
  ['gemini', 'gemini-pro', 'Gemini / Google AI Pro', 'gemini-pro-recharge', 'gemini-pro-year', 'gemini-advanced'],
  ['gemini', 'gemini-ultra', 'Gemini / Google AI Ultra', 'gemini-ai-ultra'],
  ['gemini', 'gemini-pro-long', 'Gemini / Google AI Pro · 多月 / 年号'],
  ['gemini', 'gemini-ultra-long', 'Gemini / Google AI Ultra · 多月 / 年号'],
  ['gemini', 'gemini-ai-plus', 'Google AI Plus'],
  ['gemini', 'gemini-activation-service', 'Gemini 权限激活服务'],
  ['gemini', 'gemini-claim-link', 'Gemini 权益领取链接'],
  ['grok', 'super-grok', 'Super Grok', 'grok-supergrok'],
  ['grok', 'super-grok-heavy', 'Super Grok Heavy', 'grok-supergrok-heavy'],
  ['grok', 'grok-supergrok-lite', 'Super Grok Lite'],
  ...['Plus','Premium','Super','Ultra'].map(tier=>['x-subscription','x-subscription-'+tier.toLowerCase(),'X 融合订阅 '+tier]),
  ['x', 'x-basic', 'X Basic'],
  ['x', 'x-twitter-premium', 'X Premium', 'x-premium'],
  ['x', 'x-twitter-premium-plus', 'X Premium+', 'x-premium-plus'],
  ['mail', 'email-accounts', '邮箱账号'],
  ...['pro', 'premier'].map(tier => ['suno', `suno-${tier}`, `Suno ${tier === 'pro' ? 'Pro' : 'Premier'}`, ...[1, 3, 12].map(months => `suno-${tier}-${months}m`)]),
  ...[['pro', 'Pro'], ['pro-plus', 'Pro+'], ['ultra', 'Ultra']].map(([tier, name]) => ['cursor', `cursor-${tier}`, `Cursor ${name}`, `cursor-${tier}-1m`]),
  ['perplexity', 'perplexity-pro', 'Perplexity Pro', ...[1, 12, 24].map(months => `perplexity-pro-${months}m`)],
  ['notion', 'notion-ai-business', 'Notion AI 商业版', ...[1, 12, 24].map(months => `notion-ai-business-${months}m`)],
  ...[2000, 5000, 10000].map(credits => ['manus', `manus-${credits}-credits`, `Manus ${credits} 积分`]),
  ['chatgpt', 'chatgpt-free-account', 'ChatGPT 普通账号'],
  ['chatgpt', 'chatgpt-codex-service', 'Codex 服务'],
  ['claude', 'claude-account', 'Claude 账号'],
  ['claude', 'claude-team-standard', 'Claude Team Standard'],
  ['claude', 'claude-team-premium', 'Claude Team Premium'],
  ['microsoft', 'copilot-pro', 'Microsoft Copilot Pro'],
  ['grok', 'grok-account', 'Grok 普通账号 / 体验号'],
  ['x', 'x-twitter-account', 'X / 推特账号'],
  ...[['cursor', 'Cursor'], ['perplexity', 'Perplexity'], ['suno', 'Suno']].map(([brand, name]) => [brand, `${brand}-account`, `${name} 账号`]),
  ...[['gmail-account', 'Gmail / Google 邮箱'], ['icloud-email', 'iCloud 邮箱'], ['outlook-account', 'Outlook / Hotmail 邮箱'], ['email-account', '其他邮箱'], ['education-email', '教育邮箱']].map(([key, name]) => ['mail', key, name]),
  ['other', 'identity-verification', '真人 / KYC 验证'],
  ['other', EDUCATION_VERIFICATION_ID, EDUCATION_VERIFICATION_NAME],
  ...[['apple-id-account', 'Apple ID / 苹果账号'], ['dreamina-account', 'Dreamina / 即梦'], ['kiro-pro-account', 'Kiro Pro / 额度号'], ['kiro-account', 'Kiro 普通账号'], ['telegram-premium', 'Telegram Premium'], ['telegram-account', 'Telegram 账号'], ['windsurf-account', 'Windsurf 账号'], ['other-product', '其他商品'], ['gift-card', '礼品卡'], ['virtual-card', '虚拟卡']].map(([key, name]) => ['other', key, name]),
];
const byId = new Map();
const byName = new Map();
for (const [rank, [category, key, name, ...aliases]] of definitions.entries()) {
  const definition = { category, key, name, rank };
  for (const id of [key, ...aliases]) byId.set(id, definition);
  byName.set(name.toLowerCase(), definition);
}
// Stored snapshots and older copy still use the merchant-era labels.
for (const [legacy, id] of [['chatgpt pro 5x', 'chatgpt-pro-5x'], ['chatgpt pro 20x', 'chatgpt-pro-20x'], ['chatgpt pro 25x / pro 500', 'chatgpt-pro-25x'], ['chatgpt pro 25x', 'chatgpt-pro-25x']]) {
  const definition = byId.get(id);
  if (definition) byName.set(legacy, definition);
}
const currencies = new Set(['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'TWD', 'JPY', 'KRW', 'SGD', 'AUD', 'CAD', 'INR', 'BDT', 'TRY', 'BRL', 'MYR', 'THB', 'VND', 'IDR', 'CHF', 'AED', 'USDT', 'USDC']);

function definitionFor(list, product, offer) { return geminiTermSplit(definitionForBase(list, product, offer), offer); }
function definitionForBase(list, product, offer) {
  if (retiredCatalogSource(list.source) || retiredCatalogItem(product) || retiredCatalogItem(offer)) return undefined;
  // Search buckets are not product identities. In particular, do not pass an
  // LDXP bucket/category as classifier context for an unrelated result title.
  const title = String(offer.title || '').trim();
  const trusted = ['direct-shops', 'cardnav-official'].includes(list.source);
  const idDefinition = trusted ? byId.get(product.product_id) : undefined;
  // These are explicitly distinct products outside the direct subscription
  // classifier. Their upstream canonical IDs must not collapse into Plus/Pro.
  if (idDefinition && (list.source === 'cardnav-official' || /account$|email$|verification$/.test(product.product_id) || ['other-product', 'gift-card', 'virtual-card', 'telegram-premium', 'chatgpt-codex-service', 'claude-team-standard', 'claude-team-premium', 'copilot-pro', 'gemini-ai-plus'].includes(product.product_id))) return idDefinition;
  if (title) {
    const classified = classifyDirectOffer({ title, url:offer.url, source:list.source, sourceId: offer.source_id || offer.sourceId, extra:list.source==='direct-shops'?offer.extra:undefined });
    return classified ? byId.get(classified.id) : undefined;
  }
  if (!trusted) return undefined;
  return byId.get(product.product_id) || byName.get(String(product.name || '').trim().toLowerCase());
}

export function directoryIdentity(list, product, offer = {}) {
  return definitionFor(list, product, offer)?.key || null;
}

// Canonical source IDs can supply missing brand context, but search buckets
// cannot. Explicit brands in a title always win over the upstream bucket.
// Gemini Pro/Ultra: multi-month / annual quotes get their own pages so the
// monthly start price is not pulled by year or two-year cards. Unknown terms stay.
function geminiTermSplit(definition, offer) {
  if (!definition || !['gemini-pro', 'gemini-ultra'].includes(definition.key)) return definition;
  const term = String(offer?.comparison_key || '').split(':')[0];
  const m = /^(\d+)m$/.exec(term), d = /^(\d+)d$/.exec(term);
  return (m && Number(m[1]) >= 2) || (d && Number(d[1]) >= 60) ? byId.get(definition.key + '-long') : definition;
}
function quoteDefinition(list, product, offer) { return geminiTermSplit(quoteDefinitionBase(list, product, offer), offer); }
function quoteDefinitionBase(list, product, offer) {
  if (retiredCatalogSource(list.source) || retiredCatalogItem(product) || retiredCatalogItem(offer)) return undefined;
  const existing = definitionFor(list, product, offer);
  const canonical = ['direct-shops'].includes(list.source) ? byId.get(product.product_id) : null;
  const title = String(offer.title || '').trim();
  // An explicitly identified unified plan legitimately names multiple benefits.
  // Unknown bundle tiers must not fall back into one of those legacy products.
  if (isXSubscription({title,extra:list.source==='direct-shops'?offer.extra:undefined})) return existing?.category === 'x-subscription' ? existing : undefined;
  // Match product-bearing brand phrases, not incidental Google email/payment
  // mentions. Multiple explicit subscriptions are bundles, not one identity.
  const brandProducts = [
    /(?:chat\s*gpt|\bgpt\b|openai|\bcodex\b|\bg(?=\s*plus\b))\s*[- ]*(?:plus|pro|go|team|business|free)/i,
    /claude\s*[- ]*(?:pro|max|team)/i,
    /(?:gemini|google\s*(?:ai)?)\s*[- ]*(?:pro|ultra|plus|advanced)/i,
    /(?:super\s*grok|grok\s*(?:super|heavy|lite))/i,
    /(?:twitter|\bx)\s*[- ]*(?:premium|basic)/i,
    /muse\s*[- ]*(?:power|max(?:imum)?)/i,
    /suno\s*[- ]*(?:pro|premier)/i, /cursor\s*[- ]*(?:pro|ultra)/i,
    /perplexity\s*[- ]*pro/i, /notion\s*(?:ai|business)/i,
    /\bmidjourney\b/i, /\bcanva\b/i,
  ];
  if (brandProducts.filter(pattern => pattern.test(title)).length > 1) return undefined;
  // A positive title classification already establishes product identity.
  // The Latin-word guard only constrains inference from a bare tier; applying
  // it again would discard valid aliases and their actual delivery wording.
  // "Plus 已接码" describes an account attribute, so it still needs the
  // contextual bare-tier path rather than becoming a verification service.
  const explicit = classifyDirectOffer({ title: title.replace(/已接码|已验证/g, ''), url:offer.url, source:list.source, sourceId: offer.source_id || offer.sourceId, extra:list.source==='direct-shops'?offer.extra:undefined });
  if (existing && explicit) return existing;
  const brands = /chat\s*gpt|\bgpt\b|openai|claude|gemini|google|grok|twitter|\bx\s+(?:premium|basic)|suno|cursor|perplexity|notion|manus|copilot|microsoft|\bmuse\b/i;
  if (!canonical || !title || brands.test(title)) return existing;
  // A bare tier is useful evidence; generic account/accessory titles aren't.
  if (!/\b(?:power|maximum|plus|pro|go|max|ultra|premium|business|premier)\b/i.test(title)) return existing;
  // Fallback is deliberately limited to bare tiers with delivery/duration
  // text. An unrecognized Latin brand cannot inherit a trusted source's ID.
  const latinWords = title.toLowerCase().match(/[a-z]+/g) || [];
  const allowedWords = new Set(['power', 'maximum', 'plus', 'pro', 'go', 'max', 'ultra', 'premium', 'business', 'premier', 'x', 'm', 'd', 'y', 'month', 'months', 'year', 'years', 'day', 'days', 'monthly', 'yearly', 'usd', 'cny', 'usdt', 'usdc', 'cdk', 'cdkey', 'ios', 'android', 'web', 'app', 'code', 'key', 'recharge', 'account']);
  if (latinWords.some(word => !allowedWords.has(word))) return undefined;
  const tierTokens = value => [...value.toLowerCase().matchAll(/\b(?:power|maximum|plus|pro|go|max|ultra|premium|business|premier)\b/g)].map(match => match[0]);
  if (tierTokens(title).some(tier => !tierTokens(canonical.name).includes(tier))) return existing;
  const contextual = classifyDirectOffer({ title: `${canonical.name} ${title.replace(/已接码|已验证/g, '')}`, sourceId: offer.source_id || offer.sourceId });
  return contextual && byId.get(contextual.id)?.key === canonical.key ? canonical : existing;
}

// Share the exact directory identity with opt-in watchlists; search buckets are
// never treated as product identities by the notification layer.
export const directoryQuoteIdentity=(list,product,offer)=>quoteDefinition(list,product,offer)||null;

function quoteEligible(list, product, offer) {
  if (retiredCatalogSource(list.source) || retiredCatalogItem(product) || retiredCatalogItem(offer)) return false;
  const reference = ['cardnav-official'].includes(list.source);
  return (!(offer.quote_stale ?? list.stale) || offer.quote_retained===true)
    && (isListed(offer) || reference && ['official', 'active'].includes(offer.status))
    && !directOfferExclusionReason({ ...offer, stockCount: offer.stock_count ?? offer.stockCount })
    && offer.price != null && Number.isFinite(Number(offer.price))
    && (reference ? Number(offer.price) >= 0 : Number(offer.price) > 0)
    && currencies.has(offer.currency || product.currency) && !!safeMerchantUrl(offer.url);
}

const specKey = entry => entry.offer.comparison_eligible !== false && entry.offer.comparison_known === true && entry.offer.comparison_key && entry.offer.comparison_key !== 'mixed' ? entry.offer.comparison_key : '';
function shopKey(entry) {
  // Count a shared platform shop only when the adapter established its identity.
  return merchantIdForOffer({...entry.offer,source:entry.list.source});
}
const currencyOrder = (a, b) => Number(b === 'CNY') - Number(a === 'CNY') || a.localeCompare(b);

// Reuse only the unfiltered public preparation within the same render. Sorting
// with private badges/X state is always recalculated, never retained here.
const quoteBases=new WeakMap();
function prepareQuotes(product) {
  const deduped = new Map();
  for (const entry of product?.quoteEntries || product?.entries || []) {
    if (!quoteEligible(entry.list, entry.product, entry.offer)) continue;
    const key = quoteIdentityKey(entry.offer,{productKey:product.key,currency:entry.offer.currency||entry.product.currency,reference:entry.reference});
    const previous = deduped.get(key);
    const updated = item => Date.parse(item.offer.last_verified_at || item.offer.captured_at || item.list.fetched_at || item.list.fetchedAt || '') || 0;
    if (!previous || Number(entry.list.source === 'direct-shops') > Number(previous.list.source === 'direct-shops') || (entry.list.source === 'direct-shops') === (previous.list.source === 'direct-shops') && updated(entry) > updated(previous)) deduped.set(key, entry);
  }
  const reviews=isGemini(product)?readGeminiReviews().filter(row=>row.productKey===product.key):[];
  return [...deduped.values()].map(entry=>{
    const gemini=isGemini(product)?geminiClassification(entry,reviews):null;
    return {...entry,...(gemini?{gemini}:{}),delivery:gemini?.delivery||offerDelivery(entry.offer),
      rechargeMethod:rechargeMethod(entry.offer),pricingType:offerPricingType(entry.offer),showDelivery:!!product?.deliveryEnabled};
  });
}
/** Complete quotes for one canonical directory product; specs are optional. */
export function directoryQuotes(product, { sort = 'price_asc', channel = 'all', spec = '', currency = '', delivery = 'all', eligibility = 'all', recharge = 'all', purchase = 'all', pricing = 'listed', pricing_type = 'regular', now = Date.now(), merchantBadges = [], xProfiles = [], baseResult } = {}) {
  const priceBasis=pricing==='checkout'?'checkout':'listed';
  const base=baseResult&&quoteBases.get(baseResult);
  const all=base?.product===product?base.all:prepareQuotes(product);
  const deliveries = (isGemini(product)?GEMINI_DELIVERIES:DIRECTORY_DELIVERIES).map(group=>({...group,count:all.filter(entry=>!entry.reference && entry.delivery.kind===group.kind && (channel==='all'||entry.channel?.id===channel) && (!currency||(entry.offer.currency||entry.product.currency)===currency)).length})).filter(group=>group.count);
  const methodScope=all.filter(entry=>!entry.reference && entry.delivery.kind==='recharge' && (channel==='all'||entry.channel?.id===channel) && (!currency||(entry.offer.currency||entry.product.currency)===currency) && (!spec||specKey(entry)===spec));
  const rechargeMethods=RECHARGE_METHODS.map(group=>({...group,count:methodScope.filter(entry=>entry.rechargeMethod.kind===group.kind).length}));
  const activeMethod=product?.deliveryEnabled && delivery==='recharge' ? normalizeRechargeMethod(recharge) : 'all';
  const scope = all.filter(entry=>entry.reference || ((!product?.deliveryEnabled || delivery==='all' || entry.delivery.kind===delivery) && (activeMethod==='all'||isGemini(product)||entry.rechargeMethod.kind===activeMethod) && (!isGemini(product)||eligibility==='all'||entry.gemini.eligibility.kind===eligibility)));
  const specMap = new Map();
  for (const entry of scope) {
    const key = specKey(entry);
    if (!key) continue;
    if (!specMap.has(key)) specMap.set(key, { key, label: entry.offer.comparison_label?.trim() || (entry.reference ? '参考报价 · 规格待确认' : '规格待确认'), count: 0 });
    specMap.get(key).count++;
  }
  const activePricingType = normalizePricingType(pricing_type);
  const baseFiltered = scope.filter(entry => (entry.reference || matchesPurchase(entry.offer.purchase_conditions,purchase)) && (channel === 'all' || entry.channel.id === channel) && (!spec || specKey(entry) === spec) && (!currency || (entry.offer.currency || entry.product.currency) === currency));
  const merchantBasis = baseFiltered.filter(entry => !entry.reference);
  const pricingTypes = PRICING_TYPES.map(group => ({
    ...group,
    count: group.kind === 'all'
      ? merchantBasis.length
      : merchantBasis.filter(entry => matchesPricingType(entry.pricingType, group.kind)).length,
  }));
  const filtered = baseFiltered.filter(entry => entry.reference || matchesPricingType(entry.pricingType, activePricingType));
  let checkoutAvailableCount=0,checkoutExcludedCount=0;
  const entries=filtered.flatMap(entry=>{
    if(entry.reference)return [entry];
    // Revalidate time-bound checkout evidence on every render, including when
    // reusing prepared quotes. Mode switches must never mutate shared offers.
    const quote=checkoutQuote({...entry.offer,source:entry.list.source,currency:entry.offer.currency||entry.product.currency},{now});
    if(quote)checkoutAvailableCount++;else checkoutExcludedCount++;
    if(priceBasis==='checkout'&&!quote)return [];
    const listed=entry.offer.listed_price??entry.offer.price;
    return [{...entry,offer:{...entry.offer,listed_price:listed,price:priceBasis==='checkout'?quote.totalAmount:listed,
      price_basis:priceBasis,checkout_quote:quote,checkout_status:quote?'verified':'unknown'}}];
  });
  entries.sort((a, b) => currencyOrder(a.offer.currency || a.product.currency, b.offer.currency || b.product.currency)
    || (sort === 'comprehensive' ? Number(a.offer.comparison_eligible===false)-Number(b.offer.comparison_eligible===false) : 0)
    || compareCheckoutPrices(a.offer,b.offer,{descending:sort==='price_desc'})
    || (shopKey(a) || destinationKey(a.offer.url)).localeCompare(shopKey(b) || destinationKey(b.offer.url)) || String(a.offer.offer_id).localeCompare(String(b.offer.offer_id)));
  if(isGemini(product))entries.forEach((entry,originalPosition)=>{entry.originalPosition=originalPosition;});
  const merchantEntries = entries.filter(entry => !entry.reference);
  const result={ ...(isGemini(product)?{displayRows:geminiDisplayRows(entries,product,all),eligibilities:GEMINI_ELIGIBILITIES.map(group=>({...group,count:all.filter(entry=>!entry.reference&&entry.gemini.eligibility.kind===group.kind).length}))}:{}),entries, pricing:priceBasis, pricing_type:activePricingType, pricingTypes, checkoutAvailableCount, checkoutExcludedCount, shopCount: new Set(merchantEntries.map(shopKey).filter(Boolean)).size,
    unresolvedQuoteCount: merchantEntries.filter(entry => !shopKey(entry)).length, total: entries.length,
    deliveries, rechargeMethods, specs: [...specMap.values()], currencies: [...new Set(scope.map(entry => entry.offer.currency || entry.product.currency))].sort(currencyOrder) };
  quoteBases.set(result,{product,all});return result;
}

function eligible(list, product, offer) {
  if (retiredCatalogSource(list.source) || retiredCatalogItem(product) || retiredCatalogItem(offer)) return false;
  const currency = offer.currency || product.currency;
  const reference = ['cardnav-official'].includes(list.source);
  return !(offer.quote_stale ?? list.stale) && (isListed(offer) || reference && ['official', 'active'].includes(offer.status))
    && (offer.stock_count ?? offer.stockCount) !== 0
    && offer.price != null && Number.isFinite(Number(offer.price)) && (reference ? Number(offer.price) >= 0 : Number(offer.price) > 0)
    && currencies.has(currency) && offer.comparison_eligible !== false && offer.comparison_known === true
    && typeof offer.comparison_key === 'string' && !!offer.comparison_key && offer.comparison_key !== 'mixed';
}

/** Public projection only: retains original IDs and never mutates stored data. */
export function buildProductDirectory(lists = [], {includeOfficialReferences=false} = {}) {
  const categories = DIRECTORY_CATEGORIES.map(category => ({ ...category, products: [] }));
  const products = new Map();
  // Explicit editorial opt-in: a new category can be discoverable before its
  // first merchant quote, without inventing offers or persisting fake snapshots.
  if(includeOfficialReferences)for(const baseline of OFFICIAL_BASELINES.filter(row=>row.directory)){
    const definition=byId.get(baseline.id);
    if(definition)products.set(definition.key,{definition,entries:[],references:[],officialReference:baseline});
  }
  for (const list of lists.filter(Boolean)) for (const product of list.products || []) {
    const offers = product.offers || (product.selected_offer ? [product.selected_offer] : []);
    // A trusted canonical product remains navigable even when its individual
    // titles cannot establish a valid comparable quote. Search buckets never
    // gain this fallback identity, and this reference carries no quoted price.
    const fallback = definitionFor(list, product, {});
    if (fallback && !products.has(fallback.key)) products.set(fallback.key, { definition: fallback, entries: [], references: [] });
    if (fallback) products.get(fallback.key).references.push({ list, product, offer: null });
    for (const offer of offers) {
      const definition = quoteDefinition(list, product, offer);
      if (!definition) continue;
      if (!products.has(definition.key)) products.set(definition.key, { definition, entries: [], references: [] });
      if (!products.get(definition.key).references.some(entry => entry.list.source === list.source && entry.product.product_id === product.product_id)) products.get(definition.key).references.push({ list, product, offer });
      if (quoteEligible(list, product, offer)) {
        const group = products.get(definition.key);
        (group.quoteEntries ||= []).push({ list, product, offer, channel: offerChannel(offer), reference: ['cardnav-official'].includes(list.source) });
      }
      if (definitionFor(list, product, offer)?.key !== definition.key) continue;
      if (!eligible(list, product, offer)) continue;
      products.get(definition.key).entries.push({ list, product, offer, channel: offerChannel(offer), reference: ['cardnav-official'].includes(list.source) });
    }
  }
  for (const { definition, entries, references, quoteEntries = [], officialReference } of [...products.values()].sort((a, b) => a.definition.rank - b.definition.rank || a.definition.name.localeCompare(b.definition.name))) {
    const groups = new Map();
    for (const entry of entries) {
      const key = JSON.stringify([entry.list.source, entry.product.product_id, entry.offer.comparison_key, entry.offer.currency || entry.product.currency]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const variants = [...groups.values()].filter(group => {
      const entry = group[0];
      if (entry.list.source !== 'ldxp-goods') return true;
      // Existing detail routes select a source/product/spec, not a directory
      // identity. Publishing a mixed search bucket would leak another product.
      return (entry.product.offers || []).filter(offer => offer.comparison_key === entry.offer.comparison_key)
        .every(offer => directoryIdentity(entry.list, entry.product, offer) === definition.key);
    }).map(group => {
      group.sort((a, b) => quoteOrder(a.offer, b.offer));
      const selected = group[0], offers = group.map(entry => entry.offer);
      return { ...selected, alternatives: group.slice(1), product: {
        ...selected.product, offers, selected_offer: selected.offer,
        currency: selected.offer.currency || selected.product.currency,
        comparison_key: selected.offer.comparison_key,
        comparison_label: selected.offer.comparison_label,
        comparable: true, lowest_price: Number(selected.offer.price),
        offer_count: offers.length, in_stock_count: offers.length, stale: false,
      } };
    });
    categories.find(category => category.key === definition.category).products.push({ key: definition.key, name: definition.name, deliveryEnabled:deliveryEnabled(definition), entries, quoteEntries, variants, references: references.filter(entry => entry.list.source !== 'ldxp-goods'), ...(officialReference?{officialReference}:{}) });
  }
  return categories;
}
