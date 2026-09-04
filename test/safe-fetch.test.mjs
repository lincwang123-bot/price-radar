import test from "node:test";
import assert from "node:assert/strict";

import { safeFetchJson, safeFetchText } from "../lib/safe-fetch.mjs";

test("安全请求拒绝未登记的来源地址", async () => {
  await assert.rejects(
    () => safeFetchJson("https://evil.example/data", { allowedOrigins: ["https://good.example"], fetchImpl: async () => new Response("{}") }),
    /未登记来源/,
  );
});

test("安全 JSON 请求校验类型与响应大小", async () => {
  await assert.rejects(
    () => safeFetchJson("https://good.example/data", {
      allowedOrigins: ["https://good.example"],
      fetchImpl: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    }),
    /响应类型/,
  );
  await assert.rejects(
    () => safeFetchText("https://good.example/data", {
      allowedOrigins: ["https://good.example"],
      maxBytes: 4,
      fetchImpl: async () => new Response("12345", { headers: { "content-type": "text/plain" } }),
    }),
    /响应过大/,
  );
});

test("POST 默认拒绝，仅在调用方显式允许时放行", async () => {
  const fetchImpl = async (_url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.body, '{"token":"public-shop"}');
    return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => safeFetchJson("https://good.example/catalog", {
      allowedOrigins: ["https://good.example"],
      fetchImpl,
      method: "POST",
      body: '{"token":"public-shop"}',
    }),
    /未显式允许/,
  );

  const payload = await safeFetchJson("https://good.example/catalog", {
    allowedOrigins: ["https://good.example"],
    allowedMethods: ["POST"],
    fetchImpl,
    method: "POST",
    body: '{"token":"public-shop"}',
  });
  assert.deepEqual(payload, { ok: true });
});
