export const normalizeShopQuery=value=>String(value??'').trim().slice(0,100);
const searchable=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/gu,' ').trim();

// Search only the current public catalog, never applications or contact details.
export function searchShops(catalog,query,{page=1}={}){
 const q=normalizeShopQuery(query);
 let term=searchable(q);
 if(/^https?:\/\//.test(term)){
  try{const url=new URL(term);term=url.hostname+url.pathname.replace(/\/$/,'');}catch{/* Treat incomplete URLs as literal text. */}
 }
 const words=term.split(' ').filter(Boolean);
 const matches=words.length?[...catalog].map(shop=>{
  const names=[shop.name,...(shop.entries||[]).map(entry=>entry.offer.store_name)].map(searchable);
  const url=searchable(shop.url).replace(/^https?:\/\//,'').replace(/\/$/,'');
  const haystack=[...names,url].join(' ');
  const rank=names.includes(term)||url===term?0:names.some(name=>name.includes(term))?1:2;
  return {shop,rank,match:words.every(word=>haystack.includes(word))};
 }).filter(item=>item.match).sort((a,b)=>a.rank-b.rank||a.shop.name.localeCompare(b.shop.name,'zh-CN',{numeric:true})||a.shop.id.localeCompare(b.shop.id)):[];
 const pageSize=20,pages=Math.max(1,Math.ceil(matches.length/pageSize));
 const requested=Number(page);
 const current=Math.min(pages,Number.isSafeInteger(requested)&&requested>0?requested:1);
 return {q,total:matches.length,page:current,pages,pageSize,shops:matches.slice((current-1)*pageSize,current*pageSize).map(item=>item.shop)};
}
