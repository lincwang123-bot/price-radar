// Search metadata describes the public comparison pages, never private submissions.
import {publicProductName,publicSpec} from './market-view.mjs';
import {DIRECTORY_CATEGORIES,directoryQuotes} from './product-directory.mjs';
import {CONTENT_PATHS,articleForPath,contentForPath} from './guides.mjs';
import {retiredCatalogItem} from './catalog-policy.mjs';
export const SITE_ORIGIN='https://airadar.vip';
// Public ownership proof: preserve the supplied file bytes exactly, without a newline.
const BAIDU_VERIFICATION_PATH='/baidu_verify_codeva-5RkS1i3vOP.html';
const BAIDU_VERIFICATION_BODY='67e45203694e31d32e7dec268a770435';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames={'direct-shops':'原店直采',priceai:'PriceAI','cardnav-official':'官方参考','ldxp-goods':'链动公开数据','goaihop-relay':'GoAIHop公开数据'};
export function seoProducts(db){return db.prepare(`WITH latest AS (SELECT source,snapshot_id,ROW_NUMBER() OVER(PARTITION BY source ORDER BY fetched_at DESC,rowid DESC) n FROM snapshots) SELECT p.* FROM latest s JOIN products p ON p.source=s.source AND p.snapshot_id=s.snapshot_id WHERE s.n=1 ORDER BY p.source,p.product_id`).all().filter(p=>!retiredCatalogItem(p));}
export function seoProduct(db,url){const source=url.searchParams.get('source')||'priceai',id=url.searchParams.get('id');if(!id)return null;const p=db.prepare(`SELECT p.* FROM products p WHERE source=? AND product_id=? AND snapshot_id=(SELECT snapshot_id FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1)`).get(source,id,source);return p&&!retiredCatalogItem(p)?p:null;}
const productUrl=p=>SITE_ORIGIN+'/product?'+new URLSearchParams({source:p.source,id:p.product_id});
// Only the directory renderer may establish a product identity. Query parameters
// alone are not evidence that a product exists or belongs to the chosen brand.
function directoryPage(html,url){
 const tag=html.match(/<section\b[^>]*\bdata-directory-family="[^"]*"[^>]*>/)?.[0];
 if(!tag)return null;
 const attr=name=>tag.match(new RegExp('\\b'+name+'="([^"]*)"'))?.[1]||'';
 const family=attr('data-directory-family');
 const category=DIRECTORY_CATEGORIES.find(c=>c.key===family);
 if(!category||family!==url.searchParams.get('family'))return null;
 const key=attr('data-directory-product'),encodedName=attr('data-directory-product-name');
 const name=encodedName.replace(/&(amp|quot|apos|#39|lt|gt);/g,(_,entity)=>({amp:'&',quot:'"',apos:"'",'#39':"'",lt:'<',gt:'>'}[entity]));
 const product=key===url.searchParams.get('product')&&/^[a-z0-9][a-z0-9-]*$/.test(key)&&name?{key,name}:null;
 return {category,product};
}
export function sitemap(db,directory=[]){const urls=[SITE_ORIGIN+'/',SITE_ORIGIN+'/sources',SITE_ORIGIN+'/privacy',SITE_ORIGIN+'/advertise',SITE_ORIGIN+'/weekly'];
 urls.push(...CONTENT_PATHS.map(path=>SITE_ORIGIN+path));
 // Use the same public directory as the page renderer, including title-classified
 // search results. Empty records and secondary filters are not sitemap entries.
 for(const category of directory){
  const products=category.products.filter(product=>directoryQuotes(product).total>0);
  if(!products.length)continue;
  urls.push(SITE_ORIGIN+'/?'+new URLSearchParams({family:category.key}));
  for(const product of products)urls.push(SITE_ORIGIN+'/?'+new URLSearchParams({family:category.key,product:product.key}));
 }
 urls.push(...seoProducts(db).map(productUrl));
 // Observation timestamps are not edit timestamps. Omit lastmod until actual content-change tracking exists.
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(urls)].map(u=>`<url><loc>${esc(u)}</loc></url>`).join('')+'</urlset>';
}
export const robotsText=`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /submissions/\nDisallow: /analytics/\nDisallow: /following\nDisallow: /unsubscribe\nDisallow: /claim-shop\nDisallow: /login\nDisallow: /register\nDisallow: /reset-password\nDisallow: /account\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
export function seoRoute(req,res,url,db,loadDirectory=()=>[]){
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
 if(loopback&&req.headers['x-forwarded-proto']==='http'&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:SITE_ORIGIN+url.pathname+url.search});res.end();return true;}
 if(loopback&&req.headers['x-forwarded-proto']==='https')res.setHeader('Strict-Transport-Security','max-age=15552000');
 if(url.pathname===BAIDU_VERIFICATION_PATH){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(BAIDU_VERIFICATION_BODY),'X-Robots-Tag':'noindex, nofollow'});
  res.end(req.method==='HEAD'?'':BAIDU_VERIFICATION_BODY);return true;
 }
 if(['/index.html','/product/','/sources/','/privacy/','/alerts/','/advertise/'].includes(url.pathname)&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:(url.pathname==='/index.html'?'/':url.pathname.slice(0,-1))+url.search});res.end();return true;}
 if(url.pathname.startsWith('/api/')||['/submit','/submit-shop','/following','/unsubscribe','/claim-shop','/login','/register','/reset-password','/account'].includes(url.pathname))res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(url.pathname.endsWith('/')&&contentForPath(url.pathname.slice(0,-1))&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:url.pathname.slice(0,-1)+url.search});res.end();return true;}
 if(!['/robots.txt','/sitemap.xml'].includes(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
 res.setHeader('Content-Type',url.pathname==='/robots.txt'?'text/plain; charset=utf-8':'application/xml; charset=utf-8');res.end(req.method==='HEAD'?'':url.pathname==='/robots.txt'?robotsText:sitemap(db,loadDirectory()));return true;
}
export function decorateSeo(html,url,db,status=200){
 const privatePage=['/submit','/submit-shop','/following','/unsubscribe','/claim-shop','/login','/register','/reset-password','/account'].includes(url.pathname)||status>=400;
 if(privatePage)return html.replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
 // Internal search is not a product landing page and must not be indexed.
 if(url.pathname==='/'&&String(url.searchParams.get('shop_q')||'').trim())return html.replace('</head>','<meta name="robots" content="noindex, follow"></head>');
 const product=url.pathname==='/product'?seoProduct(db,url):null;
 let canonical=SITE_ORIGIN+url.pathname, title=html.match(/<title>(.*?)<\/title>/s)?.[1]||'AI 订阅价格雷达';
 let description=({'/':'比较 ChatGPT、Claude、Gemini 等 AI 订阅的公开报价、库存与历史价格，按交易渠道筛选并前往原店核验。本站不售卖账号，不提供交易担保。','/advertise':'查看 AIradar 首页、分类页和产品页的后置赞助示例、合作档期与投放建议。支持同页 1～4 家彩色广告卡，申请后人工确认档期。','/sources':'了解 AI 订阅报价的公开收录范围、更新时间、规格比较方法及购买前核验事项。','/alerts':'查看 AI 订阅公开报价变化提醒，结合历史记录与原店信息核验价格。','/privacy':'了解 AI 订阅价格雷达的访问统计口径、数据保留期限及主动投稿的隐私保护方式。'})[url.pathname]||'AI 订阅公开报价与历史记录参考。';
 if(product){canonical=productUrl(product);const actualPage=Number(html.match(/第 (\d+) \/ \d+ 页/)?.[1]||1);if(actualPage>1)canonical+='&page='+actualPage;const name=publicProductName(product),spec=publicSpec(product.spec);title=`${name}价格与报价${spec?' · '+spec:''}${actualPage>1?' · 第'+actualPage+'页':''} · AI 订阅价格雷达`;description=`查看${name}${spec?'（'+spec+'）':''}的公开报价、库存状态、交易平台与历史价格${actualPage>1?'，报价第'+actualPage+'页':''}。仅展示本站已收录信息，价格与规格以店铺结算页面为准，本站不提供交易担保。`;}
 if(url.pathname==='/'){
  title='AI订阅产品目录｜ChatGPT、Claude、Gemini · AI订阅价格雷达';
  description='按品牌浏览 AI 订阅及邮箱的产品，直接查看多家店铺的公开报价、商品规格与交易平台，支持价格排序。价格以原店结算页面为准。';
  const directory=directoryPage(html,url);
  if(directory){
   const {category,product:chosen}=directory,params=new URLSearchParams({family:category.key});
   if(chosen)params.set('product',chosen.key);
   canonical=SITE_ORIGIN+'/?'+params;
   title=chosen?`${chosen.name}公开报价与规格 · AI订阅价格雷达`:`${category.label}产品目录与公开报价 · AI订阅价格雷达`;
   description=chosen?`查看${chosen.name}多家店铺的公开报价、交付规格与原店入口，按价格排序并筛选交易平台。不同规格请分别核对，价格与库存以店铺结算页面为准，本站不提供交易担保。`:`浏览${category.label}已收录的产品，一次点击查看多家店铺的公开报价与规格。价格与库存以原店页面为准。`;
  }
 }
 if(url.pathname==='/shop'){
  const id=html.match(/data-shop-id="([a-f0-9]{24})"/)?.[1];
  if(id&&id===url.searchParams.get('id'))canonical+='?'+new URLSearchParams({id});
  description='查看这家店铺已收录的 AI 产品报价与店主自愿认领的 X 账号关联。认领不代表信用或交易安全保证，价格与库存以原店结算页为准。';
 }
 if(url.pathname==='/weekly'){
  const date=url.searchParams.get('date');
  title='AI 产品行情周报'+(date?' · 截至 '+date:'')+' · AIradar';
  description='查看同规格 AI 订阅挂牌价的真实变化，了解观察日期、报价范围与购买条件。历史不足时不推算完整一周。';
  if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))canonical+='?date='+date;
 }
 const content=contentForPath(url.pathname),article=articleForPath(url.pathname);
 if(content){title=content.title+' · AI订阅雷达';description=content.description;}
 const schema=[{'@context':'https://schema.org','@type':'WebSite','@id':SITE_ORIGIN+'/#website',url:SITE_ORIGIN+'/',name:'AI订阅价格雷达',inLanguage:'zh-CN'},{'@context':'https://schema.org','@type':url.pathname==='/'||content&&!article?'CollectionPage':'WebPage',url:canonical,name:title,description,inLanguage:'zh-CN',isPartOf:{'@id':SITE_ORIGIN+'/#website'}}];
 if(article){schema.push({'@context':'https://schema.org','@type':'Article',url:canonical,headline:article.title,description:article.description,datePublished:article.published,dateModified:article.updated,inLanguage:'zh-CN',mainEntityOfPage:canonical,author:{'@type':'Organization',name:article.author,url:SITE_ORIGIN+'/'}});schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'首页',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:article.section.label,item:SITE_ORIGIN+article.section.path},{'@type':'ListItem',position:3,name:article.title,item:canonical}]});}
 if(product)schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'AI订阅价格比较',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:publicProductName(product),item:canonical}]});
 if(url.pathname==='/'){const linked=new Set([...html.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>{const u=new URL(m[1].replaceAll('&amp;','&'),SITE_ORIGIN);return productUrl({source:u.searchParams.get('source'),product_id:u.searchParams.get('id')})}));if(linked.size){const items=seoProducts(db).filter(p=>linked.has(productUrl(p))).slice(0,500).map((p,i)=>({'@type':'ListItem',position:i+1,name:publicProductName(p),url:productUrl(p)}));if(items.length)schema.push({'@context':'https://schema.org','@type':'ItemList',itemListElement:items});}}
 const verification=[['google-site-verification',process.env.GOOGLE_SITE_VERIFICATION],['baidu-site-verification',process.env.BAIDU_SITE_VERIFICATION]].filter(([,v])=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(v)).map(([k,v])=>`<meta name="${k}" content="${esc(v)}">`).join('');
 const tags=`<link rel="canonical" href="${esc(canonical)}"><meta name="description" content="${esc(description)}"><meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="${article?'article':'website'}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:locale" content="zh_CN"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">${verification}<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>`;
 return html.replace(/<title>.*?<\/title>/s,`<title>${esc(title)}</title>`).replace('</head>',tags+'</head>');
}
