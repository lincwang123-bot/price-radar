import test from "node:test";
import assert from "node:assert/strict";
import { isAccessDeniedError } from '../lib/safe-fetch.mjs';

test('访问拒绝附带可靠元数据，识别HTTP200 WAF和API认证', async () => {
  const variants = [
    () => new Response('denied', { status: 403 }),
    () => new Response('rate limit', { status: 429 }),
    () => new Response('<script>window._waf_is_mobile=false</script>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('challenge', { headers: { 'x-tengine-error': 'denied by http_custom' } }),
    () => new Response(JSON.stringify({ code: 0, msg: '请先登录' }), { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of variants) {
    await assert.rejects(safeFetchJson('https://example.com/api', { allowedOrigins: ['https://example.com'], fetchImpl: async () => response() }), err => isAccessDeniedError(err) && Number.isInteger(err.status));
  }
  await assert.rejects(safeFetchJson('https://example.com/api', { allowedOrigins: ['https://example.com'], fetchImpl: async () => new Response('down', { status: 500 }) }), err => !isAccessDeniedError(err) && err.status === 500);
});

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
