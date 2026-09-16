import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { openDb, metaGet } from '../lib/db.mjs';
import { DEFAULT_DIRECT_TARGET_IDS, directTargets, collectorFor } from '../collectors/direct/registry.mjs';
import { PLATFORM16688_SHOPS, collect16688 } from '../collectors/direct/platform16688.mjs';
import { collectAichong } from '../collectors/direct/aichong.mjs';
import { recommendedKeywords } from '../sources/ldxp.mjs';
import { merchantIdForUrl } from '../lib/offer-provenance.mjs';
import { offerChannel } from '../lib/channels.mjs';
import { pull } from '../sources/direct-shops.mjs';

test('新增固定目标接入正确采集器，共享16688域名不是独立商家', () => {
  for (const target of directTargets(PLATFORM16688_SHOPS.map(row => row.id))) {
    assert.equal(collectorFor(target), collect16688);
    assert.equal(target.intervalMinutes, 60);
    assert.equal(target.origin, 'https://www.16688.com.cn');
    assert.equal(merchantIdForUrl(target.origin), null);
    assert.equal(offerChannel({ url: `${target.origin}/goods/G123` }).id, '16688');
  }
  const aichong = directTargets(['aichong'])[0];
  assert.equal(collectorFor(aichong), collectAichong);
  assert.equal(aichong.intervalMinutes, 60);
  assert.equal(aichong.origin, 'https://aichong.xin');
  assert.ok(!DEFAULT_DIRECT_TARGET_IDS.some(id => id.startsWith('wzyp-')));
});

test('默认配置与已核验目标/有限关键词常量同步', () => {
  const config = loadConfig();
  assert.deepEqual(config.sources['direct-shops'].targets, [...DEFAULT_DIRECT_TARGET_IDS]);
  assert.deepEqual(config.sources['ldxp-goods'].keywords, [...recommendedKeywords]);
  assert.equal(config.sources['ldxp-goods'].min_interval_minutes, 30);
  assert.equal(config.sources['ldxp-goods'].max_requests, 24);
  assert.equal(config.sources['ldxp-goods'].max_pages_per_keyword, 2);
  assert.equal(config.sources['ldxp-goods'].request_delay_ms, 1000);
  assert.equal(config.sources['ldxp-goods'].page_size, 100);
  config.sources['direct-shops'].targets.push('mutation');
  assert.ok(!loadConfig().sources['direct-shops'].targets.includes('mutation'));
});

test('直采仅实际目标之间延迟，首个请求与缓存命中不额外等待，失败仍保持节流', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'radar-expansion-'));
  const db = openDb(':memory:');
  try {
    const cacheDir = path.join(dir, 'direct-shops-cache');
    mkdirSync(cacheDir);
    writeFileSync(path.join(cacheDir, 'redeemgpt.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), offers: [] }));
    const events = [];
    const result = await pull({ db, dataDir: dir, config: { sources: { 'direct-shops': { targets: ['aisou', 'redeemgpt', 'ai666'], request_delay_ms: 17 } } },
      sleep: async ms => events.push(`sleep:${ms}`),
      fetchImpl: async url => {
        const host = new URL(url).host; events.push(host);
        if (host === 'aisou.pro') throw new Error('fixture failure');
        return new Response(JSON.stringify({ code: 200, total: 0, data: [] }), { headers: { 'Content-Type': 'application/json' } });
      },
    });
    assert.deepEqual(events, ['aisou.pro', 'sleep:17', 'ai666.id']);
    assert.equal(result.snapshot.stale, true);
    const health = JSON.parse(metaGet(db, 'health:direct-targets')).targets;
    assert.deepEqual(health.map(row => [row.target, row.status]), [['aisou', 'unavailable'], ['redeemgpt', 'cached'], ['ai666', 'ok']]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('同origin访问拒绝立即熔断，健康缓存降级，其他origin继续', async () => {
  for (const denied of [true, false]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'radar-circuit-'));
    const db = openDb(':memory:');
    try {
      const cacheDir = path.join(dir, 'direct-shops-cache'); mkdirSync(cacheDir);
      const cached = PLATFORM16688_SHOPS[1];
      writeFileSync(path.join(cacheDir, `${cached.id}.json`), JSON.stringify({ fetchedAt: new Date().toISOString(), offers: [] }));
      const calls = [];
      await pull({ db, dataDir: dir, config: { sources: { 'direct-shops': { targets: [...PLATFORM16688_SHOPS.map(t => t.id), 'aisou'] } } }, sleep: async () => {}, fetchImpl: async url => {
        const host = new URL(url).host; calls.push(host);
        if (host === 'www.16688.com.cn') {
          if (denied) return new Response('denied', { status: 403 });
          throw new Error('temporary connection reset');
        }
        return new Response(JSON.stringify({ code: 200, total: 0, data: [] }), { headers: { 'Content-Type': 'application/json' } });
      } });
      assert.equal(calls.filter(host => host === 'www.16688.com.cn').length, denied ? 1 : PLATFORM16688_SHOPS.length - 1);
      assert.equal(calls.filter(host => host === 'aisou.pro').length, 1);
      const health = JSON.parse(metaGet(db, 'health:direct-targets')).targets;
      assert.equal(health.find(t => t.target === cached.id).status, denied ? 'stale' : 'cached');
      assert.equal(health.find(t => t.target === 'aisou').status, 'ok');
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});
