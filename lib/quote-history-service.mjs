import { Worker } from 'node:worker_threads';
import { readQuoteHistoryInput } from './quote-history-worker.mjs';

const unavailable = () => ({ status: 'unavailable', rows: [] });
const pending = () => ({ status: 'pending', rows: [] });
const positive = (value, fallback, upper) => Math.min(upper, Math.max(1, Math.trunc(Number(value)) || fallback));
const sources = new Set(['direct-shops', 'ldxp-goods', 'cardnav-official']);

function parameters(value = {}) {
  const result = {
    source: String(value.source || ''), productId: String(value.productId || ''),
    since: value.since ? String(value.since) : '', comparisonKey: value.comparisonKey ? String(value.comparisonKey) : '',
    channel: String(value.channel || 'all'), framework: String(value.framework || 'all'),
    limit: positive(value.limit, 120, 120),
  };
  if (!sources.has(result.source) || !result.productId || result.productId.length > 256 || result.since.length > 128 || result.comparisonKey.length > 4096 || result.channel.length > 100 || result.framework.length > 100) return null;
  return result;
}

/** A single bounded worker serves optional historical charts, never HTTP work. */
export function createQuoteHistoryService({ db, dbPath, waitMs = 100, maxAgeMs = 60000, errorMaxAgeMs = 1000,
  maxEntries = 64, maxPending = 8, jobTimeoutMs = 15000, maxOffers = 50000,
  maxInputBytes = 64 * 1024 * 1024, now = Date.now } = {}) {
  const capacity = positive(maxEntries, 64, 256), pendingCapacity = positive(maxPending, 8, 32);
  const timeoutMs = positive(jobTimeoutMs, 15000, 120000);
  const limits = { maxOffers: positive(maxOffers, 50000, 100000), maxInputBytes: positive(maxInputBytes, 64 * 1024 * 1024, 64 * 1024 * 1024) };
  let file = dbPath, version, changes;
  try {
    if (!file) file = db.prepare('PRAGMA database_list').all().find(item => item.name === 'main')?.file || null;
    version = db.prepare('PRAGMA data_version');
    changes = db.prepare('SELECT total_changes() AS n');
  } catch { file = null; }
  let worker = null, stopping = null, current = null, closed = false, generation = 0, sequence = 0;
  let jobsStarted = 0, jobsCompleted = 0, closePromise;
  const cache = new Map(), jobs = new Map(), queue = [];
  const revision = () => generation + ':' + version.get().data_version + ':' + changes.get().n;
  const remember = (job, result) => {
    if (closed || job.generation !== generation) return;
    const ttl = result.status === 'ready' ? Math.max(0, Number(maxAgeMs) || 0) : Math.max(0, Number(errorMaxAgeMs) || 0);
    if (!ttl) return;
    cache.delete(job.key);
    cache.set(job.key, { result, until: now() + ttl });
    while (cache.size > capacity) cache.delete(cache.keys().next().value);
  };
  const finish = (job, result) => {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    jobs.delete(job.key);
    const queued = queue.indexOf(job);
    if (queued >= 0) queue.splice(queued, 1);
    if (current === job) current = null;
    if (result.status === 'ready') jobsCompleted++;
    remember(job, result);
    job.resolve(result);
  };
  const stopWorker = target => {
    if (!target) return stopping || Promise.resolve();
    if (worker === target) worker = null;
    const operation = target.terminate().catch(() => {});
    stopping = operation;
    operation.finally(() => {
      if (stopping === operation) stopping = null;
      pump();
    });
    return operation;
  };
  const failedWorker = target => {
    if (worker !== target) return;
    if (current) finish(current, unavailable());
    stopWorker(target);
  };
  const launch = () => {
    const options = execArgv => ({
      workerData: { dbPath: file, quoteHistoryWorker: true },
      execArgv,
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    const entry = new URL('./quote-history-worker.mjs', import.meta.url);
    let target;
    // The entrypoint is a module file even when a caller uses node -e.
    try { target = new Worker(entry, options(process.execArgv.filter(arg => !arg.startsWith('--input-type')))); }
    catch (error) {
      // Some runtimes (e.g. Node 24 under `node --test`) expose process-only
      // flags in execArgv that a Worker rejects; the worker needs none of them.
      if (error?.code !== 'ERR_WORKER_INVALID_EXEC_ARGV') throw error;
      target = new Worker(entry, options([]));
    }
    worker = target;
    target.on('message', message => {
      if (worker !== target || !current || message.id !== current.id) return;
      const rows = Array.isArray(message.rows) && message.rows.length <= current.params.limit ? message.rows : null;
      finish(current, message.status === 'ready' && rows ? { status: 'ready', rows } : unavailable());
      target.unref();
      pump();
    });
    target.on('error', () => failedWorker(target));
    target.on('exit', () => failedWorker(target));
    target.unref();
    return target;
  };
  function pump() {
    if (closed || stopping || current || !queue.length) return;
    const job = queue.shift();
    current = job;
    try {
      const target = worker || launch();
      // In-memory test/embedded databases cannot be opened from another thread.
      // Export public raw rows only; classification always remains in the worker.
      const input = file ? undefined : readQuoteHistoryInput(db, job.params, limits);
      jobsStarted++;
      target.ref();
      target.postMessage({ id: job.id, params: job.params, input, limits });
    } catch {
      finish(job, unavailable());
      worker?.unref();
      pump();
    }
  }
  function start(key, params) {
    const job = { id: ++sequence, key, params, generation, done: false };
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    jobs.set(key, job);
    job.timer = setTimeout(() => {
      const running = current === job;
      finish(job, unavailable());
      if (running) stopWorker(worker);
      else pump();
    }, timeoutMs);
    job.timer.unref();
    queue.push(job);
    // Give the HTTP event loop a turn before exporting an in-memory fixture.
    setImmediate(pump);
    return job;
  }
  return {
    async get(value, options = {}) {
      if (closed) return unavailable();
      const params = parameters(value);
      if (!params) return unavailable();
      let key;
      try { key = JSON.stringify([revision(), params]); } catch { return unavailable(); }
      const entry = cache.get(key);
      if (entry && entry.until > now()) {
        cache.delete(key); cache.set(key, entry);
        return entry.result;
      }
      cache.delete(key);
      let job = jobs.get(key);
      if (!job) {
        if (jobs.size >= pendingCapacity) return unavailable();
        job = start(key, params);
      }
      const wait = Math.max(0, Math.min(timeoutMs, Number(options.waitMs ?? waitMs) || 0));
      if (!wait) return pending();
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve(pending()), wait);
        job.promise.then(result => { clearTimeout(timer); resolve(result); });
      });
    },
    invalidate() { generation++; cache.clear(); },
    stats() { return { closed, workers: worker || stopping ? 1 : 0, queued: queue.length, inFlight: current ? 1 : 0, cacheEntries: cache.size, jobsStarted, jobsCompleted }; },
    close() {
      if (closePromise) return closePromise;
      closed = true; cache.clear();
      for (const job of [...jobs.values()]) finish(job, unavailable());
      queue.length = 0;
      closePromise = stopWorker(worker).then(() => {});
      return closePromise;
    },
  };
}
