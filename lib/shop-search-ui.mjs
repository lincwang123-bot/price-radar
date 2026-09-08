import {merchantBadgeForOffer} from './merchant-badges.mjs';
import {merchantXBadge} from './merchant-x-ui.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function shopSearchForm(q=''){
 return '<form class="shop-search" role="search" aria-label="搜索店铺" method="get" action="/"><label for="shop-search-input">找店铺</label><div class="shop-search-controls"><input id="shop-search-input" name="shop_q" type="search" maxlength="100" value="'+esc(q)+'" placeholder="输入店铺名或域名" aria-label="店铺名或域名" enterkeyhint="search"><button type="submit">搜索</button>'+(q?'<a class="shop-search-clear" href="/">清空</a>':'')+'</div></form>';
}

export function shopSearchContent(result,{merchantBadges=[],xProfiles=[]}={}){
 const rows=result.shops.map(shop=>{
  const first=shop.entries[0],offer={...first.offer,source:first.list.source};
  const products=[...new Set(shop.entries.map(entry=>entry.productName))];
  const address=new URL(shop.url),label=address.hostname+(address.pathname==='/'?'':address.pathname);
  return '<article class="shop-search-result" data-shop-result="'+esc(shop.id)+'"><div><h2>'+esc(shop.name)+merchantBadgeForOffer(offer,merchantBadges)+merchantXBadge(offer,xProfiles)+'</h2><p class="shop-search-domain">'+esc(label)+'</p><p>'+esc(products.slice(0,4).join(' · '))+(products.length>4?' 等 '+products.length+' 类产品':'')+' · '+shop.entries.length+' 条报价</p></div><a class="offer-shop-button" data-shop-result-link href="/shop?id='+esc(shop.id)+'">查看店铺 <span aria-hidden="true">›</span></a></article>';
 }).join('');
 const href=page=>'/?'+esc(new URLSearchParams({shop_q:result.q,page}).toString());
 const pagination=result.pages>1?'<nav class="offer-pagination" aria-label="店铺搜索分页"><div class="offer-pagination-links">'+(result.page>1?'<a class="offer-page" href="'+href(result.page-1)+'">上一页</a>':'')+'<span class="shop-search-page">第 '+result.page+' / '+result.pages+' 页</span>'+(result.page<result.pages?'<a class="offer-page" href="'+href(result.page+1)+'">下一页</a>':'')+'</div></nav>':'';
 return '<div class="directory-intro"><h1>搜索店铺</h1><p>“'+esc(result.q)+'” · 找到 '+result.total+' 家店铺</p></div>'+(rows?'<div class="shop-search-results">'+rows+'</div>'+pagination:'<div class="directory-empty"><h2>没有找到相关店铺</h2><p>试试店名中的几个字，或输入域名（不需要 https://）。</p><p>搜索范围为本站当前公开报价中的店铺。</p><a href="/">返回全部产品</a></div>');
}
