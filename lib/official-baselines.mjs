// Editorial snapshots of vendor documentation, never live checkout quotes.
// Do not use a vendor's web billing period to fill an unknown App Store SKU.
import {CHATGPT_PRO_PUBLIC_NAMES} from './chatgpt-pro-names.mjs';
const checkedAt='2026-10-28';
const openai='https://help.openai.com/en/articles/';
const claude='https://support.claude.com/en/articles/';
// Curated destinations only: never label an upstream or merchant URL as official.
const officialWebsites=new Map([
 ['https://chatgpt.com/pricing/',['chatgpt-go','chatgpt-plus','chatgpt-pro-5x','chatgpt-pro-20x','chatgpt-pro-25x']],
 ['https://claude.com/pricing',['claude-pro','claude-max-5x','claude-max-20x']],
 ['https://gemini.google/subscriptions/',['gemini-ai-plus','gemini-pro','gemini-advanced','gemini-ai-ultra']],
 ['https://grok.com/',['grok-supergrok-lite','grok-supergrok','grok-supergrok-heavy']],
 ['https://copilot.microsoft.com/',['copilot-pro']],
 ['https://x.com/',['x-basic','x-premium','x-premium-plus']],
 ['https://x.ai/pricing',['x-subscription-plus','x-subscription-premium','x-subscription-super','x-subscription-ultra']],
 ['https://muse.ai/',['muse-power','muse-max']],
].flatMap(([url,ids])=>ids.map(id=>[id,url])));
export const officialWebsite=id=>officialWebsites.get(id)||null;
const reviewed={
 'chatgpt-plus':{checkedAt:'2026-10-28',billing:{channel:'官网订阅',region:'官方美元说明，不代表所有地区实付',eligibility:'在本人账号核对套餐入口、所在地与付款资格。',renewal:'按月计费；优惠后金额及下一次扣款以本人账单为准。',annual:'官方当前不支持 Plus 年付或预付多个月；商家“年卡”需另核对。'}},
 'claude-pro':{checkedAt:'2026-10-28',billing:{channel:'官网订阅',region:'美国月付参考',eligibility:'服务仅在支持地区提供；当地币种与税费按结算页确认。',renewal:'按所选周期续费；实际续费金额以本人账单为准。',annual:'官方另有一次按年扣费的方案；本卡片仍为月付价，不推算年付总额。'}},
};
const xSubscriptionNote='Grok 与 Cursor 中的 Grok 模型共享每周用量；Cursor 第三方模型另行计费，Grok API 用量另计费。标价不含税费，实付以本人结算页为准。旧套餐可继续保留，无须自动迁移。官方未授权第三方转售，请通过官网购买。';
export const OFFICIAL_BASELINES=Object.freeze([
 {id:'chatgpt-pro-25x',name:CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-25x'],directory:true,amount:500,currency:'USD',period:'month',checkedAt:'2026-10-28',scope:'官网美元月付档位',source:openai+'9793128-about-chatgpt-pro-tiers',note:'官方名称 Pro 500，包含 Astra Ultrafast。商家常写 25x 或 $500，对应这一档；25x 是用量档位，不代表回答质量或速度倍数。具体额度、地区资格、税费与实付金额以官方页面及本人账号为准。'},
 {id:'chatgpt-plus',name:'ChatGPT Plus',amount:20,currency:'USD',period:'month',scope:'官方说明中的美元月付价',source:openai+'6950777-what-is-chatgpt-plus',note:'按月扣费；API 另行计费。地区与税费以结算页为准。'},
 {id:'chatgpt-go',name:'ChatGPT Go',amount:null,currency:null,period:'month',scope:'官网按月订阅',source:openai+'11989085-what-is-chatgpt-go',note:'官方已确认按月自动续费；具体金额按账号所在地区查看。'},
 {id:'chatgpt-pro-5x',name:CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-5x'],amount:100,currency:'USD',period:'month',checkedAt:'2026-10-28',scope:'官网美元月付档位',source:openai+'9793128-about-chatgpt-pro-tiers',note:'官方名称 Pro 100。商家常写 5x、$100 或 pro100，对应这一档；具体用量以当前套餐表为准，不从旧 5x 名称推定固定倍数。'},
 {id:'chatgpt-pro-20x',name:CHATGPT_PRO_PUBLIC_NAMES['chatgpt-pro-20x'],amount:200,currency:'USD',period:'month',checkedAt:'2026-10-28',scope:'官网美元月付档位',source:openai+'9793128-about-chatgpt-pro-tiers',note:'官方名称 Pro 200，已恢复新订阅。商家常写 20x 或 $200，对应这一档；新旧订阅的用量可能不同，请核对账号资格。'},
 {id:'claude-pro',name:'Claude Pro',amount:20,currency:'USD',period:'month',scope:'美国官网月付价',source:claude+'8325606-what-is-the-pro-plan',note:'另有年付方案；地区价和税费可能不同，API 另行计费。'},
 {id:'claude-max-5x',name:'Claude Max（原 Max 5x）',amount:100,currency:'USD',period:'month',scope:'官网月付价',source:claude+'11049741-what-is-the-max-plan',note:'官方现称 Max（约 $100）；原 Max 5x。官网月付方案；移动应用商店价格可能不同。'},
 {id:'claude-max-20x',name:'Claude Ultra（原 Max 20x）',amount:200,currency:'USD',period:'month',scope:'官网月付价',source:claude+'11049741-what-is-the-max-plan',note:'官方现称 Ultra（约 $200）；原 Max 20x。官网月付方案；移动应用商店价格可能不同。'},
 {id:'gemini-pro',aliases:['gemini-advanced'],name:'Google AI Pro',platform:'Gemini',amount:19.99,currency:'USD',period:'month',checkedAt:'2026-10-28',scope:'美国官网月付标价',source:'https://one.google.com/about/google-ai-plans/',note:'普通月付参考，不套用学生或其他限时优惠。当地结算金额与资格请在本人账号确认。同期对照 https://gemini.google/us/subscriptions/ 。',billing:{channel:'官网订阅',region:'美国价格页',eligibility:'核对账号可用地区、年龄及具体权益的适用要求；学生优惠须另行验证。',renewal:'促销期限与优惠后价格以本人结算页及账单为准。',annual:'本次仅核对月付；未将地区参考补成月付或年付。'}},
 {id:'muse-power',name:'Muse Power',platform:'Muse',directory:true,amount:20,currency:'USD',period:'month',checkedAt:'2026-10-17',scope:'Meta 官方说明中的美元月付价',source:'https://www.meta.com/help/subscriptions/1021145227643680/',note:'个人 AI 智能体订阅，每周 5 亿 Muse tokens；不是 Muse Code 或 API 计费。仍在有限测试，地区与账号资格、税费及实付金额以官方结算页为准。'},
 {id:'muse-max',name:'Muse Maximum',platform:'Muse',directory:true,amount:100,currency:'USD',period:'month',checkedAt:'2026-10-17',scope:'Meta 官方说明中的美元月付价',source:'https://www.meta.com/help/subscriptions/1021145227643680/',note:'个人 AI 智能体订阅，每周 30 亿 Muse tokens；不是 Muse Code 或 API 计费。仍在有限测试，地区与账号资格、税费及实付金额以官方结算页为准。'},
 ...[['plus','Plus',8],['premium','Premium',30],['super','Super',100],['ultra','Ultra',200]].map(([key,tier,amount])=>({id:'x-subscription-'+key,name:'X 融合订阅 '+tier,platform:'X 融合订阅',directory:true,amount,currency:'USD',period:'month',checkedAt:'2026-10-28',scope:'官网个人套餐美元月付标价',source:'https://x.ai/pricing',note:(key==='plus'?'整合 Grok、Cursor 与 X 权益，不含 Grok Bot。':'整合 Grok、Cursor 与 X 权益，含 Grok Bot；Bot 共用套餐用量，不另加额度。')+xSubscriptionNote})),
].map(row=>Object.freeze({checkedAt,...row,...reviewed[row.id],platform:row.platform||(row.name.startsWith('Claude')?'Claude':'ChatGPT')})));
export const officialBaseline=id=>OFFICIAL_BASELINES.find(row=>row.id===id||row.aliases?.includes(id))||null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function officialWebsiteLink(id,{className='official-website-button'}={}){
 const url=officialWebsite(id);
 return url?`<a class="${esc(className)}" data-official-website="${esc(id)}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">前往官网 ↗</a>`:'';
}
export function baselineHtml(row,{compact=false,now=Date.now()}={}){
 if(!row)return '';
 const stale=now-Date.parse(row.checkedAt+'T00:00:00Z')>30*86400000;
 const billing=row.billing?`<details class="official-billing"><summary>周期、购买与续费条件</summary><dl>${[['购买渠道',row.billing.channel],['价格适用范围',row.billing.region],['付款周期',row.period==='month'?'按月计费':'以官方方案为准'],['购买资格',row.billing.eligibility],['续费',row.billing.renewal],['其他周期',row.billing.annual]].map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></details>`:'';
 if(compact)return `<details class="official-baseline official-baseline-compact" data-official-baseline="${esc(row.id)}"><summary><span>官方价格参考</span><strong>${row.amount==null?'月付 · 金额见官方结算':esc(row.currency)+' '+row.amount+' / 月'}</strong><small>核对日期 <time datetime="${row.checkedAt}">${row.checkedAt}</time>${stale?' · 待重新核对':''}</small></summary><div class="official-baseline-content"><p>${esc(row.scope)}。${esc(row.note)}</p>${billing}<p class="note">此价格不替代下方地区记录的周期与实付金额。</p><nav class="official-baseline-actions" aria-label="${esc(row.name)} 官方链接">${officialWebsiteLink(row.id)}<a href="${esc(row.source)}" target="_blank" rel="noopener noreferrer">查看官方依据 ↗</a><a href="/official-prices">查看地区参考 →</a></nav></div></details>`;
 return `<aside class="official-baseline" data-official-baseline="${esc(row.id)}"><div><span>${compact?'官方价格参考':esc(row.name)+' · 官方价格参考'}</span><strong>${row.amount==null?'月付 · 金额见官方结算':esc(row.currency)+' '+row.amount+' / 月'}</strong></div><p>${esc(row.scope)}。${esc(row.note)}</p>${billing}<p class="note">核对日期 <time datetime="${row.checkedAt}">${row.checkedAt}</time>${stale?' · 待重新核对':''}；此价格不替代下方地区记录的周期与实付金额。</p><nav class="official-baseline-actions" aria-label="${esc(row.name)} 官方链接">${officialWebsiteLink(row.id)}<a href="${esc(row.source)}" target="_blank" rel="noopener noreferrer">查看官方依据 ↗</a>${compact?`<a href="/official-prices">查看地区参考 →</a>`:''}</nav></aside>`;
}
