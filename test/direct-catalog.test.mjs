import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDirectOffer,
  directOfferExclusionReason,
  groupDirectOffers,
  stableDirectSnapshotId,
} from "../collectors/direct/catalog.mjs";

const cases = [
  ["GPT PLUS 充值卡密(IOS美区质保)", "ChatGPT", "chatgpt-plus-recharge"],
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
  ["Gemini Pro 12个月成品号", "Gemini", "gemini-pro-recharge"],
  ["Gemini Ultra 独享月卡", "Gemini", "gemini-ultra"],
  ["全自动激活 Gemini pro 和antigravity 权限", "Gemini", "gemini-activation-service"],
  ["Gemini Pro 3个月链接", "Gemini", "gemini-claim-link"],
  ["Super Grok Heavy 月卡", "Grok", "super-grok-heavy"],
  ["X Premium+ 年卡", "X", "x-twitter-premium-plus"],
  ["X-Twitter Premium+自助卡密（赠送Super Grok）", "X", "x-twitter-premium-plus"],
  ["Codex 点数额度充值", "ChatGPT", "api-cdk-credits"],
  ["OpenAI 哥伦比亚手机号短效接码 SMS", "ChatGPT", "verification-service"],
  ["Gmail 老号带辅助邮箱", "邮箱", "email-accounts"],
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
    ["【质保30天】GPT PRO 20× 正规代充", "ChatGPT", "chatgpt-pro-20x"],
    ["ChatGPT plus30天会员", "ChatGPT", "chatgpt-plus-recharge"],
    ["gopay GOJEK長效接碼 印尼", "SMS接碼服務", "verification-service"],
    ["Gpt/Codex 美国实卡手机号 临时单次", "实卡/接码", "verification-service"],
    ["Mail.tm长效邮箱", "邮箱产品", "email-accounts"],
    ["满年谷歌账号", "Google 邮箱", "email-accounts"],
    ["推特蓝V-Premium一个月", "推特电报会员服务", "x-twitter-premium"],
    ["推特蓝V-Premium➕ 一个月", "推特电报会员服务", "x-twitter-premium-plus"],
    ["100刀Codex API中转额度(纯Pro号池)", "ChatGPT业务", "api-cdk-credits"],
    ["AI平台直充100美元额度-Claude Opus / Max / 官API", "Claude API", "api-cdk-credits"],
  ]) assert.equal(classifyDirectOffer({title, category})?.id, expected, title);
  for (const title of ["Claude MAX5x/20x 官方订阅", "GPT Pro 5x 和 20x 版本", "GPT PLUS 月年卡", "GPT PLUS 月卡/年卡"]) {
    assert.equal(classifyDirectOffer({title, category:'ChatGPT'}) , null, title);
  }
  const titled = {title:'1个月PLUS代充 订阅质保 IOS 渠道', category:'CDK'};
  assert.equal(classifyDirectOffer({...titled,sourceId:'redeemgpt'})?.id, 'chatgpt-plus-recharge');
  assert.equal(classifyDirectOffer({...titled,sourceId:'unknown'}), null);
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

test("库存紧张属于可购买报价，且新类别仍排除售罄与无质保商品", () => {
  const products=groupDirectOffers([
    {...offer('low','Perplexity Pro 月卡',36,'low_stock'),stockCount:null},
    offer('sold','Perplexity Pro 月卡',1,'out_of_stock'),
    offer('bare','Perplexity Pro 月卡 无质保',2,'in_stock'),
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
  assert.equal(classifyDirectOffer({ title: "Claude Max 代充（倍数未注明）", category: "Claude" }), null);
  assert.equal(classifyDirectOffer({ title: "豆包专业版一个月 VIP 会员", category: "ChatGPT Plus" }), null);
  assert.equal(classifyDirectOffer({ title: "Instagram账号新建，手机号注册，开通2FA", category: "账号" }), null);
  assert.equal(classifyDirectOffer({ title: "推特老号｜邮箱可用｜token登录", category: "社交账号" }), null);
  assert.equal(classifyDirectOffer({ title: "Graph Api", category: "Outlook 邮箱" })?.id, "email-accounts");
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
  assert.equal(products[0].lowestPrice, 110);
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
  assert.equal(products[0].lowestPrice, 1050);
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
