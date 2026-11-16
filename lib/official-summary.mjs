import {officialProductHref,periodLabel} from './official-prices.mjs';
import {priceHref} from './price-routes.mjs';
export const OFFICIAL_LIMIT='当前为 CardNav 汇总的 App Store 地区内购参考，未经本站逐条结账核验；不是官网或 Google Play 实时报价。能否按该价格开通取决于账号地区、支付方式和结账页，本页只整理公开标价，以官方结账页为准。';
export const officialModified=p=>p.rows.map(r=>r.collectedAt).filter(Boolean).sort().at(-1)||null;
const date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':'本期数据日期未提供';
const amount=r=>`${r.originalPrice||'原币价未提供'} ${r.originalCurrency}${r.cny!=null?'，约合人民币 ¥'+r.cny.toFixed(2):'，人民币参考额本期未收录'}`;
export function officialSummary(p){
 const period=p.rows.some(r=>r.period==='month')?'month':p.rows.some(r=>r.period==='year')?'year':null;
 const rows=period?p.rows.filter(r=>r.period===period):[],lowest=rows.filter(r=>r.cny!=null).sort((a,b)=>a.cny-b.cny)[0];
 const when=date(officialModified(p)),us=rows.find(r=>/(?:\bUS\b|美国|United States)/i.test(r.region));
 const conclusion=`截至${when}，在本页已采集、且周期可比（优先月付）的公开参考里，`+(lowest?`${periodLabel(period)}人民币参考额最低的是${lowest.region}，原币${amount(lowest)}。`:'本期未收录可比的最低地区或人民币参考额，不能比较最低价。');
 const american=us?`本期美区${periodLabel(period)}参考：原币${amount(us)}；来源时间 ${date(us.sourceAt)}。`:'本期未收录美区参考。';
 const faq=[
 [p.name+'哪个地区最便宜？',conclusion+'这是 CardNav 汇总的 App Store 地区内购参考，不是本站逐条结账核验的官网实时价，也不能保证你的账号一定能按该价格开通。能否按下单价格完成订阅，取决于账号地区、支付方式和结账页，请以官方结账页为准。'],
 ['美区官方价是多少？',american],
 ['App Store 地区价和官网价有什么不同？','App Store 内购价由应用商店按地区标价，官网订阅价按账号所在地区和付款方式在结账页生成，两者不一定相同，也不能直接当作同一笔费用。税费、汇率、支付渠道手续费和优惠到期后的续费金额都可能不同。请同时查看本站「官网与应用商店价格为何不同」指南，并在下单前核对官方结账页。'],
 ['这里的官方地区价和站内商家挂牌价是一回事吗？','不是。本页整理的是公开来源中的官方地区参考价；渠道或商家挂牌价在对应的产品报价页，且挂牌价不是成交价。两边数字不能直接相减得出「能省多少」。购买渠道商品前请回原店核对商品、期限、账号条件和实付金额。本站不代售、不收款、不作交易担保，收录店铺或展示「已验证商家」都不代表官方授权或信誉背书。'],
 ['这些地区价多久更新一次？','本页分别展示上游刷新时间和本站最近一次成功采集时间（北京时间）。上游刷新不等于官方刚调价。上游时间未知或距今超过 72 小时，会标为待复核。数字以本页当前展示和数据更新日期为准。']];
 return {conclusion,american,faq};
}
export function officialMarkdown(p){const s=officialSummary(p);return `# ${p.name}哪个地区最便宜？\n\n数据日期：${date(officialModified(p))}\n\n${s.conclusion}\n\n${s.american}\n\n${OFFICIAL_LIMIT}\n\n|地区|原币|人民币参考|周期|上游刷新|本站采集|\n|---|---|---|---|---|---|\n`+p.rows.map(r=>[r.region,r.originalPrice+' '+r.originalCurrency,r.cny??'本期未收录',periodLabel(r.period),r.sourceAt||'未提供',r.collectedAt||'未提供'].map(v=>String(v).replace(/[|\r\n]/g,' ')).join('|')).map(r=>'|'+r+'|').join('\n')+'\n\n'+s.faq.map(([q,a])=>'## '+q+'\n\n'+a).join('\n\n')+`\n\n[HTML 专页](https://airadar.vip${officialProductHref(p.id)})\n[Markdown 副本](https://airadar.vip${officialProductHref(p.id)}.md)\n`+(priceHref(p.id)?`[渠道挂牌价](https://airadar.vip${priceHref(p.id)})\n`:'');}
