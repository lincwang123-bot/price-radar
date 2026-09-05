import { analyticsCsv } from "./analytics.mjs";
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function analyticsContent(analytics, days) {
  if (!analytics) return "<section><p>访问统计尚未启用或暂时不可用，暂无可展示数据。</p></section>";
  let r;try { r=analytics.report(days); } catch { return "<section><p>统计读取暂时失败，公开页面不受影响。请检查统计服务。</p></section>"; }
  const max = Math.max(2,...r.series.map(p=>p.pv||0),...r.series.map(p=>p.uv||0));
  const x = i => 52 + i * 700 / (r.series.length-1), y = value => 230 - value * 185 / max;
  const plot = (key,color) => r.series.map((p,i)=>p[key]===null?"":`<circle cx="${x(i)}" cy="${y(p[key])}" r="3" fill="${color}"/><title>${p.day} ${key}: ${p[key]}</title>`).join("") + `<polyline points="${r.series.flatMap((p,i)=>p[key]===null?[]:[`${x(i)},${y(p[key])}`]).join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`;
  const axes = [0,0.5,1].map(n=>`<line x1="52" x2="752" y1="${y(max*n)}" y2="${y(max*n)}" stroke="#dce2e6"/><text x="44" y="${y(max*n)+4}" text-anchor="end" font-size="12">${Math.round(max*n)}</text>`).join("");
  return `<style>svg text{font-size:14px}@media(max-width:600px){svg text{font-size:26px}}</style><nav><a href="/admin/analytics?days=7">最近7天</a><a href="/admin/analytics?days=30">最近30天</a><a href="/admin/analytics.csv?days=${r.days}">导出按日明细 CSV</a></nav>
  <section><h2>最近${r.days}天</h2><p>访客估算 <strong>${r.uv}</strong> · 页面访问量（服务器统计） <strong>${r.pv}</strong></p><p>开始记录以来累计访问量：${r.historicalPv}；开始时间：${esc(new Date(r.startedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}))}（北京时间）</p>${r.healthy?"":"<p role=alert>最近一次统计写入失败，当前数据可能不完整。</p>"}</section>
  <section><h2>每日访问趋势</h2><p><span style="color:#165cb0">蓝色：页面浏览量</span> · <span style="color:#147e55">绿色：估算独立访客</span></p><svg viewBox="0 0 800 285" role="img" aria-label="每日浏览量与估算独立访客趋势，横轴日期，纵轴数量" style="width:100%;height:auto">${axes}<text x="8" y="20" font-size="12">数量</text><line x1="52" y1="45" x2="52" y2="230" stroke="#526570"/>${plot("pv","#165cb0")}${plot("uv","#147e55")}<text x="52" y="255" font-size="12">${r.series[0].day}</text><text x="400" y="255" text-anchor="middle" font-size="12">${r.series[Math.floor(r.series.length/2)].day}</text><text x="752" y="255" text-anchor="end" font-size="12">${r.series.at(-1).day}</text><text x="752" y="278" text-anchor="end" font-size="12">日期（北京时间）</text></svg><p>灰色缺失记录代表统计尚未开始，不补造历史；启用后未记录请求的日期显示0。服务中断可能造成漏计。</p></section>
  <section><h2>按日明细</h2><div class="table"><table><thead><tr><th>日期</th><th>浏览量</th><th>估算独立访客</th></tr></thead><tbody>${r.series.map(p=>`<tr><td>${p.day}</td><td>${p.pv??"未采集"}</td><td>${p.uv??"未采集"}</td></tr>`).join("")}</tbody></table></div></section>
  <section><h2>统计口径与隐私</h2><p>访客按网络地址与浏览器粗分类的HMAC去标识摘要估算。共享网络可能合并计数，切换网络或浏览器可能重复计数；它不是实际人数，也不是精准真人PV。区间访客对整个窗口重新去重，不相加每日访客。</p><p>不使用追踪Cookie，不保存原始IP、完整浏览器标识、查询参数或表单信息。去标识不等于完全匿名。在线去重明细保留31天；按日汇总长期保留。备份最多保留14份，过期摘要可能在备份轮换完成前保留。只记录来自当前Tunnel的成功公开页面GET，排除后台、API、提交页、健康检查、预取、带管理员会话的请求与已知机器人；无法识别的自动流量仍可能被统计。为防滥用，每标识每分钟最多60次、全站每分钟最多600次，超过时不计。</p></section>`;
}
export function exportAnalytics(res,analytics,days) {
  if(!analytics){res.statusCode=503;res.end("统计暂不可用");return;}
  try{const report=analytics.report(days);res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="airadar-daily-${report.days}d.csv"`);res.end(analyticsCsv(report));}
  catch{res.statusCode=503;res.end("统计暂不可用");}
}
