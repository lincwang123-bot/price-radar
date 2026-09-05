import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { openDb, storeSnapshot } from "../lib/db.mjs";
import { createApp } from "../lib/web.mjs";

test("原店直采报价支持翻页，PriceAI Top 5 可跳转完整直采排行", async () => {
  const db = openDb(":memory:");
  const server = createApp({ db });
  try {
    const capturedAt = "2026-09-05T00:00:00.000Z";
    storeSnapshot(db, snapshot("direct-shops", "direct-fixture", capturedAt, 23, 23));
    storeSnapshot(db, snapshot("priceai", "priceai-fixture", capturedAt, 23, 5));

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();

    const homeHtml = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.match(homeHtml, /原店直采最低/);
    assert.match(homeHtml, /原始店铺直采/);

    const directHtml = await fetch(`http://127.0.0.1:${port}/product?source=direct-shops&id=chatgpt-plus-recharge&page=2`).then((response) => response.text());
    assert.match(directHtml, /共 23 条公开报价/);
    assert.match(directHtml, /第 2 \/ 3 页/);
    assert.match(directHtml, />#11</);
    assert.match(directHtml, />#20</);
    assert.doesNotMatch(directHtml, />#21</);

    const priceAiHtml = await fetch(`http://127.0.0.1:${port}/product?source=priceai&id=chatgpt-plus-recharge`).then((response) => response.text());
    assert.match(priceAiHtml, /PriceAI 公开快照仅提供该品类的 Top 5/);
    assert.match(priceAiHtml, /查看原店直采完整排行/);
    assert.match(priceAiHtml, /source=direct-shops&amp;id=chatgpt-plus-recharge/);
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

test("原店历史走势排除售罄与无质保低价，但保留库存紧张的可售报价", async () => {
  const db = openDb(":memory:");
  const server = createApp({ db });
  try {
    storeSnapshot(db, directHistorySnapshot(
      "direct-history-old",
      "2026-09-05T00:00:00.000Z",
      [
        historyOffer("bad-warranty", "GPT PRO 20X 直冲卡密（无任何质保）", 348, "in_stock", 5),
        historyOffer("bad-stock", "GPT PRO 20X 已售罄", 99, "out_of_stock", 0),
        historyOffer("bad-category", "100刀Codex API中转额度(纯Pro号池)", 10, "in_stock", 8),
        historyOffer("valid-old", "GPT PRO 20X 菲区代充1个月", 1050, "in_stock", 3),
      ],
      99,
    ));
    storeSnapshot(db, directHistorySnapshot(
      "direct-history-new",
      "2026-09-05T01:00:00.000Z",
      [historyOffer("valid-new", "GPT PRO 20X 菲区代充1个月", 1060, "low_stock", 2)],
      1060,
    ));

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const html = await fetch(`http://127.0.0.1:${port}/product?source=direct-shops&id=chatgpt-pro-20x`).then((response) => response.text());

    assert.match(html, /最近 2 个快照/);
    assert.match(html, /从 09\/05 08:00 的 ¥1050 到 09\/05 09:00 的 ¥1060/);
    assert.doesNotMatch(html, /¥348|¥99/);
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

function snapshot(source, snapshotId, capturedAt, reportedCount, visibleCount) {
  return {
    source,
    snapshotId,
    fetchedAt: capturedAt,
    stale: false,
    products: [{
      productId: "chatgpt-plus-recharge",
      name: "ChatGPT Plus 代充/卡密",
      platform: "ChatGPT",
      productType: "订阅/会员",
      lowestPrice: 100,
      currency: "CNY",
      offerCount: reportedCount,
      inStockCount: visibleCount,
      offers: Array.from({ length: visibleCount }, (_, index) => ({
        offerId: `${source}:${index + 1}`,
        sourceId: source === "direct-shops" ? `store-${index + 1}` : "priceai",
        sourceName: `店铺 ${index + 1}`,
        storeName: `店铺 ${index + 1}`,
        title: `ChatGPT Plus 代充 ${index + 1}`,
        price: 100 + index,
        currency: "CNY",
        status: "in_stock",
        stockCount: 1,
        url: `https://example.com/item/${index + 1}`,
        capturedAt,
      })),
    }],
  };
}

test("首页为已采集的新品牌生成独立分类，详情可返回对应分类", async () => {
  const db = openDb(":memory:");
  const server = createApp({ db });
  try {
    const data = snapshot("direct-shops", "category-fixture", "2026-09-05T00:00:00.000Z", 1, 1);
    data.products = [
      ["cursor-pro", "Cursor"], ["perplexity-pro-1m", "Perplexity"],
      ["notion-ai-business-1m", "Notion AI"], ["manus-2000-credits", "Manus"],
      ["relay-cdk", "API/CDK"],
    ].map(([productId, platform]) => ({ ...data.products[0], productId, platform, name: productId }));
    storeSnapshot(db, data);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(base + "/?family=cursor").then((res) => res.text());
    for (const key of ["cursor", "perplexity", "notion", "manus", "relay"]) {
      assert.match(html, new RegExp(`data-family-filter="${key}"`));
      assert.match(html, new RegExp(`<tbody data-family="${key}" data-catalog-group`));
    }
    assert.doesNotMatch(html, /data-family-filter="mail"/);
    assert.match(html, /\[data-family\]\[hidden\]\{display:none!important\}/);
    const detail = await fetch(base + "/product?source=direct-shops&id=cursor-pro").then((res) => res.text());
    assert.match(detail, /class="breadcrumb" href="\/\?family=cursor"/);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

function directHistorySnapshot(snapshotId, capturedAt, offers, lowestPrice) {
  return {
    source: "direct-shops",
    snapshotId,
    fetchedAt: capturedAt,
    stale: false,
    products: [{
      productId: "chatgpt-pro-20x",
      name: "ChatGPT Pro 20x",
      platform: "ChatGPT",
      productType: "订阅/会员",
      lowestPrice,
      currency: "CNY",
      offerCount: offers.length,
      inStockCount: offers.filter((offer) => offer.status === "in_stock").length,
      offers,
    }],
  };
}

function historyOffer(offerId, title, price, status, stockCount) {
  return {
    offerId,
    sourceId: "fixture-store",
    sourceName: "Fixture Store",
    storeName: "Fixture Store",
    title,
    price,
    currency: "CNY",
    status,
    stockCount,
    url: `https://example.com/item/${offerId}`,
    capturedAt: "2026-09-05T00:00:00.000Z",
  };
}
