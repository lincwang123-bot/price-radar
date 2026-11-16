import {safeFetchJson} from '../../lib/safe-fetch.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';
import {collectShopApi} from './shop-api.mjs';

// Verified against CatFK's public shop route and its linked shop module.
// All requests stay inside the submitted shop; no platform-wide catalogue.
export async function collectCatfk(target,options={}) {
  if(!isAuthorizedMerchantTarget(target)||!['https://catfk.com','https://www.catfk.com'].includes(target.origin)
    ||!/^[A-Za-z0-9_-]{1,100}$/.test(target.token||''))throw new Error('猫店公开店铺未登记');
  const info=await safeFetchJson(target.origin+'/shopApi/Shop/info',{
    ...options,allowedOrigins:[target.origin],allowedMethods:['POST'],method:'POST',maxRedirects:0,maxBytes:128*1024,
    headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({token:target.token}),
  });
  if(info?.code!==1||info.data?.token!==target.token)throw new Error('猫店店铺身份不匹配');
  return collectShopApi({...target,strictShopToken:true},options);
}
