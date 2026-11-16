const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_ALLOWED_METHODS = ["GET", "HEAD"];
const SUPPORTED_METHODS = new Set(["GET", "HEAD", "POST"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCESS_DENIED_STATUSES = new Set([401, 403, 407, 429]);

function responseError(message, status, denied = false) {
  return Object.assign(new Error(message), { status, code: denied ? 'ACCESS_DENIED' : 'HTTP_ERROR' });
}

export function isAccessDeniedError(error) {
  return error?.code === 'ACCESS_DENIED' || ACCESS_DENIED_STATUSES.has(error?.status);
}

function challengeDocument(text) {
  return /window\._waf_|cf-chl-|captchaType\s*=|<title[^>]*>\s*(?:access denied|just a moment|attention required|验证码|安全验证)/i.test(text);
}

function normalizedAllowedOrigins(allowedOrigins) {
  const values = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : allowedOrigins instanceof Set
      ? [...allowedOrigins]
      : [];
  if (!values.length) {
    throw new Error("safe-fetch: allowedOrigins 不能为空");
  }

  const origins = new Set();
  for (const value of values) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      throw new Error(`safe-fetch: 无效的 allowedOrigins 项: ${value}`);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error(`safe-fetch: 无效的 allowedOrigins 项: ${value}`);
    }
    origins.add(url.origin);
  }
  return origins;
}

function allowedUrl(value, origins, base) {
  let url;
  try {
    url = base ? new URL(String(value), base) : new URL(String(value));
  } catch {
    throw new Error(`safe-fetch: 无效请求地址: ${value}`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`safe-fetch: 未登记来源 ${url.origin || value}`);
  }
  if (!origins.has(url.origin)) {
    throw new Error(`safe-fetch: 未登记来源 ${url.origin}`);
  }
  return url;
}

function positiveInteger(value, fallback, label, { allowZero = false } = {}) {
  if (value == null) return fallback;
  const number = Number(value);
  const valid = Number.isSafeInteger(number) && (allowZero ? number >= 0 : number > 0);
  if (!valid) throw new Error(`safe-fetch: ${label} 必须为${allowZero ? "非负" : "正"}整数`);
  return number;
}

function normalizedAllowedMethods(value) {
  const entries = value == null
    ? DEFAULT_ALLOWED_METHODS
    : Array.isArray(value)
      ? value
      : value instanceof Set
        ? [...value]
        : null;
  if (!entries?.length) throw new Error("safe-fetch: allowedMethods 不能为空");

  const methods = new Set();
  for (const entry of entries) {
    const method = String(entry ?? "").trim().toUpperCase();
    if (!SUPPORTED_METHODS.has(method)) {
      throw new Error(`safe-fetch: allowedMethods 不支持 ${method || "空值"}`);
    }
    methods.add(method);
  }
  return methods;
}

function isJsonContentType(value) {
  const mime = String(value ?? "").split(";", 1)[0].trim().toLowerCase();
  return mime === "application/json" || (mime.startsWith("application/") && mime.endsWith("+json"));
}

async function readLimitedText(response, maxBytes) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength != null && contentLength !== "") {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error(`safe-fetch: 响应过大（${declaredBytes} > ${maxBytes} bytes）`);
    }
  }

  if (!response.body) return "";
  if (typeof response.body.getReader !== "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`safe-fetch: 响应过大（${bytes.byteLength} > ${maxBytes} bytes）`);
    }
    return new TextDecoder().decode(bytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("响应过大").catch(() => {});
        throw new Error(`safe-fetch: 响应过大（超过 ${maxBytes} bytes）`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function requestText(url, options, requireJson) {
  const {
    allowedOrigins,
    allowedMethods: rawAllowedMethods,
    fetchImpl = globalThis.fetch,
    timeoutMs: rawTimeoutMs,
    maxBytes: rawMaxBytes,
    maxRedirects: rawMaxRedirects,
    signal: callerSignal,
    ...requestInit
  } = options ?? {};
  if (typeof fetchImpl !== "function") throw new Error("safe-fetch: fetchImpl 不可用");

  const timeoutMs = positiveInteger(rawTimeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const maxBytes = positiveInteger(rawMaxBytes, DEFAULT_MAX_BYTES, "maxBytes");
  const maxRedirects = positiveInteger(rawMaxRedirects, DEFAULT_MAX_REDIRECTS, "maxRedirects", { allowZero: true });
  const origins = normalizedAllowedOrigins(allowedOrigins);
  const allowedMethods = normalizedAllowedMethods(rawAllowedMethods);
  let currentUrl = allowedUrl(url, origins);

  const method = String(requestInit.method ?? "GET").toUpperCase();
  if (!allowedMethods.has(method)) {
    throw new Error(`safe-fetch: 请求方法 ${method} 未显式允许`);
  }

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(callerSignal?.reason);

  let timeoutId;
  const abortPromise = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      const reason = timedOut
        ? new Error(`safe-fetch: 请求超时（${timeoutMs}ms）`)
        : controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error("safe-fetch: 请求已取消");
      reject(reason);
    }, { once: true });
  });
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener?.("abort", forwardAbort, { once: true });

  const execute = async () => {
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await fetchImpl(currentUrl.href, {
        ...requestInit,
        method,
        redirect: "manual",
        signal: controller.signal,
      });

      // 即使注入的 fetch 实现忽略 redirect: manual，也不信任它最终到达的未登记主机。
      if (response.url) allowedUrl(response.url, origins);

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= maxRedirects) {
          throw new Error(`safe-fetch: 重定向超过上限 ${maxRedirects}`);
        }
        const location = response.headers?.get?.("location");
        if (!location) throw new Error(`safe-fetch: HTTP ${response.status} 缺少 Location`);
        currentUrl = allowedUrl(location, origins, currentUrl);
        continue;
      }

      if (!response.ok) {
        throw responseError(`safe-fetch: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""} @ ${currentUrl.href}`, response.status, ACCESS_DENIED_STATUSES.has(response.status));
      }
      if (/denied/i.test(response.headers?.get?.('x-tengine-error') || '') || response.headers?.get?.('cf-mitigated') === 'challenge') {
        throw responseError('safe-fetch: 访问拒绝或 WAF 验证', response.status, true);
      }
      const text = await readLimitedText(response, maxBytes);
      if (/^\s*</.test(text) && challengeDocument(text)) throw responseError('safe-fetch: 访问拒绝或验证码页面', response.status, true);
      if (requireJson && !isJsonContentType(response.headers?.get?.("content-type"))) {
        throw new Error(`safe-fetch: JSON 响应类型无效（${response.headers?.get?.("content-type") || "缺失 Content-Type"}）`);
      }
      return text;
    }
  };

  try {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    return await Promise.race([execute(), abortPromise]);
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener?.("abort", forwardAbort);
  }
}

/**
 * 对固定来源发起只读请求，并在解码前限制响应体大小。
 */
export function safeFetchText(url, options) {
  return requestText(url, options, false);
}

/**
 * safeFetchText 的 JSON 版本：只接受 application/json 或 application/*+json。
 */
export async function safeFetchJson(url, options) {
  const text = await requestText(url, options, true);
  let payload;
  try {
    payload = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`safe-fetch: JSON 解析失败: ${error.message}`);
  }
  const status = Number(payload?.code ?? payload?.status);
  const message = typeof (payload?.msg ?? payload?.message ?? payload?.error) === 'string' ? (payload.msg ?? payload.message ?? payload.error) : '';
  if (ACCESS_DENIED_STATUSES.has(status) || /(?:需要|请先|未)登录|验证码|访问被拒绝|访问过于频繁|captcha required|authentication required|unauthorized|access denied|too many requests/i.test(message)) {
    throw responseError('safe-fetch: API 访问拒绝或需要认证/验证码', ACCESS_DENIED_STATUSES.has(status) ? status : 200, true);
  }
  return payload;
}
