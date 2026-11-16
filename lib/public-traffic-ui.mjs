const COPY={
 zh:{title:'本站访问数据',advertise:'广告合作',total:'累计浏览量',month:'近 30 天浏览量',visitors:'近 30 天估算访客',pv:'次页面浏览',uv:'去重访客估算',cadence:'每 5 分钟更新',delayed:'更新延迟，展示上次统计',updated:'更新于',zone:'北京时间',details:'统计口径',since:'开始统计',note:'浏览量（PV）按成功打开的已记录公开页面计数，刷新可能重复。近 30 天包含今天，按北京时间计算。访客按网络地址与浏览器类型的去标识摘要在区间内去重，不等于真实人数或独立 IP。已排除已知机器人、后台、管理员访问和预取，但过滤可能有遗漏。统计启用前及此前未覆盖页面的访问未补算；不代表广告曝光或成交。'},
 en:{title:'Airadar traffic',advertise:'Advertise',total:'Total pageviews',month:'Pageviews · last 30 days',visitors:'Estimated visitors · last 30 days',pv:'pageviews',uv:'deduplicated estimate',cadence:'Updated every 5 minutes',delayed:'Update delayed; last snapshot shown',updated:'Updated',zone:'UTC+8',details:'How we count',since:'Tracking since',note:'Pageviews (PV) count successful recorded public-page requests; reloads may count again. The last 30 days include today in UTC+8. Visitors are deduplicated within the period using a de-identified network-address and browser-type digest, not real people or unique IP addresses. Known bots, admin visits and prefetches are filtered, but filtering is imperfect. Visits before tracking began or to previously untracked pages are not backfilled. These figures are not ad impressions or sales.'},
};
const displayTime=value=>new Date(+new Date(value)+8*3600000).toISOString().slice(0,16).replace('T',' ');
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const displayUtcTime=value=>new Date(value).toISOString().slice(0,19).replace('T',' ');
const CLOUDFLARE_COPY={
 zh:{day:'近 24 小时唯一访问者',month:'近 30 天唯一访问者',unit:'IP 去重估算',source:'来源：Cloudflare',cadence:'每 5 分钟同步',updated:'上次同步',dayWindow:'24 小时统计区间',monthWindow:'30 天统计区间',note:'采用 Cloudflare 的唯一访问者统计口径，按 IP 去重估算，可能包含机器人或自动化流量；不等于真实人数、广告曝光或成交。区间按下列 UTC 起止时间统计，更新时间不代表统计区间的结束时间。不同统计工具的去重方式、范围和时区可能不同，数据不宜直接混用。'},
 en:{day:'Unique visitors · last 24 hours',month:'Unique visitors · last 30 days',unit:'IP-based estimate',source:'Source: Cloudflare',cadence:'Synced every 5 minutes',updated:'Last synced',dayWindow:'24-hour reporting period',monthWindow:'30-day reporting period',note:'Uses Cloudflare’s unique-visitor metric, an IP-based estimate that may include bots or automated traffic; these figures are not real people, ad impressions or sales. Reporting periods use the UTC boundaries below; the sync time is not the reporting-period end. Other analytics tools may use different deduplication rules, coverage and time zones, so their figures are not directly interchangeable.'},
};

function trafficNumber(value,largest=value){
 const text=value.toLocaleString('en-US');
 const longest=largest.toLocaleString('en-US'),digits=[...longest].filter(char=>/\d/.test(char)).length;
 const units=(digits*.76+(longest.length-digits)*.28).toFixed(2);
 const face=(char,kind,flap=false)=>`<span class="traffic-half traffic-half--${kind}${flap?' traffic-flap':''}"><i>${char}</i></span>`;
 return `<div class="traffic-number" data-traffic-flip role="img" aria-label="${escapeHtml(text)}" style="--traffic-units:${units}">${[...text].map((char,index)=>/\d/.test(char)?`<span class="traffic-digit" aria-hidden="true" style="--flip-delay:${Math.min(index,8)*55}ms">${face(char,'top')}${face(char,'bottom')}${face(char,'top',true)}${face(char,'bottom',true)}</span>`:`<span class="traffic-separator" aria-hidden="true">${escapeHtml(char)}</span>`).join('')}</div>`;
}

function cloudflareTrafficHtml(snapshot,locale,stale){
 const common=COPY[locale]||COPY.zh,c=CLOUDFLARE_COPY[locale]||CLOUDFLARE_COPY.zh;
 const largest=Math.max(snapshot.dayUv,snapshot.monthUv);
 const time=value=>`<time datetime="${escapeHtml(value)}">${displayUtcTime(value)}</time>`;
 return `<section class="public-traffic public-traffic--cloudflare" aria-labelledby="public-traffic-title">
  <div class="public-traffic-heading"><h2 id="public-traffic-title">${common.title}</h2><div class="traffic-actions"><button type="button" class="traffic-replay" data-traffic-replay hidden>${locale==='en'?'Flip again':'翻一翻'} <span aria-hidden="true">↻</span></button><a href="/advertise">${common.advertise} <span aria-hidden="true">↗</span></a></div></div>
  <dl class="public-traffic-metrics">
   <div><dt>${c.day}</dt><dd>${trafficNumber(snapshot.dayUv,largest)}<span>${c.unit}</span></dd></div>
   <div><dt>${c.month}</dt><dd>${trafficNumber(snapshot.monthUv,largest)}<span>${c.unit}</span></dd></div>
  </dl>
  <div class="public-traffic-footer"><p>${c.source}<span>${stale?common.delayed:c.cadence}</span><span>${c.updated} <time datetime="${escapeHtml(snapshot.updatedAt)}">${displayTime(snapshot.updatedAt)}</time> (${common.zone})</span></p>
  <details><summary>${common.details}</summary><p>${c.dayWindow}: ${time(snapshot.dayStart)} — ${time(snapshot.dayEnd)} (UTC)</p><p>${c.monthWindow}: ${time(snapshot.monthStart)} — ${time(snapshot.monthEnd)} (UTC)</p><p>${c.note}</p></details></div>
 </section>`;
}

// Validated public DTO only. Digits are server rendered; animation is optional, never polling.
export function publicTrafficHtml(snapshot,locale='zh',now=Date.now()){
 if(!snapshot)return '';
 const c=COPY[locale]||COPY.zh;
 const stale=now-Date.parse(snapshot.updatedAt)>10*60000;
 if(snapshot.source==='cloudflare')return cloudflareTrafficHtml(snapshot,locale,stale);
 return `<section class="public-traffic" aria-labelledby="public-traffic-title">
  <div class="public-traffic-heading"><h2 id="public-traffic-title">${c.title}</h2><a href="/advertise">${c.advertise} <span aria-hidden="true">↗</span></a></div>
  <dl class="public-traffic-metrics">
   <div><dt>${c.total}</dt><dd>${trafficNumber(snapshot.totalPv)}<span>${c.pv}</span></dd></div>
   <div><dt>${c.month}</dt><dd>${trafficNumber(snapshot.monthPv)}<span>${c.pv}</span></dd></div>
   <div><dt>${c.visitors}</dt><dd>${trafficNumber(snapshot.monthUv)}<span>${c.uv}</span></dd></div>
  </dl>
  <div class="public-traffic-footer"><p>${stale?c.delayed:c.cadence}<span>${c.updated} <time datetime="${snapshot.updatedAt}">${displayTime(snapshot.updatedAt)}</time> (${c.zone})</span></p>
  <details><summary>${c.details}</summary><p>${c.since}: <time datetime="${snapshot.startedAt}">${displayTime(snapshot.startedAt).slice(0,10)}</time> (${c.zone})</p><p>${c.note}</p></details></div>
 </section>`;
}

export const PUBLIC_TRAFFIC_CSS=`
.public-traffic-metrics>div{container-type:inline-size}
.traffic-number{display:flex;align-items:center;justify-content:center;gap:.08em;width:max-content;max-width:100%;margin:0 auto;padding:10px 2px 13px;font-family:ui-rounded,'SF Pro Rounded','Avenir Next',system-ui,sans-serif;font-size:64px;font-size:clamp(12px,calc(100cqi / var(--traffic-units)),64px);line-height:1.28;letter-spacing:-.035em;font-weight:600;font-variant-numeric:tabular-nums}
.traffic-digit{position:relative;isolation:isolate;display:block;flex:0 0 .66em;width:.66em;height:1.28em;border-radius:7px;background:#fdfdfb;color:#244c39;box-shadow:0 1px 0 1px #d4dbd2,0 4px 0 #e5e9e1,0 5px 0 #cbd4c8,0 8px 12px #234b3212;perspective:400px}
.traffic-digit:after{content:'';position:absolute;top:50%;left:0;right:0;border-top:1px solid #c0cbbd;box-shadow:0 1px 0 #ffffffc9;z-index:5;pointer-events:none}
.traffic-digit:before{content:'';position:absolute;top:calc(50% - 4px);left:-2px;width:3px;height:8px;border-radius:2px;background:#8d9c8e;box-shadow:calc(.66em + 1px) 0 #8d9c8e;z-index:6;pointer-events:none}
.traffic-half{display:block;position:absolute;left:0;right:0;height:50%;overflow:hidden;backface-visibility:hidden;background:#fdfdfb}
.traffic-half--top{top:0;border-radius:7px 7px 0 0;background:linear-gradient(#f9faf6,#edf0e9);transform-origin:center bottom}
.traffic-half--bottom{top:50%;border-radius:0 0 7px 7px;transform-origin:center top}
.traffic-half i{position:absolute;left:0;right:0;top:0;height:1.28em;line-height:1.28em;text-align:center;font-style:normal}
.traffic-half--bottom i{top:-.64em}
.traffic-separator{align-self:flex-end;width:.16em;padding-bottom:.05em;text-align:center;color:#80917f}
.traffic-flap{display:none;z-index:3}
.traffic-number.is-flipping .traffic-flap{display:block;animation-duration:700ms;animation-delay:var(--flip-delay);animation-timing-function:cubic-bezier(.4,0,.2,1);animation-fill-mode:both}
.traffic-number.is-flipping .traffic-flap.traffic-half--top{animation-name:traffic-flip-top}
.traffic-number.is-flipping .traffic-flap.traffic-half--bottom{animation-name:traffic-flip-bottom}
@keyframes traffic-flip-top{0%{transform:rotateX(0deg)}49%,100%{transform:rotateX(-90deg)}}
@keyframes traffic-flip-bottom{0%,49%{transform:rotateX(90deg)}82%{transform:rotateX(-7deg)}100%{transform:rotateX(0deg)}}
@media(max-width:600px){.traffic-number{font-size:34px;font-size:clamp(12px,calc((100cqi - 14px) / var(--traffic-units)),34px)}}
@media(prefers-reduced-motion:reduce){.traffic-number.is-flipping .traffic-flap{display:none;animation:none}}
.public-traffic{margin:0 0 28px;padding:18px 24px;border:1px solid #d9dfd6;border-radius:16px;background:#f5f7f1;color:#283e34;box-shadow:inset 0 1px 0 #fff,0 6px 20px #244c3905}
.public-traffic-heading{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 12px}
.public-traffic-heading h2{margin:0;font-size:15px;font-weight:650}.public-traffic-heading a{display:inline-flex;align-items:center;gap:8px;min-height:44px;color:#285b45;font-size:13px;font-weight:650;white-space:nowrap}
.public-traffic-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:22px 0 26px;gap:20px;text-align:center}
.public-traffic--cloudflare .public-traffic-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
.public-traffic--cloudflare .public-traffic-metrics{container-type:inline-size}
.public-traffic--cloudflare .public-traffic-metrics>div{container-type:normal}
.public-traffic--cloudflare .traffic-number{font-size:clamp(12px,calc((50cqi - 26px) / var(--traffic-units)),64px)}
@media(max-width:600px){.public-traffic--cloudflare .traffic-number{font-size:clamp(12px,calc((50cqi - 22px) / var(--traffic-units)),34px)}}
.public-traffic-metrics>div{min-width:0}.public-traffic-metrics>div+div{padding-left:24px;border-left:1px solid #dce3d6}
.public-traffic-metrics dt{font-size:13px;color:#4b6356;line-height:1.5}.public-traffic-metrics dd{margin:6px 0 3px;font-size:clamp(26px,3vw,38px);font-weight:650;line-height:1.15;letter-spacing:-.025em;font-variant-numeric:tabular-nums}.public-traffic-metrics dd>span{display:block;margin-top:6px;font-size:11px;font-weight:400;letter-spacing:normal;color:#4b6356}
.public-traffic-footer{display:flex;justify-content:space-between;align-items:start;gap:8px 24px;border-top:1px solid #dce3d6;padding-top:10px;font-size:11px;color:#4b6356;line-height:1.7}.public-traffic-footer p{margin:0}.public-traffic-footer>p{flex:1;align-self:center;display:flex;flex-wrap:wrap;column-gap:16px;row-gap:2px}.public-traffic-footer>p>span{display:inline-block}.public-traffic-footer details{max-width:650px}.public-traffic-footer summary{cursor:pointer;min-height:44px;align-content:center;text-align:right;font-size:12px}.public-traffic-footer details[open]{flex-basis:100%}.public-traffic-footer:has(details[open]){flex-wrap:wrap}.public-traffic-footer details p{margin:4px 0 8px}.public-traffic a:focus-visible,.public-traffic summary:focus-visible,.traffic-replay:focus-visible{outline:2px solid #285b45;outline-offset:3px}
.traffic-actions{display:flex;align-items:center;gap:18px}.traffic-replay{border:0;background:transparent;color:#526b58;font:inherit;font-size:12px;min-height:44px;padding:0 4px;cursor:pointer}.traffic-replay[hidden]{display:none}.traffic-replay:disabled{cursor:default;opacity:.55}.traffic-replay:hover:not(:disabled){color:#244c39}.traffic-replay span{font-size:18px;margin-left:3px}.public-traffic-heading a{border:1px solid #ccdacb;border-radius:8px;padding:0 12px;background:#fcfdf9}
@media(max-width:600px){.traffic-actions{gap:10px;margin-left:auto}.public-traffic-heading a{padding:0 8px;font-size:12px}.public-traffic-heading .traffic-replay{font-size:11px}.public-traffic-heading .traffic-replay span{font-size:16px}}
@media(max-width:600px){.public-traffic-metrics>div:not(:first-child) dt{min-height:3em}}
@media(max-width:600px){.public-traffic{padding:12px 16px;margin-bottom:22px}.public-traffic-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:10px 0 14px}.public-traffic-metrics>div+div{padding-left:0;border-left:0}.public-traffic-metrics>div:first-child{grid-column:1/-1;padding-bottom:12px;border-bottom:1px solid #d4e1da}.public-traffic-metrics>div:first-child dd{font-size:36px}.public-traffic-metrics dt{font-size:12px}.public-traffic-metrics dd{font-size:26px}.public-traffic-footer{flex-wrap:wrap;gap:0}.public-traffic-footer details{width:100%}.public-traffic-footer summary{text-align:left}.public-traffic-heading h2{font-size:14px}}
@media(max-width:600px){.public-traffic--cloudflare .public-traffic-metrics>div:first-child{grid-column:auto;padding-bottom:0;border-bottom:0}.public-traffic--cloudflare .public-traffic-metrics>div+div{padding-left:14px;border-left:1px solid #d4e1da}.public-traffic--cloudflare .public-traffic-metrics dt{min-height:3em}.public-traffic--cloudflare .public-traffic-metrics>div:first-child dd{font-size:26px}.public-traffic--cloudflare .public-traffic-footer>p{max-width:100%;flex-shrink:1}.public-traffic--cloudflare .public-traffic-footer details p{overflow-wrap:anywhere}}
`;
