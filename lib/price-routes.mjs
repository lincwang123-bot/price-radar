import {EDUCATION_VERIFICATION_ID,EDUCATION_VERIFICATION_NAME} from './education-verification.mjs';
import {CHATGPT_PRO_PUBLIC_NAMES} from './chatgpt-pro-names.mjs';
// Finite product intent pages, not a product x filter page generator.
export const PRICE_PRODUCTS=Object.freeze([
 ['chatgpt-plus','chatgpt','ChatGPT Plus'],['chatgpt-pro-5x','chatgpt',CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-5x']],['chatgpt-pro-20x','chatgpt',CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-20x']],['chatgpt-go','chatgpt','ChatGPT Go'],
 ['chatgpt-free-account','chatgpt','ChatGPT 普通账号'],
 ['chatgpt-pro-25x','chatgpt',CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-25x']],
 ['claude-pro','claude','Claude Pro'],['claude-max-5x','claude','Claude Max（原 Max 5x）'],['claude-max-20x','claude','Claude Ultra（原 Max 20x）'],
 ['gemini-pro','gemini','Google AI Pro'],['gemini-ultra','gemini','Google AI Ultra'],['gemini-pro-long','gemini','Google AI Pro · 多月 / 年号'],['gemini-ultra-long','gemini','Google AI Ultra · 多月 / 年号'],['super-grok','grok','SuperGrok'],['super-grok-heavy','grok','SuperGrok Heavy'],['cursor-pro','cursor','Cursor Pro'],
 ['muse-account-10b','muse','Muse 成品号 · 10 亿 token'],['muse-account-300b','muse','Muse 成品号 · 300 亿+ token'],['muse-account','muse','Muse 账号 · 其他/未标注'],['muse-power','muse','Muse Power'],['muse-max','muse','Muse Maximum'],
 ...['Plus','Premium','Super','Ultra'].map(tier=>['x-subscription-'+tier.toLowerCase(),'x-subscription','X 融合订阅 '+tier]),
 [EDUCATION_VERIFICATION_ID,'other',EDUCATION_VERIFICATION_NAME],
].map(([key,family,name])=>Object.freeze({key,family,name,path:'/prices/'+key})));
export const priceProduct=key=>PRICE_PRODUCTS.find(p=>p.key===key)||null;
export const priceHref=key=>priceProduct(key)?.path||null;
export function priceRoute(url){const match=/^\/prices\/([a-z0-9-]+)\/?$/.exec(url.pathname);return match?priceProduct(match[1]):null;}
export const hasPriceFilters=url=>(url.searchParams.has('eligibility')&&/^gemini-/.test(priceRoute(url)?.key||url.searchParams.get('product')||'')&&!['','all'].includes(url.searchParams.get('eligibility')))||['delivery','recharge','purchase','spec','currency','channel','sort','pricing','pricing_type','q','shop_q','purpose','framework'].some(k=>url.searchParams.has(k)&&!['','all',...(k==='sort'?['price_asc']:[]),...(k==='pricing'?['listed']:[]),...(k==='pricing_type'?['regular']:[])].includes(url.searchParams.get(k)));
// These explicit values are identical to the quote page's omitted defaults.
// Keep real filters, attribution, duplicate keys and pagination beyond page 1.
export function compactPriceParams(input){
 const params=new URLSearchParams(input);
 for(const [key,value] of Object.entries({delivery:'all',recharge:'all',purchase:'all',channel:'all',sort:'price_asc',pricing:'listed',pricing_type:'regular',page:'1'})){
  if(params.getAll(key).length===1&&params.get(key)===value)params.delete(key);
 }
 return params;
}
export function legacyPriceRedirect(url,directory){
 if(url.pathname!=='/'||hasPriceFilters(url)||url.searchParams.has('page'))return null;
 const p=priceProduct(url.searchParams.get('product'));
 if(!p||p.family!==url.searchParams.get('family')||!directory.some(c=>c.key===p.family&&c.products.some(x=>x.key===p.key)))return null;
 const params=compactPriceParams(url.searchParams);params.delete('family');params.delete('product');
 return p.path+(params.size?'?'+params:'');
}

export function priceIdentity(id){return priceProduct(id)||priceProduct(({'chatgpt-plus-recharge':'chatgpt-plus','chatgpt-plus-recharge-12m':'chatgpt-plus','claude-pro-month':'claude-pro','gemini-pro-recharge':'gemini-pro','gemini-pro-year':'gemini-pro','grok-supergrok':'super-grok'})[id]);}
