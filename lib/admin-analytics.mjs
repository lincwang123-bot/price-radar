import { analyticsCsv } from './analytics.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function analyticsContent(analytics,days){
 if(!analytics)return '<section><h2>访问统计尚未启用</h2><p class="muted">暂时没有可展示的数据，请检查统计配置。</p></section>';
 let r;try{r=analytics.report(days)}catch{return '<section><p>统计读取暂时失败，公开页面不受影响。</p></section>'}
 const max=Math.max(2,...r.series.flatMap(p=>[p.pv||0,p.uv||0]));
 const x=i=>64+i*672/(r.series.length-1),y=v=>216-v*170/max;
 const plot=(key,color)=>`<polyline points="${r.series.flatMap((p,i)=>p[key]===null?[]:[`${x(i)},${y(p[key])}`]).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`+r.series.map((p,i)=>p[key]===null?'':`<circle cx="${x(i)}" cy="${y(p[key])}" r="3.5" fill="${color}"><title>${p.day} ${key}: ${p[key]}</title></circle>`).join('');
 const axes=[0,.5,1].map(n=>`<line x1="64" x2="736" y1="${y(max*n)}" y2="${y(max*n)}" stroke="#e4ebe6"/><text x="48" y="${y(max*n)+5}" text-anchor="end" fill="#7e8e83">${Math.round(max*n)}</text>`).join('');
 const dates=[0,Math.floor(r.series.length/2),r.series.length-1].map((i,j)=>`<text x="${x(i)}" y="250" text-anchor="${j===0?'start':j===2?'end':'middle'}" fill="#7e8e83">${r.series[i].day.slice(5).replace('-','/')}</text>`).join('');
 return `<div class="analytics-toolbar"><nav class="segments" aria-label="统计日期范围">${[7,30].map(d=>`<a href="/admin/analytics?days=${d}"${r.days===d?' aria-current="page"':''}>最近${d}天</a>`).join('')}</nav><a class="export-link" href="/admin/analytics.csv?days=${r.days}">导出 CSV ↓</a></div>
 <div class="metrics"><div class="metric"><span class="metric-label">访客估算</span><strong class="metric-value">${r.uv}</strong><span class="metric-hint">最近${r.days}天 · 区间去重</span></div><div class="metric"><span class="metric-label">页面访问量</span><strong class="metric-value">${r.pv}</strong><span class="metric-hint">最近${r.days}天 · 服务器统计</span></div><div class="metric"><span class="metric-label">历史累计访问量</span><strong class="metric-value">${r.historicalPv}</strong><span class="metric-hint">从首次记录开始累计</span></div></div>
 <p class="period-note">开始记录：${esc(new Date(r.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}（北京时间）</p>${r.healthy?'':'<p class="status-warning" role="alert">最近一次统计写入失败，数据可能不完整。</p>'}
 <section><h2>每日访问趋势</h2><div class="chart-legend"><span style="color:#55749a">● 页面访问量（服务器统计）</span><span style="color:#368061">● 访客估算</span></div><div class="chart-scroll" tabindex="0" aria-label="访问趋势图，可左右滚动"><svg viewBox="0 0 800 282" role="img" aria-label="每日访问趋势，横轴日期，纵轴数量">${axes}<text x="18" y="24" fill="#7e8e83">数量</text>${plot('pv','#55749a')}${plot('uv','#368061')}${dates}<text x="736" y="278" text-anchor="end" fill="#7e8e83">日期（北京时间）</text></svg></div><p class="chart-help">统计前的日期不补造历史；当天无记录显示 0。手机可横向滑动图表查看坐标，服务中断可能造成漏计。</p></section>
 <section><h2>按日明细</h2><div class="table"><table class="daily-table"><thead><tr><th scope="col">日期</th><th scope="col">页面访问量</th><th scope="col">访客估算</th></tr></thead><tbody>${r.series.map(p=>`<tr><td>${p.day}</td><td>${p.pv??'<span class="muted">未采集</span>'}</td><td>${p.uv??'<span class="muted">未采集</span>'}</td></tr>`).join('')}</tbody></table></div></section>
 <section class="privacy-note"><h2>统计口径与隐私</h2><p>访客按网络地址与浏览器粗分类的 HMAC 去标识摘要估算。共享网络可能合并计数，换网络或浏览器可能重复计数；它不是实际人数，也不是精准真人 PV。区间访客重新去重，不相加每日访客。</p><p>不使用追踪 Cookie，不保存原始 IP、完整浏览器标识、查询参数或表单信息。去标识不等于完全匿名。在线摘要保留 31 天，按日汇总长期保留；备份最多 14 份，过期摘要可能保留至备份轮换完成。</p><p>仅记录当前 Tunnel 传入的成功公开页面 GET；排除后台、API、投稿、健康检查、预取、管理员会话和已知机器人，但过滤并不完全。每标识每分钟最多计 60 次，全站最多计 600 次，超过时不计。</p></section>`;
}
export function exportAnalytics(res,analytics,days){
 if(!analytics){res.statusCode=503;res.end('统计暂不可用');return}
 try{const report=analytics.report(days);res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="airadar-daily-${report.days}d.csv"`);res.end(analyticsCsv(report))}catch{res.statusCode=503;res.end('统计暂不可用')}
}
