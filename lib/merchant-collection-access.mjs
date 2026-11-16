import {publicHttpsUrl} from './public-network-fetch.mjs';
import {reviewedHostedCatalog} from './reviewed-hosted-catalogs.mjs';

const fail=()=>{throw new Error('公开读取约束无效或未匹配已核验回复');};
const FIELDS=['mode','replyId','publicUrls','minimumIntervalMs','permissionScope'];
function pageUrl(value,origin){
 if(typeof value!=='string'||value.length>500||/[\\\u0000-\u0020\u007f]/.test(value))fail();
 const url=publicHttpsUrl(value);
 if(url.href!==value||url.origin!==origin||url.search||url.hash||/%2f|%5c|%2e/i.test(url.pathname)
  ||/(?:^|\/)(?:admin|login|account|orders?|checkout|api|assets|_next)(?:\/|$)/i.test(url.pathname)
  ||/\.(?:js|mjs|json|xml)$/i.test(url.pathname))fail();
 return url.href;
}

// Public manifests carry only this bounded contract. The operator-only queue
// additionally supplies replyId/publicUrls to attest the exact verified round.
// No free-form merchant prose is interpreted as authorization here.
export function normalizeCollectionAccess(value,{shopUrl,replyId,publicUrls}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!FIELDS.includes(key)))fail();
 const origin=publicHttpsUrl(shopUrl).origin;
 const hosted=value.mode==='hosted_catalog'&&value.publicUrls?.length===1?reviewedHostedCatalog(shopUrl,value.publicUrls[0]):null;
 if((value.mode!=='public_pages_only'&&!hosted)||!Number.isSafeInteger(value.replyId)||value.replyId<1
  ||(replyId!==undefined&&value.replyId!==replyId)
  ||!Number.isSafeInteger(value.minimumIntervalMs)||value.minimumIntervalMs<1100||value.minimumIntervalMs>60000
  ||!['ongoing','test_only'].includes(value.permissionScope)
  ||!Array.isArray(value.publicUrls)||value.publicUrls.length<1||value.publicUrls.length>5)fail();
 if(hosted&&value.minimumIntervalMs<hosted.minimumIntervalMs)fail();
 const urls=value.publicUrls.map(url=>pageUrl(url,hosted?.origin||origin));
 if(new Set(urls).size!==urls.length)fail();
 if(publicUrls!==undefined){
  if(!Array.isArray(publicUrls))fail();
  const allowed=new Set([...publicUrls,publicHttpsUrl(shopUrl).href]);
  if(urls.some(url=>!allowed.has(url)))fail();
 }
 return {mode:value.mode,replyId:value.replyId,publicUrls:[...urls].sort(),minimumIntervalMs:value.minimumIntervalMs,permissionScope:value.permissionScope};
}

export const sameCollectionAccess=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
