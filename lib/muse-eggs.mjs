// Limited X giveaway clues. Delete this module, its call sites, and the
// .muse-egg rule in lib/guide-styles.mjs when the campaign ends.
// Public hints only. Never put a real Muse code, card key, or redemption code here.

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const MUSE_EGGS=Object.freeze([
 {path:'/guides',id:'Muse-03'},
 {path:'/help/compare-prices',id:'Muse-05'},
]);

export function museEggHtml(path){
 const egg=MUSE_EGGS.find(item=>item.path===path);
 if(!egg)return '';
 const id=esc(egg.id);
 return `<aside class="muse-egg" data-muse-egg="${id}" translate="no"><p>#MUSE彩蛋 ${id} · 限时 5 名 · 找到后私信 X <a href="https://x.com/superwang" target="_blank" rel="noopener noreferrer">@superwang</a> 兑换 · 先到先得，兑完即止 · 收录≠推荐，本站不售号、不代充、不担保</p></aside>`;
}
