import { createImmediatePreflightServer, DEFAULT_PREFLIGHT_SOCKET } from '../lib/merchant-preflight-immediate.mjs';
const service = createImmediatePreflightServer({
  dataDir: process.env.MERCHANT_PREFLIGHT_DATA_DIR || new URL('../data/', import.meta.url).pathname,
  merchantBridgeDir: process.env.MERCHANT_BRIDGE_DIR || new URL('../merchant-bridge/', import.meta.url).pathname,
});
await service.listen(process.env.MERCHANT_PREFLIGHT_SOCKET || DEFAULT_PREFLIGHT_SOCKET);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  try { await service.close(); } catch { process.exitCode = 1; }
});
