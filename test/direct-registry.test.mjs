import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_DIRECT_TARGET_IDS, directTargets } from "../collectors/direct/registry.mjs";

test("默认直采列表只启用生产 VPS 已验证可达的目标", () => {
  assert.deepEqual(DEFAULT_DIRECT_TARGET_IDS, [
    "aisou", "redeemgpt", "ai666", "shopcardai", "ikunlove", "mooncake",
  ]);
  assert.equal(directTargets().length, 6);
  assert.equal(directTargets(["wzyp-harvey"])[0].token, "harvey");
});

test("未登记目标不能把直采器当作任意代理", () => {
  assert.throws(() => directTargets(["https://example.com"]), /未登记/);
});
