import test from "node:test";
import assert from "node:assert/strict";

import { collectKami, parseKamiPage } from "../collectors/direct/kami.mjs";
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

test("Kami 公开文字库存映射为可售状态", () => {
  const offers = parseKamiPage({ code: 200, data: [
    { id: 40, name: "GPT Plus", price: 100, status: 1, hide: 0, stock: "充足", stock_state: 3 },
    { id: 41, name: "Claude Pro", price: 110, status: 1, hide: 0, stock: "非常多", stock_state: 4 },
    { id: 42, name: "Gemini Pro", price: 20, status: 1, hide: 0, stock: "一般", stock_state: 2 },
    { id: 43, name: "Grok", price: 30, status: 1, hide: 0, stock: "即将售罄", stock_state: 1 },
  ] }, { id: "zhanghao66", name: "账号66", origin: "https://zhanghao66.com" }, capturedAt);

  assert.deepEqual(offers.map((offer) => offer.status), [
    "in_stock", "in_stock", "in_stock", "low_stock",
  ]);
  assert.deepEqual(offers.map((offer) => offer.stockCount), [null, null, null, null]);
});

test("Kami 有 total 时不因单页少于 limit 而提前停止", async () => {
  const calls = [];
  const pages = [
    { code: 200, total: 3, data: [kamiItem(1), kamiItem(2)] },
    { code: 200, total: 3, data: [kamiItem(3)] },
  ];
  const offers = await collectKami(kamiTarget(), {
    pageSize: 4,
    maxPages: 5,
    capturedAt,
    fetchImpl: kamiFetch(pages, calls),
  });

  assert.deepEqual(offers.map((offer) => offer.offerId), ["kami-test:1", "kami-test:2", "kami-test:3"]);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).searchParams.get("limit"), "4");
  assert.equal(new URL(calls[1]).searchParams.get("page"), "2");
});

test("Kami 在 total 不准时以连续空页安全终止", async () => {
  const calls = [];
  const offers = await collectKami(kamiTarget(), {
    pageSize: 3,
    maxPages: 5,
    capturedAt,
    fetchImpl: kamiFetch([
      { code: 200, total: 99, data: [kamiItem(1)] },
      { code: 200, total: 99, data: [] },
      { code: 200, total: 99, data: [] },
      { code: 200, total: 99, data: [kamiItem(4)] },
    ], calls),
  });

  assert.deepEqual(offers.map((offer) => offer.offerId), ["kami-test:1"]);
  assert.equal(calls.length, 3);
});

test("Kami 在非空页没有新 ID 时停止，且不超过 maxPages", async () => {
  const repeatedCalls = [];
  const repeated = await collectKami(kamiTarget(), {
    pageSize: 3,
    maxPages: 5,
    capturedAt,
    fetchImpl: kamiFetch([
      { code: 200, total: 99, data: [kamiItem(1)] },
      { code: 200, total: 99, data: [kamiItem(1)] },
      { code: 200, total: 99, data: [kamiItem(3)] },
    ], repeatedCalls),
  });
  assert.equal(repeated.length, 1);
  assert.equal(repeatedCalls.length, 2);

  const boundedCalls = [];
  const bounded = await collectKami(kamiTarget(), {
    pageSize: 3,
    maxPages: 2,
    capturedAt,
    fetchImpl: kamiFetch([
      { code: 200, total: 99, data: [kamiItem(1)] },
      { code: 200, total: 99, data: [kamiItem(2)] },
      { code: 200, total: 99, data: [kamiItem(3)] },
    ], boundedCalls),
  });
  assert.equal(bounded.length, 2);
  assert.equal(boundedCalls.length, 2);
  assert.ok(boundedCalls.every((url) => new URL(url).searchParams.get("limit") === "3"));
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

function kamiTarget() {
  return { id: "kami-test", name: "Kami Test", origin: "https://kami.example" };
}

function kamiItem(id) {
  return { id, name: `商品 ${id}`, price: id, status: 1, hide: 0, stock: 1 };
}

function kamiFetch(pages, calls) {
  return async (url) => {
    calls.push(String(url));
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(JSON.stringify(pages[page - 1] ?? { code: 200, total: 0, data: [] }), {
      headers: { "content-type": "application/json" },
    });
  };
}
