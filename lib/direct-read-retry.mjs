import {setTimeout as delay} from 'node:timers/promises';
import {classifyPreflightError} from './merchant-preflight-guidance.mjs';

// Retry a bounded public read, not the whole catalogue. Retrying whole collectors
// repeats successful pages and can multiply traffic on large storefronts.
export async function withPublicReadRetry(read,{sleep=delay,deadline=Infinity}={}) {
  try { return await read(); }
  catch(error) {
    const {reasonCode}=classifyPreflightError(error);
    if(!['timeout','network_error','server_error'].includes(reasonCode)||Date.now()+1500>=deadline)throw error;
    await sleep(1500);
    return read();
  }
}

export function retryingPublicFetch(fetchImpl,{sleep,deadline=Infinity,maxRetries=3}={}) {
  let retries=0;
  return async(url,init)=>{
    const read=async()=>{
      const response=await fetchImpl(url,init);
      // Only transport-level 5xx is retriable here. Denials and malformed JSON
      // pass through to safe-fetch and are never retried.
      if([500,502,504].includes(response.status)&&retries<maxRetries
        && /application\/json/i.test(response.headers.get('content-type')||'')
        && response.headers.get('cf-mitigated')!=='challenge'
        && !/denied/i.test(response.headers.get('x-tengine-error')||'')) {
        await response.body?.cancel();
        throw Object.assign(new Error('公开目录服务器暂时异常'),{status:response.status});
      }
      return response;
    };
    if(retries>=maxRetries)return fetchImpl(url,init);
    let attempt=0;
    return withPublicReadRetry(()=>{if(attempt++)retries++;if(init?.signal?.aborted)throw init.signal.reason;return read();},{sleep,deadline});
  };
}
