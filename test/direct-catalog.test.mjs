import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDirectOffer,
  directOfferExclusionReason,
  groupDirectOffers,
  stableDirectSnapshotId,
} from "../collectors/direct/catalog.mjs";

test('confirmed Claude category with a single multiplier never falls into Pro',()=>{
 for(const [multiplier,expected] of [['5x','claude-max-5x'],['20x','claude-max-20x']]){
  assert.equal(classifyDirectOffer({title:`Claude ${multiplier} · 1个月 · 代充`,category:'Claude'})?.id,expected);
  assert.equal(classifyDirectOffer({title:`Claude Pro ${multiplier} 代充`,category:'Claude'}),null);
 }
 assert.equal(classifyDirectOffer({title:'Claude 5x/20x 代充',category:'Claude'}),null);
 assert.equal(classifyDirectOffer({title:'Claude 礼包 5x 代充',category:'未核对'}),null);
});

const cases = [
  ["GPT PLUS 充值卡密(IOS美区质保)", "ChatGPT", "chatgpt-plus-recharge"],
  ["ChatGPT Plus年卡 正价订阅 IOS CDK", "ChatGPT", "chatgpt-plus-recharge-12m"],
  ["ChatGPT plus-月卡 独享 成品号", "ChatGPT", "chatgpt-plus"],
  ["GPT PRO 5X 菲区代充1个月", "ChatGPT", "chatgpt-pro-5x"],
  ["GPT PRO X20 菲区代充1个月", "ChatGPT", "chatgpt-pro-20x"],
  ["ios x5自助充值卡密", "ChatGPT正规付款自助卡密", "chatgpt-pro-5x"],
  ["ChatGPT Pro200刀版本（官网直充）", "ChatGPT", "chatgpt-pro-20x"],
  ["48月 GPT Business Standard 标准席位", "ChatGPT", "chatgpt-team-business"],
  ["Claude Pro直充月卡", "Claude", "claude-pro-month"],
  ["Claude Max 20X直充月卡", "Claude", "claude-max-20x"],
  ["Claude Max X5 代充", "CDK", "claude-max-5x"],
  ["Claude Max X20 代充", "CDK", "claude-max-20x"],
  ["Claude Ultra 直充月卡", "Claude", "claude-max-20x"],
  ["Claude Ultra 代充", "CDK", "claude-max-20x"],
  ["Claude Max 代充月卡", "Claude", "claude-max-5x"],
  ["Claude Max 100刀 官方订阅", "Claude", "claude-max-5x"],
  ["Claude Max 200刀 官方订阅", "Claude", "claude-max-20x"],
  ["Gemini Pro 12个月成品号", "Gemini", "gemini-pro-recharge"],
  ["Gemini Ultra 独享月卡", "Gemini", "gemini-ultra"],
  ["全自动激活 Gemini pro 和antigravity 权限", "Gemini", "gemini-activation-service"],
  ["Gemini Pro 3个月链接", "Gemini", "gemini-claim-link"],
  ["Super Grok Heavy 月卡", "Grok", "super-grok-heavy"],
  ["X Premium+ 年卡", "X", "x-twitter-premium-plus"],
  ["X-Twitter Premium+自助卡密（赠送Super Grok）", "X", "x-twitter-premium-plus"],
  ["Codex 点数额度充值", "ChatGPT", undefined],
  ["Gmail 老号带辅助邮箱", "邮箱", "email-accounts"],
  ["【Google个人邮箱】3个月新号｜2FA＋原手机号链接", "", "email-accounts"],
  ["【Google个人邮箱】新号新号，账号+密码", "", "email-accounts"],
];

test("明确的原店商品映射到稳定产品分类", () => {
  for (const [title, category, expected] of cases) {
    assert.equal(classifyDirectOffer({ title, category })?.id, expected, title);
  }
});

test("扩充原店标题写法，且 API 与组合套餐不冒充高价订阅", () => {
  for (const [title, category, expected] of [
    ["Claude 正价Max5X", "Claude", "claude-max-5x"],
    ["Claude 正价Max20X", "Claude", "claude-max-20x"],
    ["Claude Max", "Claude", undefined],
    ["Claude Ultra", "Claude", "claude-max-20x"],
    ["Claude Max Ultra 代充", "Claude", "claude-max-20x"],
    ["【质保30天】GPT PRO 20× 正规代充", "ChatGPT", "chatgpt-pro-20x"],
    ["ChatGPT plus30天会员", "ChatGPT", "chatgpt-plus-recharge"],
    ["Mail.tm长效邮箱", "邮箱产品", "email-accounts"],
    ["满年谷歌账号", "Google 邮箱", "email-accounts"],
    ["推特蓝V-Premium一个月", "推特电报会员服务", "x-twitter-premium"],
    ["推特蓝V-Premium➕ 一个月", "推特电报会员服务", "x-twitter-premium-plus"],
    ["100刀Codex API中转额度(纯Pro号池)", "ChatGPT业务", undefined],
    ["AI平台直充100美元额度-Claude Opus / Max / 官API", "Claude API", undefined],
  ]) assert.equal(classifyDirectOffer({title, category})?.id, expected, title);
  for (const title of ["Claude MAX5x/20x 官方订阅", "Claude Max 5x Ultra 代充", "GPT Pro 5x 和 20x 版本", "GPT PLUS 月年卡", "GPT PLUS 月卡/年卡"]) {
    assert.equal(classifyDirectOffer({title, category:'ChatGPT'}) , null, title);
  }
  const titled = {title:'1个月PLUS代充 订阅质保 IOS 渠道', category:'CDK'};
  assert.equal(classifyDirectOffer({...titled,sourceId:'redeemgpt'})?.id, 'chatgpt-plus-recharge');
  // 2026-10-23：无品牌也可按规格归类；代充语境下非 redeemgpt 来源同样归 Plus。
  assert.equal(classifyDirectOffer({...titled,sourceId:'unknown'})?.id, 'chatgpt-plus-recharge');
});

test("新 AI 品类按套餐、期限和额度区分，不从质保天数推断订阅周期", () => {
  for (const [title, category, expected] of [
    ['Perplexity Pro 自助充值月卡','Perplexity','perplexity-pro-1m'],
    ['perplexity-年卡-独享','perplexity pro','perplexity-pro-12m'],
    ['perplexity pro-两年卡-独享','perplexity pro','perplexity-pro-24m'],
    ['NotionAI商业版-月卡','Notion AI','notion-ai-business-1m'],
    ['NotionAI商业版-年卡','Notion AI','notion-ai-business-12m'],
    ['NotionAI商业版-两年卡','Notion AI','notion-ai-business-24m'],
    ['Manus-2000积分','Manus','manus-2000-credits'],
    ['Manus-5000积分','Manus','manus-5000-credits'],
    ['Manus-10000积分','Manus','manus-10000-credits'],
    ['Cursor月卡--质保','Cursor Pro','cursor-pro-1m'],
    ['cursor pro 20美刀成品会员账号【质保28天】','cursor','cursor-pro'],
    ['cursor pro+ 60美刀成品会员账号【质保28天】','cursor','cursor-pro-plus'],
    ['cursor ulrta 200美刀成品会员账号【质保28天】','cursor','cursor-ultra'],
  ]) assert.equal(classifyDirectOffer({title,category})?.id,expected,title);
  for (const title of ['Perplexity Pro 永久卡', 'Perplexity Pro 月卡/年卡', 'Manus-2000/5000积分', 'Cursor Free 普号', 'NotionAI商业版-永久卡', '五大AI全家桶年卡(包含gemini pro,perplexity pro,claude pro)']) {
    assert.equal(classifyDirectOffer({title}),null,title);
  }
  assert.equal(classifyDirectOffer({title:'Claude 普号Google邮箱注册',category:'Claude'}),null);
  assert.equal(classifyDirectOffer({title:'mail.com邮箱 普号注册专用',category:'邮箱产品'})?.id,'email-accounts');
});

test("无品牌标题可按明确规格归类，无关商品不乱归", () => {
  for (const [title, expected] of [
    ["30秒到账plus官方充值月卡（质保30天）----直冲个人账号---自动发货-(24h全自动充值)----限时优惠", "chatgpt-plus-recharge"],
    ["🔥【官网正价直充】菲区 Plus 1个月｜ 质保30天售后同步官方 充自己号｜带官方发票账单｜24H全自动秒充", "chatgpt-plus-recharge"],
    ["一卡一绑【官网直充】（质保30天）pro5x 1个月会员充自己号", "chatgpt-pro-5x"],
    ["【官网正价直充】菲区 Pro200 20x 质保30天售后同步官方 充自己号（1号1卡1付）", "chatgpt-pro-20x"],
    ["【官网正价直充】Go 1个月｜自己号直充｜拍下立刻可充｜官方账单收据｜24H全自动｜30天售后同步官方", "chatgpt-go"],
    ["Business/Team席位 plus平替 质保30天 长期稳定 可续费 标准版", "chatgpt-team-business"],
    ["一卡一绑【官网直充】（质保30天） 200刀（20x） 1个月会员充自己号", "chatgpt-pro-20x"],
    ["plus成品号得资询客服，85一个，质保30天", "chatgpt-plus"],
  ]) assert.equal(classifyDirectOffer({ title })?.id, expected, title);

  for (const title of [
    "plus 会员 超市",
    "pro 鼠标垫",
    "Adobe Premiere Pro 月卡",
    "Canva Pro 年费",
    "Netflix Premium Plus",
    "500刀的咨询客服，5分钟就能到账",
    "plus升级pro，需要咨询客服",
  ]) assert.equal(classifyDirectOffer({ title }), null, title);
});

test("库存紧张属于可购买报价，且新类别仍排除售罄与无质保商品", () => {
  const products=groupDirectOffers([
    {...offer('low','Perplexity Pro 代充月卡',36,'low_stock'),stockCount:null},
    offer('sold','Perplexity Pro 代充月卡',1,'out_of_stock'),
    offer('bare','Perplexity Pro 代充月卡 无质保',2,'in_stock'),
  ]);
  assert.equal(products.length,1);
  assert.equal(products[0].lowestPrice,36);
  assert.equal(products[0].inStockCount,1);
  assert.equal(products[0].offerCount,1);
});

test("无法可靠识别的商品不进入公开排行", () => {
  assert.equal(classifyDirectOffer({ title: "打赏", category: "其他" }), null);
  assert.equal(classifyDirectOffer({ title: "节点加速教程", category: "教程" }), null);
  assert.equal(classifyDirectOffer({ title: "0 刀虚拟卡手搓 G Plus 教程", category: "ChatGPT Plus" }), null);
  assert.equal(classifyDirectOffer({ title: "Claude 成品账号 Free 版", category: "Claude Pro" }), null);
  assert.equal(classifyDirectOffer({ title: "Grok 普号 | 成品帐密SSO | 可生图", category: "Grok" }), null);
  assert.equal(classifyDirectOffer({ title: "Gpt-Free普号 | 账密 AT | outlook邮箱", category: "GPT", price: 0.4, currency: "CNY" })?.id, "chatgpt-free-account");
  assert.equal(classifyDirectOffer({ title: "Gpt-Free普号 | 账密 AT | outlook邮箱", category: "GPT", price: 88, currency: "CNY" }), null);
  assert.equal(classifyDirectOffer({ title: "Claude Max 代充（倍数未注明）", category: "Claude" })?.id, "claude-max-5x");
  assert.equal(classifyDirectOffer({ title: "豆包专业版一个月 VIP 会员", category: "ChatGPT Plus" }), null);
  assert.equal(classifyDirectOffer({ title: "Instagram账号新建，手机号注册，开通2FA", category: "账号" }), null);
  assert.equal(classifyDirectOffer({ title: "推特老号｜邮箱可用｜token登录", category: "社交账号" }), null);
  assert.equal(classifyDirectOffer({ title: "Graph Api", category: "Outlook 邮箱" }), null);
});

test("邮箱和试用号不被冒充为 Plus 代充", () => {
  assert.equal(
    classifyDirectOffer({ title: "全新微软邮箱，已注册好 OpenAI（不含 Plus）", category: "ChatGPT Plus" })?.id,
    "email-accounts",
  );
  assert.equal(
    classifyDirectOffer({ title: "Plus 试用资格 Free 号", category: "ChatGPT Plus" })?.id,
    "chatgpt-plus",
  );
});

test("售罄报价不进入公开聚合", () => {
  const products = groupDirectOffers([
    offer("a", "GPT PLUS 充值卡密", 120, "in_stock"),
    offer("b", "GPT PLUS 充值卡密", 2, "out_of_stock"),
    offer("c", "GPT PLUS 充值卡密", 110, "in_stock"),
  ]);
  assert.equal(products.length, 1);
  assert.equal(products[0].lowestPrice, null); // 期限未注明，仅展示原始报价。
  assert.equal(products[0].offerCount, 2);
  assert.equal(products[0].inStockCount, 2);
  assert.deepEqual(products[0].offers.map((item) => item.offerId), ["c", "a"]);
});

test("明确无质保或无售后的报价不进入公开排行", () => {
  const products = groupDirectOffers([
    offer("a", "GPT PRO 20X 直冲卡密（无任何质保）", 348, "in_stock"),
    offer("b", "GPT PRO 20X 菲区代充1个月", 1050, "in_stock"),
    offer("c", "GPT PRO 20X 囤卡超5天不退", 1060, "in_stock"),
  ]);
  assert.equal(products.length, 1);
  assert.equal(products[0].productId, "chatgpt-pro-20x");
  assert.equal(products[0].lowestPrice, null); // 一个月代充不能与未注明周期的囤卡商品比总价。
  assert.deepEqual(products[0].offers.map((item) => item.offerId), ["b", "c"]);
});

test("过滤规则保留有限封号免责，拒绝明确无保障商品", () => {
  assert.equal(directOfferExclusionReason(offer("a", "Claude Pro 月卡", 120, "out_of_stock")), "out_of_stock");
  assert.equal(directOfferExclusionReason(offer("b", "Claude Pro 月卡", 120, "in_stock", undefined, 0)), "out_of_stock");
  assert.equal(directOfferExclusionReason(offer("b2", "Claude Pro 月卡", 120, "in_stock", undefined, "0")), "out_of_stock");
  assert.equal(directOfferExclusionReason(offer("c", "Claude Pro 独享月卡 无质保", 120, "in_stock")), "no_warranty");
  assert.equal(directOfferExclusionReason(offer("d", "Claude Pro 囤货无售后", 120, "in_stock")), "no_warranty");
  assert.equal(directOfferExclusionReason(offer("e", "Claude Pro no warranty", 120, "in_stock")), "no_warranty");
  assert.equal(directOfferExclusionReason(offer("e2", "Claude Pro 首登成功后不会有任何售后和补偿", 120, "in_stock")), "no_warranty");
  assert.equal(directOfferExclusionReason(offer("f", "Claude Pro 质保订阅，不质保封号", 120, "in_stock")), null);
  assert.equal(directOfferExclusionReason(offer("g", "Claude Pro 囤卡超5天不退", 120, "in_stock")), null);
  assert.equal(directOfferExclusionReason(offer("h", "Claude Pro 正常使用售后48小时，不看说明不售后", 120, "in_stock")), null);
  assert.equal(directOfferExclusionReason(offer("i", "Claude Pro 未按说明操作不售后", 120, "in_stock")), null);
});

test("快照 ID 与输入顺序和抓取时间无关，但价格变化会改变", () => {
  const a = offer("a", "Claude Pro直充月卡", 128, "in_stock", "2026-09-05T00:00:00Z");
  const b = offer("b", "Claude Pro直充月卡", 130, "in_stock", "2026-09-05T00:00:00Z");
  const first = stableDirectSnapshotId([a, b], []);
  const reordered = stableDirectSnapshotId([{ ...b, capturedAt: "2026-09-05T01:00:00Z" }, { ...a, capturedAt: "2026-09-05T01:00:00Z" }], []);
  const changed = stableDirectSnapshotId([a, { ...b, price: 129 }], []);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  const categoryDependent = {...a, title: "ios x5自助充值卡密", category: "ChatGPT"};
  assert.notEqual(stableDirectSnapshotId([categoryDependent]), stableDirectSnapshotId([{...categoryDependent, category: "其他"}]));
});

function offer(id, title, price, status, capturedAt = "2026-09-05T00:00:00Z", stockCount) {
  return {
    offerId: id,
    sourceId: "fixture",
    sourceName: "Fixture",
    storeName: "Fixture",
    title,
    category: "ChatGPT",
    price,
    currency: "CNY",
    status,
    stockCount: stockCount ?? (status === "in_stock" ? 1 : 0),
    url: `https://example.com/item/${id}`,
    capturedAt,
  };
}

test("ChatGPT Free/Codex Free 成品号进普通账号品类，不进 Plus/Pro，超价格带或无质保仍排除", () => {
  const freeId = "chatgpt-free-account";
  for (const title of [
    "已接🐎成品账号丨Codex Free 普号｜iCloud 邮箱｜量大管饱",
    "【已接马】Codex | 账密带2FA丨icloud邮箱丨支持6-luna",
    "GFree-iCloud格式：邮箱---账密---2FA丨未接马丨一号一住宅IP",
    "ChatGPT Free 成品号 已接码",
    "Gpt-Free普号 | 账密 AT | outlook邮箱",
  ]) {
    assert.equal(classifyDirectOffer({ title, price: 0.4, currency: "CNY" })?.id, freeId, title);
    assert.notEqual(classifyDirectOffer({ title, price: 0.4, currency: "CNY" })?.id, "chatgpt-plus");
    assert.notEqual(classifyDirectOffer({ title, price: 0.4, currency: "CNY" })?.id, "chatgpt-plus-recharge");
  }
  // 价格带：CNY > 20 不收录到普通账号品类
  assert.equal(classifyDirectOffer({ title: "Codex Free 普号 iCloud", price: 21, currency: "CNY" }), null);
  // 付费档仍走原规则
  assert.equal(classifyDirectOffer({ title: "ChatGPT Plus 月卡 官方直充", price: 88 })?.id, "chatgpt-plus-recharge");
  assert.equal(classifyDirectOffer({ title: "Codex ProMax 500刀 1个月 正价代充", price: 500 })?.id, "chatgpt-pro-25x");
  // 明示无质保仍排除
  assert.equal(directOfferExclusionReason({ title: "GFree 未接码", extra: { deliveryEvidence: { description: "特价商品，无任何质保，购买即视为接受", descriptionScope: "product", productTitle: "GFree 未接码" } } }), "no_warranty");
  // 他牌 Free 仍不收录
  assert.equal(classifyDirectOffer({ title: "Claude 成品账号 Free 版", category: "Claude Pro" }), null);
  assert.equal(classifyDirectOffer({ title: "Cursor Free 普号" }), null);
  assert.equal(classifyDirectOffer({ title: "Grok 普号 | 成品帐密SSO | 可生图", category: "Grok" }), null);
});

test("站长拍板的档位样例：非官方倍率、Pro 10X、Max 20、多档可选与 json 档", () => {
  const id = title => classifyDirectOffer({ title })?.id;
  // 无 Max/Ultra/5x/20x 时，6.25X 不能只因「订阅」落入 Claude Pro。
  for (const title of ["Claude 6.25X【质保订阅】", "Claude 6.25X 质保订阅", "Claude Pro 6.25X 订阅"]) {
    assert.equal(id(title), undefined, title);
  }
  assert.equal(id("Claude Pro直充月卡"), "claude-pro-month");
  assert.equal(id("Claude Max 5x 代充月卡"), "claude-max-5x");
  assert.equal(id("Claude Max 20x 代充月卡"), "claude-max-20x");

  // Pro 10X 的「可覆盖 plus」不是 Plus；无 $200 时归 Pro 100。$200 仍是 Pro 200。
  for (const title of ["ChatGPT Pro 10X 可覆盖plus", "ChatGPT Pro 10X …可覆盖plus", "ChatGPT Pro 10X"]) {
    assert.equal(id(title), "chatgpt-pro-5x", title);
  }
  assert.equal(id("GPT Pro 100刀 10x"), "chatgpt-pro-5x");
  assert.equal(id("PRO 10X 200$ 官方充值月卡"), "chatgpt-pro-20x");
  assert.equal(id("ChatGPT Pro 5x 可覆盖plus"), "chatgpt-pro-5x");
  assert.equal(id("ChatGPT Plus 代充【可覆盖iOS】"), "chatgpt-plus-recharge");

  // Max 20 / 等同 Max20 没有 x，仍是 Ultra（20x），不是默认 5x。
  for (const title of ["Claude Max 20", "Claude Max20", "Claude 代充 等同Max20", "Claude 等同 Max20"]) {
    assert.equal(id(title), "claude-max-20x", title);
  }
  assert.equal(id("Claude Max 20 5x"), undefined);
  assert.equal(id("Claude Max 代充月卡"), "claude-max-5x");
  assert.equal(id("Claude Max 200刀 官方订阅"), "claude-max-20x");

  // 多档可选不能兜底进单一 Pro 100。裸「claude max」先不归类。
  assert.equal(id("ChatGPT Pro 代充（100/200/500 美金档位可选）"), undefined);
  assert.equal(id("claude max"), undefined);
  assert.equal(id("Claude Max"), undefined);

  // json 档不是团队席位。真实席位和「已过 cyber」的 Plus 成品号保持原分类。
  assert.equal(id("ChatGPT Business Pro 5X*僅json檔"), undefined);
  assert.equal(id("ChatGPT Business Pro 5X*仅json档"), undefined);
  assert.equal(id("48月 GPT Business Standard 标准席位"), "chatgpt-team-business");
  assert.equal(id("ChatGPT Plus 成品号 已过 cyber"), "chatgpt-plus");
  assert.equal(directOfferExclusionReason({ title: "ChatGPT Plus 成品号 已过 cyber", status: "in_stock", stockCount: 1 }), null);

  const hidden = groupDirectOffers([
    offer("json", "ChatGPT Business Pro 5X*僅json檔", 88, "in_stock"),
    offer("menu", "ChatGPT Pro 代充（100/200/500 美金档位可选）", 699, "in_stock"),
    offer("seat", "48月 GPT Business Standard 标准席位", 128, "in_stock"),
  ]);
  assert.deepEqual(hidden.map(product => product.productId), ["chatgpt-team-business"]);
  assert.deepEqual(hidden[0].offers.map(item => item.offerId), ["seat"]);
});
