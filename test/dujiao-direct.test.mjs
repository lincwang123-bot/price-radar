import test from "node:test";
import assert from "node:assert/strict";

import { collectDujiao, parseDujiaoProducts } from "../collectors/direct/dujiao.mjs";
import { groupDirectOffers } from "../collectors/direct/catalog.mjs";

const capturedAt = "2026-09-05T00:00:00.000Z";
const burstTarget = {
  id: "burstpro-ai",
  name: "BurstPro AI",
  origin: "https://burstpro-ai.online",
};

test("Dujiao 按 SKU 拆分组合商品，公开聚合排除售罄 SKU", () => {
  const offers = parseDujiaoProducts({
    status_code: 200,
    data: [{
      id: 13,
      slug: "ChatGPT-TopUp",
      title: { "zh-CN": "ChatGPT PLUS、PRO 5X、PRO 20X 一个月正价直冲" },
      category: { name: { "zh-CN": "ChatGPT" } },
      fulfillment_type: "manual",
      skus: [
        {
          id: 31,
          sku_code: "正价PLUS",
          spec_values: { "en-US": "PLUS", "zh-CN": "正价PLUS" },
          price_amount: "130.00",
          manual_stock_total: 72,
          manual_stock_sold: 27,
          auto_stock_available: 0,
          is_active: true,
        },
        {
          id: 32,
          sku_code: "正价PRO5X",
          spec_values: { "en-US": "PRO5X", "zh-CN": "正价PRO5X" },
          price_amount: "620.00",
          manual_stock_total: 0,
          manual_stock_sold: 8,
          auto_stock_available: 0,
          is_active: true,
        },
        {
          id: 99,
          sku_code: "已停用",
          spec_values: { "zh-CN": "已停用" },
          price_amount: "1.00",
          manual_stock_total: 1,
          is_active: false,
        },
      ],
    }],
  }, burstTarget, capturedAt);

  assert.deepEqual(offers.map((offer) => offer.title), ["ChatGPT 正价PLUS", "ChatGPT 正价PRO5X"]);
  assert.ok(offers.every((offer) => !offer.title.includes("PRO 20X")));
  assert.deepEqual(offers.map((offer) => offer.offerId), [
    "burstpro-ai:13:31",
    "burstpro-ai:13:32",
  ]);
  assert.deepEqual(offers.map((offer) => offer.price), [130, 620]);
  assert.deepEqual(offers.map((offer) => offer.stockCount), [72, 0]);
  assert.deepEqual(offers.map((offer) => offer.status), ["in_stock", "out_of_stock"]);
  assert.equal(offers[0].category, "ChatGPT");
  assert.equal(offers[0].url, "https://burstpro-ai.online/products/ChatGPT-TopUp");
  assert.equal(offers[0].deliveryMode, "manual");
  assert.deepEqual(groupDirectOffers(offers).map((product) => product.productId), ["chatgpt-plus-recharge"]);
});

test("Dujiao 多 SKU 只补充父商品的品牌，不混入其他套餐名", () => {
  const offers = parseDujiaoProducts({
    status_code: 0,
    data: [{
      id: 22,
      slug: "claude-plans",
      title: { "zh-CN": "Claude Pro / Max 5x / Max 20x" },
      category: { name: { "zh-CN": "Claude" } },
      fulfillment_type: "auto",
      skus: [
        { id: 1, spec_values: { "zh-CN": "Pro" }, price_amount: 130, auto_stock_available: 2, is_active: true },
        { id: 2, spec_values: { "zh-CN": "Max X20" }, price_amount: 1500, auto_stock_available: 1, is_active: true },
      ],
    }],
  }, burstTarget, capturedAt);

  assert.deepEqual(offers.map((offer) => offer.title), ["Claude Pro", "Claude Max X20"]);
  assert.deepEqual(groupDirectOffers(offers).map((product) => product.productId).sort(), [
    "claude-max-20x", "claude-pro-month",
  ]);
});

test("Dujiao 单一 DEFAULT SKU 无规格名时才回退到父商品标题，并保留 SKU 库存状态", () => {
  const [offer] = parseDujiaoProducts({
    status_code: 0,
    data: [{
      id: 46,
      slug: "gptplus",
      title: { "en-US": "", "zh-CN": "ChatGPT PLUS 菲区正规代充" },
      category: { name: { "zh-CN": "GPT" } },
      fulfillment_type: "auto",
      skus: [{
        id: 50,
        sku_code: "DEFAULT",
        spec_values: {},
        price_amount: "115.00",
        manual_stock_total: 0,
        auto_stock_available: 1,
        stock_status: "low_stock",
        is_sold_out: false,
        is_active: true,
      }],
    }],
  }, {
    id: "morimm",
    name: "MoriMM",
    origin: "https://morimm.com",
  }, capturedAt);

  assert.equal(offer.title, "ChatGPT PLUS 菲区正规代充");
  assert.equal(offer.price, 115);
  assert.equal(offer.stockCount, 1);
  assert.equal(offer.status, "low_stock");
  assert.equal(offer.deliveryMode, "auto");
});

test("Dujiao collector 只请求固定公开端点并按 pagination 有界翻页", async () => {
  const calls = [];
  const pages = [
    responsePage([product(1, "PLUS", 130, 2)], 1, 2),
    responsePage([product(2, "PRO5X", 620, 0)], 2, 2),
  ];
  const offers = await collectDujiao(burstTarget, {
    capturedAt,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(pages[calls.length - 1]), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(offers.length, 2);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/api/v1/public/products",
    "/api/v1/public/products",
  ]);
  assert.deepEqual(calls.map(({ url }) => new URL(url).searchParams.get("page")), ["1", "2"]);
  assert.ok(calls.every(({ url }) => new URL(url).searchParams.get("page_size") === "100"));
  assert.ok(calls.every(({ init }) => init.method === "GET" && init.redirect === "manual"));
});

test("自动生成的 SKU-1 仅在单规格时回退父标题，多规格不得冒用起售价", () => {
  const base = {id: 50, slug: "gemini-link", title: {"zh-CN": "Gemini 18月链接CDK兑换"}, fulfillment_type: "auto"};
  const sku = {id: 1, sku_code: "SKU-1", spec_values: {}, price_amount: 8.5, auto_stock_available: 2, is_active: true};
  const one = parseDujiaoProducts({data: [{...base, skus: [sku]}]}, burstTarget, capturedAt);
  assert.equal(one[0].title, "Gemini 18月链接CDK兑换");
  assert.equal(groupDirectOffers(one)[0].productId, "gemini-claim-link");
  const multiple = parseDujiaoProducts({data: [{...base, skus: [sku, {...sku, id: 2, sku_code: "SKU-2"}]}]}, burstTarget, capturedAt);
  assert.deepEqual(multiple, []);
});

test("父商品标为售罄时，不因 SKU 残留库存发布有货报价", () => {
  const offers = parseDujiaoProducts({data: [{
    id: 31, title: {"zh-CN": "ChatGPT Plus 月卡"}, fulfillment_type: "auto", is_sold_out: true, stock_status: "out_of_stock",
    skus: [{id: 34, sku_code: "DEFAULT", price_amount: 125, auto_stock_available: 6, is_active: true}],
  }]}, burstTarget, capturedAt);
  assert.equal(offers[0].status, "out_of_stock");
  assert.deepEqual(groupDirectOffers(offers), []);
});

test("Dujiao collector 在网络请求前拒绝未登记来源", async () => {
  let called = false;
  await assert.rejects(
    collectDujiao({ id: "evil", name: "Evil", origin: "https://example.com" }, {
      fetchImpl: async () => {
        called = true;
        throw new Error("不应发起请求");
      },
    }),
    /未登记来源/,
  );
  assert.equal(called, false);
});

test("Dujiao collector 遇到超过五页的目录时中止而不是发布截断快照", async () => {
  let calls = 0;
  await assert.rejects(
    collectDujiao(burstTarget, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(responsePage([product(1, "PLUS", 130, 2)], 1, 6)), {
          headers: { "content-type": "application/json" },
        });
      },
    }),
    /分页超过上限 5/,
  );
  assert.equal(calls, 1);
});

test("Dujiao parser 对单商品 SKU 数量设置硬上限", () => {
  const skus = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1,
    spec_values: { "zh-CN": `SKU ${index + 1}` },
    price_amount: "1.00",
    auto_stock_available: 1,
    is_active: true,
  }));
  assert.throws(
    () => parseDujiaoProducts({
      status_code: 200,
      data: [{ id: 1, slug: "too-many", fulfillment_type: "auto", skus }],
    }, burstTarget, capturedAt),
    /SKU 数量超过上限 100/,
  );
});

function responsePage(data, page, totalPage) {
  return {
    status_code: 200,
    msg: "success",
    data,
    pagination: { page, page_size: 100, total: totalPage, total_page: totalPage },
  };
}

function product(id, title, price, stock) {
  return {
    id,
    slug: `product-${id}`,
    title: { "zh-CN": "ChatGPT PLUS、PRO 5X 组合商品" },
    category: { name: { "zh-CN": "ChatGPT" } },
    fulfillment_type: "auto",
    skus: [{
      id,
      sku_code: title,
      spec_values: { "zh-CN": title },
      price_amount: String(price),
      auto_stock_available: stock,
      is_active: true,
    }],
  };
}
