import { classifyDirectOffer, directOfferExclusionReason } from '../collectors/direct/catalog.mjs';
import { safeMerchantUrl } from './outbound.mjs';
import { merchantIdForUrl } from './offer-provenance.mjs';
import { offerChannel } from './channels.mjs';
import { isListed, quoteOrder } from './market-view.mjs';

export const DIRECTORY_CATEGORIES = Object.freeze([
  ['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'],
  ['grok', 'Grok'], ['x', 'X'], ['relay', 'API / 中转'], ['mail', '邮箱 / 接码'],
  ['suno', 'Suno'], ['cursor', 'Cursor'], ['perplexity', 'Perplexity'],
  ['notion', 'Notion AI'], ['manus', 'Manus'], ['microsoft', 'Microsoft'], ['other', '其他'],
].map(([key, label], index) => Object.freeze({ key, label, primary: index < 7 })));

// Directory membership is intentionally bounded. A directory group describes a
// product family, never an assertion that its different delivery specs compare.
const definitions = [
  ['chatgpt', 'chatgpt-go', 'ChatGPT Go'],
  ['chatgpt', 'chatgpt-plus', 'ChatGPT Plus', 'chatgpt-plus-recharge', 'chatgpt-plus-recharge-12m'],
  ['chatgpt', 'chatgpt-pro-5x', 'ChatGPT Pro 5x'],
  ['chatgpt', 'chatgpt-pro-20x', 'ChatGPT Pro 20x'],
  ['chatgpt', 'chatgpt-team-business', 'ChatGPT Team / Business'],
  ['claude', 'claude-pro', 'Claude Pro', 'claude-pro-month'],
  ['claude', 'claude-max-5x', 'Claude Max 5x'],
  ['claude', 'claude-max-20x', 'Claude Max 20x'],
  ['gemini', 'gemini-pro', 'Gemini / Google AI Pro', 'gemini-pro-recharge', 'gemini-pro-year', 'gemini-advanced'],
  ['gemini', 'gemini-ultra', 'Gemini / Google AI Ultra', 'gemini-ai-ultra'],
  ['gemini', 'gemini-ai-plus', 'Google AI Plus'],
  ['gemini', 'gemini-activation-service', 'Gemini 权限激活服务'],
  ['gemini', 'gemini-claim-link', 'Gemini 权益领取链接'],
  ['grok', 'super-grok', 'Super Grok', 'grok-supergrok'],
  ['grok', 'super-grok-heavy', 'Super Grok Heavy', 'grok-supergrok-heavy'],
  ['grok', 'grok-supergrok-lite', 'Super Grok Lite'],
  ['x', 'x-basic', 'X Basic'],
  ['x', 'x-twitter-premium', 'X Premium', 'x-premium'],
  ['x', 'x-twitter-premium-plus', 'X Premium+', 'x-premium-plus'],
  ['relay', 'api-cdk-credits', 'API / CDK / 额度'],
  ['mail', 'email-accounts', '邮箱账号'],
  ['mail', 'verification-service', '接码 / 验证服务'],
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
  ...[['gmail-account', 'Gmail / Google 邮箱'], ['icloud-email', 'iCloud 邮箱'], ['outlook-account', 'Outlook / Hotmail 邮箱'], ['email-account', '其他邮箱'], ['education-email', '教育邮箱'], ['google-phone-verification', 'Google / Gemini 接码'], ['openai-phone-verification', 'OpenAI / ChatGPT 接码'], ['paypal-phone-verification', 'PayPal 接码'], ['identity-verification', '真人 / KYC 验证'], ['phone-verification', '通用接码']].map(([key, name]) => ['mail', key, name]),
  ...[['apple-id-account', 'Apple ID / 苹果账号'], ['dreamina-account', 'Dreamina / 即梦'], ['kiro-pro-account', 'Kiro Pro / 额度号'], ['kiro-account', 'Kiro 普通账号'], ['telegram-premium', 'Telegram Premium'], ['telegram-account', 'Telegram 账号'], ['windsurf-account', 'Windsurf 账号'], ['other-product', '其他商品'], ['gift-card', '礼品卡'], ['virtual-card', '虚拟卡']].map(([key, name]) => ['other', key, name]),
];
const byId = new Map();
const byName = new Map();
for (const [rank, [category, key, name, ...aliases]] of definitions.entries()) {
  const definition = { category, key, name, rank };
  for (const id of [key, ...aliases]) byId.set(id, definition);
  byName.set(name.toLowerCase(), definition);
}
const currencies = new Set(['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'TWD', 'JPY', 'KRW', 'SGD', 'AUD', 'CAD', 'INR', 'TRY', 'BRL', 'MYR', 'THB', 'VND', 'IDR', 'CHF', 'AED', 'USDT', 'USDC']);

function definitionFor(list, product, offer) {
  if (list.source === 'goaihop-relay' && /^relay-[a-z0-9-]+$/.test(product.product_id)) return { category: 'relay', key: product.product_id, name: String(product.name || product.product_id), rank: 1000 };
  // Search buckets are not product identities. In particular, do not pass an
  // LDXP bucket/category as classifier context for an unrelated result title.
  const title = String(offer.title || '').trim();
  const trusted = ['direct-shops', 'priceai', 'cardnav-official'].includes(list.source);
  const idDefinition = trusted ? byId.get(product.product_id) : undefined;
  // These are explicitly distinct products outside the direct subscription
  // classifier. Their upstream canonical IDs must not collapse into Plus/Pro.
  if (idDefinition && (list.source === 'cardnav-official' || /account$|email$|verification$/.test(product.product_id) || ['other-product', 'gift-card', 'virtual-card', 'telegram-premium', 'chatgpt-codex-service', 'claude-team-standard', 'claude-team-premium', 'copilot-pro', 'gemini-ai-plus'].includes(product.product_id))) return idDefinition;
  if (title) {
    const classified = classifyDirectOffer({ title, sourceId: offer.source_id || offer.sourceId });
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
function quoteDefinition(list, product, offer) {
  const existing = definitionFor(list, product, offer);
  const canonical = ['direct-shops', 'priceai'].includes(list.source) ? byId.get(product.product_id) : null;
  const title = String(offer.title || '').trim();
  // Match product-bearing brand phrases, not incidental Google email/payment
  // mentions. Multiple explicit subscriptions are bundles, not one identity.
  const brandProducts = [
    /(?:chat\s*gpt|\bgpt\b|openai|\bcodex\b|\bg(?=\s*plus\b))\s*[- ]*(?:plus|pro|go|team|business|free)/i,
    /claude\s*[- ]*(?:pro|max|team)/i,
    /(?:gemini|google\s*(?:ai)?)\s*[- ]*(?:pro|ultra|plus|advanced)/i,
    /(?:super\s*grok|grok\s*(?:super|heavy|lite))/i,
    /(?:twitter|\bx)\s*[- ]*(?:premium|basic)/i,
    /suno\s*[- ]*(?:pro|premier)/i, /cursor\s*[- ]*(?:pro|ultra)/i,
    /perplexity\s*[- ]*pro/i, /notion\s*(?:ai|business)/i,
    /\bmidjourney\b/i, /\bcanva\b/i,
  ];
  if (brandProducts.filter(pattern => pattern.test(title)).length > 1) return undefined;
  // A positive title classification already establishes product identity.
  // The Latin-word guard only constrains inference from a bare tier; applying
  // it again would discard valid aliases and verification-service titles.
  // "Plus 已接码" describes an account attribute, so it still needs the
  // contextual bare-tier path rather than becoming a verification service.
  const explicit = classifyDirectOffer({ title: title.replace(/已接码|已验证/g, ''), sourceId: offer.source_id || offer.sourceId });
  if (existing && explicit) return existing;
  const brands = /chat\s*gpt|\bgpt\b|openai|claude|gemini|google|grok|twitter|\bx\s+(?:premium|basic)|suno|cursor|perplexity|notion|manus|copilot|microsoft/i;
  if (!canonical || !title || brands.test(title)) return existing;
  // A bare tier is useful evidence; generic account/accessory titles aren't.
  if (!/\b(?:plus|pro|go|max|ultra|premium|business|premier)\b/i.test(title)) return existing;
  // Fallback is deliberately limited to bare tiers with delivery/duration
  // text. An unrecognized Latin brand cannot inherit a trusted source's ID.
  const latinWords = title.toLowerCase().match(/[a-z]+/g) || [];
  const allowedWords = new Set(['plus', 'pro', 'go', 'max', 'ultra', 'premium', 'business', 'premier', 'x', 'm', 'd', 'y', 'month', 'months', 'year', 'years', 'day', 'days', 'monthly', 'yearly', 'usd', 'cny', 'usdt', 'usdc', 'cdk', 'cdkey', 'ios', 'android', 'web', 'app', 'code', 'key', 'recharge', 'account']);
  if (latinWords.some(word => !allowedWords.has(word))) return undefined;
  const tierTokens = value => [...value.toLowerCase().matchAll(/\b(?:plus|pro|go|max|ultra|premium|business|premier)\b/g)].map(match => match[0]);
  if (tierTokens(title).some(tier => !tierTokens(canonical.name).includes(tier))) return existing;
  const contextual = classifyDirectOffer({ title: `${canonical.name} ${title.replace(/已接码|已验证/g, '')}`, sourceId: offer.source_id || offer.sourceId });
  return contextual && byId.get(contextual.id)?.key === canonical.key ? canonical : existing;
}

function quoteEligible(list, product, offer) {
  const reference = ['cardnav-official', 'goaihop-relay'].includes(list.source);
  return !(offer.quote_stale ?? list.stale)
    && (isListed(offer) || reference && ['official', 'active'].includes(offer.status))
    && !directOfferExclusionReason({ ...offer, stockCount: offer.stock_count ?? offer.stockCount })
    && offer.price != null && Number.isFinite(Number(offer.price))
    && (reference ? Number(offer.price) >= 0 : Number(offer.price) > 0)
    && currencies.has(offer.currency || product.currency) && !!safeMerchantUrl(offer.url);
}

const specKey = entry => entry.offer.comparison_known === true && entry.offer.comparison_key && entry.offer.comparison_key !== 'mixed' ? entry.offer.comparison_key : '';
function destinationKey(value) {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
function is16688SingleProduct(destination) {
  const url = new URL(destination);
  // Only this verified route identifies one SKU. Unknown queries may select a
  // variant; other storefronts often sell multiple variants at a shared URL.
  return url.origin === 'https://16688.com.cn'
    && /^\/goods\/G\d+$/.test(url.pathname) && !url.search;
}
function shopKey(entry) {
  // Current adapters expose no verified shared-platform merchant IDs. Names,
  // payload IDs and distinct product destinations never establish shop count.
  return merchantIdForUrl(entry.offer.url);
}
const currencyOrder = (a, b) => Number(b === 'CNY') - Number(a === 'CNY') || a.localeCompare(b);

/** Complete quotes for one canonical directory product; specs are optional. */
export function directoryQuotes(product, { sort = 'price_asc', channel = 'all', spec = '', currency = '' } = {}) {
  const deduped = new Map();
  for (const entry of product?.quoteEntries || product?.entries || []) {
    if (!quoteEligible(entry.list, entry.product, entry.offer)) continue;
    const knownSpec = specKey(entry);
    const destination = destinationKey(entry.offer.url);
    const dimension = is16688SingleProduct(destination) ? '16688-single-product' : knownSpec || String(entry.offer.title || '');
    const key = JSON.stringify([!!entry.reference, destination, dimension, entry.offer.currency || entry.product.currency]);
    const previous = deduped.get(key);
    const updated = item => Date.parse(item.offer.last_verified_at || item.offer.captured_at || item.list.fetched_at || item.list.fetchedAt || '') || 0;
    if (!previous || Number(entry.list.source === 'direct-shops') > Number(previous.list.source === 'direct-shops') || (entry.list.source === 'direct-shops') === (previous.list.source === 'direct-shops') && updated(entry) > updated(previous)) deduped.set(key, entry);
  }
  const all = [...deduped.values()];
  const specMap = new Map();
  for (const entry of all) {
    const key = specKey(entry);
    if (!key) continue;
    if (!specMap.has(key)) specMap.set(key, { key, label: entry.offer.comparison_label || key, count: 0 });
    specMap.get(key).count++;
  }
  const entries = all.filter(entry => (channel === 'all' || entry.channel.id === channel) && (!spec || specKey(entry) === spec) && (!currency || (entry.offer.currency || entry.product.currency) === currency));
  entries.sort((a, b) => currencyOrder(a.offer.currency || a.product.currency, b.offer.currency || b.product.currency)
    || (Number(a.offer.price) - Number(b.offer.price)) * (sort === 'price_desc' ? -1 : 1)
    || (shopKey(a) || destinationKey(a.offer.url)).localeCompare(shopKey(b) || destinationKey(b.offer.url)) || String(a.offer.offer_id).localeCompare(String(b.offer.offer_id)));
  const merchantEntries = entries.filter(entry => !entry.reference);
  return { entries, shopCount: new Set(merchantEntries.map(shopKey).filter(Boolean)).size,
    unresolvedQuoteCount: merchantEntries.filter(entry => !shopKey(entry)).length, total: entries.length,
    specs: [...specMap.values()], currencies: [...new Set(all.map(entry => entry.offer.currency || entry.product.currency))].sort(currencyOrder) };
}

function eligible(list, product, offer) {
  const currency = offer.currency || product.currency;
  const reference = ['cardnav-official', 'goaihop-relay'].includes(list.source);
  return !(offer.quote_stale ?? list.stale) && (isListed(offer) || reference && ['official', 'active'].includes(offer.status))
    && (offer.stock_count ?? offer.stockCount) !== 0
    && offer.price != null && Number.isFinite(Number(offer.price)) && (reference ? Number(offer.price) >= 0 : Number(offer.price) > 0)
    && currencies.has(currency) && offer.comparison_known === true
    && typeof offer.comparison_key === 'string' && !!offer.comparison_key && offer.comparison_key !== 'mixed';
}

/** Public projection only: retains original IDs and never mutates stored data. */
export function buildProductDirectory(lists = []) {
  const categories = DIRECTORY_CATEGORIES.map(category => ({ ...category, products: [] }));
  const products = new Map();
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
        (group.quoteEntries ||= []).push({ list, product, offer, channel: offerChannel(offer), reference: ['cardnav-official', 'goaihop-relay'].includes(list.source) });
      }
      if (definitionFor(list, product, offer)?.key !== definition.key) continue;
      if (!eligible(list, product, offer)) continue;
      products.get(definition.key).entries.push({ list, product, offer, channel: offerChannel(offer), reference: ['cardnav-official', 'goaihop-relay'].includes(list.source) });
    }
  }
  for (const { definition, entries, references, quoteEntries = [] } of [...products.values()].sort((a, b) => a.definition.rank - b.definition.rank || a.definition.name.localeCompare(b.definition.name))) {
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
    categories.find(category => category.key === definition.category).products.push({ key: definition.key, name: definition.name, entries, quoteEntries, variants, references: references.filter(entry => entry.list.source !== 'ldxp-goods') });
  }
  return categories;
}
