import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openDb, storeSnapshot } from "../lib/db.mjs";
import { createApp } from "../lib/web.mjs";
import { listSubmissions, openSubmissionsDb, purgeExpiredClientHashes } from "../lib/submissions.mjs";

async function withServer(run) {
  const db = openDb(":memory:");
  const submissionsDb = openSubmissionsDb(":memory:");
  const server = createApp({ db, submissionsDb });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    await run({ db, submissionsDb, base });
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    submissionsDb.close();
    db.close();
  }
}

test('真实写锁通过HTTP返回503与Retry-After，释放后可重试',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'radar-http-lock-'));
  const file=path.join(directory,'submissions.sqlite'),db=openDb(':memory:'),submissionsDb=openSubmissionsDb(file),blocker=new DatabaseSync(file),server=createApp({db,submissionsDb});
  let locked=false;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
    const payload={kind:'feedback',topic:'price_wrong',subject:'锁测试价格',details:'这是一条验证数据库写锁处理的虚构价格反馈。'};
    blocker.exec('BEGIN IMMEDIATE');locked=true;
    const response=await submit(base,payload);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'3');assert.match((await response.json()).error,/繁忙/);
    blocker.exec('ROLLBACK');locked=false;
    const retry=await submit(base,payload);assert.equal(retry.status,201);await retry.body?.cancel();
  }finally{if(locked)blocker.exec('ROLLBACK');if(server.listening)await new Promise(r=>server.close(r));blocker.close();submissionsDb.close();db.close();rmSync(directory,{recursive:true,force:true});}
});

async function csrfSession(base) {
  const formResponse = await fetch(`${base}/submit`);
  const form = await formResponse.text();
  const csrfToken = form.match(/<meta name="csrf-token" content="([^"]+)"\/>/)?.[1];
  assert.ok(csrfToken, "提交页应签发 CSRF token");
  return { csrfToken, cookie: `airadar_csrf=${csrfToken}` };
}

async function submit(base, payload, headers = {}) {
  const { csrfToken, cookie } = await csrfSession(base);
  return fetch(`${base}/api/submissions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      cookie,
      "x-csrf-token": csrfToken,
      ...headers,
    },
    body: JSON.stringify(payload),
});
}

test("提交接口限制请求方法、内容类型与请求体大小", async () => {
  await withServer(async ({ base }) => {
    const getResponse = await fetch(`${base}/api/submissions`);
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get("allow"), "POST");

    const { csrfToken, cookie } = await csrfSession(base);
    const headers = { origin: base, cookie, "x-csrf-token": csrfToken };
    const wrongType = await fetch(`${base}/api/submissions`, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: "hello",
    });
    assert.equal(wrongType.status, 415);

    const oversized = await fetch(`${base}/api/submissions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ kind: "feedback", topic: "other", details: "大".repeat(17000) }),
    });
    assert.equal(oversized.status, 413);

    const chunkedSession = await csrfSession(base);
    const chunkedStatus = await new Promise((resolve, reject) => {
      let req;
      const timer = setTimeout(() => {
        req?.destroy();
        reject(new Error("超长分块请求未及时返回"));
      }, 1200);
      req = request(`${base}/api/submissions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: base,
          cookie: chunkedSession.cookie,
          "x-csrf-token": chunkedSession.csrfToken,
          "transfer-encoding": "chunked",
        },
      }, (response) => {
        response.resume();
        response.on("end", () => {
          clearTimeout(timer);
          resolve(response.statusCode);
        });
      });
      req.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.write(JSON.stringify({ kind: "feedback", topic: "other", details: "大".repeat(17000) }));
      // 故意不 end：服务端应在越过硬上限时立即响应并关闭连接。
    });
    assert.equal(chunkedStatus, 413);
  });
});

test("同一浏览器打开多个提交页时复用 CSRF token", async () => {
  await withServer(async ({ base }) => {
    const first = await csrfSession(base);
    const secondResponse = await fetch(`${base}/submit`, { headers: { cookie: first.cookie } });
    const second = await secondResponse.text();
    const secondToken = second.match(/<meta name="csrf-token" content="([^"]+)"\/>/)?.[1];
    assert.equal(secondToken, first.csrfToken);
  });
});

test("超过 48 小时的客户端摘要可按固定时钟清理", () => {
  const db = openSubmissionsDb(":memory:");
  try {
    const insert = db.prepare(
      `INSERT INTO feedback_submissions
         (public_id, created_at, topic, details, client_hash, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insert.run("FB-20260901-OLDHASH1", "2026-09-01T00:00:00.000Z", "other", "旧记录", "old-client", "old-content");
    insert.run("FB-20260904-NEWHASH1", "2026-09-04T12:00:00.000Z", "other", "新记录", "new-client", "new-content");

    assert.equal(purgeExpiredClientHashes(db, new Date("2026-09-05T00:00:00.000Z")), 1);
    const rows = db.prepare("SELECT public_id, client_hash FROM feedback_submissions ORDER BY id").all();
    assert.equal(rows[0].client_hash, null);
    assert.equal(rows[1].client_hash, "new-client");
  } finally {
    db.close();
  }
});

test("反馈提交会经过校验并保存为待处理记录", async () => {
  await withServer(async ({ submissionsDb, base }) => {
    const response = await submit(base, {
      kind: "feedback",
      topic: "price_wrong",
      subject: "ChatGPT Pro 20x",
      details: "Mooncake 的公开价格与原站结算信息不一致，请复核。",
      contextUrl: `${base}/product?source=direct-shops&id=chatgpt-pro-20x`,
      contact: "TG @example_user",
      website: "",
    });

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.match(result.id, /^FB-\d{8}-[A-Z0-9]{8}$/);

    const rows = listSubmissions(submissionsDb, { kind: "feedback", limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].public_id, result.id);
    assert.equal(rows[0].topic, "price_wrong");
    assert.equal(rows[0].subject, "ChatGPT Pro 20x");
    assert.equal(rows[0].contact, "TG @example_user");
    assert.equal(rows[0].status, "new");
    assert.equal(rows[0].client_hash.length, 64);
    const internalSecretTable = submissionsDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'submission_meta'"
    ).get();
    assert.equal(internalSecretTable, undefined, "限流密钥不应与投稿数据存放在同一数据库");
  });
});

test("供需合作提交保存结构化字段", async () => {
  await withServer(async ({ submissionsDb, base }) => {
    const response = await submit(base, {
      kind: "cooperation",
      topic: "supply",
      subject: "Claude 企业订阅稳定供给",
      details: "支持小额测试，确认稳定后可按月供给，并提供掉订阅处理。",
      contact: "X @supplier",
      contextUrl: "https://supplier.example/catalog",
      metadata: {
        productArea: "claude",
        scale: "monthly",
        assurance: "conditional",
        settlement: "both",
      },
      consent: true,
      website: "",
    });

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.id, /^CO-\d{8}-[A-Z0-9]{8}$/);
    const [row] = listSubmissions(submissionsDb, { kind: "cooperation", limit: 10 });
    assert.deepEqual(JSON.parse(row.metadata), {
      productArea: "claude",
      scale: "monthly",
      assurance: "conditional",
      settlement: "both",
    });
  });
});

test("提交接口拒绝跨站请求、非法字段和明显敏感凭据", async () => {
  await withServer(async ({ base }) => {
    const crossSite = await submit(base, {
      kind: "feedback",
      topic: "other",
      details: "页面信息需要复核。",
    }, { origin: "https://evil.example" });
    assert.equal(crossSite.status, 403);

    const invalid = await submit(base, {
      kind: "feedback",
      topic: "invented_topic",
      details: "页面信息需要复核。",
    });
    assert.equal(invalid.status, 422);
    assert.match((await invalid.json()).error, /检查/);

    const secret = await submit(base, {
      kind: "feedback",
      topic: "other",
      details: "我的 key 是 sk-abcdefghijklmnopqrstuvwxyz123456，请帮我看看。",
    });
    assert.equal(secret.status, 422);
    assert.match((await secret.json()).error, /敏感凭据/);
  });
});

test("重复提交会被去重，短时间超量请求会被限制", async () => {
  await withServer(async ({ base }) => {
    const payload = {
      kind: "feedback",
      topic: "dead_link",
      details: "商品链接已经打不开，请复核。",
    };
    assert.equal((await submit(base, payload)).status, 201);
    assert.equal((await submit(base, payload)).status, 409);

    for (let index = 0; index < 5; index += 1) {
      const response = await submit(base, {
        ...payload,
        details: `商品链接 ${index + 1} 已失效，请复核。`,
      });
      assert.equal(response.status, 201);
    }
    const limited = await submit(base, {
      ...payload,
      details: "第七条不同内容，仍应触发频率限制。",
    });
    assert.equal(limited.status, 429);
  });
});

test("提交页提供两条原创流程，并可从产品页携带上下文进入反馈", async () => {
  await withServer(async ({ db, base }) => {
    const capturedAt = "2026-09-05T00:00:00.000Z";
    storeSnapshot(db, {
      source: "direct-shops",
      snapshotId: "direct-submit-fixture",
      fetchedAt: capturedAt,
      products: [{
        productId: "chatgpt-pro-20x",
        name: "ChatGPT Pro 20x",
        platform: "ChatGPT",
        productType: "订阅/会员",
        lowestPrice: 1050,
        currency: "CNY",
        offerCount: 1,
        inStockCount: 1,
        offers: [{
          offerId: "offer-1",
          sourceId: "store-1",
          storeName: "示例店铺",
          title: "ChatGPT Pro 20x 代充",
          price: 1050,
          currency: "CNY",
          status: "in_stock",
          stockCount: 1,
          url: "https://example.com/item/1",
          capturedAt,
        }],
      }],
    });

    const page = await fetch(`${base}/submit?type=feedback&source=direct-shops&product=chatgpt-pro-20x`).then((response) => response.text());
    assert.match(page, /反馈与合作/);
    assert.match(page, /纠正公开数据/);
    assert.match(page, /供需合作/);
    assert.match(page, /价格有误/);
    assert.match(page, /源头供给/);
    assert.match(page, /\/api\/submissions/);
    assert.match(page, /direct-shops/);
    assert.match(page, /chatgpt-pro-20x/);
    assert.match(page, /aria-current="page">反馈与合作</);
    assert.match(page, /data-submission-mode="feedback" aria-pressed="true"/);

    const product = await fetch(`${base}/product?source=direct-shops&id=chatgpt-pro-20x`).then((response) => response.text());
    assert.match(product, /反馈这页数据/);
    assert.match(product, /\/submit\?type=feedback&amp;source=direct-shops&amp;product=chatgpt-pro-20x/);
  });
});
