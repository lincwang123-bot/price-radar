// Public reference data. CardNav is an intermediary, not proof of a live
// vendor checkout. Keep missing periods / FX dates unknown, including legacy rows.
import {retiredCatalogItem} from './catalog-policy.mjs';
import {publicOfferAllowed} from './public-offers.mjs';

export const OFFICIAL_SOURCE='cardnav-official';
export const OFFICIAL_PATH='/official-prices';
export const OFFICIAL_GUIDES={channels:'/guides/official-subscription-channels',cost:'/guides/regional-price-total-cost'};
export const officialProductHref=id=>'/product?'+new URLSearchParams({source:OFFICIAL_SOURCE,id});
const focus=['chatgpt-plus','chatgpt-go','claude-pro'];
const vendorPages={
 'chatgpt-plus':{url:'https://chatgpt.com/pricing/',label:'ChatGPT 官方套餐',guide:'/guides/chatgpt-plus-delivery'},
 'chatgpt-go':{url:'https://help.openai.com/en/articles/11989085-what-is-chatgpt-go',label:'ChatGPT Go 官方说明',guide:'/guides/chatgpt-go-vs-plus'},
 'claude-pro':{url:'https://support.claude.com/en/articles/8325606-what-is-the-pro-plan',label:'Claude Pro 官方说明',guide:'/guides/claude-pro-buying'},
};
const parseExtra=value=>{try{const x=typeof value==='string'?JSON.parse(value):value;return x&&typeof x==='object'&&!Array.isArray(x)?x:{};}catch{return {};}};
const text=value=>typeof value==='string'?value.trim().slice(0,250):'';
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
// Old CardNav captured_at values explicitly represented Beijing time but did
// not include an offset. Never apply this repair to other sources' timestamps.
export function officialTimestamp(value,{beijing=false}={}){
 if(typeof value!=='string'||!value.trim())return null;
 let s=value.trim().replace(' ','T');
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)){
  if(!beijing)return null;
  s+='+08:00';
 }
 if(!/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s))return null;
 const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toISOString():null;
}
function cardnavUrl(value,id){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='cardnav.xyz'&&!u.username&&!u.password&&u.port===''&&u.pathname==='/official-price/'+encodeURIComponent(id)?u.origin+u.pathname:null;}catch{return null;}
}
export function officialOffer(offer,snapshot,now=Date.now()){
 const extra=parseExtra(offer.extra),meta=parseExtra(extra.officialPrice),region=text(meta.region)||text(offer.store_name)||'地区未提供';
 const title=text(offer.title),tail=title.startsWith(region)?title.slice(region.length).trim():'';
 // Preserve the source's original formatted price, not a guessed numeric
 // conversion (e.g. Rp 349ribu and locale decimal separators).
 const legacyCurrency=tail.match(/\b([A-Z]{3})$/)?.[1]||'';
 const currency=/^[A-Z]{3}$/.test(meta.originalCurrency||'')?meta.originalCurrency:legacyCurrency;
 const localPrice=text(meta.originalPrice)||(legacyCurrency?tail.slice(0,-3).trim():'');
 const price=offer.currency==='CNY'?finite(offer.price):null;
 const sourceUrl=cardnavUrl(meta.sourceUrl||offer.url,offer.product_id);
 const purchaseChannel=meta.purchaseChannel==='app-store'||sourceUrl?'app-store':'unknown';
 const period=['month','year'].includes(meta.period)?meta.period:'unknown';
 const sourceAt=officialTimestamp(meta.upstreamRefreshedAt||offer.captured_at,{beijing:true});
 const collectedAt=officialTimestamp(snapshot.fetched_at);
 const fxDate=/^\d{4}-\d{2}-\d{2}$/.test(meta.exchangeRateDate||'')?meta.exchangeRateDate:null;
 const stale=!!snapshot.stale||!sourceAt||now-Date.parse(sourceAt)>72*3600000;
 return {region,originalCurrency:currency||'unknown',originalPrice:localPrice||null,cny:price,period,purchaseChannel,sourceAt,collectedAt,fxDate,sourceUrl,stale};
}
export function officialCatalog(db,{now=Date.now()}={}){
 const snapshot=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(OFFICIAL_SOURCE);
 if(!snapshot)return {snapshot:null,products:[]};
 const products=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(OFFICIAL_SOURCE,snapshot.snapshot_id).filter(p=>!retiredCatalogItem(p));
 const offers=db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=?').all(OFFICIAL_SOURCE,snapshot.snapshot_id).filter(o=>publicOfferAllowed(OFFICIAL_SOURCE,o));
 const currencies=new Map(products.map(p=>[p.product_id,p.currency]));
 const byProduct=new Map();for(const o of offers){if(!byProduct.has(o.product_id))byProduct.set(o.product_id,[]);byProduct.get(o.product_id).push(officialOffer({...o,currency:o.currency??currencies.get(o.product_id)},snapshot,now));}
 return {snapshot,products:products.map(p=>({id:p.product_id,name:String(p.name||p.product_id).replace(/[（(]官方区价[）)]/g,'').trim(),platform:p.platform||'其他',rows:byProduct.get(p.product_id)||[],vendor:vendorPages[p.product_id]||null,focus:focus.includes(p.product_id)})).sort((a,b)=>{
  const ai=focus.indexOf(a.id),bi=focus.indexOf(b.id);return (ai<0?99:ai)-(bi<0?99:bi)||a.name.localeCompare(b.name,'zh-CN');
 })};
}
export const periodLabel=value=>({month:'月付',year:'年付',unknown:'周期未提供'})[value]||'周期未提供';
export const channelLabel=value=>value==='app-store'?'App Store 内购参考':'渠道未提供';
export function filterOfficialRows(rows,url){
 const query=(url.searchParams.get('region')||'').trim().slice(0,80).toLocaleLowerCase();
 const currency=(url.searchParams.get('currency')||'all').slice(0,20),period=(url.searchParams.get('period')||'all').slice(0,20),purchase=(url.searchParams.get('purchase')||'all').slice(0,30);
 return rows.filter(r=>(!query||r.region.toLocaleLowerCase().includes(query))&&(currency==='all'||r.originalCurrency===currency)&&(period==='all'||r.period===period)&&(purchase==='all'||r.purchaseChannel===purchase)).sort((a,b)=>Number(a.stale)-Number(b.stale)||(a.cny??Infinity)-(b.cny??Infinity)||a.region.localeCompare(b.region,'zh-CN'));
}
export function officialPageData(db,url){
 const catalog=officialCatalog(db),detail=url.pathname==='/product'&&url.searchParams.get('source')===OFFICIAL_SOURCE;
 const product=detail?catalog.products.find(p=>p.id===url.searchParams.get('id')):null;
 if(detail&&!product)return null;
 const q=(url.searchParams.get('q')||'').trim().slice(0,80).toLocaleLowerCase(),brand=(url.searchParams.get('brand')||'all').slice(0,40);
 const products=detail?[product]:catalog.products.filter(p=>(brand==='all'||p.platform===brand)&&(!q||(p.name+' '+p.platform).toLocaleLowerCase().includes(q)));
 const rows=product?filterOfficialRows(product.rows,url):[];
 const pageCount=Math.max(1,Math.ceil(rows.length/10));
 const raw=url.searchParams.get('page')||'1',page=Math.min(pageCount,/^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):1);
 return {...catalog,brands:[...new Set(catalog.products.map(p=>p.platform))],products,product,rows,page,pageCount,shown:rows.slice((page-1)*10,page*10)};
}
