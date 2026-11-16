import {priceProduct} from './price-routes.mjs';
export const PUBLIC_ORIGIN='https://airadar.vip';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>/^[a-z0-9][a-z0-9-]{0,99}$/.test(value||'');
// Called on a renderer-established canonical, not on arbitrary user claims.
export function englishPathForChinese(url){
 let path=null;
 if(url.pathname==='/'){
  if(id(url.searchParams.get('product'))&&id(url.searchParams.get('family')))path='/en/prices/'+url.searchParams.get('product');
  else path='/en/'+(id(url.searchParams.get('family'))?'?family='+url.searchParams.get('family'):'');
 }else if(priceProduct(url.pathname.slice('/prices/'.length))&&url.pathname.startsWith('/prices/'))path='/en'+url.pathname;
 else if(url.pathname==='/shop'&&/^[a-f0-9]{24}$/.test(url.searchParams.get('id')||''))path='/en/shop?id='+url.searchParams.get('id');
 else if(url.pathname==='/product'&&url.searchParams.get('source')==='cardnav-official'&&id(url.searchParams.get('id')))path='/en/official-prices/'+url.searchParams.get('id');
 else if(/^\/official-prices\/[a-z0-9-]+$/.test(url.pathname))path='/en'+url.pathname;
 else if(['/catalog','/official-prices','/about','/sources'].includes(url.pathname))path='/en'+url.pathname;
 if(path&&/^[2-9]\d*$|^1\d+$/.test(url.searchParams.get('page')||''))path+=(path.includes('?')?'&':'?')+'page='+url.searchParams.get('page');
 return path;
}
export function languageAlternates(chinese,english){
 return [['zh-CN',chinese],['en',english],['x-default',chinese]].map(([lang,path])=>'<link rel="alternate" hreflang="'+lang+'" href="'+esc(PUBLIC_ORIGIN+path)+'">').join('');
}
export function decorateChineseLanguage(html,url,status=200){
 if(status!==200)return html;
 html=html.replace(/(<nav class="app-nav"[^>]*>[\s\S]*?)(<\/nav>)/,'$1<a class="nav-link" data-language-switch href="/en/" lang="en" hreflang="en">English</a>$2');
 const raw=html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&');
 const canonical=raw?new URL(raw):null,english=(canonical&&englishPathForChinese(canonical))||(url.pathname==='/'&&url.searchParams.has('shop_q')?'/en/':null);
 if(!english)return html;
 const target=new URL(english,PUBLIC_ORIGIN);
 for(const key of ['delivery','recharge','purchase','channel','currency','sort','pricing','pricing_type','spec','shop_q','page','review_page','region','period','brand','q'])if(url.searchParams.has(key))target.searchParams.set(key,url.searchParams.get(key));
 html=html.replace('data-language-switch href="/en/"','data-language-switch href="'+esc(target.pathname+target.search)+'"');
 return !canonical||/<meta name="robots" content="noindex/.test(html)?html:html.replace('</head>',languageAlternates(canonical.pathname+canonical.search,english)+'</head>');
}
