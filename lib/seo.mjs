// Search metadata describes the public comparison pages, never private submissions.
import {publicProductName,publicSpec} from './market-view.mjs';
export const SITE_ORIGIN='https://airadar.vip';
// Public ownership proof: preserve the supplied file bytes exactly, without a newline.
const BAIDU_VERIFICATION_PATH='/baidu_verify_codeva-5RkS1i3vOP.html';
const BAIDU_VERIFICATION_BODY='67e45203694e31d32e7dec268a770435';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames={'direct-shops':'原店直采',priceai:'PriceAI','cardnav-official':'官方参考','ldxp-goods':'链动公开数据','goaihop-relay':'GoAIHop公开数据'};
export function seoProducts(db){return db.prepare(`WITH latest AS (SELECT source,snapshot_id,ROW_NUMBER() OVER(PARTITION BY source ORDER BY fetched_at DESC,rowid DESC) n FROM snapshots) SELECT p.* FROM latest s JOIN products p ON p.source=s.source AND p.snapshot_id=s.snapshot_id WHERE s.n=1 ORDER BY p.source,p.product_id`).all();}
export function seoProduct(db,url){const source=url.searchParams.get('source')||'priceai',id=url.searchParams.get('id');if(!id)return null;return db.prepare(`SELECT p.* FROM products p WHERE source=? AND product_id=? AND snapshot_id=(SELECT snapshot_id FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1)`).get(source,id,source)||null;}
const productUrl=p=>SITE_ORIGIN+'/product?'+new URLSearchParams({source:p.source,id:p.product_id});
export function sitemap(db){const urls=[SITE_ORIGIN+'/',SITE_ORIGIN+'/sources',SITE_ORIGIN+'/privacy',SITE_ORIGIN+'/advertise',...seoProducts(db).map(productUrl)];
 // Observation timestamps are not edit timestamps. Omit lastmod until actual content-change tracking exists.
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(urls)].map(u=>`<url><loc>${esc(u)}</loc></url>`).join('')+'</urlset>';
}
export const robotsText=`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /submissions/\nDisallow: /analytics/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
export function seoRoute(req,res,url,db){
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
 if(loopback&&req.headers['x-forwarded-proto']==='http'&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:SITE_ORIGIN+url.pathname+url.search});res.end();return true;}
 if(loopback&&req.headers['x-forwarded-proto']==='https')res.setHeader('Strict-Transport-Security','max-age=15552000');
 if(url.pathname===BAIDU_VERIFICATION_PATH){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(BAIDU_VERIFICATION_BODY),'X-Robots-Tag':'noindex, nofollow'});
  res.end(req.method==='HEAD'?'':BAIDU_VERIFICATION_BODY);return true;
 }
 if(['/index.html','/product/','/sources/','/privacy/','/alerts/','/advertise/'].includes(url.pathname)&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:(url.pathname==='/index.html'?'/':url.pathname.slice(0,-1))+url.search});res.end();return true;}
 if(url.pathname.startsWith('/api/')||url.pathname==='/submit')res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(!['/robots.txt','/sitemap.xml'].includes(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
 res.setHeader('Content-Type',url.pathname==='/robots.txt'?'text/plain; charset=utf-8':'application/xml; charset=utf-8');res.end(req.method==='HEAD'?'':url.pathname==='/robots.txt'?robotsText:sitemap(db));return true;
}
export function decorateSeo(html,url,db,status=200){
 const privatePage=url.pathname==='/submit'||status>=400;
 if(privatePage)return html.replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
 const product=url.pathname==='/product'?seoProduct(db,url):null;
 let canonical=SITE_ORIGIN+url.pathname, title=html.match(/<title>(.*?)<\/title>/s)?.[1]||'AI 订阅价格雷达';
 let description=({'/':'比较 ChatGPT、Claude、Gemini 等 AI 订阅的公开报价、库存与历史价格，按交易渠道筛选并前往原店核验。本站不售卖账号，不提供交易担保。','/advertise':'了解 AirRadar 商品、分类、首页和全站 Sponsored 合作方式。广告独立于自然排名，申请后人工确认报价，不承诺销量。','/sources':'了解 AI 订阅报价的公开收录范围、更新时间、规格比较方法及购买前核验事项。','/alerts':'查看 AI 订阅公开报价变化提醒，结合历史记录与原店信息核验价格。','/privacy':'了解 AI 订阅价格雷达的访问统计口径、数据保留期限及主动投稿的隐私保护方式。'})[url.pathname]||'AI 订阅公开报价与历史记录参考。';
 if(product){canonical=productUrl(product);const actualPage=Number(html.match(/第 (\d+) \/ \d+ 页/)?.[1]||1);if(actualPage>1)canonical+='&page='+actualPage;const name=publicProductName(product),spec=publicSpec(product.spec);title=`${name}价格与报价${spec?' · '+spec:''}${actualPage>1?' · 第'+actualPage+'页':''} · AI 订阅价格雷达`;description=`查看${name}${spec?'（'+spec+'）':''}的公开报价、库存状态、交易平台与历史价格${actualPage>1?'，报价第'+actualPage+'页':''}。仅展示本站已收录信息，价格与规格以店铺结算页面为准，本站不提供交易担保。`;}
 if(url.pathname==='/')title='AI订阅价格比较｜ChatGPT、Claude、Gemini报价与走势 · AI订阅价格雷达';
 const schema=[{'@context':'https://schema.org','@type':'WebSite','@id':SITE_ORIGIN+'/#website',url:SITE_ORIGIN+'/',name:'AI订阅价格雷达',inLanguage:'zh-CN'},{'@context':'https://schema.org','@type':url.pathname==='/'?'CollectionPage':'WebPage',url:canonical,name:title,description,inLanguage:'zh-CN',isPartOf:{'@id':SITE_ORIGIN+'/#website'}}];
 if(product)schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'AI订阅价格比较',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:publicProductName(product),item:canonical}]});
 if(url.pathname==='/'){const linked=new Set([...html.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>{const u=new URL(m[1].replaceAll('&amp;','&'),SITE_ORIGIN);return productUrl({source:u.searchParams.get('source'),product_id:u.searchParams.get('id')})}));schema.push({'@context':'https://schema.org','@type':'ItemList',itemListElement:seoProducts(db).filter(p=>linked.has(productUrl(p))).slice(0,500).map((p,i)=>({'@type':'ListItem',position:i+1,name:publicProductName(p),url:productUrl(p)}))});}
 const verification=[['google-site-verification',process.env.GOOGLE_SITE_VERIFICATION],['baidu-site-verification',process.env.BAIDU_SITE_VERIFICATION]].filter(([,v])=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(v)).map(([k,v])=>`<meta name="${k}" content="${esc(v)}">`).join('');
 const tags=`<link rel="canonical" href="${esc(canonical)}"><meta name="description" content="${esc(description)}"><meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}"><meta property="og:locale" content="zh_CN"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">${verification}<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>`;
 return html.replace(/<title>.*?<\/title>/s,`<title>${esc(title)}</title>`).replace('</head>',tags+'</head>');
}
