import {retentionDay} from './retention-store.mjs';
import {productGuideLinks} from './guides.mjs';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=g=>g.currency+' '+Number(g.price).toLocaleString('zh-CN',{maximumFractionDigits:2});
export const retentionAssets='<link rel="stylesheet" href="/assets/retention.css"><script src="/assets/retention.js" defer></script>';
export function followButton(productKey,spec=''){
 const query=new URLSearchParams({product:productKey});if(spec)query.set('spec',spec);
 return '<div class="retention-actions"><a class="retention-button primary" data-follow-product="'+esc(productKey)+'" data-follow-spec="'+esc(spec)+'" href="/following?'+esc(query)+'">＋ 关注这个产品</a><a class="retention-link" href="/following">我的关注</a></div>';
}
export function followingContent(){return `<section class="retention-page" data-following-page>
 <div class="retention-eyebrow">MY RADAR / 我的价格清单</div><div class="retention-heading"><div><h1>关心的产品，放在一起。</h1><p>保存购买条件，有合适的价格时再回来。</p></div><button class="retention-button primary" data-add-watch>＋ 添加关注</button></div>
 <section class="retention-account" aria-label="关注同步"><div><strong data-account-title>本机关注清单</strong><p data-account-copy>保存在当前浏览器。登录后可跨设备同步，邮件提醒由你自行开启。</p></div><div class="retention-actions" data-account-actions><a class="retention-button" href="/login?next=%2Ffollowing" data-login>登录并同步</a></div></section>
 <div class="reader-import" data-guest-import hidden><p data-import-copy></p><button type="button" class="retention-button" data-import-watches>将本机关注加入此账号</button></div>
 <div class="retention-tabs" role="group" aria-label="清单分类"><button data-list-tab="all" aria-pressed="true">全部关注</button><button data-list-tab="renewal" aria-pressed="false">到期提醒</button><button data-list-tab="notices" aria-pressed="false">最近动态</button></div>
 <p class="retention-muted"><a href="/help/price-alerts">如何设置降价、到期与邮箱提醒</a></p><p class="retention-muted" data-list-summary>正在读取关注清单…</p><div class="retention-grid" data-watch-list></div>
 <div class="retention-empty" data-watch-empty hidden><h2>把下次要买的 AI 放进清单</h2><p>先关注常用产品，选好期限与交付方式。你也可以只收藏，不接收邮件。</p><button class="retention-button primary" data-add-watch>选择第一个产品</button></div>
 <noscript><p>关注清单需要 JavaScript 保存到浏览器。你仍可直接浏览<a href="/">全部报价</a>和<a href="/weekly">行情周报</a>。</p></noscript>
 </section>`;}
export function retentionDialogs(){return `<div class="retention-toast" data-retention-toast role="status" aria-live="polite" hidden></div>
 <dialog class="retention-dialog" id="retention-watch-dialog"><form id="retention-watch-form"><div class="retention-dialog-head"><h2>关注条件</h2><button type="button" class="retention-close" data-close-dialog aria-label="关闭关注设置">×</button></div><input type="hidden" name="id">
 <label>产品<select name="productKey" required></select></label><label>期限、交付方式与适用条件<select name="groupId"><option value="">只关注产品，稍后选择规格</option></select></label><p class="retention-muted" data-group-current></p>
 <label>价格提醒方式<select name="mode"><option value="off">关闭价格提醒（仅收藏）</option><option value="target">降至目标价格或更低</option><option value="restock">明确售罄后恢复有货</option><option value="changes">价格明显下降</option><option value="weekly">每周查看一次报价</option></select></label>
 <label data-target-field hidden>目标价格（所选规格币种）<input type="number" name="targetPrice" min="0.01" max="1000000" step="0.01" placeholder="例如 100"></label>
 <label data-drop-field hidden>累计下降幅度（%）<input type="number" name="dropPct" min="1" max="90" value="5"></label>
 <details class="retention-renewal"><summary>我正在使用：添加到期日期</summary><label>到期日期<input type="date" name="renewalDate"></label><label>提前提醒<select name="leadDays"><option value="3">提前 3 天</option><option value="7">提前 7 天</option><option value="1">提前 1 天</option><option value="0">到期当天</option></select></label><p class="retention-muted">可导出到日历；邮箱提醒需要登录后自行开启。</p></details>
 <label class="retention-checkbox"><input type="checkbox" name="paused"> 暂停这项关注的所有提醒</label><p class="retention-form-error" role="alert" data-form-error></p><p class="retention-muted" data-save-note></p><button class="retention-button primary" type="submit">保存关注</button></form></dialog>
 `;}
export function productReference(service,productKey,{comparisonKey='',groupId=''}={}){
 const m=service.market(),p=m.products.find(p=>p.key===productKey);if(!p)return '';
 const groups=m.groups.filter(g=>g.productKey===productKey);
 const group=groups.find(g=>g.id===groupId||comparisonKey&&g.comparisonKey===comparisonKey)||(groups.length===1?groups[0]:null);
 let body='<p>选择明确的期限与交付规格，查看可比较的挂牌价。报价范围限于本站收录。</p>';
 if(group){
  const h=service.history(group.id),historyCopy=h.days?`近 30 天窗口内实际记录 ${h.days} 天；始于 ${retentionDay(h.firstAt)}。`:'同规格行情观察刚开始，还没有可展示的历史。';
  const chart=h.series.length>1?`<div class="retention-history">${historySvg(h.series)}</div>`:'';
  body='<p class="retention-spec">'+esc(group.spec)+' · '+esc(group.currency)+'</p><div class="retention-stats"><div><span>当前符合规格起价</span><strong>'+esc(group.state==='available'?price(group):group.state==='unavailable'?'暂时售罄':'暂未确认')+'</strong></div><div><span>符合规格的报价</span><strong>'+group.offerCount+' <small>条</small></strong></div><div><span>已记录的最低起价</span><strong>'+esc(h.low==null?'记录不足':group.currency+' '+h.low)+'</strong></div></div><p class="retention-muted">'+esc(historyCopy)+' 每日曲线取当天最后一次有效起价；保留已有来源历史。店铺覆盖变化也可能影响起价。</p>'+chart+
   '<div class="retention-actions"><a class="retention-button" data-follow-product="'+esc(p.key)+'" data-follow-group="'+esc(group.id)+'" href="/following?product='+encodeURIComponent(p.key)+'&group='+group.id+'">关注此规格</a><button class="retention-button" data-share-group="'+group.id+'">生成分享卡片</button></div>';
 }else if(groups.length){
  body+='<div class="retention-spec-links">'+groups.slice(0,8).map(g=>'<a href="/?'+esc(new URLSearchParams({family:p.family,product:p.key,spec:g.comparisonKey}))+'">'+esc(g.spec)+' · '+esc(g.currency)+'</a>').join('')+'</div>';
 }else body+='<p class="retention-muted">目前没有期限和交付方式均明确的可比规格，暂不计算统一起价或发送价格提醒。你可以先关注产品。</p>';
 return '<section class="retention-reference" aria-label="产品购买参考"><div class="retention-eyebrow">PRODUCT NOTES / 购买参考</div><h2>'+esc(p.name)+'：价格与购买条件</h2>'+body+
  '<div class="retention-faq"><details><summary>代充、成品号和共享有什么区别？</summary><p>代充通常为买家自己的账号开通权益；成品号交付另一账号；共享或席位需要核对使用人数和权限范围。以对应商品的明确交付说明为准。</p></details><details><summary>为什么最低价不能直接横向比较？</summary><p>期限、产品档位、交付方式、地区、人数、币种及优惠资格都可能不同。本站仅对已识别为同规格的报价统计起价，未知条件单独保留。质保天数不代表订阅有效期。</p></details><details><summary>购买前还应确认什么？</summary><p>核对是否适用于自己的账号、能否续费或覆盖现有权益、最终实付金额、售后范围和退款条件。报价来源与更新时间可在原报价中查看，店铺收录不等于交易安全保证。</p></details></div>'+productGuideLinks(productKey)+'</section>';
}
function historySvg(series){
 const low=Math.min(...series.map(p=>p.price)),high=Math.max(...series.map(p=>p.price)),range=Math.max(high-low,1);
 const points=series.map((p,i)=>`${40+i*720/(series.length-1)},${130-(p.price-low)/range*95}`).join(' ');
 return `<svg viewBox="0 0 800 175" role="img" aria-label="已记录的每日同规格最低挂牌价"><line x1="40" y1="135" x2="760" y2="135" stroke="#dfe7e4"/><polyline points="${points}" fill="none" stroke="#21715d" stroke-width="3"/><text x="40" y="162" font-size="13" fill="#66756d">${series[0].day}</text><text x="760" y="162" text-anchor="end" font-size="13" fill="#66756d">${series.at(-1).day}</text><text x="40" y="20" font-size="13" fill="#66756d">最高 ${high} · 最低 ${low}</text></svg>`;
}
export function weeklyContent(service,url){
 const report=service.weekly(url.searchParams.get('date'));if(!report)return null;
 const current=retentionDay(new Date()),archive=service.store?.db.prepare('SELECT DISTINCT day FROM retention_market_daily ORDER BY day DESC LIMIT 30').all()||[];
 return `<section class="retention-page"><div class="retention-eyebrow">MARKET LETTER / 行情周报</div><div class="retention-heading"><div><h1>本周，价格有什么变化？</h1><p>${report.since} — ${report.date} · 已记录 ${report.daysRecorded} 天有效观察</p></div><a class="retention-button" href="/following">关注我的产品</a></div><p class="retention-muted">比较同一规格在窗口内首个与最后一个有记录日期的收盘观察价。展示变化至少 1% 的记录；覆盖店铺变化也可能影响起价。历史不足时不推算完整一周。</p>
 <form class="retention-archive" action="/weekly"><label>查看往期<select name="date">${archive.length?archive.map(r=>'<option'+(r.day===report.date?' selected':'')+' value="'+r.day+'">截至 '+r.day+' 的一周</option>').join(''):'<option value="'+current+'">当前观察</option>'}</select></label><button class="retention-button">查看</button></form>
 <div class="retention-grid">${report.items.map(g=>`<article class="retention-card"><div class="retention-card-top"><h2>${esc(g.name)}</h2><span class="retention-change ${g.change<0?'down':'up'}">${g.change>0?'+':''}${g.change.toFixed(1)}%</span></div><p>${esc(g.spec)} · ${esc(g.currency)}</p><div class="retention-price">${g.lastPrice}<small>此前 ${g.firstPrice}</small></div><p class="retention-muted">实际记录 ${g.history.days} 天 · ${g.history.series[0].day} 至 ${g.history.series.at(-1).day}</p><div class="retention-actions"><a class="retention-button" href="/?${esc(new URLSearchParams({family:g.family,product:g.productKey,spec:g.comparisonKey}))}">查看当前报价</a><button class="retention-button" data-share-group="${g.id}" data-share-date="${report.date}">分享这条变化</button></div></article>`).join('')||'<div class="retention-empty"><h2>正在积累可比较的行情</h2><p>暂时没有跨两个日期、变化达到 1% 的同规格记录。现有报价照常更新，有符合条件的变化后会出现在这里。</p><a class="retention-button primary" href="/">查看当前报价</a></div>'}</div></section>`;
}
export function unsubscribeContent(token){return '<section class="retention-page"><h1>退订邮箱提醒</h1><p>确认后停止此邮箱的行情和续费提醒，关注清单仍保留。之后可在“我的关注”重新开启。</p><form data-unsubscribe-form><input type="hidden" name="token" value="'+esc(token)+'"><button class="retention-button primary">确认退订</button><p role="status" data-form-error></p></form><a href="/following">返回我的关注</a></section>';}
export function retentionAdminContent(store){
 if(!store)return '';
 const db=store.db,started=db.prepare("SELECT value FROM retention_meta WHERE key='started_at'").get()?.value;
 const cutoff=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
 const counts=db.prepare('SELECT kind,SUM(n) n FROM retention_event_days WHERE day>=? GROUP BY kind').all(cutoff);
 const cohorts=db.prepare("SELECT visitor,MIN(created_at) first_at FROM retention_events WHERE kind='follow' GROUP BY visitor").all();
 const returning=days=>{
  const mature=cohorts.filter(r=>Date.now()-Date.parse(r.first_at)>=days*86400000);
  const back=mature.filter(r=>db.prepare("SELECT 1 FROM retention_events WHERE visitor=? AND kind='visit' AND created_at>? AND created_at<=? AND day>? LIMIT 1").get(r.visitor,r.first_at,new Date(Date.parse(r.first_at)+days*86400000).toISOString(),retentionDay(r.first_at)));
  return mature.length?`${back.length} / ${mature.length}（${(back.length/mature.length*100).toFixed(1)}%）`:'暂无达到观察时长的样本';
 };
 return '<section><h2>关注与回访</h2><p>开始采集：'+esc(started||'尚未开始')+'。行为按日、去标识标识与对象去重；游客和邮箱账号分别计数，不等同实际人数。以下回访以最近 31 天内可观察到的关注行为为起点，排除当天访问。</p><p>7 天内回访：'+returning(7)+' · 30 天内回访：'+returning(30)+'</p><p>已确认邮箱 '+db.prepare('SELECT COUNT(*) n FROM retention_accounts').get().n+' · 当前关注 '+db.prepare('SELECT COUNT(*) n FROM retention_watches').get().n+'</p><table><thead><tr><th>近 30 天行为</th><th>去重记录</th></tr></thead><tbody>'+counts.map(r=>'<tr><td>'+esc(({follow:'保存关注',unfollow:'取消关注',visit:'清单回访',notice_visit:'从提醒入口回访',pause:'暂停单项',resume:'恢复单项',email_off:'停止邮箱提醒',email_on:'启用邮箱提醒',renewal:'设置到期',share:'分享',code_verified:'确认邮箱'})[r.kind]||r.kind)+'</td><td>'+r.n+'</td></tr>').join('')+'</tbody></table><p>邮件：'+db.prepare('SELECT status,COUNT(*) n FROM retention_mail GROUP BY status').all().map(r=>esc(r.status)+' '+r.n).join(' · ')+'。accepted 仅表示发件服务接受，不代表已读或收件箱送达。</p></section>';
}
