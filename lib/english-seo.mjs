// Localize metadata already established by the shared server renderer. Neither
// query parameters nor merchant text can introduce a new schema type or claim.
import {PUBLIC_ORIGIN,englishPathForChinese} from './public-locales.mjs';
import {englishText,decodeHtml} from './public-translation.mjs';

const publisherId=PUBLIC_ORIGIN+'/#publisher';
const textFields=new Set(['name','headline','description','measurementTechnique','variableMeasured']);
const urlFields=new Set(['url','item','@id','mainEntityOfPage']);
function localizedUrl(value){
 if(value===publisherId||!value.startsWith(PUBLIC_ORIGIN+'/'))return value;
 const url=new URL(value),path=englishPathForChinese(url);
 return path?PUBLIC_ORIGIN+path+url.hash:value;
}
function localizedText(value){
 const dataset=value.match(/^(.+) App Store 地区价格参考$/);
 if(dataset)return dataset[1]+' App Store regional price references';
 return englishText(value);
}
function localizeSchema(value,key){
 if(Array.isArray(value))return value.map(item=>localizeSchema(item,key));
 if(value&&typeof value==='object'){
  const translated=Object.fromEntries(Object.entries(value).map(([field,item])=>[field,localizeSchema(item,field)]));
  if(value.inLanguage==='zh-CN')translated.inLanguage='en';
  // The publisher is the same organization in both languages, not a new entity.
  if(value['@id']===publisherId)translated.url=value.url;
  return translated;
 }
 if(typeof value!=='string')return value;
 return urlFields.has(key)?localizedUrl(value):textFields.has(key)?localizedText(value):value;
}
function sourceGraph(html){
 return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap(match=>{
  try{const value=JSON.parse(match[1]);return Array.isArray(value)?value:[value];}
  catch{return [];}
 });
}
const descriptions={
 '/en/':'Compare public AI subscription quotes for ChatGPT, Claude, Gemini and more. Check delivery, duration and account conditions before visiting the original provider.',
 '/en/catalog':'Browse the AI product catalog by brand, with recorded merchant quotes, buying specifications, official references and products without current quotes.',
 '/en/about':'Learn how Airadar organizes public subscription information, documents sources and editorial methods, handles corrections and discloses commercial relationships.',
 '/en/sources':'Understand quote sources, coverage, update times and comparison methods. Check plan, duration, currency, delivery and merchant terms before buying.',
 '/en/shop':'View this shop’s recorded AI subscription quotes, public reviews and voluntary owner X account link. A claim does not guarantee reliability or transaction safety.',
 '/en/official-prices':'Compare official monthly subscription references and App Store regional records. Check original currencies, billing periods, sources and data limitations.',
};
const titles={
 '/en/':'Airadar · Compare AI subscriptions and renewals',
 '/en/catalog':'AI product catalog and public quotes · Airadar',
 '/en/about':'About Airadar',
 '/en/sources':'Sources and update methods · Airadar',
 '/en/official-prices':'Official subscription and regional prices · Airadar',
};
export function englishSeo(html,{canonical,status=200}){
 const original=sourceGraph(html),target=new URL(canonical,PUBLIC_ORIGIN);
 const rawTitle=decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]||'Airadar');
 let title=englishText(rawTitle),description='Public AI subscription information from Airadar. Check current prices and buying conditions with the original provider.';
 const dataset=original.find(node=>node?.['@type']==='Dataset');
 if(status===200){
  title=titles[target.pathname]||title;
  description=descriptions[target.pathname]||description;
  const family=rawTitle.match(/^(.+)产品目录与公开报价 · AI订阅价格雷达$/)?.[1];
  const productTag=html.match(/<section\b[^>]*\bdata-directory-product-name="([^"]+)"[^>]*>/)?.[1];
 const product=productTag?englishText(decodeHtml(productTag)):null;
  if(target.pathname==='/en/'&&family){
   title=englishText(family)+' products and public quotes · Airadar';
   description='Browse recorded '+englishText(family)+' products and compare merchant quotes, specifications and original shop links. Confirm prices and stock with each merchant.';
  }else if(target.pathname.startsWith('/en/prices/')&&product){
   title=product+' quotes and specifications · Airadar';
   description='Compare public '+product+' quotes, delivery types, service durations and merchant links. Check like-for-like terms and confirm price and stock at checkout.';
   if(target.pathname==='/en/prices/chatgpt-pro-5x'){
    title=product+' price comparison: duration, regions and top-up methods · Airadar';
    description='Compare '+product+' quotes by duration, region, currency and top-up method. Merchants often write 5x and 20x; those labels correspond to official Pro 100 and Pro 200. Check eligibility and renewal terms with the provider.';
   }
  }else if(target.pathname.startsWith('/en/official-prices/')&&dataset){
   const name=dataset.name.replace(/ App Store 地区价格参考$/,'');
   title=name+' App Store regional price references · Airadar';
   description='Compare '+name+' App Store regional references from CardNav, with original currencies, CNY estimates, periods and sources. Confirm checkout totals and eligibility.';
  }
  const page=Number(html.match(/data-official-page="(\d+)"/)?.[1]||html.match(/第 (\d+) \/ \d+ 页/)?.[1]||target.searchParams.get('page')||1);
  if(page>1&&(target.pathname.startsWith('/en/prices/')||dataset)){title+=' · Page '+page;description+=' Page '+page+'.';}
 }
 const graph=original.map(node=>{
  const localized=localizeSchema(node);
  if(node?.['@type']==='WebSite'){localized.name='Airadar';localized.url=PUBLIC_ORIGIN+'/en/';}
  if(['WebPage','CollectionPage'].includes(node?.['@type']))Object.assign(localized,{name:title,description,url:PUBLIC_ORIGIN+canonical,inLanguage:'en'});
  if(node?.['@type']==='Dataset')Object.assign(localized,{description,url:PUBLIC_ORIGIN+canonical,inLanguage:'en'});
  return localized;
 });
 return {title,description,graph};
}
