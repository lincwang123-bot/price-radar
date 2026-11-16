import {sponsorError,sponsorPlan} from './sponsor-plans.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayOf=value=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
const localTime=value=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
const fields=['impressions','visible','clicks','contact_clicks'];
const zero=()=>Object.fromEntries(fields.map(k=>[k,0]));
const add=(target,row)=>{for(const k of fields)target[k]+=Number(row[k]||0);return target;};
const ratio=(n,d)=>d?`${(n/d*100).toFixed(2)}%`:'无法计算';
const stage=(campaign,asOf)=>!campaign?'':campaign.status==='paused'?'已暂停':campaign.status!=='approved'?'草稿':Date.parse(campaign.end_at)<=Date.parse(asOf)?'档期已结束':Date.parse(campaign.start_at)>Date.parse(asOf)?'待开始':'投放中';
export const sponsorMetricNotes=[
 '数据来源：AirRadar 站内广告统计；时间均为北京时间（UTC+8）。数据截至生成时刻，正在投放或尚未结束的当天数据可能继续增长。',
 '页面输出指页面返回了广告，不代表用户实际看见。可见展示指广告至少 50% 面积在前台连续可见满 1 秒；浏览器拦截、网络失败等可能导致漏报。',
 '各项按每日匿名网络/浏览器标识、广告、页面等维度去重，均为估算。累计数不是整段期间独立人数；跨页面、跨活动合计也未做用户去重。',
 '商家跳转仅表示本站确认跳转，不保证商家页面成功打开。TG 点击仅表示通过本站打开 Telegram 链接，不代表发起会话。两类点击分别统计，不能相加当作独立用户。',
 '商家跳转/输出比率以页面输出为分母；商家跳转/可见比率以可见展示为分母。两项均不是成交率；因漏报或不同上报时序，比率可能超过 100%。分母为 0 时无法计算。',
 '历史未区分：旧统计未记录具体页面，保留原数而不补造页面归属。升级当天旧、新口径可能出现同一访客重复计数。历史可见展示或 TG 为 0 可能是尚未测量，不代表无人看见或点击。',
 '无订单回传，无法提供成交量、成交率或销售额。本报告不计算每次点击成本；后台金额为 0 不代表免费。'
];
export const sponsorReportStyles=`.sr-filter{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sr-filter label{display:flex;flex-direction:column;gap:5px;min-width:0}.sr-filter input,.sr-filter select{width:100%;box-sizing:border-box}.sr-actions{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}.sr-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.sr-kpi{border:1px solid #dbe5df;border-radius:10px;padding:14px;background:#f6f9f7}.sr-kpi strong{display:block;font-size:26px;color:#205842}.sr-kpi span{font-size:13px;color:#53665e}.sr-scroll{overflow-x:auto;max-width:100%}.sr-table{width:100%;border-collapse:collapse;font-size:14px}.sr-table th,.sr-table td{padding:10px;text-align:left;border-bottom:1px solid #dbe5df;vertical-align:top}.sr-table th{color:#53665e;white-space:nowrap}.sr-table small{display:block;color:#61726a}.sr-notes{font-size:13px;color:#53665e;line-height:1.7}.sr-notes li{margin-bottom:7px}.sr-heading{margin:24px 0 10px}.sr-message{padding:12px;background:#f4f7f5;border-radius:8px}.sr-path{overflow-wrap:anywhere}.sr-filter button{align-self:end}@media(max-width:760px){.sr-filter{grid-template-columns:1fr}.sr-kpis{grid-template-columns:1fr 1fr}.sr-kpi strong{font-size:23px}.sr-table{min-width:760px}}`;

export function sponsorReportSelection(analytics,url,{customer=false,now=new Date()}={}){
 if(!analytics?.outbound?.reportSponsorDetail)throw sponsorError('广告报告服务未配置',503);
 const params=url.searchParams,merchantId=params.get('merchant')||'',campaignId=params.get('campaign')||'';
 for(const key of ['merchant','campaign','from','to','format'])if(params.getAll(key).length>1)throw sponsorError('报告参数重复',400);
 const all=analytics.outbound.listCampaigns();
 if(customer&&!merchantId)throw sponsorError('请先选择一个商家，再导出该商家的报告',400);
 if(merchantId&&!all.some(c=>c.merchant_id===merchantId))throw sponsorError('商家不存在',404);
 if(campaignId&&!all.some(c=>c.id===campaignId&&(!merchantId||c.merchant_id===merchantId)))throw sponsorError('所选活动不属于该商家',400);
 const from=params.get('from')||dayOf(now.getTime()-29*86400000),to=params.get('to')||dayOf(now);
 const report=analytics.outbound.reportSponsorDetail({merchantId,campaignId,from,to},now);
 // Defense in depth: an export may never include another merchant, even if a future query regresses.
 if(customer&&(report.campaigns.some(c=>c.merchant_id!==merchantId)||report.rows.some(r=>r.merchant_id!==merchantId)))throw sponsorError('报告归属核对失败，已停止导出',500);
 return {merchantId,campaignId,all,report};
}
export function sponsorPageLabel(path){
 if(!path)return '历史未区分';
 if(path==='/')return '首页';
 if(path==='/catalog')return '全部产品目录';
 if(path==='/?family=chatgpt')return 'ChatGPT 分类页';
 return path;
}
function groups(report){
 const byCampaign=new Map(report.campaigns.map(c=>[c.id,c])),map=new Map();
 for(const row of report.rows){const key=JSON.stringify([row.campaign_id,row.page_path||'']);if(!map.has(key))map.set(key,{campaign:byCampaign.get(row.campaign_id),page_path:row.page_path||'',...zero()});add(map.get(key),row);}
 for(const c of report.campaigns)if(!report.rows.some(r=>r.campaign_id===c.id))map.set(JSON.stringify([c.id,null]),{campaign:c,page_path:null,...zero()});
 return [...map.values()];
}
function daily(report){
 const map=new Map();for(let time=Date.parse(report.from+'T00:00:00+08:00');time<=Date.parse(report.to+'T00:00:00+08:00');time+=86400000)map.set(dayOf(time),{day:dayOf(time),...zero()});
 for(const row of report.rows)add(map.get(row.day),row);return [...map.values()];
}
const metrics=row=>`<td>${row.impressions}</td><td>${row.visible}</td><td>${row.clicks}</td><td>${row.contact_clicks||0}</td><td>${ratio(row.clicks,row.impressions)}</td><td>${ratio(row.clicks,row.visible)}</td>`;
const metricHead='<th>页面输出</th><th>可见展示</th><th>商家跳转</th><th>TG 点击</th><th>跳转 / 输出</th><th>跳转 / 可见</th>';
const notes=()=>'<ul class="sr-notes">'+sponsorMetricNotes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul>';
export function sponsorReportBody(report,{customer=false}={}){
 const totals=report.rows.reduce(add,zero()),groupRows=groups(report);
 const kpis=[['页面输出估算',totals.impressions],['可见展示估算',totals.visible],['商家跳转估算',totals.clicks],['TG 点击估算',totals.contact_clicks]];
 const remaining=report.campaigns.some(c=>c.status==='approved'&&Date.parse(c.end_at)>Date.parse(report.asOf));
 return `<p>统计日期：<strong>${esc(report.from)} 至 ${esc(report.to)}</strong>（北京时间，含首尾日期）<br>数据截至：${esc(localTime(report.asOf))}（北京时间）</p>${remaining?'<p class="sr-message">包含尚未结束的活动，以下是截至当前的数据快照。</p>':''}<div class="sr-kpis">${kpis.map(([label,value])=>`<div class="sr-kpi"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>
 <h3 class="sr-heading">活动与页面表现</h3><div class="sr-scroll"><table class="sr-table"><thead><tr><th>活动 / 页面</th>${metricHead}</tr></thead><tbody>${groupRows.map(r=>`<tr><td><strong>${esc(r.campaign?.label||'广告活动')}</strong><small>${esc(sponsorPlan(r.campaign?.placement)?.label||'')} · ${esc(r.campaign?.page_label||'')}</small>${customer&&r.campaign?.start_at&&r.campaign?.end_at?`<small>活动档期：${esc(localTime(r.campaign.start_at))} 至 ${esc(localTime(r.campaign.end_at))}<br>当前状态：${stage(r.campaign,report.asOf)}</small>`:''}<small class="sr-path">${r.page_path===null?'该期间无统计记录':esc(sponsorPageLabel(r.page_path))}</small>${customer?'':`<small>活动编号：${esc(r.campaign?.id)}</small>`}</td>${metrics(r)}</tr>`).join('')||'<tr><td colspan="7">该期间暂无广告数据</td></tr>'}</tbody><tfoot><tr><th>合计（未跨页去重）</th>${metrics(totals)}</tr></tfoot></table></div>
 <h3 class="sr-heading">逐日趋势</h3><div class="sr-scroll"><table class="sr-table"><thead><tr><th>日期</th>${metricHead}</tr></thead><tbody>${daily(report).map(row=>`<tr><td>${row.day}</td>${metrics(row)}</tr>`).join('')}</tbody></table></div>
 <h3 class="sr-heading">统计口径</h3>${notes()}`;
}
export function sponsorReportAdminSection(analytics,url){
 let resetCampaign=false;
 const requestedMerchant=url.searchParams.get('merchant'),requestedCampaign=url.searchParams.get('campaign');
 // Changing merchant in the filter must not leave the previous merchant's campaign selected.
 if(requestedMerchant&&requestedCampaign&&url.searchParams.getAll('merchant').length===1&&url.searchParams.getAll('campaign').length===1){
  const all=analytics.outbound.listCampaigns(),previous=all.find(c=>c.id===requestedCampaign);
  if(previous&&previous.merchant_id!==requestedMerchant&&all.some(c=>c.merchant_id===requestedMerchant)){url=new URL(url.href);url.searchParams.delete('campaign');resetCampaign=true;}
 }
 const {merchantId,campaignId,all,report}=sponsorReportSelection(analytics,url),merchants=new Map();
 for(const c of all)if(!merchants.has(c.merchant_id))merchants.set(c.merchant_id,c.label);
 const campaigns=all.filter(c=>!merchantId||c.merchant_id===merchantId),params=new URLSearchParams({merchant:merchantId,campaign:campaignId,from:report.from,to:report.to});
 return `<style>${sponsorReportStyles}</style><section id="sponsor-report"><h2>赞助投放报告</h2>${resetCampaign?'<p class="sr-message">已切换商家，并清除之前的活动筛选。</p>':''}<p>按商家、活动和日期核对页面表现。选择一个商家后，可导出仅包含该商家的客户报告。</p><form class="sr-filter" method="get" action="/admin/sponsors"><label>商家<select name="merchant"><option value="">全部商家（仅内部查看）</option>${[...merchants].map(([id,label])=>`<option value="${esc(id)}"${id===merchantId?' selected':''}>${esc(label)} · ${esc(id.replace(/^domain:/,''))}</option>`).join('')}</select></label><label>活动<select name="campaign"><option value="">全部活动</option>${campaigns.map(c=>`<option value="${esc(c.id)}"${campaignId===c.id?' selected':''}>${esc(c.label)} · ${esc(c.page_label||c.page_key)} · ${esc(c.id)}</option>`).join('')}</select></label><label>开始日期（北京时间）<input type="date" required name="from" value="${esc(report.from)}"></label><label>结束日期（北京时间）<input type="date" required name="to" value="${esc(report.to)}"></label><button>查看报告</button><a href="/admin/sponsors#sponsor-report">重置筛选</a></form>${merchantId?`<div class="sr-actions"><a href="/admin/sponsor-report?${esc(params)}" target="_blank" rel="noopener">客户报告 / 打印为 PDF ↗</a><a href="/admin/sponsor-report.csv?${esc(params)}&amp;format=summary">导出客户汇总 CSV</a><a href="/admin/sponsor-report.csv?${esc(params)}&amp;format=daily">导出客户每日明细 CSV</a></div>`:'<p class="sr-message">请选择一个商家后导出，避免把其他商家的数据一起发出。</p>'}${sponsorReportBody(report)}</section>`;
}
function customerReport(analytics,url,now){return sponsorReportSelection(analytics,url,{customer:true,now}).report;}
export function sponsorCustomerDocument(analytics,url,now=new Date()){
 const report=customerReport(analytics,url,now),labels=[...new Set(report.campaigns.map(c=>c.label))],title=labels.join(' / ')||'商家';
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · AirRadar 投放报告</title><style>body{font:16px/1.6 system-ui,-apple-system,sans-serif;color:#20382d;background:#f4f7f5;margin:0}main{max-width:1100px;margin:32px auto;background:#fff;padding:32px;border:1px solid #dbe5df;border-radius:14px}h1{margin-bottom:8px}a{color:#226249}h2{margin:0}.brand{font-size:18px;letter-spacing:1px;color:#226249}.report-intro{color:#53665e}.toolbar{margin-bottom:18px;font-size:14px}${sponsorReportStyles}@media(max-width:760px){main{padding:18px;margin:0;border:0}}@media print{@page{size:A4 landscape;margin:12mm}body{background:#fff;font-size:11px}main{max-width:none;margin:0;padding:0;border:0}.toolbar{display:none}.sr-scroll{overflow:visible}.sr-table{font-size:10px;min-width:0}.sr-table th,.sr-table td{padding:5px}.sr-kpis{grid-template-columns:repeat(4,1fr)}.sr-kpi{break-inside:avoid}.sr-kpi strong{font-size:20px}tr{break-inside:avoid}thead{display:table-header-group}h3{break-after:avoid}.sr-notes{font-size:10px}}</style></head><body><main><div class="toolbar">使用浏览器“打印 → 另存为 PDF”保存本报告；建议关闭浏览器打印页眉和页脚。</div><p class="brand">AirRadar · 赞助投放数据</p><h1>${esc(title)}</h1><p class="report-intro">仅包含本商家的站内投放数据，供效果核对与投放复盘。</p>${sponsorReportBody(report,{customer:true})}</main></body></html>`;
}
export function sendSponsorCustomerDocument(res,analytics,url,now=new Date()){
 const document=sponsorCustomerDocument(analytics,url,now);
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.end(document);
}
const csvCell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
export function sponsorCustomerCsv(analytics,url,now=new Date()){
 const report=customerReport(analytics,url,now),format=url.searchParams.get('format')||'summary';
 if(!['summary','daily'].includes(format))throw sponsorError('报告格式无效',400);
 const campaigns=new Map(report.campaigns.map(c=>[c.id,c])),base=['统计开始日期','统计结束日期','数据截至（北京时间）','商家','活动位置','投放页面','实际来源页面','活动开始（北京时间）','活动结束（北京时间）','当前状态'];
 const metricColumns=['页面输出估算','可见展示估算','商家跳转估算','TG 点击估算','跳转/页面输出','跳转/可见展示'];
 const tail=['统计口径','订单数据'];
 const merchantLabel=[...new Set(report.campaigns.map(c=>c.label))].join(' / ');
 const rows=format==='daily'?report.rows.map(r=>({...r,campaign:campaigns.get(r.campaign_id)})):groups(report);
 if(format==='daily')for(const day of daily(report))if(!rows.some(r=>r.day===day.day))rows.push({...day,campaign:{label:merchantLabel},page_path:null});
 if(format==='daily')rows.sort((a,b)=>a.day.localeCompare(b.day));
 else rows.push({...report.rows.reduce(add,zero()),campaign:{label:merchantLabel},page_path:null,total:true});
 const columns=[...base,...(format==='daily'?['日期']:[]),...metricColumns,...tail];
 const data=rows.map(r=>[report.from,report.to,localTime(report.asOf),r.campaign?.label||'',sponsorPlan(r.campaign?.placement)?.label||'',r.campaign?.page_label||'',r.total?'合计（未跨页去重）':r.page_path===null?'该期间无统计记录':sponsorPageLabel(r.page_path),r.campaign?.start_at?localTime(r.campaign.start_at):'',r.campaign?.end_at?localTime(r.campaign.end_at):'',r.campaign?.id?stage(r.campaign,report.asOf):'',...(format==='daily'?[r.day]:[]),r.impressions,r.visible,r.clicks,r.contact_clicks||0,ratio(r.clicks,r.impressions),ratio(r.clicks,r.visible),sponsorMetricNotes.join(' '),'未回传，不估算']);
 // An empty daily report still states its date range and measurement boundaries.
 if(!data.length)data.push([report.from,report.to,localTime(report.asOf),[...new Set(report.campaigns.map(c=>c.label))].join(' / '),'','该期间无统计记录','','','','',...(format==='daily'?['']:[]),0,0,0,0,'无法计算','无法计算',sponsorMetricNotes.join(' '),'未回传，不估算']);
 return '\ufeff'+[columns,...data].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function exportSponsorCustomerCsv(res,analytics,url,now=new Date()){
 const csv=sponsorCustomerCsv(analytics,url,now);
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="airadar-merchant-report.csv"');res.setHeader('Cache-Control','private, no-store');res.end(csv);
}
