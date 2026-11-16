// Ownership proof for public URL notifications; never an account/admin credential.
import {DEFAULT_PAGES} from '../sources/cardnav.mjs';
import {CONTENT_PATHS} from './guides.mjs';
import {PRICE_PRODUCTS} from './price-routes.mjs';
export const INDEXNOW_ORIGIN='https://airadar.vip';
export const INDEXNOW_KEY='22c6e86b2f1e1681b55d9bf306810a8b';
export const INDEXNOW_KEY_PATH='/'+INDEXNOW_KEY+'.txt';
export const INDEXNOW_ENDPOINT='https://api.indexnow.org/indexnow';
const eligible=new Set(['/', '/catalog', '/sources', '/about', '/official-prices', '/weekly', ...DEFAULT_PAGES.flatMap(id=>['/official-prices/'+id,'/en/official-prices/'+id]), ...CONTENT_PATHS, ...PRICE_PRODUCTS.map(p=>p.path), '/?family=gemini&product=gemini-claim-link']);

export function indexNowUrl(value){
 if(typeof value!=='string')throw new Error('URL must be a string');
 const url=new URL(value,INDEXNOW_ORIGIN);
 if(url.origin!==INDEXNOW_ORIGIN||url.username||url.password||url.hash||!eligible.has(url.pathname+url.search))throw new Error('URL is outside the reviewed public canonical allowlist');
 return url.href;
}
function timestamp(value){
 if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('A valid timestamp with timezone is required');
 return Date.parse(value);
}
export function planIndexNow(manifest,state,now=Date.now()){
 if(state?.version!==1||!Array.isArray(state.accepted)||!Array.isArray(state.pending))throw new Error('Initialize a valid notification state first');
 const activated=timestamp(state.activatedAt);
 if(activated>now)throw new Error('Activation time is in the future');
 if(!Array.isArray(manifest?.changes)||manifest.changes.length>20)throw new Error('Provide at most 20 reviewed changes');
 const selected=[],skipped=[],seen=new Set();
 for(const change of manifest.changes){
  const url=indexNowUrl(change.url),changed=timestamp(change.changedAt);
  if(changed>now)throw new Error('Change date is in the future');
  if(typeof change.reason!=='string'||change.reason.trim().length<4||!/^([a-f0-9]{64})$/.test(change.revision||''))throw new Error('Provide a meaningful reason and release SHA-256');
  if(seen.has(url))throw new Error('One reviewed change per URL in a batch');
  seen.add(url);
  const item={url,changedAt:change.changedAt,reason:change.reason.trim(),revision:change.revision};
  let why;
  if(changed<=activated)why='predates_activation';
  else if(state.accepted.some(x=>x.url===url&&x.revision===item.revision))why='already_accepted';
  else if(state.pending.some(x=>x.url===url))why='previous_attempt_uncertain';
  else if(state.accepted.some(x=>x.url===url&&now-timestamp(x.submittedAt)<300000))why='five_minute_cooldown';
  if(why)skipped.push({...item,why});else selected.push(item);
 }
 return {selected,skipped};
}
const request=(fetcher,url,options={})=>fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'AIradarSEOAudit/1.0',...options.headers},...options});
export async function verifyIndexNowKey(fetcher=fetch){
 const response=await request(fetcher,INDEXNOW_ORIGIN+INDEXNOW_KEY_PATH);
 if(response.status!==200||(await response.text())!==INDEXNOW_KEY)throw new Error('Public key file does not match');
}
export async function verifyIndexNowPage(url,fetcher=fetch){
 indexNowUrl(url);
 const response=await request(fetcher,url);
 if(response.status!==200||!String(response.headers.get('content-type')).includes('text/html'))throw new Error('Canonical page must return HTML with HTTP 200');
 const body=await response.text();
 const attributes=tag=>Object.fromEntries(Array.from(tag.matchAll(/([a-z-]+)=["']([^"']*)["']/gi),m=>[m[1].toLowerCase(),m[2]]));
 const meta=Array.from(body.matchAll(/<meta\b[^>]*>/gi),m=>attributes(m[0]));
 const directives=[response.headers.get('x-robots-tag')||'',...meta.filter(m=>/^(robots|googlebot|bingbot)$/i.test(m.name||'')).map(m=>m.content||'')].join(',');
 if(/\b(noindex|none)\b/i.test(directives))throw new Error('Page is excluded from indexing');
 const canonical=Array.from(body.matchAll(/<link\b[^>]*>/gi),m=>attributes(m[0])).find(a=>a.rel?.toLowerCase()==='canonical')?.href?.replaceAll('&amp;','&');
 if(canonical!==url)throw new Error('Page canonical differs from the submitted URL');
}
export async function notifyIndexNow(selected,fetcher=fetch){
 if(!selected.length||selected.length>20)throw new Error('Submit 1 to 20 reviewed URLs');
 const payload={host:'airadar.vip',key:INDEXNOW_KEY,keyLocation:INDEXNOW_ORIGIN+INDEXNOW_KEY_PATH,urlList:selected.map(x=>indexNowUrl(x.url))};
 const response=await request(fetcher,INDEXNOW_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(payload)});
 await response.body?.cancel();
 return {status:response.status,accepted:[200,202].includes(response.status),keyValidationPending:response.status===202,retryAfter:response.headers.get('retry-after')};
}
