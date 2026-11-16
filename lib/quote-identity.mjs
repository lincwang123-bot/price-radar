import {rechargeMethod} from './recharge-method.mjs';

export const QUOTE_IDENTITY_VERSION=2;
export function quoteDestinationKey(value){
 const url=new URL(value);
 url.hash='';url.hostname=url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
 for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(fbclid|gclid|msclkid)$/i.test(key))url.searchParams.delete(key);
 url.searchParams.sort();return url.href;
}
export function quoteIdentityKey(offer,{productKey='',currency=offer.currency,reference=false}={}){
 const destination=quoteDestinationKey(offer.url),url=new URL(destination);
 // Only this verified route identifies one SKU independently of its title.
 // Other product URLs can expose separately priced Web/iOS variants.
 const single=url.origin==='https://16688.com.cn'&&/^\/goods\/G\d+$/.test(url.pathname)&&!url.search;
 const known=offer.comparison_eligible!==false&&offer.comparison_known===true&&offer.comparison_key&&offer.comparison_key!=='mixed';
 return JSON.stringify([productKey,!!reference,destination,single?'16688-single-product':known?offer.comparison_key:String(offer.title||''),currency,single?'':rechargeMethod(offer).kind]);
}
