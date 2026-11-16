import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {parsePublicProduct,readHtml,htmlFailure} from '../../lib/public-catalog-html.mjs';
import {parseReviewedAcgItem} from '../../lib/public-acg-item.mjs';

// Exact reviewed URLs only. Discovery, script downloads and API fallbacks are
// intentionally absent; the outer fetch enforces the same contract per request.
export async function collectPublicReplyPages(target,access,options){
 const offers=[],rejections=[];
 // This reviewed storefront supplies independent product pages. A conflicting
 // product must not erase other verified quotes, or refresh its old cached one.
 // Transport/access failures still abort the whole read, before this parse step.
 const isolateInvalidProducts=target.origin==='https://liunenglabs.xyz';
 for(const url of access.publicUrls){
  const html=await safeFetchText(url,{...options,allowedOrigins:[target.origin],maxRedirects:0,maxBytes:1024*1024,
   headers:{accept:'text/html,application/xhtml+xml'}});
  try {
   const reviewed=parseReviewedAcgItem(html,{url},target,options.capturedAt);
   if(reviewed){offers.push(reviewed);continue;}
   const doc=readHtml(html);
   if(doc.all.some(n=>n.attrs.id==='app')&&!doc.all.some(n=>n.tag==='h1')&&!doc.graph.some(p=>p['@type']==='Product'))
    throw htmlFailure('允许的页面需要动态渲染，未读取脚本或接口','PAGE_REQUIRES_RENDERING');
   offers.push(parsePublicProduct(html,{url},target,options.capturedAt));
  } catch(error) {
   if(!isolateInvalidProducts||error.code!=='INVALID_CATALOG')throw error;
   rejections.push({url,reasonCode:'invalid_catalog'});
  }
 }
 if(rejections.length){
  if(!offers.length)throw htmlFailure();
  const catalogValidation={listedCount:access.publicUrls.length,parsedCount:offers.length,rejectedCount:rejections.length,rejections};
  return offers.map(offer=>({...offer,extra:{...offer.extra,catalogValidation}}));
 }
 return offers;
}
