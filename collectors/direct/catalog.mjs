import { createHash } from "node:crypto";
import { offerSpec, deliveryForm } from '../../lib/offer-spec.mjs';
import { deliveryEvidence } from '../../lib/delivery-evidence.mjs';
import { retiredCatalogItem } from '../../lib/catalog-policy.mjs';
import { plusCoverageOnly } from '../../lib/plus-coverage.mjs';
import { reviewedProductBrand } from '../../lib/reviewed-product-brands.mjs';
import { hasPro25xTitle } from '../../lib/chatgpt-pro-tier.mjs';
import { subscriptionTerm } from '../../lib/subscription-term.mjs';
import { museSubscriptionTier, isMuseAccount, museAccountTokenTier } from '../../lib/muse-products.mjs';
import { isXSubscription, xSubscriptionTier } from '../../lib/x-subscription-products.mjs';
import { EDUCATION_VERIFICATION_ID, EDUCATION_VERIFICATION_NAME, isEducationVerificationService } from '../../lib/education-verification.mjs';

// 独立维护的小型明确分类表。它只覆盖当前站点实际展示的产品族；规则不确定时
// 返回 null，避免把低价但不同形态的商品错误混入排行榜。
const PRODUCTS = {
  "muse-account": product("muse-account", "Muse 账号", "Muse", "账号", "账号权益与额度以原店说明为准，不推定订阅档位"),
  "muse-account-10b": product("muse-account-10b", "Muse 成品号 · 10 亿 token", "Muse", "账号", "标题明确 10 亿 token 的成品号；不推定订阅档位或期限"),
  "muse-account-300b": product("muse-account-300b", "Muse 成品号 · 300 亿+ token", "Muse", "账号", "标题明确 300 亿或 310 亿 token 的成品号（合并比价，以原店数量为准）；不推定订阅档位或期限"),
  "muse-power": product("muse-power", "Muse Power", "Muse", "订阅/会员"),
  "muse-max": product("muse-max", "Muse Maximum", "Muse", "订阅/会员"),
  [EDUCATION_VERIFICATION_ID]: product(EDUCATION_VERIFICATION_ID, EDUCATION_VERIFICATION_NAME, '其他', '辅助服务', '资格认证服务，不代表已开通订阅；需在原店核对资格、实际权益和额外费用'),
  ...Object.fromEntries(['pro','premier'].flatMap(tier=>[1,3,12].map(months=>[`suno-${tier}-${months}m`,product(`suno-${tier}-${months}m`,`Suno ${tier==='pro'?'Pro':'Premier'} · ${months} 个月`,'Suno','订阅/会员',`${months} 个月；以原店交付说明为准`)]))),
  "chatgpt-go": product("chatgpt-go", "ChatGPT Go", "ChatGPT", "订阅/会员"),
  "chatgpt-plus": product("chatgpt-plus", "ChatGPT Plus", "ChatGPT", "账号/共享"),
  "chatgpt-plus-recharge": product("chatgpt-plus-recharge", "ChatGPT Plus", "ChatGPT", "订阅/会员"),
  "chatgpt-plus-recharge-12m": product("chatgpt-plus-recharge-12m", "ChatGPT Plus · 12 个月", "ChatGPT", "订阅/会员", "12 个月；以原店交付说明为准"),
  // Collector labels stay on the legacy names. Public pages use chatgpt-pro-names.mjs.
  "chatgpt-pro-5x": product("chatgpt-pro-5x", "ChatGPT Pro 5x", "ChatGPT", "订阅/会员"),
  "chatgpt-pro-20x": product("chatgpt-pro-20x", "ChatGPT Pro 20x", "ChatGPT", "订阅/会员"),
  "chatgpt-pro-25x": product("chatgpt-pro-25x", "ChatGPT Pro 25x / Pro 500", "ChatGPT", "订阅/会员"),
  "chatgpt-team-business": product("chatgpt-team-business", "ChatGPT Team / Business", "ChatGPT", "团队席位/账号"),
  "claude-pro-month": product("claude-pro-month", "Claude Pro", "Claude", "订阅/会员"),
  "claude-max-5x": product("claude-max-5x", "Claude Max（原 Max 5x）", "Claude", "订阅/会员"),
  "claude-max-20x": product("claude-max-20x", "Claude Ultra（原 Max 20x）", "Claude", "订阅/会员"),
  "gemini-pro-recharge": product("gemini-pro-recharge", "Gemini / Google AI Pro", "Gemini", "订阅/会员"),
  "gemini-ultra": product("gemini-ultra", "Gemini / Google AI Ultra", "Gemini", "订阅/会员"),
  "gemini-activation-service": product("gemini-activation-service", "Gemini 权限激活服务", "Gemini", "辅助服务", "权限激活服务，不代表完整订阅；需在原店核对适用条件"),
  "gemini-claim-link": product("gemini-claim-link", "Gemini 权益领取链接", "Gemini", "辅助服务", "领取链接，不代表已开通订阅；需在原店核对资格和使用条件"),
  "super-grok": product("super-grok", "Super Grok", "Grok", "订阅/会员"),
  "super-grok-heavy": product("super-grok-heavy", "Super Grok Heavy", "Grok", "订阅/会员"),
  "x-twitter-premium": product("x-twitter-premium", "X Premium", "X", "订阅/会员"),
  "x-twitter-premium-plus": product("x-twitter-premium-plus", "X Premium+", "X", "订阅/会员"),
  ...Object.fromEntries(['plus','premium','super','ultra'].map(tier=>[
    `x-subscription-${tier}`,product(`x-subscription-${tier}`,`X 融合订阅 ${tier[0].toUpperCase()+tier.slice(1)}`,'X 融合订阅','订阅/会员'),
  ])),
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
  "email-accounts": product("email-accounts", "邮箱账号", "邮箱", "账号"),
  // Free/普号/GFree/Codex Free 成品号：独立公开品类，不进 Plus/Pro 主列表。
  "chatgpt-free-account": product("chatgpt-free-account", "ChatGPT 普通账号", "ChatGPT", "账号", "Free/普号/白号/Codex Free 成品账号；标题关键词+价格带；明示无质保仍排除"),
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
    // Retail titles also transpose GPT as GTP. Require an explicit subscription
    // tier; unrelated GTP terms and the original offer text remain unchanged.
    .replace(/\bgtp\b(?=[\s-]+(?:plus\b|pro(?:\b|(?=\d))|go\b|team\b|business\b))/g, 'gpt')
    .trim();
}

function has(text, pattern) {
  return pattern.test(text);
}

// 5 / 20 are the official ChatGPT and Claude steps. 10 is a shop label for one
// Pro plan (Pro 100 unless the title also names $200). Decimals and other
// integers are not a tier.
function multiplierValues(titleText) {
  return [...String(titleText).matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*x(?![\d.])|(?<![a-z\d.])x\s*(\d+(?:\.\d+)?)(?![\d.])/g)].map(match => match[1] || match[2]);
}

// "100/200/500" is already spaces. Listing more than one dollar tier is a menu.
function optionalChatgptProMenu(titleText) {
  if (/(?<![\d.])100\s+200(?:\s+500)?(?![\d.])/.test(titleText)) return true;
  const amounts = new Set([...titleText.matchAll(/(?<![\d.])(100|200|500)(?![\d.])/g)].map(match => match[1]));
  return amounts.size >= 2 && /可选|任选|多档|档位/.test(titleText);
}

function isAccountManagementTool(title) {
  const text=normalized(title)
    // A subscription can include an accessory without becoming that accessory.
    .replace(/(?:附赠|赠送|附带|加赠|免费送)[^。；;]{0,60}(?:管理工具|管理软件|管理程序|管理器)/g,' ');
  return /(?:账号|账户)\s*(?:批量\s*)?管理(?:工具|软件|程序|器)|\baccounts?\s+(?:bulk\s+)?(?:management\s+(?:tool|software)|manager)\b/i.test(text);
}


// ChatGPT / Codex Free 成品号公开品类：关键词命中且不含付费档，并受价格带约束。
// 上限取可维护的宽松带（CNY ≤ 20 / USD·USDT ≤ 5），避免乱价灌入；无价格时仍可按标题归类。
const FREE_ACCOUNT_MAX = Object.freeze({ CNY: 20, RMB: 20, USD: 5, USDT: 5, USDC: 5 });
function freeAccountPriceOk(offer) {
  const price = Number(offer?.price);
  if (!Number.isFinite(price)) return true;
  if (!(price > 0)) return false;
  const currency = String(offer?.currency || "CNY").trim().toUpperCase() || "CNY";
  const max = FREE_ACCOUNT_MAX[currency] ?? FREE_ACCOUNT_MAX.CNY;
  return price <= max;
}
function chatgptFreeAccountTitle(titleText) {
  const plain = titleText
    .replace(/(?:不含|不包含|无|没有|without)\s*(?:any\s+)?(?:plus|pro|会员|付费)/g, " ")
    .replace(/(?:已|未|无需|无须|不需要|免)\s*接码/g, " ");
  // 付费订阅/代充信号：命中则不是 Free 普号品类。
  if (/\bplus(?:\b|(?=\d))|\bpro\b|pro(?=\d)|(?<![\d.])(?:5|20|25|50)\s*x(?![\d.])|(?<![a-z\d.])x\s*(?:5|20)(?![\d.])|\bgo\b(?!\s*ogle)|\bteam\b|\bbusiness\b|月卡|年卡|季卡|周卡|日卡|代充|直充|官网充值|官方充值|订阅/.test(plain)) return false;
  if (/\bapi\b|中转|镜像|额度|积分|余额|兑换码|\bcdk\b/.test(plain)) return false;
  const brand = /(?:chat\s*gpt|openai|\bgpt\b|\bgfree\b|\bcodex\b)/.test(plain);
  const freeMarker = /\bfree\b|\bgfree\b|免费(?:版|账号|号)|普号|白号|普通账号|账号免费版/;
  const codexAccount = /\bcodex\b/.test(plain) && /成品(?:账号|账户|号)|账密|2\s*fa|邮箱|icloud|独享/.test(plain);
  const gptAccount = /(?:chat\s*gpt|\bgpt\b|\bgfree\b)/.test(plain) && /成品(?:账号|账户|号)|普号|白号|免费|icloud|账密|2\s*fa/.test(plain);
  // 必须有 ChatGPT/Codex/GFree 品牌，避免 Cursor/Claude Free 普号误入。
  return brand && (freeMarker.test(plain) || codexAccount || gptAccount);
}
function classifyChatgptFreeAccount(offer, titleText) {
  if (!chatgptFreeAccountTitle(titleText) || !freeAccountPriceOk(offer)) return null;
  return PRODUCTS["chatgpt-free-account"];
}

export function classifyDirectOffer(offer) {
  const { title, category:inputCategory = "", sourceId = "", extra }=offer;
  let category=inputCategory;
  if (retiredCatalogItem({title,category,extra})) return null;
  if (isAccountManagementTool(title)) return null;
  if (isEducationVerificationService(offer)) return PRODUCTS[EDUCATION_VERIFICATION_ID];
  // An explicit unified bundle is never allowed to fall through into its
  // legacy component plans when its own tier is missing or ambiguous.
  if (isXSubscription(offer)) {
    const tier=xSubscriptionTier(offer);
    return tier?PRODUCTS[`x-subscription-${tier}`]:null;
  }
  let evidence={};
  try { evidence=deliveryEvidence((typeof extra==='string'?JSON.parse(extra):extra)?.deliveryEvidence); } catch {}
  // Single-product category evidence survives SQLite storage. Never inherit a
  // parent or another SKU's category when the selected title does not match.
  if(!category&&!evidence.skuTitle&&evidence.productTitle===title)category=evidence.category;
  let titleText = normalized(title);
  // Retail spelling verified against the same product's OpenAI description.
  // A shop notice, another SKU or an arbitrary Plus/Pro title is not evidence.
  const retailGptAlias = /\bg\s+jpt\b/.test(titleText) && !evidence.skuTitle
    && evidence.productTitle === title && evidence.descriptionScope === 'product'
    && /openai|chat\s*gpt|\bgpt\b/.test(normalized(`${evidence.category} ${evidence.description}`))
    && /\bplus\b|\bpro\s*(?:5|20)\s*x\b/.test(titleText);
  if (retailGptAlias) titleText = titleText.replace(/\bg\s+jpt\b/g, 'gpt');
  // A single-SKU iOS code omits X; its own parent must confirm that exact tier.
  const iosTier = /^chat\s*gpt\s+pro(5|20)\s+ios$/.exec(titleText)?.[1];
  if (iosTier && normalized(evidence.skuTitle) === `pro${iosTier} ios`
      && evidence.descriptionScope === 'product'
      && !/claude|gemini|grok|suno|cursor|perplexity|notion|copilot/i.test(evidence.productTitle)
      && classifyDirectOffer({title:evidence.productTitle})?.id === `chatgpt-pro-${iosTier}x`) {
    titleText = `chatgpt pro ${iosTier}x ios`;
  }
  // Do not let a mixed Muse title fall through to another brand classifier.
  const muse = /\bmuse\b/.test(titleText);
  const museTier = museSubscriptionTier(titleText);
  const museAccount = isMuseAccount(titleText);
  if (muse && !museTier && !museAccount) return null;
  const categoryText = normalized(category);
  const text = normalized(`${category} ${title}`);
  if (!text) return null;
  // 推广返利邀请、无交付公告不是零售商品，不能形成接码/API 起价。
  if (/^(?:邀请推广|接马推广|推广)/.test(titleText) && has(titleText, /返利/) && has(titleText, /可提现/)) return null;
  if (titleText === 'codex api 更变') return null;
  // Verified retail spellings of GPT. Do not let an alias turn an
  // explicitly mixed-brand subscription bundle into a single GPT quote.
  const alternateGpt = retailGptAlias || /\bgp\.t\b|\bgtp\b/i.test(String(title ?? '').normalize('NFKC'));
  if (alternateGpt && /claude\s*(?:pro|max|ultra|team)|gemini\s*(?:pro|ultra|plus)|(?:super\s*grok|grok\s*(?:super|heavy|lite))|suno\s*(?:pro|premier)|cursor\s*(?:pro|ultra)|perplexity\s*pro|notion\s*(?:ai|business)|(?:twitter|\bx)\s*(?:premium|basic)|copilot\s*pro|\b(?:canva|midjourney)\b/i.test(titleText)) return null;
  if (/\bsuno\b/.test(titleText)) {
    const months=singleSubscriptionMonths(titleText),tier=/\bpremier\b/.test(titleText)?'premier':/\bpro\b/.test(titleText)?'pro':null;
    return tier?PRODUCTS[`suno-${tier}-${months}m`]??null:null;
  }
  // 注册邮箱只是免费 AI 账号的附带属性；Free/普号归入普通账号品类，不进 Plus。
  if (/^(?:chat\s*gpt|gpt)\s*[- ]*(?:free\b|普号|账号免费版)/.test(titleText)) {
    return classifyChatgptFreeAccount(offer, titleText);
  }
  // 免费账号偶尔附带的付费试用不是保证交付的订阅权益。
  // 限定为免费账号 + 权益不确定，不能误伤随机地区或真实短期 Plus。
  if (has(titleText, /\bfree\b|免费(?:版|账号|号)/) &&
      has(titleText, /(?:少量|部分|随机|概率|不保证|不保障).{0,16}(?:plus|pro|premium|付费|会员)/)) return null;
  // 主商品是 Leonardo 积分账号；兼容 Gemini 图片模型不是 Gemini 订阅。
  if (/^leonardo\b/.test(titleText)) return null;
  // 额度恢复/重置是账号维护服务；宣传中的 Plus / Pro 不代表套餐交付。
  // 明确月卡等套餐附带的周期重置说明仍保留，不使用价格作为判断依据。
  if (has(titleText, /额度\s*(?:自动\s*)?(?:重置|恢复)/) &&
      !has(titleText, /月卡|年卡|季卡|周卡|日卡|\d+\s*(?:个?月|年|天)\s*(?:订阅|会员|套餐)/) &&
      has(titleText, /(?:重置|恢复)\s*服务|联系客服|确认.*资格/)) return null;

  // 邮箱标题经常带有“已注册 OpenAI”等用途说明，需先于订阅关键词判断。
  if (has(titleText, /^google\s*个人邮箱(?:\s|$)|gmail|outlook|hotmail|微软邮箱|谷歌邮箱|邮箱账号|邮箱老号|域名邮箱/) ||
      (has(categoryText, /^邮箱产品$/) && has(titleText, /mail\.com|mail\.tm|rambler|gmx|firstmail/))) {
    return PRODUCTS["email-accounts"];
  }
  // 纯教程/额度说明不是会员报价，避免把低价资料当成代充最低价。
  if (has(titleText, /教程|教学|攻略|邀请额度/) && !has(titleText, /直充|代充|卡密|成品|月卡|年卡|会员|账号/)) {
    return null;
  }
  if (has(titleText, /补差价|差价专用|月年卡|月卡\s*年卡|全家桶|多合一/)) return null;

  // API 商品经常同时提及 Pro / Max 号池，必须先于订阅套餐识别。
  const aiService = /codex|openai|chat\s*gpt|\bgpt\b|\bg[\s-]*plus\b|claude|gemini|\bgrok\b|\bmuse\b/i;
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
  if (((has(titleText, /\bapi\b|中转|镜像站|网页镜像/i) || balanceProduct || monetaryCredits) && has(titleText, aiService)) || has(titleText, /api\s*中转|中转\s*api|api中转站|中转站/i)) {
    return null;
  }

  if (muse) { const tokenTier = museAccount ? museAccountTokenTier(titleText) : null; return PRODUCTS[museAccount?(tokenTier?`muse-account-${tokenTier}`:'muse-account'):`muse-${museTier}`]; }

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
    if (has(titleText, /邀请链接/) && has(titleText, /半价|折扣|优惠/)) return null;
    if (/^api\s+cursor\b/.test(titleText) && has(titleText, /积分|额度/)) return null;
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

  // 标题有品牌时优先认品牌。无 ChatGPT/GPT 字样时，仅在规格明确、无其他品牌、
  // 且有订阅/代充语境时按规格归入 ChatGPT（2026-10-23 站长拍板）。
  // 店铺分类仍只做辅助；其它品牌或无关商品不得借此污染最低价。
  const otherBrand=/claude|cladue|克劳德|gemini|双子座|google|grok|格洛克|格罗克|葛洛克|推特|suno|cursor|perplexity|notion|manus|copilot|microsoft|midjourney|canva|adobe|豆包|即梦|可灵|腾讯|百度|夸克|\bwps\b/i;
  const bareWords=new Set(['plus','pro','max','go','team','business','x','ios','android','web','app','cdk','cdkey','free','usd','cny','usdt','m','month','months','year','years','monthly','yearly','recharge','account']);
  const chatgptTier=/\bplus\b|\bpro\b|pro(?=\d)|team|business|\bgo\b|(?:5|20)\s*x|x\s*(?:5|20)/i;
  // 去掉 24h 这类时长记号后再核英文词，避免误伤无品牌但合法的 Plus/Pro 标题。
  const bareEnglish=(titleText.replace(/\b\d+h\b/g,' ').match(/[a-z]+/g)||[]).every(word=>bareWords.has(word));
  const categoryGpt=has(categoryText,/chat\s*gpt|openai|\bgpt\b|\bgtp\b|\bcodex\b/i)&&!otherBrand.test(categoryText)&&!otherBrand.test(titleText)&&bareEnglish;
  const unbrandedGpt=!otherBrand.test(titleText)&&bareEnglish&&has(titleText,chatgptTier)
    &&has(titleText,/官方(?:正价)?(?:直充|充值)|官网(?:正价)?(?:直充|充值)|直冲个人|充自己(?:的?号)?|代充|直充|月卡|年卡|席位|成品号|自动发货|秒充|一卡一绑|自助充值/);
  const chatgpt = reviewedProductBrand(offer)==='chatgpt' || has(titleText, /chat\s*gpt|openai|\bgpt\b|\bgfree\b|\bg\s*plus\b|\bgplus\b|codex/i) ||
    ((categoryGpt || unbrandedGpt) && has(titleText, chatgptTier)) ||
    (sourceId === "redeemgpt" && categoryText === "cdk" && has(titleText, /1个月plus代充/) && has(titleText, /ios/));
  const claude = has(titleText, /claude|cladue|克劳德/i);
  const gemini = has(titleText, /gemini|google\s*ai|反重力|antigravity/i);
  const grok = has(titleText, /super\s*grok|\bgrok\b|\bgokr\b|\bgork\b|格洛克|格罗克|葛洛克/i);

  if (chatgpt && has(titleText, /不含\s*plus|无\s*plus|without\s+plus/i) && !chatgptFreeAccountTitle(titleText)) return null;
  if (claude && has(titleText, /\bfree\b|免费版/) && !has(titleText, /\bpro\b|max|ultra/i)) return null;
  if (grok && has(titleText, /\bfree\b|免费版|普号|白号/)) return null;
  // 一个标题同时列出 5x 和 20x 时，目录价格无法对应具体 SKU，暂不发布。
  // 倍率必须是完整数字；1.5x、15x、x5.5均不是5x订阅。
  const fiveX = has(titleText, /(?<![\d.])5\s*x(?![\d.])|(?<![a-z\d.])x\s*5(?![\d.])/);
  const twentyX = has(titleText, /(?<![\d.])20\s*x(?![\d.])|(?<![a-z\d.])x\s*20(?![\d.])/);
  if ((chatgpt || claude) && fiveX && twentyX) return null;
  // A legacy 50X title can only use a tier statement from this exact
  // single-product description, never another SKU or a mixed parent listing.
  const tierDescription=normalized(evidence.description);
  const tierStatement=tierDescription.slice(0,160);
  const sameProductPro25 = /(?<![\d.])50\s*x(?![\d.])/.test(titleText)
    && normalized(evidence.productTitle)===normalized(title)
    && ['product','sku'].includes(evidence.descriptionScope)
    && !/本店|全店|提供各类|主营业务|\bfaq\b|常见问题/.test(tierStatement)
    && (hasPro25xTitle(tierStatement)||/(?<![\d.])500\s*(?:美元|美金|美刀|刀|usd)\s*订阅/.test(tierStatement))
    && !/claude|gemini|grok|cursor|perplexity|suno/.test(tierStatement);
  if (chatgpt && (hasPro25xTitle(titleText)||sameProductPro25)) {
    // Mixed tiers/bundles cannot be assigned the price of one selected plan.
    if (fiveX || twentyX || /(?<![\d.])(?:100|200)\s*(?:刀|美金|美元|usd|dollar)|\bpro\s*(?:100|200)(?!\d)|\b(?:plus|go|team|business)\b|claude|gemini|grok|cursor|perplexity|suno/.test(titleText)) return null;
    if (/\bpro(?:max)?\b|pro(?=\d)/.test(titleText) || categoryGpt || /(?:chat\s*gpt|\bgpt)\s+25\s*(?:x|倍)/.test(titleText) || /(?:chat\s*gpt|\bgpt)\s+50\s*x/.test(titleText)) return PRODUCTS['chatgpt-pro-25x'];
  }

  if (chatgpt && has(titleText, /team|business|团队|席位|母号|车位/)) {
    // 僅 json 檔是凭据文件，不是可加入的团队席位，不进席位比价。
    if (/(?:仅|僅)\s*json\b|\bjson\s*(?:档|檔|文件|file)\b/.test(titleText)) return null;
    return PRODUCTS["chatgpt-team-business"];
  }
  if (chatgpt && has(titleText, /\bgo\b/) && !has(titleText, /google|grok/)) {
    return PRODUCTS["chatgpt-go"];
  }
  if (chatgpt && has(titleText, /\bpro\b|pro(?=\d)/)) {
    // 100/200/500 同时可选时，一条价格对不上单一档。
    if (optionalChatgptProMenu(titleText)) return null;
    const multipliers = multiplierValues(titleText);
    const tenX = multipliers.includes("10");
    const strayX = multipliers.some(value => !["5", "10", "20", "25", "50"].includes(value));
    // 10x 和 5x/20x 写在一起，或夹着 6.25x 这类非档位倍率，不能收成一档。
    if ((tenX && (fiveX || twentyX)) || (strayX && (fiveX || twentyX || tenX))) return null;
    // Official Pro 100/200 names (with or without space) map to legacy 5x/20x slots.
    // $200 / 20x → Pro 200。100刀、5x、以及商店常写的 10x → Pro 100。
    // 「可覆盖 plus」不能把 Pro 标题再收进 Plus。
    if (twentyX || has(titleText, /(?:\bpro\s*200\b|200\s*(?:刀|美金|usd|dollar|\$)|\$\s*200(?![\d.]))/)) return PRODUCTS["chatgpt-pro-20x"];
    if (fiveX || has(titleText, /(?:\bpro\s*100\b|100\s*(?:刀|美金|usd|dollar))/)) return PRODUCTS["chatgpt-pro-5x"];
    if (strayX) return null;
    if (tenX || plusCoverageOnly(titleText)) return PRODUCTS["chatgpt-pro-5x"];
  }
  // Accept a confirmed category, unbranded subscription specs, OR the explicit
  // product phrase “GPT 5x/20x”. The latter remains available after storage,
  // where category isn't always retained.
  if (chatgpt && (categoryGpt || unbrandedGpt || has(titleText, /(?:chat\s*gpt|\bgpt)\s+(?:5|20)\s*x(?![\d.])/))) {
    if (twentyX) return PRODUCTS["chatgpt-pro-20x"];
    if (fiveX) return PRODUCTS["chatgpt-pro-5x"];
  }
  // Pro 标题里的 plus 只可能是「可覆盖 plus」，不能再落到 Plus。
  if (chatgpt && has(titleText, /\bplus(?:\b|(?=\d))|g\s*\+/) && !has(titleText, /\bpro\b|pro(?=\d)/)) {
    if (has(titleText, /日抛|周抛|普号|体验|试用|trial|free\s*号/) || ['成品账号', '共享'].includes(deliveryForm({title,category,extra}))) return PRODUCTS["chatgpt-plus"];
    if (singleSubscriptionMonths(titleText) === 12) return PRODUCTS["chatgpt-plus-recharge-12m"];
    return PRODUCTS["chatgpt-plus-recharge"];
  }

  // Official rename: Max 5x → Max ($100), Max 20x → Ultra ($200).
  // Ultra / Max 20x / Max 20（无 x）/ 等同 Max20 / Max 200 归 20x 槽。
  // Max 5x / Max 100 / 写明代充或月卡的 Max 归 5x。完全裸的「claude max」先不归类。
  // 必须在 Pro（含“代充/月卡”）规则之前，避免 Claude Ultra 代充误入 Pro。
  // 1.5x / 6.25x / 15x 等非 5x·20x 倍率仍不归类，不能因标题带 Max 就掉进 5x。
  if (claude && (has(titleText, /\bmax(?:\b|(?=\d))/) || has(titleText, /\bultra\b|\bulrta\b/))) {
    const claudeUltra = has(titleText, /\bultra\b|\bulrta\b/);
    const max200 = has(titleText, /(?:\bmax\s*200\b|(?<![\d.])200\s*(?:刀|美金|美元|usd|dollar))/);
    const max100 = has(titleText, /(?:\bmax\s*100\b|(?<![\d.])100\s*(?:刀|美金|美元|usd|dollar))/);
    const max20 = has(titleText, /\bmax\s*20(?!\d)/);
    const otherMultiplier = multiplierValues(titleText).some(value => value !== "5" && value !== "20");
    if (/^(?:claude|cladue|克劳德)\s+max$/.test(titleText)) return null;
    if (claudeUltra || twentyX || max200 || max20) {
      // 同标题混写 5x 与 Ultra/20x/Max 20 时无法对应单一 SKU。
      if (fiveX) return null;
      return PRODUCTS["claude-max-20x"];
    }
    if (fiveX || max100) return PRODUCTS["claude-max-5x"];
    if (otherMultiplier) return null;
    return PRODUCTS["claude-max-5x"];
  }
  // 6.25x 这类非官方倍率不能只因「订阅 / 月卡 / 代充」落入 Claude Pro。
  if (claude && multiplierValues(titleText).some(value => value !== "5" && value !== "20")) return null;
  // Some storefronts abbreviate Claude Max as “Claude 5x/20x”. Only a
  // confirmed Claude category or explicit Claude multiplier phrase may fill Max;
  // a contradictory explicit Pro label remains unclassified, never Pro-priced.
  if (claude && (fiveX || twentyX)) {
    if (has(titleText, /\bpro\b/) || !(has(categoryText, /claude|anthropic/) || has(titleText, /\bclaude\s+(?:5|20)\s*x(?![\d.])/))) return null;
    return PRODUCTS[twentyX ? 'claude-max-20x' : 'claude-max-5x'];
  }
  if (claude && has(titleText, /\bpro\b|月卡|订阅|直充|代充/)) return PRODUCTS["claude-pro-month"];

  if (gemini && has(titleText, /激活.*权限|权限.*激活/)) return PRODUCTS["gemini-activation-service"];
  if (gemini && has(titleText, /链接/) && !has(titleText, /成品|账号|代充|直充/)) return PRODUCTS["gemini-claim-link"];
  if (gemini && has(titleText, /ultra|\bulrta\b/)) return PRODUCTS["gemini-ultra"];
  if (gemini && has(titleText, /\bpro\b|advanced|plus|会员|年卡|月卡|成品|代充|直充/)) {
    return PRODUCTS["gemini-pro-recharge"];
  }

  // X Premium 套餐可能把 Super Grok 写成附赠权益；主商品仍应归 X。
  if (has(titleText, /(?:^|\s)(?:x|twitter)(?:\s|$|-)|推特/) && has(titleText, /premium|会员|蓝标|蓝\s*v/)) {
    if (has(titleText, /premium\s*(?:\+|➕|plus)/)) return PRODUCTS["x-twitter-premium-plus"];
    return PRODUCTS["x-twitter-premium"];
  }

  if (grok && has(titleText, /heavy/)) return PRODUCTS["super-grok-heavy"];
  // 新版 Grok 档位（Plus $10 / Premium $30 / Super $100 / Ultra $200）即 X 融合订阅档位，
  // 不能与旧版 SuperGrok 混在一页比价。仅单一明确档位 + 1 个月/未注明期限才归档；
  // 多档可选、多月/年付不进入月付档位页。“Super Grok”品牌词本身不算档位。
  if (grok) {
    const tierText = titleText.replace(/super\s*grok/g, " ").replace(/\buitra\b/g, "ultra");
    const tiers = new Set([...tierText.matchAll(/\b(plus|premium|super|ultra)\b/g)].map((m) => m[1]));
    if (tiers.size > 1) return null;
    if (tiers.size === 1) {
      if (has(titleText, /季卡|年卡|年费|年付|一年|半年/)) return null;
      const months = singleSubscriptionMonths(titleText);
      return months === 1 || months === undefined ? PRODUCTS[`x-subscription-${[...tiers][0]}`] : null;
    }
  }
  if (grok && has(titleText, /super|超级|会员|月卡|年卡|成品|代充|直充|充值|cdk|premium/)) return PRODUCTS["super-grok"];

  // API/CDK 必须出现 AI 品牌上下文，或明确写成“API 中转”。
  // 不再因 Twitter 账号的 token 登录、Graph API 等通用词误分类。
  const apiService = /api|中转|额度|点数|token|余额|兑换码|\bcdk\b/i;
  if (has(titleText, /api\s*中转|中转\s*api|api中转站|中转站/i) || (has(titleText, aiService) && has(titleText, apiService))) {
    return null;
  }
  if (has(text, /gmail|outlook|hotmail|微软邮箱|谷歌邮箱|邮箱账号|邮箱老号|域名邮箱/) ||
      (categoryText === "google 邮箱" && has(titleText, /谷歌账号/))) {
    return PRODUCTS["email-accounts"];
  }
  {
    const free = classifyChatgptFreeAccount(offer, titleText);
    if (free) return free;
  }
  return null;
}

// 只识别商品明示的单一期限；不把质保期或多期限选择框当作订阅期限。
function singleSubscriptionMonths(text) {
  const term=subscriptionTerm(text);
  return /^\d+m$/.test(term)?Number(term.slice(0,-1)):term==='ambiguous'?null:undefined;
}

function withoutWarrantyExpiryDisclaimer(text) {
  const duration = String.raw`(?:[1-9]\d*(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(?:个\s*)?(?:小时|分钟|天|日|周|月|年)`;
  const warranty = String.raw`(?:质保|售后|保修)`;
  // A time limit only qualifies an explicit warranty for this product/SKU.
  // Remove the tightly bounded expiry clause before punctuation is normalized;
  // independent blanket disclaimers and the stored source description stay intact.
  if (!new RegExp(`${warranty}\\s*(?:(?:期限|时间|期)\\s*)?(?:为|:|：)?\\s*${duration}|${duration}\\s*${warranty}`).test(text)) return text;
  const denial = String.raw`(?:没有|不提供|不予|不支持|不包|不做|无|不)\s*(?:任何\s*)?${warranty}`;
  return text.replace(new RegExp(`(?:超时|逾期|超期|超过\\s*${duration})\\s*(?:后)?\\s*${denial}(?:\\s*(?:和|及|、)?\\s*${denial})*`, 'g'), '');
}

export function directOfferExclusionReason(raw) {
  if (retiredCatalogItem(raw)) return 'retired_business';
  if (isAccountManagementTool(raw?.title)) return 'non_subscription_tool';
  const status = String(raw?.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const stockCount = raw?.stockCount == null ? null : Number(raw.stockCount);
  if (["out_of_stock", "sold_out", "soldout", "unavailable"].includes(status) || stockCount === 0) {
    return "out_of_stock";
  }

  // Only the selected SKU's bounded evidence is relevant; parent product titles,
  // categories and arbitrary extra fields may describe other variants.
  let evidence = {};
  try { evidence = deliveryEvidence((typeof raw?.extra === 'string' ? JSON.parse(raw.extra) : raw?.extra)?.deliveryEvidence); } catch {}
  const descriptionApplies = ['sku', 'product'].includes(evidence.descriptionScope)
    || (!evidence.descriptionScope && !evidence.skuTitle);
  const traditional = { 質:'质', 後:'后', 無:'无', 沒:'没', 號:'号', 說:'说', 負:'负', 責:'责', 並:'并', 會:'会', 絕:'绝' };
  const warrantyText=[raw?.title, evidence.skuTitle, descriptionApplies ? evidence.description : ''].filter(Boolean).join('。')
    .replace(/[質後無沒號說負責並會絕]/g, char => traditional[char])
    // A complete ban-only exception is not a blanket denial. Keep both sentence
    // boundaries: mixed risks, comma continuations and separate denials remain.
    // This projection never changes the stored source warranty evidence.
    .replace(/(^|[。；;！？!?\n])\s*(?:破甲(?:被)?|被)?封号\s*除外\s*不做\s*售后(?=\s*(?:[。；;！？!?\n]|$))/g, '$1')
    // The same bounded account-ban exception may use “账号封禁” instead of “封号”.
    .replace(/(?:账号|帐号)封禁(?=\s*(?:不提供|不予|没有|无|不)\s*(?:任何\s*)?售后)/g, '封号')
    // Keep punctuation until the bounded ban-only clause is removed. A separate
    // whole-product disclaimer must still exclude the offer, even with warranty elsewhere.
    .replace(/封号(?:\s*(?:\d+(?:\.\d+)?\s*%\s*)?的?原因(?:是)?(?:由于|为)?(?:(?!本商品|所有|任何问题|一律|无论)[^，,。；;！？!?\n]){0,60})?[，,]?\s*(?:不提供|不予|没有|无|不)\s*(?:任何\s*)?售后/g,'');
  const title = normalized(withoutWarrantyExpiryDisclaimer(warrantyText))
    // An explicitly negated disclaimer is not itself a disclaimer.
    .replace(/(?:不是|并非|并不是|非)\s*(?:无\s*(?:任何\s*)?|没有\s*|不提供\s*|不支持\s*|不予\s*|不做\s*|不)(?:质保|售后)/g, '')
    .replace(/封号\s*(?:不质保|不保)(?:\s*不退款)?(?:\s*(?:和|及|、)?\s*(?:不|无)售后)?|封号\s*不售后/g, '');
  if (!title) return null;

  // “封号不质保”是对封禁风险的有限免责，并不等于商品完全无质保；仅在
  // 标题或受控 SKU 描述明确声明整个商品无质保/无售后时排除。
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
  const evidenceOf = extra => { try { return deliveryEvidence((typeof extra === 'string' ? JSON.parse(extra) : extra)?.deliveryEvidence || {}); } catch { return deliveryEvidence({}); } };
  const rows = (offers ?? []).map((offer) => ({
    productId: classifyDirectOffer(offer)?.id ?? null,
    offerId: String(offer.offerId ?? ""),
    sourceId: String(offer.sourceId ?? ""),
    title: String(offer.title ?? ""),
    category: deliveryEvidence({ category: offer.category }).category,
    deliveryEvidence: evidenceOf(offer.extra),
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
