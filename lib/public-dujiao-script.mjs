// Read only explicitly linked modules. These signatures establish a public
// catalog route, not permission to request it; the caller still checks robots.
export const DUJIAO_PUBLIC_ENDPOINT='/api/v1/public/products';
export function linkedDujiaoProductModule(script,scriptUrl){
 if(typeof script!=='string'||Buffer.byteLength(script)>1024*1024||!/["']\/api\/v1["']/.test(script))return null;
 const paths=[...script.matchAll(/["']((?:\.\/|\/assets\/|assets\/)?product-[\w-]+\.js)["']/g)].map(m=>m[1]);
 const urls=[...new Set(paths.map(p=>new URL(p.startsWith('assets/')?'/'+p:p,scriptUrl).href))];
 if(urls.length!==1)return null;
 const url=new URL(urls[0]);
 return url.origin===new URL(scriptUrl).origin&&/^\/assets\/product-[\w-]+\.js$/.test(url.pathname)&&!url.search?url.href:null;
}
export function confirmsDujiaoProductModule(script){
 return typeof script==='string'&&Buffer.byteLength(script)<=64*1024
  && /\blist:\w+=>\w+\.get\(["']\/public\/products["'],\{params:\w+\}\)/.test(script)
  && /\bdetail:\w+=>\w+\.get\(`\/public\/products\/\$\{\w+\}`\)/.test(script);
}
