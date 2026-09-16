import { createServer, request as httpRequest } from 'node:http';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { processMerchantPreflights, readPreflightRequests } from './merchant-preflight-worker.mjs';
import { isPreflightRunning, validPreflightId } from './merchant-preflight-lock.mjs';

export const DEFAULT_PREFLIGHT_SOCKET = '/run/price-radar-preflight/worker.sock';
const states = new Set(['running', 'completed', 'busy', 'unavailable', 'invalid']);
// Private IPC only. The web service sends an audited request ID, never a URL,
// command, credentials, or collector options. Network I/O remains isolated.
export function startImmediatePreflight(id, { socketPath = process.env.MERCHANT_PREFLIGHT_SOCKET || DEFAULT_PREFLIGHT_SOCKET, timeoutMs = 3000 } = {}) {
  if (!validPreflightId(id)) return Promise.resolve({ state: 'invalid' });
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const req = httpRequest({ socketPath, path: '/run', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 1024) req.destroy(); });
      res.on('end', () => {
        try { const value = JSON.parse(data); done({ state: states.has(value.state) ? value.state : 'unavailable' }); }
        catch { done({ state: 'unavailable' }); }
      });
      res.on('error', () => done({ state: 'unavailable' }));
    });
    const timer = setTimeout(() => { done({ state: 'unavailable' }); req.destroy(); }, timeoutMs);
    req.on('error', () => done({ state: 'unavailable' }));
    req.end(JSON.stringify({ id }));
  });
}

export function createImmediatePreflightServer(ctx) {
  const active = new Map();
  let stopping = false;
  const directory = path.join(ctx.dataDir, 'merchant-preflights');
  const server = createServer(async (req, res) => {
    const reply = (code, state) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ state })); };
    try {
      if (req.method !== 'POST' || req.url !== '/run' || req.headers['content-type'] !== 'application/json') return reply(400, 'invalid');
      let data = '';
      for await (const chunk of req) { data += chunk; if (data.length > 128) return reply(413, 'invalid'); }
      let input;
      try { input = JSON.parse(data); } catch { return reply(400, 'invalid'); }
      if (!input || Object.keys(input).length !== 1 || !validPreflightId(input.id)) return reply(400, 'invalid');
      const { id } = input;
      const queue = readPreflightRequests(ctx.merchantBridgeDir);
      if (!queue.valid || !queue.requests.some(row => row.id === id)) return reply(409, 'invalid');
      if (existsSync(path.join(directory, id + '.json'))) return reply(200, 'completed');
      if (active.has(id) || isPreflightRunning(directory, id)) return reply(202, 'running');
      if (stopping || active.size >= 2) return reply(503, 'busy');
      const task = processMerchantPreflights(ctx, { requestId: id });
      active.set(id, task);
      void task.catch(() => { /* no raw exception or merchant data in logs */ }).finally(() => active.delete(id));
      // The worker acquires its request lock before its first await. An orphan
      // lock or a just-revoked manifest must not be advertised as newly started.
      return isPreflightRunning(directory, id) ? reply(202, 'running') : reply(503, 'unavailable');
    } catch { if (!res.headersSent) reply(503, 'unavailable'); else res.end(); }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.setTimeout(5000, socket => socket.destroy());
  return {
    server,
    async listen(socketPath) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.off('error', reject); resolve(); }); });
      chmodSync(socketPath, 0o600);
    },
    async close() {
      stopping = true;
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
      await Promise.allSettled([...active.values()]);
    },
  };
}
