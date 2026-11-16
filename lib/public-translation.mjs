import {PUBLIC_ENGLISH_COPY} from './public-english-copy.mjs';
import {PUBLIC_ORIGIN,englishPathForChinese} from './public-locales.mjs';
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const decodeHtml=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[k]));
export function englishText(value){
 const s=value.trim();
 if(Object.hasOwn(PUBLIC_ENGLISH_COPY,s))return value.replace(s,()=>PUBLIC_ENGLISH_COPY[s]);
 const patterns=[
  [/^最近成功采集时间：$/,()=> 'Last successful collection: '],
  [/^(\d+) 条上次采集报价$/,(_,n)=>n+' previously observed quotes'],
  [/^(\d+) 条上次采集报价，按产品和币种分别列出。以原店结算页面为准。$/,(_,n)=>n+' previously observed quotes, grouped by product and currency. Confirm at merchant checkout.'],
  [/^“(.*)” · 找到 (\d+) 家店铺$/,(_,q,n)=>'“'+q+'” · '+n+' shops'],
  [/^第 (\d+) \/ (\d+) 页 · 本页 (\d+) 条店铺报价（每页最多 (\d+) 条）$/,(_,p,total,n,size)=>'Page '+p+' of '+total+' · '+n+' merchant quotes shown (up to '+size+' per page)'],
  [/^第 (\d+) \/ (\d+) 页$/,(_,p,total)=>'Page '+p+' of '+total],
  [/^第 (\d+) 页$/,(_,n)=>'Page '+n],
  [/^(\d+) 条已展示评价$/,(_,n)=>n+' published reviews'],
  [/^(\d+) 星，满分 5 星$/,(_,n)=>n+' out of 5 stars'],
  [/^评价配图 (\d+)（用户上传）$/,(_,n)=>'User-uploaded review image '+n],
  [/^查看评价配图 (\d+) 大图$/,(_,n)=>'View review image '+n],
  [/^其他交付 · (\d+) 条$/,(_,n)=>'Other delivery types · '+n],
  [/^(\d+) 条报价 · 查看$/,(_,n)=>n+' quotes · View'],
  [/^(\d+) 条有效报价，按产品和币种分别列出。以原店结算页面为准。$/,(_,n)=>n+' eligible quotes, grouped by product and currency. Confirm at merchant checkout.'],
  [/^(\d+) 条地区参考，原币标价与来源一起看。$/,(_,n)=>n+' regional references, with original prices and sources.'],
  [/^筛选后 (\d+) 条 \/ 共 (\d+) 条 · 第 (\d+) \/ (\d+) 页 · 待复核记录后置，同状态按人民币参考额排序$/,(_,n,t,p,ps)=>n+' matching records / '+t+' total · Page '+p+' of '+ps+' · Records needing recheck last; otherwise sorted by CNY reference.'],
  [/^(.+)（北京时间）$/,(_,s)=>englishText(s)+' (Beijing time, UTC+8)'],
  [/^返回 (ChatGPT|Claude|Gemini|Grok|X|Suno|Muse)$/,(_,n)=>'Back to '+n],
  [/^(.+) · 店铺报价与评价$/,(_,n)=>n+' · Shop quotes and reviews'],
  [/^(.+) · 店铺报价$/,(_,n)=>englishText(n)+' · Shop quotes'],
  [/^(.+)：价格与购买条件$/,(_,n)=>n+' — Prices and buying conditions'],
  [/^(.+) 官方地区价格$/,(_,n)=>n+' regional price references'],
  [/^(.+) · AI 订阅价格雷达$/,(_,n)=>englishText(n)+' · Airadar'],
  [/^(.+) · AI订阅价格雷达$/,(_,n)=>englishText(n)+' · Airadar'],
  [/^(.+)公开报价与规格$/,(_,n)=>englishText(n)+' quotes and specifications'],
  [/^AI 官方订阅地区价格｜(.+)$/,()=> 'Official subscription and regional prices'],
  [/^AIradar · AI 订阅选购与续费雷达｜(.+)$/,()=> 'Airadar · Compare AI subscriptions and renewals'],
  [/^(.+) 官方链接$/,(_,n)=>englishText(n)+' official links'],
  [/^(.+) \/ 官方订阅参考$/,(_,n)=>n+' / Official subscription references'],
  [/^第 (\d+) \/ (\d+) 页 · (\d+) 条$/,(_,p,t,n)=>'Page '+p+' of '+t+' · '+n+' reviews'],
  [/^(.+) 选购说明$/,(_,n)=>n+' buying notes'],
  [/^(.+) 选购相关阅读$/,(_,n)=>n+' related guides'],
  [/^(.+) 订阅怎么选？$/,(_,n)=>'Choosing a '+n+' subscription'],
  [/^在 (X|Telegram) 联系站长 (.+)$/,(_,n,h)=>'Contact '+h+' on '+n],
  [/^地区数据最近采集 (.+)$/,(_,n)=>'Regional data collected: '+englishText(n)],
  [/^(USD|CNY|EUR|GBP) ([\d.]+) \/ 月$/,(_,c,n)=>c+' '+n+' / month'],
  [/^· (\d+) 个月$/,(_,n)=>'· '+n+' month'+(n==='1'?'':'s')],
  [/^(CNY|USD|EUR|HKD|JPY|GBP) 报价$/,(_,c)=>c+' quotes'],
 ];
 for(const [re,replace] of patterns)if(re.test(s))return value.replace(s,s.replace(re,replace));
 if(s.includes(' · '))return value.replace(s,s.split(' · ').map(englishText).join(' · '));
 const count=s.match(/^(\d+) (家店|条报价|条店铺报价|条参考报价|条有效报价|条地区参考|个产品|个官方月付参考|个地区套餐)(.*)$/);
 if(count){const nouns={'家店':'shops','条报价':'quotes','条店铺报价':'merchant quotes','条参考报价':'reference quotes','条有效报价':'eligible quotes','条地区参考':'regional references','个产品':'products','个官方月付参考':'official monthly references','个地区套餐':'regional plans'};return value.replace(s,count[1]+' '+nouns[count[2]]+englishText(count[3]));}
 if(/^报价时间 /.test(s))return value.replace('报价时间 ','Observed ');
 if(/^核对日期：/.test(s))return value.replace('核对日期：','Last checked: ');
 if(/^汇率日期：/.test(s))return value.replace(s,'FX date: '+englishText(s.slice(5)));
 return value;
}
export function englishPublicHref(href){
 if(!href.startsWith('/')||href.startsWith('//')||href.startsWith('/en/'))return href;
 const u=new URL(href,PUBLIC_ORIGIN);
 if(u.pathname==='/go'){u.searchParams.set('lang','en');return u.pathname+u.search+u.hash;}
 const mapped=englishPathForChinese(u);if(!mapped)return href;
 const target=new URL(mapped,PUBLIC_ORIGIN);
 for(const [key,value] of u.searchParams){if(['family','product'].includes(key)&&target.pathname.startsWith('/en/prices/'))continue;if(key==='source'&&target.pathname==='/en/official-prices')continue;target.searchParams.set(key,value);}
 return target.pathname+target.search+u.hash;
}
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const originalClasses=new Set(['directory-quote-title','directory-minimum-spec','review-body','review-meta','sponsor-creative','sponsor-card-copy','retention-spec','retention-spec-links','merchant-x-handle','shop-search-domain']);
export function englishReviewBrowsing(html,id){
 const href='/shop?id='+id;
 return html.replace('href="#write-review">写评价','data-chinese-page="true" href="'+href+'#write-review">Write a review (Chinese)')
  .replace(/<button\b[^>]*class="review-report"[^>]*>[\s\S]*?<\/button>/g,'<a class="review-report" data-chinese-page="true" href="'+href+'#reviews">Report / appeal (Chinese)</a>')
  .replace(/<button\b[^>]*\bdata-reply-review="[^"]*"[^>]*>[\s\S]*?<\/button>/g,'<a class="review-button" data-chinese-page="true" href="'+href+'#merchant-replies">Reply as shop owner (Chinese)</a>')
  .replace(/<details class="review-compose"[\s\S]*?(?=<details class="review-rules")/,'<details class="review-compose" id="write-review"><summary>Write a review / My review status</summary><p>Review text and images are shown in their original language. Purchase records must be submitted privately for moderation on the Chinese form.</p><a class="review-button" data-chinese-page="true" href="'+href+'#write-review">Write a review (Chinese)</a></details>\n<details class="review-compose" id="merchant-replies"><summary>Shop owner replies / My reply status</summary><p>Verified shop owners can reply using the Chinese form. Replies are moderated before publication. Merchants cannot access private purchase records or edit customer reviews.</p><a class="review-button" data-chinese-page="true" href="'+href+'#merchant-replies">Reply / My reply status (Chinese)</a></details>\n')
  .replace(/<dialog data-(?:review|reply)-dialog[\s\S]*?<\/dialog>/g,'')
  .replace(/<script src="\/assets\/shop-reviews.js"[^>]*><\/script>/,'');
}
// Operates only on escaped server-generated HTML. Static UI translations never
// touch scripts, styles, form values or protected original merchant/user text.
// Unknown copy stays visible, rather than silently rewriting a merchant claim.
export function localizePublicHtml(html,{chinese='/' }={}){
 const stack=[];let out='',position=0;
 const token=/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
 const has=cls=>stack.some(n=>n.classes.has(cls));
 const protectedText=()=>{
  const current=stack.at(-1),parent=stack.at(-2);
  return stack.some(n=>n.original)||current?.name==='h2'&&(parent?.classes.has('directory-quote-main')||has('shop-search-result'))||current?.name==='h1'&&has('merchant')||current?.name==='strong'&&parent?.name==='header'&&has('review-card')||current?.name==='p'&&has('x-list-row')&&!current.classes.has('shop-quote-time')||current?.classes.has('directory-quote-spec')||current?.name==='p'&&has('quote-conditions')||current?.name==='span'&&has('growth-market');
 };
 const text=raw=>protectedText()?raw:escapeHtml(englishText(decodeHtml(raw)));
 for(let match; (match=token.exec(html));){
  out+=text(html.slice(position,match.index));let tag=match[0];position=token.lastIndex;
  if(tag.startsWith('<!')){out+=tag;continue;}
  const close=tag.startsWith('</'),name=tag.match(/^<\/?([\w-]+)/)[1].toLowerCase();
  if(close){const index=stack.findLastIndex(n=>n.name===name);if(index>=0)stack.length=index;out+=tag;continue;}
  const attributes=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],decodeHtml(m[2]??m[3])]));
  const classes=new Set((attributes.class||'').split(/\s+/)),original=attributes.translate==='no'||[...classes].some(c=>originalClasses.has(c));
  if(name==='script'||name==='style'){
   const end=new RegExp('</'+name+'\\s*>','ig');end.lastIndex=position;const last=end.exec(html);if(!last){out+=html.slice(match.index);position=html.length;break;}
   // These forms still live in Chinese. Normal hrefs remain usable, without
   // initializing Chinese-only dialog/account code on an English browsing page.
   if(!(name==='script'&&['/assets/retention.js','/assets/account.js'].includes(attributes.src)))out+=html.slice(match.index,last.index+last[0].length);
   position=end.lastIndex;token.lastIndex=position;continue;
  }
  if(name==='html')tag=tag.replace('lang="zh-CN"','lang="en"');
  if((name==='a'||name==='form')&&!attributes['data-chinese-page'])tag=tag.replace(/\b(href|action)="([^"]*)"/g,(_,key,raw)=>{
   const href=decodeHtml(raw),next=key==='action'&&href==='/product'?'/en/official-prices':englishPublicHref(href);
   return key+'="'+escapeHtml(next)+'"';
  });
  if(!original)for(const attribute of ['aria-label','placeholder','title','alt','data-label'])tag=tag.replace(new RegExp('\\b'+attribute+'="([^"]*)"','g'),(_,raw)=>attribute+'="'+escapeHtml(englishText(decodeHtml(raw)))+'"');
  if(name==='a'&&!attributes['data-chinese-page']&&attributes.href?.startsWith('/')&&!attributes.href.startsWith('//')&&!attributes.href.startsWith('/go?')&&englishPublicHref(attributes.href)===attributes.href&&!attributes.href.startsWith('/assets/')&&!attributes.href.startsWith('/api/'))tag=tag.replace(/\s+title="[^"]*"/,'').replace(/>$/,' data-chinese-page="true" title="This page is currently in Chinese">');
  if(original&&attributes.translate!=='no')tag=tag.replace(/>$/,' translate="no">');
  if(!attributes.title&&(classes.has('directory-quote-title')||classes.has('review-body')))tag=tag.replace(/>$/,' title="Original text · untranslated">');
  out+=tag;if(!voidTags.has(name)&&!tag.endsWith('/>'))stack.push({name,classes,original});
 }
 out+=text(html.slice(position));
 out=out.replace(/(<nav class="app-nav"[^>]*>[\s\S]*?)(<\/nav>)/,'$1<a class="nav-link" data-language-switch href="'+escapeHtml(chinese)+'" lang="zh-CN" hreflang="zh-CN">简体中文</a>$2');
 out=out.replace(/<button class="retention-button" data-share-group="[^"]*"[^>]*>[\s\S]*?<\/button>/g,'<a class="retention-button" data-chinese-page href="'+escapeHtml(chinese)+'">Share (Chinese)</a>');
 return out;
}
