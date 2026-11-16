import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {tapeoutRoute} from '../lib/tapeout-app.mjs';
import {openDb} from '../lib/db.mjs';

async function withServer(server, run) {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await server.retentionWorkflowDone?.();
    await server.merchantWorkflowDone?.();
  }
}

function staticServer() {
  return http.createServer((req, res) => {
    if (tapeoutRoute(req, res, new URL(req.url, 'http://localhost'))) return;
    res.writeHead(404);
    res.end('Not found');
  });
}

function rawRequest(base, path) {
  return new Promise((resolve, reject) => {
    http.get(base, {path}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString()}));
    }).on('error', reject);
  });
}

test('TapeOut tool redirects to its directory and serves a standalone page with relative assets', async () => {
  await withServer(staticServer(), async base => {
    const redirect = await fetch(base + '/tapeout?from=tapetape', {redirect: 'manual'});
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/tapeout/?from=tapetape');
    const response = await fetch(base + '/tapeout/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html;/);
    const html = await response.text();
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /href="(?:\.\/)?style\.css(?:\?[^" ]*)?"/);
    assert.match(html, /src="(?:\.\/)?app\.js(?:\?[^" ]*)?"/);
    assert.doesNotMatch(html, /(?:src|href)="\/(?:assets|tapeout)\//);
    assert.equal(response.headers.get('set-cookie'), null);
    const policy = response.headers.get('content-security-policy');
    assert.match(policy, /connect-src 'none'/);
    assert.match(policy, /script-src 'self'/);
    assert.doesNotMatch(policy, /sandbox/);
  });
});

test('TapeOut HTML and explicit assets preserve MIME, body, HEAD, ETag and versioned caching', async () => {
  const files = [
    ['', 'index.html', 'text/html'],
    ['style.css', 'style.css', 'text/css'],
    ['app.js', 'app.js', 'text/javascript'],
    ['domain.js', 'domain.js', 'text/javascript'],
    ['airadar.png', 'airadar.png', 'image/png'],
  ];
  await withServer(staticServer(), async base => {
    for (const [path, file, mime] of files) {
      const url = base + '/tapeout/' + path;
      const response = await fetch(url);
      assert.equal(response.status, 200, file);
      assert.equal(response.headers.get('content-type').split(';')[0], mime, file);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const body = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(body, readFileSync(new URL('../assets/tapeout/' + file, import.meta.url)));
      const etag = response.headers.get('etag');
      assert.match(etag, /^"[a-f0-9]{16}"$/);
      assert.match(response.headers.get('cache-control'), /must-revalidate/);
      assert.match(response.headers.get('cache-control'), /no-transform/);
      const head = await fetch(url, {method: 'HEAD'});
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('etag'), etag);
      assert.equal(+head.headers.get('content-length'), body.length);
      assert.equal(await head.text(), '');
      const unchanged = await fetch(url, {headers: {'If-None-Match': 'W/' + etag}});
      assert.equal(unchanged.status, 304);
      assert.equal(await unchanged.text(), '');
      const versioned = await fetch(url + '?v=' + etag.slice(1, -1));
      assert.match(versioned.headers.get('cache-control'), /immutable/);
      assert.match(versioned.headers.get('cache-control'), /no-transform/);
      await versioned.arrayBuffer();
      const old = await fetch(url + '?v=old');
      assert.doesNotMatch(old.headers.get('cache-control'), /immutable/);
      await old.arrayBuffer();
    }
  });
});

test('TapeOut route rejects methods and never exposes files outside the explicit asset list', async () => {
  await withServer(staticServer(), async base => {
    for (const path of ['/tapeout', '/tapeout/', '/tapeout/app.js']) {
      const response = await fetch(base + path, {method: 'POST', redirect: 'manual'});
      assert.equal(response.status, 405, path);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const path of [
      '/tapeout/index.html', '/tapeout/package.json', '/tapeout/.env',
      '/tapeout/%2e%2e/package.json', '/tapeout/../package.json',
      '/tapeout/%2e%2e%2flib/db.mjs', '/tapeout/%252e%252e%252flib/db.mjs',
      '/tapeout/app.js/map', '/tapeout/app.js%00', '/tapeout//app.js',
    ]) {
      const response = await rawRequest(base, path);
      assert.equal(response.status, 404, path);
      assert.equal(response.body, 'Not found', path);
    }
  });
});

test('main app handles TapeOut after canonical redirect and preserves existing public/private routes', async () => {
  const {createApp} = await import('../lib/web.mjs');
  const db = openDb(':memory:');
  try {
    await withServer(createApp({db, adsenseEnv: {}, trafficEnv: {}}), async base => {
      const canonical = await fetch(base + '/tapeout?from=tapetape', {
        headers: {Host: 'www.airadar.vip', 'X-Forwarded-Proto': 'http'}, redirect: 'manual',
      });
      assert.equal(canonical.status, 301);
      assert.equal(canonical.headers.get('location'), 'https://airadar.vip/tapeout?from=tapetape');
      const tool = await fetch(base + '/tapeout/');
      assert.equal(tool.status, 200);
      assert.match(tool.headers.get('cache-control'), /public/);
      assert.doesNotMatch(await tool.text(), /data-reader-nav|data-sponsor-id|adsbygoogle/);
      for (const path of ['/', '/login']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get('cache-control'), /no-store/, path);
        if (path === '/login') assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
        else assert.equal(response.headers.get('content-security-policy'), null, path);
        await response.text();
      }
    });
  } finally {
    db.close();
  }
});
