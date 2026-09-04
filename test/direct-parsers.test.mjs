import test from "node:test";
import assert from "node:assert/strict";

import { parseKamiPage } from "../collectors/direct/kami.mjs";
import { parseIkunLove } from "../collectors/direct/ikunlove.mjs";
import { parseMooncakeCatalog } from "../collectors/direct/mooncake.mjs";
import { parseShopApiGoods } from "../collectors/direct/shop-api.mjs";

const capturedAt = "2026-09-05T00:00:00.000Z";

test("Kami JSON 只保留公开有效商品并规范金额库存", () => {
  const offers = parseKamiPage({ code: 200, data: [
    { id: 30, name: "GPT PLUS 充值卡密", price: 130, user_price: 125, status: 1, hide: 0, stock: 12, category: { name: "ChatGPT" } },
    { id: 31, name: "隐藏商品", price: 1, status: 1, hide: 1, stock: 1 },
  ] }, { id: "aisou", name: "AI搜", origin: "https://aisou.pro" }, capturedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].offerId, "aisou:30");
  assert.equal(offers[0].price, 125);
  assert.equal(offers[0].stockCount, 12);
  assert.equal(offers[0].status, "in_stock");
});

test("IkunLove 分转元并排除删除商品", () => {
  const offers = parseIkunLove({ success: true, data: { products: [
    { id: "gemini", title: "Gemini Pro 一年会员", priceCents: 2350, stockCount: 11, isActive: true, isDeleted: false, category: "gemini" },
    { id: "gone", title: "已删除", priceCents: 1, stockCount: 1, isActive: true, isDeleted: true },
  ] } }, { id: "ikunlove", name: "IkunLove", origin: "https://ikunlove.best" }, capturedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 23.5);
  assert.equal(offers[0].status, "in_stock");
});

test("Mooncake 公开脚本目录可解析", () => {
  const script = 'window.MOONCAKE_CATALOG = [{"id":3,"name":"ChatGPT","items":[{"id":8,"name":"ChatGPT Plus-月卡-代充","price":150,"stock":208}]}];';
  const offers = parseMooncakeCatalog(script, { id: "mooncake", name: "Mooncake", origin: "https://fk1.ybkjs.top" }, capturedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].offerId, "mooncake:8");
  assert.equal(offers[0].price, 150);
  assert.equal(offers[0].category, "ChatGPT");
  assert.equal(offers[0].status, "in_stock");
});

test("Shop API 商品响应映射且不把零库存冒充有货", () => {
  const offers = parseShopApiGoods({ code: 1, data: { list: [
    { goods_key: "abc", name: "Claude Pro 月卡", price: 144.5, category: { name: "Claude" }, user: { nickname: "Chronos" }, extend: { stock_count: 0, show_stock_type: 1 }, link: "https://wzyp.cn/item/abc" },
  ] } }, { id: "wzyp-chronos", name: "Chronos", token: "1KUKOX05", origin: "https://wzyp.cn" }, capturedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].status, "out_of_stock");
});
