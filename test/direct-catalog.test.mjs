import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDirectOffer,
  groupDirectOffers,
  stableDirectSnapshotId,
} from "../collectors/direct/catalog.mjs";

const cases = [
  ["GPT PLUS 充值卡密(IOS美区质保)", "ChatGPT", "chatgpt-plus-recharge"],
  ["ChatGPT plus-月卡 独享 成品号", "ChatGPT", "chatgpt-plus"],
  ["GPT PRO 5X 菲区代充1个月", "ChatGPT", "chatgpt-pro-5x"],
  ["ChatGPT Pro200刀版本（官网直充）", "ChatGPT", "chatgpt-pro-20x"],
  ["48月 GPT Business Standard 标准席位", "ChatGPT", "chatgpt-team-business"],
  ["Claude Pro直充月卡", "Claude", "claude-pro-month"],
  ["Claude Max 20X直充月卡", "Claude", "claude-max-20x"],
  ["Gemini Pro 12个月成品号", "Gemini", "gemini-pro-recharge"],
  ["Gemini Ultra 独享月卡", "Gemini", "gemini-ultra"],
  ["Super Grok Heavy 月卡", "Grok", "super-grok-heavy"],
  ["X Premium+ 年卡", "X", "x-twitter-premium"],
  ["Codex 点数额度充值", "ChatGPT", "api-cdk-credits"],
  ["OpenAI 哥伦比亚手机号短效接码 SMS", "ChatGPT", "verification-service"],
  ["Gmail 老号带辅助邮箱", "邮箱", "email-accounts"],
];

test("明确的原店商品映射到稳定产品分类", () => {
  for (const [title, category, expected] of cases) {
    assert.equal(classifyDirectOffer({ title, category })?.id, expected, title);
  }
});

test("无法可靠识别的商品不进入公开排行", () => {
  assert.equal(classifyDirectOffer({ title: "打赏", category: "其他" }), null);
  assert.equal(classifyDirectOffer({ title: "节点加速教程", category: "教程" }), null);
  assert.equal(classifyDirectOffer({ title: "0 刀虚拟卡手搓 G Plus 教程", category: "ChatGPT Plus" }), null);
  assert.equal(classifyDirectOffer({ title: "Claude 成品账号 Free 版", category: "Claude Pro" }), null);
  assert.equal(classifyDirectOffer({ title: "豆包专业版一个月 VIP 会员", category: "ChatGPT Plus" }), null);
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

test("聚合仅用确认有货报价计算最低价", () => {
  const products = groupDirectOffers([
    offer("a", "GPT PLUS 充值卡密", 120, "in_stock"),
    offer("b", "GPT PLUS 充值卡密", 2, "out_of_stock"),
    offer("c", "GPT PLUS 充值卡密", 110, "in_stock"),
  ]);
  assert.equal(products.length, 1);
  assert.equal(products[0].lowestPrice, 110);
  assert.equal(products[0].offerCount, 3);
  assert.equal(products[0].inStockCount, 2);
});

test("快照 ID 与输入顺序和抓取时间无关，但价格变化会改变", () => {
  const a = offer("a", "Claude Pro直充月卡", 128, "in_stock", "2026-09-05T00:00:00Z");
  const b = offer("b", "Claude Pro直充月卡", 130, "in_stock", "2026-09-05T00:00:00Z");
  const first = stableDirectSnapshotId([a, b], []);
  const reordered = stableDirectSnapshotId([{ ...b, capturedAt: "2026-09-05T01:00:00Z" }, { ...a, capturedAt: "2026-09-05T01:00:00Z" }], []);
  const changed = stableDirectSnapshotId([a, { ...b, price: 129 }], []);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

function offer(id, title, price, status, capturedAt = "2026-09-05T00:00:00Z") {
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
    stockCount: status === "in_stock" ? 1 : 0,
    url: `https://example.com/item/${id}`,
    capturedAt,
  };
}
