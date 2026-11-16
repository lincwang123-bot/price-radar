// Language routing only. Both locales use the existing public renderers.
import {priceHref} from './price-routes.mjs';
import {PUBLIC_ORIGIN,englishPathForChinese,languageAlternates} from './public-locales.mjs';
import {localizePublicHtml,escapeHtml,decodeHtml} from './public-translation.mjs';
import {englishSeo} from './english-seo.mjs';

export function englishSourceUrl(url,directory){
 const source=new URL(url);source.pathname=source.pathname.slice(3)||'/';
 if(source.pathname.startsWith('/prices/')){
  const key=source.pathname.slice(8),category=directory.find(c=>c.products.some(p=>p.key===key));
  if(!category)return null;
  source.pathname='/';source.searchParams.set('family',category.key);source.searchParams.set('product',key);
 }else if(source.pathname==='/official-prices'&&source.searchParams.has('id')){
  source.pathname='/product';source.searchParams.set('source','cardnav-official');
 }else if(/^\/official-prices\/[a-z0-9-]+$/.test(source.pathname)){
 }else if(!['/','/catalog','/official-prices','/shop','/about','/sources'].includes(source.pathname))return null;
 return source;
}
export function englishResponse(url,{directory,render}){
 if(url.pathname==='/en')return {status:301,location:'/en/'+url.search};
 if(!url.pathname.startsWith('/en/'))return null;
 if(url.pathname!=='/en/'&&url.pathname.endsWith('/'))return {status:301,location:url.pathname.slice(0,-1)+url.search};
 const source=englishSourceUrl(url,directory()),page=render(source);
 let html=page.html.replace(/<aside class="muse-egg"[\s\S]*?<\/aside>/g,'');
 const filtered=['delivery','recharge','purchase','channel','currency','sort','pricing','pricing_type','spec','shop_q','region','period','brand','q'].some(key=>url.searchParams.has(key)&&!['','all','default',...(key==='pricing'?['listed']:[]),...(key==='pricing_type'?['regular']:[])].includes(url.searchParams.get(key)));
 const status=page.status||200,noindex=status!==200||filtered||/<meta name="robots" content="noindex/.test(html)||Number(url.searchParams.get('review_page'))>1;
 const rawCanonical=html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
 const zhCanonical=rawCanonical?new URL(decodeHtml(rawCanonical)):source||new URL('/',PUBLIC_ORIGIN);
 const canonical=englishPathForChinese(zhCanonical)||'/en/';
 const switchUrl=new URL(source||'/',PUBLIC_ORIGIN);
 if(switchUrl.pathname==='/'&&switchUrl.searchParams.has('product')){
  const path=priceHref(switchUrl.searchParams.get('product'));
  if(path){switchUrl.pathname=path;switchUrl.searchParams.delete('family');switchUrl.searchParams.delete('product');}
 }
 const chinese=switchUrl.pathname+switchUrl.search;
 const {title,description,graph}=englishSeo(html,{canonical,status});
 // Rebuild locale metadata from the shared renderer's evidence. Unrelated
 // embedded scripts/JSON and protected merchant text remain unchanged.
 html=html.replace(/<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g,'').replace(/<meta\b[^>]*(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/g,'').replace(/<link\b[^>]*rel="(?:canonical|alternate)"[^>]*>/g,'');
 html=localizePublicHtml(html,{chinese});
 const meta='<link rel="canonical" href="'+escapeHtml(PUBLIC_ORIGIN+canonical)+'"><meta name="description" content="'+escapeHtml(description)+'"><meta name="robots" content="'+(noindex?'noindex':'index')+', follow">'+(!noindex?languageAlternates(zhCanonical.pathname+zhCanonical.search,canonical):'')+'<meta property="og:title" content="'+escapeHtml(title)+'"><meta property="og:description" content="'+escapeHtml(description)+'"><meta property="og:locale" content="en_US"><meta property="og:type" content="website"><meta property="og:url" content="'+escapeHtml(PUBLIC_ORIGIN+canonical)+'"><meta property="og:image" content="'+PUBLIC_ORIGIN+'/assets/brands/airadar.png"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="'+escapeHtml(title)+'"><meta name="twitter:description" content="'+escapeHtml(description)+'"><meta name="twitter:image" content="'+PUBLIC_ORIGIN+'/assets/brands/airadar.png">'+(graph.length?'<script type="application/ld+json">'+JSON.stringify(graph).replace(/</g,'\\u003c')+'</script>':'');
 html=html.replace(/<title>[\s\S]*?<\/title>/,'<title>'+escapeHtml(title)+'</title>').replace('</head>',meta+'</head>');
 return {status,noindex,html};
}
