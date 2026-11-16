// Semantic public content only: fetch clocks, styles and FX dates do not notify.
import {createHash} from 'node:crypto';
import {officialCatalog,officialProductHref} from './official-prices.mjs';
import {PRICE_PRODUCTS} from './price-routes.mjs';
import {PRODUCT_FAQ} from './buying-faq.mjs';
import {OFFICIAL_BASELINES} from './official-baselines.mjs';
import {officialSummary,OFFICIAL_LIMIT} from './official-summary.mjs';
import {CONTENT_PATHS,contentForPath} from './guides.mjs';
export const indexNowAutoEnabled=value=>['1','on'].includes(String(value||'').toLowerCase());
export function indexNowDocuments(db){
 const docs=CONTENT_PATHS.map(url=>({url,content:contentForPath(url)}));
 docs.push(...PRICE_PRODUCTS.map(p=>({url:p.path,content:{name:p.name,faq:PRODUCT_FAQ}})));
 docs.push({url:'/official-prices',content:{limit:OFFICIAL_LIMIT,baselines:OFFICIAL_BASELINES}});
 for(const p of officialCatalog(db).products.filter(p=>p.rows.length)){
  const content={id:p.id,name:p.name,rows:p.rows.map(r=>({region:r.region,originalPrice:r.originalPrice,originalCurrency:r.originalCurrency,cny:r.cny,period:r.period,purchaseChannel:r.purchaseChannel,sourceUrl:r.sourceUrl})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
  content.limit=OFFICIAL_LIMIT;
  content.summary=officialSummary({...p,rows:content.rows});
  for(const prefix of ['','/en'])docs.push({url:prefix+officialProductHref(p.id),content});
 }
 return docs;
}
export function autoManifest(documents,state,now=Date.now()){
 const changes=[],fingerprints={...state.fingerprints};
 for(const {url,content} of documents){
  const revision=createHash('sha256').update(JSON.stringify(content)).digest('hex');
  if(fingerprints[url]&&fingerprints[url]!==revision)changes.push({url,revision,changedAt:new Date(now).toISOString(),reason:'公开页面正文或官方地区数据实质更新'});
  else if(!fingerprints[url]&&state.fingerprints)changes.push({url,revision,changedAt:new Date(now).toISOString(),reason:'新增公开页面或官方地区数据'});
  fingerprints[url]=revision;
 }
 // A first run establishes a baseline; only later semantic changes notify.
 // Leave overflow revisions untouched so the next scheduled run can plan them.
 const selected=changes.slice(0,20);
 for(const item of changes.slice(20))if(state.fingerprints?.[item.url])fingerprints[item.url]=state.fingerprints[item.url];else delete fingerprints[item.url];
 return {manifest:{changes:selected},fingerprints};
}
