// One exact public catalogue supplied by the authenticated original applicant.
// This is not a general cross-origin collection capability.
export function reviewedHostedCatalog(shopUrl,pageUrl){
 return shopUrl==='https://gptibo.com/r/U1CQ32'&&pageUrl==='https://cocos666a.github.io/tibo-price/'
  ?{shopUrl,pageUrl,origin:'https://cocos666a.github.io',minimumIntervalMs:3000}:null;
}
export function reviewedHostedBuyUrl(shopUrl,pageUrl,value){
 if(!reviewedHostedCatalog(shopUrl,pageUrl))return false;
 try{const u=new URL(value);return u.href===value&&u.origin==='https://gptibo.com'&&!u.search&&!u.hash
  &&/^\/r\/U1CQ32\/product\/[a-z0-9-]+$/.test(u.pathname);}catch{return false;}
}
