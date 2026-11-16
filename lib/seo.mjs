import {officialCatalog} from './official-prices.mjs';
import {officialSummary,officialModified,officialMarkdown} from './official-summary.mjs';
import {PRODUCT_FAQ,faqHtml,faqSchema} from './buying-faq.mjs';
// Search metadata describes the public comparison pages, never private submissions.
import {priceHref,priceIdentity,hasPriceFilters,compactPriceParams} from './price-routes.mjs';
import {readFileSync} from 'node:fs';
import {INDEXNOW_KEY,INDEXNOW_KEY_PATH} from './indexnow.mjs';
import {serveResearchDownload} from './research-downloads.mjs';
import {publicProductName,publicSpec} from './market-view.mjs';
import {DIRECTORY_CATEGORIES,directoryQuotes} from './product-directory.mjs';
import {CONTENT_PATHS,articleForPath,contentForPath,contentLastModified,faqEntities} from './guides.mjs';
import {llmsText} from './llms-txt.mjs';
import {retiredCatalogItem,retiredCatalogSource} from './catalog-policy.mjs';
import {officialPageData,officialProductHref,OFFICIAL_PATH,OFFICIAL_SOURCE} from './official-prices.mjs';
import {SHOP_SOURCES} from './public-offers.mjs';
import {botRobotsAgents} from './bot-allowlist.mjs';
export const SITE_ORIGIN='https://airadar.vip';
// Public ownership proof: preserve the supplied file bytes exactly, without a newline.
const BAIDU_VERIFICATION_PATH='/baidu_verify_codeva-5RkS1i3vOP.html';
const BAIDU_VERIFICATION_BODY='67e45203694e31d32e7dec268a770435';
const SITE_VERIFICATION_PATH='/3135103.txt';
const SITE_VERIFICATION_BODY=readFileSync(new URL('../3135103.txt',import.meta.url));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unescapeAttr=value=>String(value||'').replace(/&(amp|quot|apos|#39|lt|gt);/g,(_,entity)=>({amp:'&',quot:'"',apos:"'",'#39':"'",lt:'<',gt:'>'}[entity]));
const sourceNames={'direct-shops':'原店直采','cardnav-official':'官方参考','ldxp-goods':'链动公开数据','goaihop-relay':'GoAIHop公开数据'};
const PRODUCT_SCHEMA_PILOT=new Set(['chatgpt-go','chatgpt-plus','chatgpt-pro-5x','chatgpt-pro-20x','claude-pro','gemini-pro','cursor-pro','super-grok']);
const SHARE_IMAGE=SITE_ORIGIN+'/assets/brands/og-share.png';
const STATIC_LASTMOD={
 '/':null,'/catalog':'2026-10-25','/sources':'2026-10-25','/privacy':'2026-10-25','/about':'2026-10-25','/contact':'2026-10-25','/advertise':'2026-10-25','/weekly':null,'/official-prices':null,
 '/en/':'2026-10-25','/en/catalog':'2026-10-25','/en/about':'2026-10-25','/en/sources':'2026-10-25','/en/official-prices':'2026-10-25',
};
function visibleDirectoryOffers(html){
 const offers=[];
 for(const match of String(html||'').matchAll(/<article\b[^>]*\bdata-directory-quote\b[^>]*>/g)){
  const tag=match[0];
  if(!/data-delivery="recharge"/.test(tag)||!/data-in-stock="true"/.test(tag))continue;
  const price=Number(tag.match(/\bdata-price="([^"]*)"/)?.[1]);
  const currency=tag.match(/\bdata-currency="([^"]*)"/)?.[1]||'CNY';
  if(Number.isFinite(price)&&price>0)offers.push({price,currency});
 }
 return offers;
}
function aggregateOfferFromHtml(html){
 const offers=visibleDirectoryOffers(html);
 if(offers.length<1)return null;
 const byCurrency=new Map();
 for(const offer of offers){
  const list=byCurrency.get(offer.currency)||[];
  list.push(offer.price);
  byCurrency.set(offer.currency,list);
 }
 // Prefer CNY when present so schema matches the common visible listing currency.
 const currency=byCurrency.has('CNY')?'CNY':[...byCurrency.keys()].sort((a,b)=>byCurrency.get(b).length-byCurrency.get(a).length)[0];
 const prices=byCurrency.get(currency).slice().sort((a,b)=>a-b);
 return {priceCurrency:currency,lowPrice:prices[0],highPrice:prices.at(-1),offerCount:prices.length};
}
export function seoProducts(db){return db.prepare(`WITH latest AS (SELECT source,snapshot_id,ROW_NUMBER() OVER(PARTITION BY source ORDER BY fetched_at DESC,rowid DESC) n FROM snapshots) SELECT p.* FROM latest s JOIN products p ON p.source=s.source AND p.snapshot_id=s.snapshot_id WHERE s.n=1 ORDER BY p.source,p.product_id`).all().filter(p=>!retiredCatalogItem(p));}
export function seoProduct(db,url){const source=url.searchParams.get('source')||'direct-shops',id=url.searchParams.get('id');if(!id||retiredCatalogSource(source))return null;const p=db.prepare(`SELECT p.* FROM products p WHERE source=? AND product_id=? AND snapshot_id=(SELECT snapshot_id FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1)`).get(source,id,source);return p&&!retiredCatalogItem(p)?p:null;}
const productUrl=p=>SITE_ORIGIN+(p.source===OFFICIAL_SOURCE?officialProductHref(p.product_id):p.source==='direct-shops'&&priceIdentity(p.product_id)?priceIdentity(p.product_id).path:'/product?'+new URLSearchParams({source:p.source,id:p.product_id}));
// Exact historical URLs from the 2026-09-17 and 2026-10-08 GSC exports.
// The retired source no longer has local rows; this is not a wildcard redirect.
const migratedPriceAiProducts=new Map([
 ['chatgpt-plus','chatgpt-plus'],['chatgpt-plus-recharge','chatgpt-plus'],
 ['chatgpt-pro-5x','chatgpt-pro-5x'],['chatgpt-pro-20x','chatgpt-pro-20x'],
 ['super-grok-heavy','super-grok-heavy'],['chatgpt-team-business','chatgpt-team-business'],
 ['education-email','education-email'],
 // Oct8: each historical ID has a verified matching live product; tiers stay distinct.
 ['claude-pro-month','claude-pro'],['claude-max-5x','claude-max-5x'],['claude-max-20x','claude-max-20x'],
 ['gemini-pro-recharge','gemini-pro'],['gemini-pro-year','gemini-pro'],['gemini-ultra','gemini-ultra'],
 ['super-grok','super-grok'],['chatgpt-go','chatgpt-go'],['x-twitter-premium','x-twitter-premium'],
]);
// Observed historical direct-source alias. Existing history and a live product
// with quotes are still required below; this does not restore an expired offer.
const migratedDirectProducts=new Map([['perplexity-pro-1m','perplexity-pro']]);
// GSC still sends visitors to source-specific URLs after a catalog is retired
// or regrouped. Redirect only a proven historical identity to its live match;
// never republish retired quotes or send unrelated missing pages to the home page.
function historicalProductRedirect(db,url,loadDirectory){
 if(url.pathname!=='/product')return null;
 const source=url.searchParams.get('source')||'direct-shops',id=url.searchParams.get('id');
 if(!['priceai','direct-shops','ldxp-goods'].includes(source)||!id||!/^[a-z0-9-]{1,100}$/.test(id)||url.searchParams.getAll('source').length>1||url.searchParams.getAll('id').length!==1)return null;
 if(seoProduct(db,url))return null;
 const previous=source==='priceai'?null:db.prepare('SELECT product_id,name,platform FROM products WHERE source=? AND product_id=? LIMIT 1').get(source,id);
 if(source==='priceai'?!migratedPriceAiProducts.has(id):!previous||retiredCatalogItem(previous))return null;
 const key=source==='priceai'?migratedPriceAiProducts.get(id):priceIdentity(id)?.key||(source==='direct-shops'&&migratedDirectProducts.get(id))||id;
 const category=loadDirectory().find(c=>c.products.some(p=>p.key===key&&directoryQuotes(p,{pricing_type:'all'}).total>0));
 if(!category)return null;
 const clean=priceHref(key),params=new URLSearchParams(clean?undefined:{family:category.key,product:key});
 // Source-page pagination does not map to a merged directory. Preserve explicit
 // purchase filters and attribution, but never copy routing or external targets.
 for(const name of ['delivery','recharge','purchase','spec','currency','channel','sort','q','utm_source','utm_medium','utm_campaign','utm_content','utm_term']){
  if(url.searchParams.getAll(name).length===1)params.set(name,url.searchParams.get(name));
 }
 return (clean||'/')+(params.size?'?'+params:'');
}
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
export function sitemap(db,directory=[],weeks=[]){const urls=[SITE_ORIGIN+'/',SITE_ORIGIN+'/catalog',SITE_ORIGIN+'/sources',SITE_ORIGIN+'/privacy',SITE_ORIGIN+'/about',SITE_ORIGIN+'/contact',SITE_ORIGIN+'/advertise',SITE_ORIGIN+'/weekly',SITE_ORIGIN+OFFICIAL_PATH];
 urls.push(...['/en/','/en/catalog','/en/about','/en/sources','/en/official-prices'].map(path=>SITE_ORIGIN+path));
 for(const week of weeks)if(/^\d{4}-W\d{2}$/.test(week))urls.push(SITE_ORIGIN+'/weekly/'+week);
 urls.push(...CONTENT_PATHS.map(path=>SITE_ORIGIN+path));
 // Use the same public directory as the page renderer, including title-classified
 // search results and curated official-reference pages. Other empty records
 // and secondary filters are not sitemap entries.
 for(const category of directory){
  const products=category.products.filter(product=>directoryQuotes(product,{pricing_type:'all'}).total>0||product.officialReference);
  if(!products.length)continue;
  urls.push(...products.map(product=>SITE_ORIGIN+'/en/prices/'+product.key));
  for(const product of products)if(priceHref(product.key))urls.push(SITE_ORIGIN+priceHref(product.key));
 }
 const publicShopProducts=new Set(directory.flatMap(c=>c.products.flatMap(p=>directoryQuotes(p,{pricing_type:'all'}).entries.map(e=>JSON.stringify([e.list.source,e.product.product_id])))));
 urls.push(...seoProducts(db).filter(p=>SHOP_SOURCES.has(p.source)?publicShopProducts.has(JSON.stringify([p.source,p.product_id])):Number(p.offer_count)>0).filter(p=>p.source!==OFFICIAL_SOURCE&&!(SHOP_SOURCES.has(p.source)&&priceIdentity(p.product_id))).map(productUrl));
 const officialDates=new Map();
 for(const p of officialCatalog(db).products.filter(p=>p.rows.length))for(const prefix of ['', '/en']){const path=prefix+officialProductHref(p.id);urls.push(SITE_ORIGIN+path);officialDates.set(path,officialModified(p));}
 // Editorial dates are versioned with content. Dynamic quote pages still omit
 // lastmod: fetched_at alone cannot prove a substantive public content change.
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(urls)].map(u=>{const path=new URL(u).pathname;const modified=contentLastModified(path)||officialDates.get(path)||STATIC_LASTMOD[path]||null;return `<url><loc>${esc(u)}</loc>${modified?`<lastmod>${esc(modified)}</lastmod>`:''}</url>`;}).join('')+'</urlset>';
}
const robotsRules=`Allow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /submissions/\nDisallow: /analytics/\nDisallow: /following\nDisallow: /unsubscribe\nDisallow: /claim-shop\nDisallow: /login\nDisallow: /register\nDisallow: /reset-password\nDisallow: /account\n# Filter / search query variants (public clean product URLs remain allowed)\nDisallow: /*?*shop_q=\nDisallow: /*?*q=\nDisallow: /*?*delivery=\nDisallow: /*?*recharge=\nDisallow: /*?*purchase=\nDisallow: /*?*spec=\nDisallow: /*?*currency=\nDisallow: /*?*channel=\nDisallow: /*?*sort=\nDisallow: /*?*pricing=\nDisallow: /*?*pricing_type=\nDisallow: /*?*framework=\nDisallow: /*?*purpose=\nDisallow: /*?*utm_\n`;
const robotsGroup=agents=>agents.map(agent=>'User-agent: '+agent).join('\n')+'\n'+robotsRules;
// Search and AI crawlers get an explicit group so a later rule cannot look like a ban.
// The same private-path Disallows still apply. Bulk price scraping is not a robots permission.
export const robotsText=`# Search engines and AI indexing or assistant fetchers are welcome.\n# Third-party bulk price scraping, mirroring, and resale are prohibited.\n${robotsGroup(botRobotsAgents())}\n${robotsGroup(['*'])}\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
export function canonicalHostRedirect(req,res,url){
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
 if(loopback&&req.headers['x-forwarded-proto']==='http'&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:SITE_ORIGIN+url.pathname+url.search});res.end();return true;}
 if(loopback&&String(req.headers.host||'').toLowerCase()==='www.airadar.vip'&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:SITE_ORIGIN+url.pathname+url.search});res.end();return true;}
 if(loopback&&req.headers['x-forwarded-proto']==='https')res.setHeader('Strict-Transport-Security','max-age=15552000');
 return false;
}
export function seoRoute(req,res,url,db,loadDirectory=()=>[],loadWeeks=()=>[]){
 if(serveResearchDownload(req,res,url))return true;
 if(/^\/(?:en\/)?official-prices\/[a-z0-9-]+\/$/.test(url.pathname)&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:url.pathname.slice(0,-1)+url.search});res.end();return true;}
 if(['GET','HEAD'].includes(req.method)){
  const legacyOfficial=(['/official-prices','/en/official-prices'].includes(url.pathname)||url.pathname.replace(/\/$/,'')==='/product'&&url.searchParams.get('source')===OFFICIAL_SOURCE)&&url.searchParams.getAll('id').length===1;
  if(legacyOfficial&&url.searchParams.getAll('source').length<=1){const p=officialCatalog(db).products.find(p=>p.id===url.searchParams.get('id')&&p.rows.length);if(p){const params=new URLSearchParams();for(const k of ['period','region','currency','purchase','page'])if(url.searchParams.getAll(k).length===1)params.set(k,url.searchParams.get(k));res.writeHead(301,{Location:(url.pathname.startsWith('/en/')?'/en':'')+officialProductHref(p.id)+(params.size?'?'+params:'')});res.end();return true;}}
  if(url.pathname.replace(/\/$/,'')==='/product'&&['direct-shops',null].includes(url.searchParams.get('source'))&&url.searchParams.getAll('id').length===1&&url.searchParams.getAll('source').length<=1){const identity=priceIdentity(url.searchParams.get('id'));if(identity&&(seoProduct(db,url)||loadDirectory().some(c=>c.products.some(p=>p.key===identity.key)))){const params=new URLSearchParams();for(const k of ['delivery','recharge','purchase','spec','currency','channel','sort','q','utm_source','utm_medium','utm_campaign','utm_content','utm_term'])if(url.searchParams.getAll(k).length===1)params.set(k,url.searchParams.get(k));const compact=compactPriceParams(params);res.writeHead(301,{Location:identity.path+(compact.size?'?'+compact:'')});res.end();return true;}}
  if(/^\/official-prices\/[a-z0-9-]+\.md$/.test(url.pathname)){const page=new URL(url);page.pathname=page.pathname.slice(0,-3);const data=officialPageData(db,page);res.writeHead(data?.product?200:404,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'public, max-age=3600'});res.end(req.method==='HEAD'?undefined:data?.product?officialMarkdown(data.product):'本期未收录');return true;}
 }

 if(url.pathname===INDEXNOW_KEY_PATH&&!url.search){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':Buffer.byteLength(INDEXNOW_KEY),'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Cache-Control':'public, max-age=3600'});
  res.end(req.method==='HEAD'?undefined:INDEXNOW_KEY);return true;
 }
 if(['GET','HEAD'].includes(req.method)){
  const target=historicalProductRedirect(db,url,loadDirectory);
  if(target){res.writeHead(301,{Location:target});res.end();return true;}
 }
 if(url.pathname===SITE_VERIFICATION_PATH){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':SITE_VERIFICATION_BODY.length,'X-Robots-Tag':'noindex, nofollow'});
  res.end(req.method==='HEAD'?undefined:SITE_VERIFICATION_BODY);return true;
 }
 if(url.pathname===BAIDU_VERIFICATION_PATH){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(BAIDU_VERIFICATION_BODY),'X-Robots-Tag':'noindex, nofollow'});
  res.end(req.method==='HEAD'?'':BAIDU_VERIFICATION_BODY);return true;
 }
 if(['/catalog/','/index.html','/product/','/sources/','/about/','/privacy/','/contact/','/alerts/','/advertise/','/official-prices/'].includes(url.pathname)&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:(url.pathname==='/index.html'?'/':url.pathname.slice(0,-1))+url.search});res.end();return true;}
 if(/^\/weekly(?:\/\d{4}-W\d{2})?\/$/.test(url.pathname)&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:url.pathname.slice(0,-1)+url.search});res.end();return true;}
 if(url.pathname.startsWith('/api/')||['/submit','/submit-shop','/following','/unsubscribe','/claim-shop','/login','/register','/reset-password','/account'].includes(url.pathname))res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(url.pathname.endsWith('/')&&contentForPath(url.pathname.slice(0,-1))&&['GET','HEAD'].includes(req.method)){res.writeHead(301,{Location:url.pathname.slice(0,-1)+url.search});res.end();return true;}
 if(['/llms.txt','/llms-full.txt'].includes(url.pathname)){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
  const body=llmsText(db,{full:url.pathname==='/llms-full.txt'});
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:body);return true;
 }
 if(!['/robots.txt','/sitemap.xml'].includes(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
 res.setHeader('Content-Type',url.pathname==='/robots.txt'?'text/plain; charset=utf-8':'application/xml; charset=utf-8');res.end(req.method==='HEAD'?'':url.pathname==='/robots.txt'?robotsText:sitemap(db,loadDirectory(),loadWeeks()));return true;
}
export function decorateSeo(html,url,db,status=200){
 const privatePage=['/submit','/submit-shop','/following','/unsubscribe','/claim-shop','/login','/register','/reset-password','/account'].includes(url.pathname)||status>=400;
 if(privatePage)return html.replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
 // Internal search is not a product landing page and must not be indexed.
 if(url.pathname==='/'&&String(url.searchParams.get('shop_q')||'').trim())return html.replace('</head>','<meta name="robots" content="noindex, follow"></head>');
 const product=url.pathname==='/product'?seoProduct(db,url):null;
 const official=url.pathname.startsWith(OFFICIAL_PATH+'/')||url.pathname===OFFICIAL_PATH||product?.source===OFFICIAL_SOURCE?officialPageData(db,url):null;
 let canonical=SITE_ORIGIN+url.pathname, title=html.match(/<title>(.*?)<\/title>/s)?.[1]||'AI 订阅价格雷达';
 let description=({'/':'比较 ChatGPT、Claude、Gemini 等 AI 订阅的公开报价、库存与历史价格，按交易渠道筛选并前往原店核验。本站不售卖账号，不提供交易担保。','/advertise':'查看 AIradar 首页、分类页和产品页的赞助展示示例、合作档期与投放建议。支持同页 1～4 家彩色广告卡，申请后人工确认档期。','/sources':'了解 AI 订阅报价的公开收录范围、更新时间、规格比较方法及购买前核验事项。','/alerts':'查看 AI 订阅公开报价变化提醒，结合历史记录与原店信息核验价格。','/about':'了解 AI订阅价格雷达的用途、资料整理方式、内容更正、商业合作与联系渠道。','/contact':'通过公开邮箱 hello@airadar.vip、X 或 Telegram 联系 AI订阅价格雷达站长，处理内容更正、收录与合作咨询。','/privacy':'了解 AI 订阅价格雷达的访问统计口径、数据保留期限、广告披露及主动投稿的隐私保护方式。'})[url.pathname]||'AI 订阅公开报价与历史记录参考。';
 if(product){canonical=productUrl(product);const actualPage=Number(html.match(/第 (\d+) \/ \d+ 页/)?.[1]||1);if(actualPage>1)canonical+='&page='+actualPage;const name=publicProductName(product),spec=publicSpec(product.spec);title=`${name}价格与报价${spec?' · '+spec:''}${actualPage>1?' · 第'+actualPage+'页':''} · AI 订阅价格雷达`;description=`查看${name}${spec?'（'+spec+'）':''}的公开报价、库存状态、交易平台与历史价格${actualPage>1?'，报价第'+actualPage+'页':''}。仅展示本站已收录信息，价格与规格以店铺结算页面为准，本站不提供交易担保。`;}
 if(url.pathname==='/'){
  title='AIradar · AI 订阅选购与续费雷达｜ChatGPT、Claude、Gemini 比价';
  description='找到真正适合你的 AI 订阅报价。比较 ChatGPT、Claude、Gemini 等公开价格，先确认交付、期限与账号条件，再去原店购买，保存订阅与到期提醒。';
  const directory=directoryPage(html,url);
  if(directory){
   const {category,product:chosen}=directory,params=new URLSearchParams({family:category.key});
   if(chosen)params.set('product',chosen.key);
   canonical=SITE_ORIGIN+(chosen&&priceHref(chosen.key)||'/?'+params);
   const actualPage=Number(html.match(/第 (\d+) \/ \d+ 页/)?.[1]||1);
   if(chosen&&actualPage>1&&!hasPriceFilters(url))canonical+=(canonical.includes('?')?'&':'?')+'page='+actualPage;
   title=chosen?`${chosen.name}公开报价与规格 · AI订阅价格雷达`:`${category.label}产品目录与公开报价 · AI订阅价格雷达`;
   description=chosen?`查看${chosen.name}多家店铺的公开报价、交付规格与原店入口，按价格排序并筛选交易平台。不同规格请分别核对，价格与库存以店铺结算页面为准，本站不提供交易担保。`:`浏览${category.label}已收录的产品，一次点击查看多家店铺的公开报价与规格。价格与库存以原店页面为准。`;
   if(chosen?.key==='chatgpt-pro-5x'){
    title='ChatGPT Pro 100 价格比较：期限、地区与充值渠道 · AI订阅价格雷达';
    description='比较 ChatGPT Pro 100 多家店铺报价，分别核对期限、地区、币种与充值渠道。商家常写 5x、20x，对应官方 Pro 100、200；回原渠道确认实付与续费。';
   }
   if(chosen?.key==='chatgpt-plus'){
    title='ChatGPT Plus 充值价格比较：月付、账号与交付方式 · AI订阅价格雷达';
    description='比较 ChatGPT Plus 月付充值与成品账号的公开报价，分别核对订阅期限、地区、账号条件与续费方式。查看交付指南后，回原店确认实付与售后。';
   }
   if(chosen?.key==='claude-pro'){
    title='Claude Pro 月付价格比较：账号、地区与续费条件 · AI订阅价格雷达';
    description='比较 Claude Pro 月度订阅公开报价，区分本人账号充值与成品账号，核对地区、订阅期限和续费条件。结合选购指南查看原店库存与结算价。';
   }
   if(['chatgpt-pro-20x','chatgpt-pro-25x'].includes(chosen?.key)){
    title=chosen.name+' 价格比较：订阅档位、账号与续费条件 · AI订阅价格雷达';
    description='比较 '+chosen.name+' 公开报价，先核对账号内的实际计划，再确认订阅期限、地区与新开或续费资格。不同档位分别比较，实付与售后以原渠道为准。';
   }
   if(chosen&&actualPage>1){title+=' · 第'+actualPage+'页';description+=' 报价第'+actualPage+'页。';}
  }
 }
 if(url.pathname==='/catalog'){title='全部 AI 产品目录与公开报价 · AIradar';description='按品牌浏览 AIradar 收录的 AI 产品与店铺报价，查看购买规格、官方参考和暂无报价的产品记录。';}
 if(url.pathname==='/shop'){
  const id=html.match(/data-shop-id="([a-f0-9]{24})"/)?.[1];
  if(id&&id===url.searchParams.get('id'))canonical+='?'+new URLSearchParams({id});
  description='查看这家店铺已收录的 AI 产品报价与店主自愿认领的 X 账号关联。认领不代表信用或交易安全保证，价格与库存以原店结算页为准。';
 }
 const weeklyPermalink=url.pathname.match(/^\/weekly\/(\d{4}-W\d{2})$/);
 if(url.pathname==='/weekly'){
  const date=url.searchParams.get('date');
  title='AI 产品行情周报'+(date?' · 截至 '+date:'')+' · AIradar';
  description='查看同规格 AI 订阅挂牌价的真实变化，了解观察日期、报价范围与购买条件。历史不足时不推算完整一周。';
  if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))canonical+='?date='+date;
 }
 if(weeklyPermalink){
  const label=`${weeklyPermalink[1].slice(0,4)}年第${Number(weeklyPermalink[1].slice(6))}周`;
  title=`订阅行情周报 · ${label} · AIradar`;
  const supplied=html.match(/\bdata-weekly-description="([^"]*)"/)?.[1];
  description=supplied?unescapeAttr(supplied):`${label}的 AI 订阅公开挂牌观察。列出主要规格的最低挂牌价、中位价、报价数和店铺数。挂牌价不是成交价，收录不等于推荐。`;
  canonical=SITE_ORIGIN+url.pathname;
 }
 if(official){
  const actualPage=Number(html.match(/data-official-page="(\d+)"/)?.[1]||1);
  const filtered=['region','currency','period','purchase'].some(k=>url.searchParams.get(k)&&url.searchParams.get(k)!=='all');
  canonical=SITE_ORIGIN+(official.product?officialProductHref(official.product.id):OFFICIAL_PATH);
  if(official.product&&actualPage>1&&!filtered)canonical+='?page='+actualPage;
  title=(official.product?official.product.name+' 哪个地区最便宜？各国官方价格对比'+(actualPage>1?' · 第'+actualPage+'页':''):'AI 官方订阅地区价格｜ChatGPT、Claude 等套餐')+' · AI订阅价格雷达';
  description=official.product?'查看 '+official.product.name+' 的 App Store 地区内购参考，核对原币标价、人民币参考额、周期、来源和刷新时间。当前数据来自 CardNav 汇总，以实际结账金额和购买资格为准。':'按套餐查看 ChatGPT Plus、ChatGPT Go、Claude Pro 等 AI 官方订阅的 App Store 地区价格参考，保留原币、来源和时间，并说明周期与汇率资料缺口。';
 }
 const content=contentForPath(url.pathname),article=articleForPath(url.pathname);
 if(content){title=content.title+' · AI订阅雷达';description=content.description;}
 const publisher={'@type':'Organization','@id':SITE_ORIGIN+'/#publisher',name:'AIradar · AI订阅价格雷达',url:SITE_ORIGIN+'/',logo:SITE_ORIGIN+'/assets/brands/airadar.png'};
 const schema=[{'@context':'https://schema.org','@type':'WebSite','@id':SITE_ORIGIN+'/#website',url:SITE_ORIGIN+'/',name:'AI订阅价格雷达',inLanguage:'zh-CN',publisher:{'@id':publisher['@id']}},{'@context':'https://schema.org','@type':url.pathname==='/'||url.pathname==='/catalog'||url.pathname===OFFICIAL_PATH||content&&!article?'CollectionPage':'WebPage',url:canonical,name:title,description,inLanguage:'zh-CN',isPartOf:{'@id':SITE_ORIGIN+'/#website'}}];
 schema.push({'@context':'https://schema.org',...publisher});
 if(article){schema.push({'@context':'https://schema.org','@type':'Article',url:canonical,headline:article.title,description:article.description,datePublished:article.published,dateModified:article.updated,inLanguage:'zh-CN',mainEntityOfPage:canonical,image:SHARE_IMAGE,author:{'@type':'Organization',name:article.author,url:SITE_ORIGIN+'/about#editorial'},publisher:{'@id':publisher['@id']}});schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'首页',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:article.section.label,item:SITE_ORIGIN+article.section.path},{'@type':'ListItem',position:3,name:article.title,item:canonical}]});const faqs=faqEntities(article);if(faqs.length)schema.push({'@context':'https://schema.org','@type':'FAQPage',url:canonical,mainEntity:faqs,inLanguage:'zh-CN'});}
 if(official){
  if(official.product){
   schema.push({'@context':'https://schema.org','@type':'FAQPage',url:canonical,mainEntity:faqSchema(officialSummary(official.product).faq)});
   const source=official.product.rows.find(r=>r.sourceUrl)?.sourceUrl;
   schema.push({'@context':'https://schema.org','@type':'Dataset',name:official.product.name+' App Store 地区价格参考',url:canonical,description,inLanguage:'zh-CN',creator:{'@type':'Organization',name:'CardNav',url:'https://cardnav.xyz/'},publisher:{'@id':publisher['@id']},isAccessibleForFree:true,...(officialModified(official.product)?{dateModified:officialModified(official.product)}:{}),measurementTechnique:'整理 CardNav 公开汇总记录，未经本站逐条结账核验',...(source?{isBasedOn:source}:{}),variableMeasured:['国家或地区','原币标价','原币币种','人民币参考额','订阅周期（未提供时标明）','购买渠道','上游刷新时间','汇率日期（未提供时标明）']});
   schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'首页',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:'官方地区价',item:SITE_ORIGIN+OFFICIAL_PATH},{'@type':'ListItem',position:3,name:official.product.name,item:canonical}]});
  }else if(official.products.length)schema.push({'@context':'https://schema.org','@type':'ItemList',itemListElement:official.products.map((p,i)=>({'@type':'ListItem',position:i+1,name:p.name,url:SITE_ORIGIN+officialProductHref(p.id)}))});
 }
 const directoryProduct=url.pathname==='/'?directoryPage(html,url):null;
 if(directoryProduct?.product){html=html.replace('</main>',faqHtml(PRODUCT_FAQ)+'<a href="/submit?type=feedback&amp;product='+esc(directoryProduct.product.key)+'">反馈这页数据</a><p>代充参考仅汇总本页同币种、有货的代充挂牌价；其它交付方式请分别核对。</p></main>');schema.push({'@context':'https://schema.org','@type':'FAQPage',url:canonical,mainEntity:faqSchema(PRODUCT_FAQ)});}
 if(directoryProduct?.product)schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'首页',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:'产品目录',item:SITE_ORIGIN+'/catalog'},{'@type':'ListItem',position:3,name:directoryProduct.product.name,item:canonical}]});
 // Product schema on stable /prices/* pages with visible AggregateOffer; values must match data-price cards.
 if(directoryProduct?.product&&PRODUCT_SCHEMA_PILOT.has(directoryProduct.product.key)&&!hasPriceFilters(url)){
  const aggregate=aggregateOfferFromHtml(html);
  if(aggregate){
   schema.push({'@context':'https://schema.org','@type':'Product',name:directoryProduct.product.name,url:canonical,description:description,image:SHARE_IMAGE,brand:{'@type':'Brand',name:directoryProduct.category.label},offers:{'@type':'AggregateOffer',url:canonical,priceCurrency:aggregate.priceCurrency,lowPrice:aggregate.lowPrice,highPrice:aggregate.highPrice,offerCount:aggregate.offerCount,availability:'https://schema.org/InStock'}});
  }
 }
 if(product&&!official)schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'AI订阅价格比较',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:publicProductName(product),item:canonical}]});
 if(url.pathname==='/'||url.pathname==='/catalog'){const priceLinks=[...new Set([...html.matchAll(/href="(\/prices\/[a-z0-9-]+)(?:[?"])/g)].map(m=>m[1]))];if(priceLinks.length)schema.push({'@context':'https://schema.org','@type':'ItemList',itemListElement:priceLinks.map((path,i)=>({'@type':'ListItem',position:i+1,url:SITE_ORIGIN+path}))});const linked=new Set([...html.matchAll(/href="(\/product\?[^\"]+)"/g)].map(m=>{const u=new URL(m[1].replaceAll('&amp;','&'),SITE_ORIGIN);return productUrl({source:u.searchParams.get('source'),product_id:u.searchParams.get('id')})}));if(linked.size){const items=seoProducts(db).filter(p=>linked.has(productUrl(p))).slice(0,500).map((p,i)=>({'@type':'ListItem',position:i+1,name:publicProductName(p),url:productUrl(p)}));if(items.length)schema.push({'@context':'https://schema.org','@type':'ItemList',itemListElement:items});}}
 const filteredDirectory=!!official?.product&&['region','currency','period','purchase'].some(k=>url.searchParams.has(k)&&url.searchParams.get(k)!=='all')||url.pathname==='/'&&!!directoryPage(html,url)?.product&&hasPriceFilters(url);
 if(weeklyPermalink)schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'首页',item:SITE_ORIGIN+'/'},{'@type':'ListItem',position:2,name:'订阅行情周报',item:canonical}]});
 const siteName=weeklyPermalink?'<meta property="og:site_name" content="AIradar">':'';
 const verification=[['google-site-verification',process.env.GOOGLE_SITE_VERIFICATION],['baidu-site-verification',process.env.BAIDU_SITE_VERIFICATION]].filter(([,v])=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(v)).map(([k,v])=>`<meta name="${k}" content="${esc(v)}">`).join('');
 const articleTimes=article?`<meta property="article:published_time" content="${article.published}"><meta property="article:modified_time" content="${article.updated}">`:'';
 const tags=`${articleTimes}<link rel="canonical" href="${esc(canonical)}"><meta name="description" content="${esc(description)}"><meta name="robots" content="${filteredDirectory||url.pathname==='/weekly'&&url.searchParams.has('group')?'noindex':'index'}, follow, max-snippet:-1, max-image-preview:large"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="${article?'article':'website'}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:locale" content="zh_CN">${siteName}<meta property="og:image" content="${SHARE_IMAGE}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="AIradar · AI订阅价格雷达"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SHARE_IMAGE}"><meta name="twitter:image:alt" content="AIradar · AI订阅价格雷达"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">${verification}<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>`;
 return html.replace(/<title>.*?<\/title>/s,`<title>${esc(title)}</title>`).replace('</head>',tags+'</head>');
}
