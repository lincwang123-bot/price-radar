import { createHash } from "node:crypto";
import { offerSpec, deliveryForm } from '../../lib/offer-spec.mjs';

// 独立维护的小型明确分类表。它只覆盖当前站点实际展示的产品族；规则不确定时
// 返回 null，避免把低价但不同形态的商品错误混入排行榜。
const PRODUCTS = {
  ...Object.fromEntries(['pro','premier'].flatMap(tier=>[1,3,12].map(months=>[`suno-${tier}-${months}m`,product(`suno-${tier}-${months}m`,`Suno ${tier==='pro'?'Pro':'Premier'} · ${months} 个月`,'Suno','订阅/会员',`${months} 个月；以原店交付说明为准`)]))),
  "chatgpt-go": product("chatgpt-go", "ChatGPT Go", "ChatGPT", "订阅/会员"),
  "chatgpt-plus": product("chatgpt-plus", "ChatGPT Plus 成品号/共享", "ChatGPT", "账号/共享"),
  "chatgpt-plus-recharge": product("chatgpt-plus-recharge", "ChatGPT Plus 代充/卡密", "ChatGPT", "订阅/会员"),
  "chatgpt-plus-recharge-12m": product("chatgpt-plus-recharge-12m", "ChatGPT Plus 代充/卡密 · 12 个月", "ChatGPT", "订阅/会员", "12 个月；以原店交付说明为准"),
  "chatgpt-pro-5x": product("chatgpt-pro-5x", "ChatGPT Pro 5x", "ChatGPT", "订阅/会员"),
  "chatgpt-pro-20x": product("chatgpt-pro-20x", "ChatGPT Pro 20x", "ChatGPT", "订阅/会员"),
  "chatgpt-team-business": product("chatgpt-team-business", "ChatGPT Team / Business", "ChatGPT", "团队席位/账号"),
  "claude-pro-month": product("claude-pro-month", "Claude Pro", "Claude", "订阅/会员"),
  "claude-max-5x": product("claude-max-5x", "Claude Max 5x", "Claude", "订阅/会员"),
  "claude-max-20x": product("claude-max-20x", "Claude Max 20x", "Claude", "订阅/会员"),
  "gemini-pro-recharge": product("gemini-pro-recharge", "Gemini / Google AI Pro", "Gemini", "订阅/会员"),
  "gemini-ultra": product("gemini-ultra", "Gemini / Google AI Ultra", "Gemini", "订阅/会员"),
  "gemini-activation-service": product("gemini-activation-service", "Gemini 权限激活服务", "Gemini", "辅助服务", "权限激活服务，不代表完整订阅；需在原店核对适用条件"),
  "gemini-claim-link": product("gemini-claim-link", "Gemini 权益领取链接", "Gemini", "辅助服务", "领取链接，不代表已开通订阅；需在原店核对资格和使用条件"),
  "super-grok": product("super-grok", "Super Grok", "Grok", "订阅/会员"),
  "super-grok-heavy": product("super-grok-heavy", "Super Grok Heavy", "Grok", "订阅/会员"),
  "x-twitter-premium": product("x-twitter-premium", "X Premium", "X", "订阅/会员"),
  "x-twitter-premium-plus": product("x-twitter-premium-plus", "X Premium+", "X", "订阅/会员"),
  ...Object.fromEntries([1, 12, 24].flatMap((months) => [
    [`perplexity-pro-${months}m`, product(`perplexity-pro-${months}m`, `Perplexity Pro · ${months} 个月`, "Perplexity", "订阅/会员", `${months} 个月；以原店交付说明为准`)],
    [`notion-ai-business-${months}m`, product(`notion-ai-business-${months}m`, `Notion AI 商业版 · ${months} 个月`, "Notion AI", "订阅/会员", `${months} 个月；以原店交付说明为准`)],
  ])),
  ...Object.fromEntries([2000, 5000, 10000].map((credits) => [
    `manus-${credits}-credits`, product(`manus-${credits}-credits`, `Manus · ${credits} 积分`, "Manus", "积分/额度", `${credits} 积分；以原店交付说明为准`),
  ])),
  ...Object.fromEntries([["pro", "Pro"], ["pro-plus", "Pro+"], ["ultra", "Ultra"]].flatMap(([id, name]) => [
    [`cursor-${id}`, product(`cursor-${id}`, `Cursor ${name} · 期限未注明`, "Cursor", "订阅/账号", "订阅期限未注明；质保天数不代表订阅周期")],
    [`cursor-${id}-1m`, product(`cursor-${id}-1m`, `Cursor ${name} · 1 个月`, "Cursor", "订阅/账号", "1 个月；以原店交付说明为准")],
  ])),
  "api-cdk-credits": product("api-cdk-credits", "API / CDK / 额度", "API/CDK", "额度/开发服务"),
  "verification-service": product("verification-service", "接码 / 验证服务", "接码", "辅助服务"),
  "email-accounts": product("email-accounts", "邮箱账号", "邮箱", "账号"),
};

function product(id, name, platform, productType, spec = "原始店铺直采") {
  return Object.freeze({ id, name, platform, productType, spec });
}

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bgp\.t\b/g, 'gpt')
    .replace(/[×✕✖]/g, "x")
    .replace(/接碼/g, "接码")
    .replace(/[\u2010-\u2015_\/|【】()[\]（）·:：,，]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function has(text, pattern) {
  return pattern.test(text);
}

export function classifyDirectOffer({ title, category = "", sourceId = "" }) {
  const titleText = normalized(title);
  const categoryText = normalized(category);
  const text = normalized(`${category} ${title}`);
  if (!text) return null;
  // Verified retail spelling of GPT. Do not let this new alias turn an
  // explicitly mixed-brand subscription bundle into a single GPT quote.
  const dottedGpt = /\bgp\.t\b/i.test(String(title ?? '').normalize('NFKC'));
  if (dottedGpt && /claude\s*(?:pro|max|team)|gemini\s*(?:pro|ultra|plus)|(?:super\s*grok|grok\s*(?:super|heavy|lite))|suno\s*(?:pro|premier)|cursor\s*(?:pro|ultra)|perplexity\s*pro|notion\s*(?:ai|business)|\b(?:canva|midjourney)\b/i.test(titleText)) return null;
  if (/\bsuno\b/.test(titleText)) {
    const months=singleSubscriptionMonths(titleText),tier=/\bpremier\b/.test(titleText)?'premier':/\bpro\b/.test(titleText)?'pro':null;
    return tier?PRODUCTS[`suno-${tier}-${months}m`]??null:null;
  }
  // 注册邮箱只是免费 AI 账号的附带属性，不应被当成独立邮箱报价。
  if (/^(?:chat\s*gpt|gpt)\s*[- ]*(?:free\b|普号|账号免费版)/.test(titleText)) return null;

  // 邮箱标题经常带有“已注册 OpenAI”等用途说明，需先于订阅关键词判断。
  if (has(titleText, /gmail|outlook|hotmail|微软邮箱|谷歌邮箱|邮箱账号|邮箱老号|域名邮箱/) ||
      (has(categoryText, /^邮箱产品$/) && has(titleText, /mail\.com|mail\.tm|rambler|gmx|firstmail/))) {
    return PRODUCTS["email-accounts"];
  }
  // “手机号注册”只是账号属性，不等于卖家在提供接码服务。
  if (has(titleText, /接码|接马|验证码|短信验证|\bsms\b|phone\s*(?:number|verify)|手机号\s*(?:接码|验证|接收)/i) ||
      (has(categoryText, /^实卡\s*接码$/) && has(titleText, /手机号/) && has(titleText, /临时|单次/))) {
    return PRODUCTS["verification-service"];
  }
  // 纯教程/额度说明不是会员报价，避免把低价资料当成代充最低价。
  if (has(titleText, /教程|教学|攻略|邀请额度/) && !has(titleText, /直充|代充|卡密|成品|月卡|年卡|会员|账号/)) {
    return null;
  }
  if (has(titleText, /补差价|差价专用|月年卡|月卡\s*年卡|全家桶|多合一/)) return null;

  // API 商品经常同时提及 Pro / Max 号池，必须先于订阅套餐识别。
  const aiService = /codex|openai|chat\s*gpt|\bgpt\b|\bg[\s-]*plus\b|claude|gemini|\bgrok\b/i;
  // “余额支付/余额不足”是结算提示。只有余额为充值对象或紧邻金额时
  // 才作为额度商品证据，且不覆盖明示原厂订阅代充的主商品。
  const originalSubscription = has(titleText, /(?:官方|原厂).*?(?:月订阅|订阅|月卡).*?(?:代充|直充|充值)/);
  const balanceProduct = !originalSubscription && has(titleText,
    /余额\s*(?:充值|兑换|额度)|(?:充值|兑换)\s*余额|\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd)\s*余额(?!\s*(?:支付|不足))|余额\s*\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd)/);
  // 金额额度是服务计费单位；“Max 5x额度”不含货币金额，仍按订阅档位判断。
  const monetaryCredits = has(titleText,
    /\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd)\s*额度|额度\s*\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd)/);
  // 镜像站通行卡和中转余额是第三方服务；CDK本身仅说明交付方式，
  // 不能据此把真实原厂订阅代充一并移出订阅分类。
  if (((has(titleText, /\bapi\b|中转|镜像站/i) || balanceProduct || monetaryCredits) && has(titleText, aiService)) || has(titleText, /api\s*中转|中转\s*api|api中转站|中转站/i)) {
    return PRODUCTS["api-cdk-credits"];
  }

  if (has(titleText, /perplexity/)) {
    if (!has(titleText, /\bpro\b/) && categoryText !== "perplexity pro") return null;
    const months = singleSubscriptionMonths(titleText);
    return PRODUCTS[`perplexity-pro-${months}m`] ?? null;
  }
  if (has(titleText, /notion\s*ai/) && has(titleText, /商业版|business/)) {
    const months = singleSubscriptionMonths(titleText);
    return PRODUCTS[`notion-ai-business-${months}m`] ?? null;
  }
  if (has(titleText, /\bmanus\b/) && has(titleText, /积分|credits/)) {
    const amounts = [...titleText.matchAll(/\d[\d,]*/g)].map((match) => Number(match[0].replaceAll(",", "")));
    return amounts.length === 1 ? PRODUCTS[`manus-${amounts[0]}-credits`] ?? null : null;
  }
  if (has(titleText, /cursor/)) {
    if (has(titleText, /\bfree\b|普号|白号|试用/)) return null;
    const tier = has(titleText, /ultra|ulrta/) ? "ultra"
      : has(titleText, /pro\s*(?:\+|plus|➕)/) ? "pro-plus"
      : has(titleText, /\bpro\b/) || categoryText === "cursor pro" ? "pro" : null;
    if (!tier) return null;
    const months = singleSubscriptionMonths(titleText);
    if (months === 1) return PRODUCTS[`cursor-${tier}-1m`];
    if (months === undefined) return PRODUCTS[`cursor-${tier}`];
    return null;
  }

  // 品牌和套餐必须在商品标题中出现；店铺分类只做辅助信息。
  // 否则某个“ChatGPT Plus”分类下误放的其他品牌商品会污染最低价。
  const chatgpt = has(titleText, /chat\s*gpt|openai|\bgpt\b|\bg\s*plus\b|\bgplus\b|codex/i) ||
    (has(categoryText, /chat\s*gpt|openai/i) && has(titleText, /\bplus\b|\bpro\b|pro(?=\d)|team|business|\bgo\b|(?:5|20)\s*x|x\s*(?:5|20)/i)) ||
    (sourceId === "redeemgpt" && categoryText === "cdk" && has(titleText, /1个月plus代充/) && has(titleText, /ios/));
  const claude = has(titleText, /claude|cladue/i);
  const gemini = has(titleText, /gemini|google\s*ai|反重力|antigravity/i);
  const grok = has(titleText, /super\s*grok|\bgrok\b|\bgokr\b|\bgork\b/i);

  if (chatgpt && has(titleText, /不含\s*plus|无\s*plus|without\s+plus/i)) return null;
  if (claude && has(titleText, /\bfree\b|免费版/) && !has(titleText, /\bpro\b|max/i)) return null;
  if (grok && has(titleText, /\bfree\b|免费版|普号|白号/)) return null;
  // 一个标题同时列出 5x 和 20x 时，目录价格无法对应具体 SKU，暂不发布。
  // 倍率必须是完整数字；1.5x、15x、x5.5均不是5x订阅。
  const fiveX = has(titleText, /(?<![\d.])5\s*x(?![\d.])|(?<![a-z\d.])x\s*5(?![\d.])/);
  const twentyX = has(titleText, /(?<![\d.])20\s*x(?![\d.])|(?<![a-z\d.])x\s*20(?![\d.])/);
  if ((chatgpt || claude) && fiveX && twentyX) return null;

  if (chatgpt && has(titleText, /team|business|团队|席位|母号|车位/)) {
    return PRODUCTS["chatgpt-team-business"];
  }
  if (chatgpt && has(titleText, /\bgo\b/) && !has(titleText, /google|grok/)) {
    return PRODUCTS["chatgpt-go"];
  }
  if (chatgpt && has(titleText, /\bpro\b|pro(?=\d)/)) {
    if (twentyX || has(titleText, /200\s*(?:刀|美金|usd|dollar)/)) return PRODUCTS["chatgpt-pro-20x"];
    if (fiveX || has(titleText, /100\s*(?:刀|美金|usd|dollar)/)) return PRODUCTS["chatgpt-pro-5x"];
  }
  // 部分 Kami 店铺在标题中只写“5x / 20x”，品类名才标明 ChatGPT。
  // 只有品类已经确认品牌时才使用这个补充规则，避免普通数字误分类。
  if (chatgpt && has(categoryText, /chat\s*gpt|openai/i)) {
    if (twentyX) return PRODUCTS["chatgpt-pro-20x"];
    if (fiveX) return PRODUCTS["chatgpt-pro-5x"];
  }
  if (chatgpt && has(titleText, /\bplus(?:\b|(?=\d))|g\s*\+/)) {
    if (has(titleText, /日抛|周抛|普号|体验|试用|trial|free\s*号/) || ['成品账号', '共享'].includes(deliveryForm(titleText))) return PRODUCTS["chatgpt-plus"];
    if (singleSubscriptionMonths(titleText) === 12) return PRODUCTS["chatgpt-plus-recharge-12m"];
    return PRODUCTS["chatgpt-plus-recharge"];
  }

  if (claude && has(titleText, /\bmax(?:\b|(?=\d))/)) {
    if (twentyX) return PRODUCTS["claude-max-20x"];
    if (fiveX) return PRODUCTS["claude-max-5x"];
    // Max 不应因为标题同时含“代充 / 月卡”而掉入 Pro 排行。
    return null;
  }
  if (claude && has(titleText, /\bpro\b|月卡|订阅|直充|代充/)) return PRODUCTS["claude-pro-month"];

  if (gemini && has(titleText, /激活.*权限|权限.*激活/)) return PRODUCTS["gemini-activation-service"];
  if (gemini && has(titleText, /链接/) && !has(titleText, /成品|账号|代充|直充/)) return PRODUCTS["gemini-claim-link"];
  if (gemini && has(titleText, /ultra/)) return PRODUCTS["gemini-ultra"];
  if (gemini && has(titleText, /\bpro\b|advanced|plus|会员|年卡|月卡|成品|代充|直充/)) {
    return PRODUCTS["gemini-pro-recharge"];
  }

  // X Premium 套餐可能把 Super Grok 写成附赠权益；主商品仍应归 X。
  if (has(titleText, /(?:^|\s)(?:x|twitter)(?:\s|$|-)|推特/) && has(titleText, /premium|会员|蓝标|蓝\s*v/)) {
    if (has(titleText, /premium\s*(?:\+|➕|plus)/)) return PRODUCTS["x-twitter-premium-plus"];
    return PRODUCTS["x-twitter-premium"];
  }

  if (grok && has(titleText, /heavy/)) return PRODUCTS["super-grok-heavy"];
  if (grok && has(titleText, /super|会员|月卡|年卡|成品|代充|直充|premium/)) return PRODUCTS["super-grok"];

  // API/CDK 必须出现 AI 品牌上下文，或明确写成“API 中转”。
  // 不再因 Twitter 账号的 token 登录、Graph API 等通用词误分类。
  const apiService = /api|中转|额度|点数|token|余额|兑换码|\bcdk\b/i;
  if (has(titleText, /api\s*中转|中转\s*api|api中转站|中转站/i) || (has(titleText, aiService) && has(titleText, apiService))) {
    return PRODUCTS["api-cdk-credits"];
  }
  if (has(text, /gmail|outlook|hotmail|微软邮箱|谷歌邮箱|邮箱账号|邮箱老号|域名邮箱/) ||
      (categoryText === "google 邮箱" && has(titleText, /谷歌账号/))) {
    return PRODUCTS["email-accounts"];
  }
  return null;
}

// 只识别商品明示的单一期限；不把质保期或多期限选择框当作订阅期限。
function singleSubscriptionMonths(text) {
  const numeral = { 一: 1, 两: 2, 二: 2, 三: 3, 六: 6, 十二: 12 };
  const value = text.replace(/(?:质保|保修|售后)\s*(?:\d+|十二|一|两|二|三|六)\s*(?:天|日|个月|月|年)/g, "").replace(/(?:\d+|十二|一|两|二|三|六)\s*(?:个)?(?:天|日|月|年)\s*(?:质保|保修|售后)/g, '');
  if (/永久|终身|lifetime/.test(value)) return null;
  const months = new Set([...value.matchAll(/(?<![\d])(?:(\d+|十二|一|两|二|三|六)\s*(?:个)?)?(月|年)(?:卡)?/g)]
    .map((match) => (numeral[match[1]] ?? Number(match[1] || 1)) * (match[2] === "年" ? 12 : 1)));
  return months.size === 0 ? undefined : months.size === 1 ? [...months][0] : null;
}

export function directOfferExclusionReason(raw) {
  const status = String(raw?.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const stockCount = raw?.stockCount == null ? null : Number(raw.stockCount);
  if (["out_of_stock", "sold_out", "soldout", "unavailable"].includes(status) || stockCount === 0) {
    return "out_of_stock";
  }

  const title = normalized(raw?.title);
  if (!title) return null;

  // “封号不质保”是对封禁风险的有限免责，并不等于商品完全无质保；仅在
  // 标题明确声明整个商品无质保/无售后时从公开排行排除。
  const withoutBanOnlyDisclaimer = title
    .replace(/不质保\s*封号|封号\s*不质保|不保\s*封号|封号\s*不保/g, "")
    .trim();
  const withoutConditionalAfterSales = title
    .replace(/(?:不看|未看|没看)\s*(?:商品\s*)?说明\s*(?:不予|不做|不提供|无|不)?\s*售后/g, "")
    .replace(/(?:不按|未按|没按)\s*(?:商品\s*)?说明\s*(?:操作\s*)?(?:不予|不做|不提供|无|不)?\s*售后/g, "")
    .trim();
  if (
    /无\s*(?:任何\s*)?质保|没有\s*质保|不提供\s*质保|不予\s*质保|不包\s*质保|不质保/.test(withoutBanOnlyDisclaimer) ||
    /无\s*(?:任何\s*)?售后|没有\s*售后|不会\s*有\s*(?:任何\s*)?售后|不提供\s*售后|不支持\s*售后|拒绝\s*售后|不予\s*售后|不包\s*售后|不做\s*售后|不售后|不可\s*售后|售后\s*概不负责/.test(withoutConditionalAfterSales) ||
    /\b(?:no|without(?:\s+any)?)\s+warrant(?:y|ies)\b|\bwarrant(?:y|ies)\s+(?:is\s+)?not\s+provided\b|\b(?:no|without(?:\s+any)?)\s+after[ -]?sales?(?:\s+(?:service|support))?\b/i.test(title)
  ) {
    return "no_warranty";
  }

  return null;
}

export function groupDirectOffers(rawOffers) {
  const groups = new Map();
  const seen = new Set();
  for (const raw of rawOffers ?? []) {
    if (directOfferExclusionReason(raw)) continue;
    const price = Number(raw?.price);
    if (!raw?.offerId || seen.has(raw.offerId) || !Number.isFinite(price) || price <= 0) continue;
    if (!isHttpUrl(raw.url)) continue;
    const canonical = classifyDirectOffer(raw);
    if (!canonical) continue;
    seen.add(raw.offerId);
    const offer = { ...raw, price, currency: raw.currency || "CNY" };
    if (!groups.has(canonical.id)) groups.set(canonical.id, { canonical, offers: [] });
    groups.get(canonical.id).offers.push(offer);
  }

  return [...groups.values()].map(({ canonical, offers }) => {
    offers.sort(compareOffers);
    const available = offers.filter((offer) => isAvailable(offer.status));
    const dimensions = offers.map(offer => offerSpec(offer,canonical));
    const comparable = dimensions.every(d=>d.known) && new Set(dimensions.map(d=>d.key)).size === 1;
    return {
      productId: canonical.id,
      name: canonical.name,
      platform: canonical.platform,
      productType: canonical.productType,
      spec: canonical.spec,
      lowestPrice: comparable && available.length ? available[0].price : null,
      currency: offers[0]?.currency || "CNY",
      offerCount: offers.length,
      inStockCount: available.length,
      offers,
    };
  }).sort((a, b) => a.platform.localeCompare(b.platform, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
}

export function stableDirectSnapshotId(offers, staleTargetIds = []) {
  const rows = (offers ?? []).map((offer) => ({
    productId: classifyDirectOffer(offer)?.id ?? null,
    offerId: String(offer.offerId ?? ""),
    sourceId: String(offer.sourceId ?? ""),
    title: String(offer.title ?? ""),
    price: Number.isFinite(Number(offer.price)) ? Number(offer.price) : null,
    currency: String(offer.currency ?? ""),
    status: String(offer.status ?? ""),
    stockCount: offer.stockCount == null ? null : Number(offer.stockCount),
    url: String(offer.url ?? ""),
  })).sort((a, b) => a.offerId.localeCompare(b.offerId));
  const stale = [...new Set(staleTargetIds ?? [])].sort();
  const digest = createHash("sha256").update(JSON.stringify({ rows, stale })).digest("hex").slice(0, 20);
  return `direct-${digest}`;
}

function isAvailable(status) {
  return ["in_stock", "available", "online", "low_stock"].includes(String(status ?? "").toLowerCase());
}

function compareOffers(a, b) {
  const rank = (offer) => isAvailable(offer.status) ? 0 : 1;
  return rank(a) - rank(b) || a.price - b.price || String(a.storeName ?? "").localeCompare(String(b.storeName ?? ""), "zh-CN");
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
