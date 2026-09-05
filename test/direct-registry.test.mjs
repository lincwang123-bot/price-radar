import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_DIRECT_TARGET_IDS, directTargets } from "../collectors/direct/registry.mjs";

test("默认直采列表只启用生产 VPS 已验证可达的目标", () => {
  assert.deepEqual(DEFAULT_DIRECT_TARGET_IDS, [
    "aisou", "redeemgpt", "ai666", "shopcardai", "web3chirou", "morimm", "burstpro-ai", "ikunlove", "mooncake",
    "lynnzee", "zhanghao66", "yufenggpt", "google7676", "tehuio",
    "codesky", "fk10886", "gugugaga", "flyai", "whh985", "aictk", "ccdawang",
  ]);
  assert.equal(directTargets().length, 21);
  assert.equal(directTargets(["wzyp-harvey"])[0].token, "harvey");
});

test("Dujiao 原站仅固定登记已验证的公开目录", () => {
  assert.deepEqual(
    directTargets(["morimm", "burstpro-ai"])
      .map(({ id, kind, origin, endpoint }) => ({ id, kind, origin, endpoint })),
    [
      { id: "morimm", kind: "dujiao", origin: "https://morimm.com", endpoint: "/api/v1/public/products" },
      { id: "burstpro-ai", kind: "dujiao", origin: "https://burstpro-ai.online", endpoint: "/api/v1/public/products" },
    ],
  );
});

test("新 Kami 原站均固定登记，仅高价值可达源默认启用", () => {
  assert.deepEqual(
    directTargets(["web3chirou", "lynnzee", "zhanghao66"])
      .map(({ id, kind, origin }) => ({ id, kind, origin })),
    [
      { id: "web3chirou", kind: "kami", origin: "https://web3chirou.com" },
      { id: "lynnzee", kind: "kami", origin: "https://lynnzee.myweb999.cfd" },
      { id: "zhanghao66", kind: "kami", origin: "https://zhanghao66.com" },
    ],
  );
  assert.ok(DEFAULT_DIRECT_TARGET_IDS.includes("web3chirou"));
  assert.ok(["lynnzee", "zhanghao66"].every(id => DEFAULT_DIRECT_TARGET_IDS.includes(id)));
});

test("新增 Kami 目标固定登记原站路径与请求上限", () => {
  for (const target of directTargets(["yufenggpt", "google7676", "tehuio"])) {
    assert.equal(target.kind, "kami");
    assert.equal(target.endpoint, "/user/api/index/commodity");
    assert.equal(target.maxPages, 5);
    assert.equal(target.pageSize, 100);
    assert.equal(target.intervalMinutes, 30);
    assert.ok(DEFAULT_DIRECT_TARGET_IDS.includes(target.id));
  }
});

test("未登记目标不能把直采器当作任意代理", () => {
  assert.throws(() => directTargets(["https://example.com"]), /未登记/);
});

test("第二轮新原站登记准确，旧跳转域名与全售罄候选不计入默认来源", () => {
  const origins = directTargets().map(t => t.origin);
  assert.equal(new Set(origins).size, 21);
  assert.ok(!origins.includes("https://xtacc.top"));
  assert.ok(!DEFAULT_DIRECT_TARGET_IDS.includes("otaor"));
  for (const t of directTargets(["codesky", "fk10886", "gugugaga"])) {
    assert.equal(t.endpoint, "/user/api/index/commodity");
    assert.equal(t.maxPages, 5);
    assert.equal(t.pageSize, 100);
  }
  for (const t of directTargets(["flyai", "whh985", "aictk", "ccdawang"])) {
    assert.equal(t.endpoint, "/api/v1/public/products");
    assert.equal(t.kind, "dujiao");
  }
});
