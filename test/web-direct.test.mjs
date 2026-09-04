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
