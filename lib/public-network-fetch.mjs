import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

// Conservative public unicast policy. IPv6 must be ordinary 2000::/3 global
// unicast; transition, documentation and special-purpose ranges are rejected.
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const parts = address.toLowerCase().split(':');
  const first = parseInt(parts[0] || '0',16), second = parseInt(parts[1] || '0',16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x3fff;
}

export function publicHttpsUrl(value) {
  const u = new URL(value);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      host.endsWith('.') || !host.includes('.') || isIP(host) ||
      host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid|example|onion)$/.test(host) || /^(?:localhost|metadata)(?:\.|$)/.test(host)) {
    throw new Error('公开店铺必须使用标准 HTTPS 域名');
  }
  return u;
}

// Each request resolves ALL addresses and pins its socket to a checked answer.
// The hostname remains the HTTPS hostname and TLS SNI; certificate validation
// is mandatory. No proxy environment, redirect, cookie jar or browser is used.
export function createPublicNetworkFetch(origin, { lookup = dnsLookup, request = httpsRequest,
  timeoutMs = 8000, maxBytes = 1024 * 1024, maxRequests = 12, totalTimeoutMs = 30000 } = {}) {
  const allowedOrigin = publicHttpsUrl(origin).origin;
  const deadline = Date.now() + Math.min(60000, totalTimeoutMs);
  let requests = 0;
  return async (value, init = {}) => {
    const url = publicHttpsUrl(String(value));
    if (url.origin !== allowedOrigin || !['GET','POST'].includes(init.method || 'GET')) throw new Error('公开请求超出授权来源');
    if (++requests > Math.min(20,maxRequests)) throw new Error('公开目录请求达到上限');
    const remaining = Math.min(timeoutMs, deadline - Date.now());
    if (remaining <= 0) throw new Error('公开目录采集超时');
    return new Promise((resolve,reject) => {
      let req;
      let finished = false;
      const complete = (error,result) => {
        if (finished) return;
        finished = true; clearTimeout(timer); init.signal?.removeEventListener('abort',aborted);
        if (error) { req?.destroy(); reject(error); } else resolve(result);
      };
      const aborted = () => complete(new Error('公开请求已取消'));
      const timer = setTimeout(() => complete(new Error('公开目录请求超时')), remaining);
      if (init.signal?.aborted) return aborted();
      init.signal?.addEventListener('abort',aborted,{once:true});
      Promise.resolve().then(() => lookup(url.hostname,{all:true,verbatim:true})).then(addresses => {
        if (finished) return;
        if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => !isPublicAddress(a.address) || isIP(a.address) !== Number(a.family))) throw new Error('店铺 DNS 包含非公开地址');
        const pinned = addresses[0];
        const body = init.body == null ? null : Buffer.from(String(init.body));
        if (body?.length > 16384) throw new Error('公开查询请求过大');
        const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
        for (const key of ['authorization','cookie','proxy-authorization','host','connection']) delete headers[key];
        headers['accept-encoding'] = 'identity';
        req = request(url, { method:init.method || 'GET', headers, agent:false,
          rejectUnauthorized:true, servername:url.hostname,
          lookup:(_host,options,callback) => options?.all ? callback(null,[pinned]) : callback(null,pinned.address,pinned.family),
        }, response => {
          const status = response.statusCode || 502;
          if (status >= 300 && status < 400) { response.destroy(); complete(new Error('公开目录不允许重定向')); return; }
          if (Number(response.headers['content-length']) > maxBytes || ![undefined,'identity'].includes(response.headers['content-encoding'])) {
            response.destroy(); complete(new Error('公开目录响应超过限制')); return;
          }
          let size = 0; const chunks = [];
          response.on('data',chunk => {
            size += chunk.length;
            if (size > maxBytes) { response.destroy(); complete(new Error('公开目录响应超过限制')); }
            else chunks.push(chunk);
          });
          response.on('error',error => complete(error));
          response.on('end',() => {
            try {
              const result = new Response([204,205].includes(status)?null:Buffer.concat(chunks),{status,headers:response.headers});
              Object.defineProperty(result,'url',{value:url.href});
              complete(null,result);
            } catch(error) { complete(error); }
          });
        });
        req.on('error',error => complete(error));
        req.end(body);
      }).catch(error => complete(error));
    });
  };
}
