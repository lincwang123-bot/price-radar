import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';
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
      const definition = definitionFor(list, product, offer);
      if (!definition) continue;
      if (!products.has(definition.key)) products.set(definition.key, { definition, entries: [], references: [] });
      if (!products.get(definition.key).references.some(entry => entry.list.source === list.source && entry.product.product_id === product.product_id)) products.get(definition.key).references.push({ list, product, offer });
      if (!eligible(list, product, offer)) continue;
      products.get(definition.key).entries.push({ list, product, offer, channel: offerChannel(offer), reference: ['cardnav-official', 'goaihop-relay'].includes(list.source) });
    }
  }
  for (const { definition, entries, references } of [...products.values()].sort((a, b) => a.definition.rank - b.definition.rank || a.definition.name.localeCompare(b.definition.name))) {
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
    categories.find(category => category.key === definition.category).products.push({ key: definition.key, name: definition.name, entries, variants, references: references.filter(entry => entry.list.source !== 'ldxp-goods') });
  }
  return categories;
}
