// Only attribution parameters are disposable. Unknown/filter parameters remain
// byte-for-byte distinct, including duplicates and ordering. Keep the tracking
// list aligned with airadar_cache_args in the gateway configuration.
export function publicCacheUrl(value) {
 const text=String(value),index=text.indexOf('?');
 const path=index<0?text:text.slice(0,index),query=index<0?'':text.slice(index+1);
 if(!query)return path;
 const kept=query.split('&').filter(pair=>! /^(?:utm_[a-z0-9_]+|gclid|dclid|fbclid|msclkid|gbraid|wbraid)=/i.test(pair));
 return path+(kept.length?'?'+kept.join('&'):'');
}
