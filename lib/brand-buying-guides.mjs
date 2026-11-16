// Stable editorial additions below the existing quote list. No live price claims.
import {PURCHASE_GUIDE_PATHS} from './purchase-guides.mjs';
const shared=[
 ['官网和应用商店怎么选？','先确认自己的账号可用哪些购买入口，再比较相同套餐与周期的实际结算总额。App Store 地区参考不能直接当作官网或 Google Play 的售价。'],
 ['低价是否适用于我的账号？','分别核对新开或续费、账号地区、交付方式、期限与售后。条件待确认的标价需要回原店询问，不能直接与完整月付作最低价比较。'],
];
export const BRAND_BUYING_GUIDES={
 chatgpt:{name:'ChatGPT',updated:'2026-09-18',intro:'先选套餐，再选交付方式。Go、Plus、Pro 与 Team / Business 要分别核对；给自己的账号续费、交付另一个账号、加入团队，也不是同一种购买对象。',questions:[
  ['Go、Plus 和 Pro 先比较什么？','先看自己的使用需求、账号当前显示的套餐与额度，再比较费用。已有具体计划时，直接进入下方对应指南核对；不要把不同计划的最低标价当成同一种订阅的折扣。'],
  ['商家写“年卡”，就是官方年付吗？','不一定。核对于 2026-09-18，OpenAI 的 Plus 帮助仍说明不支持官方年付或预付多个月。商家承诺的服务期限需要另行核实，不能换成官方账单周期。'],...shared],links:[
  ['/guides/chatgpt-go-vs-plus','Go 与 Plus 的选择'],['/guides/chatgpt-pro-5x-vs-20x','Pro 档位与开通条件'],['/guides/chatgpt-plus-delivery','代充、成品号与共享席位'],['https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','OpenAI：Plus 的付款周期'],
 ]},
 claude:{name:'Claude',updated:'2026-09-18',intro:'先区分个人订阅与 API 计费，再核对 Pro、Max 的具体档位。比较时保留相同周期与账号条件，年付总额和折算月均支出分别看。',questions:[
  ['Claude Pro 月付和年付怎么比较？','官方说明提供月付与年付选择。先在自己的结算页记录一次实际扣款总额和续费周期；年付折算月均金额不表示每月扣一次，也不能直接套用另一地区的价格。'],
  ['Claude 订阅包含 API 余额吗？','个人 Pro 订阅与 Claude Console 的 API 用量分别计费。带有 API 密钥、额度或第三方入口的商品，不能只因名称包含 Claude 就当作个人订阅比较。'],...shared],links:[
  ['/guides/claude-pro-buying','Claude Pro 购买对象怎么区分'],['/guides/renewal-checklist','购买与续费条件'],['https://support.claude.com/en/articles/8325606-what-is-the-pro-plan','Claude：Pro 周期与独立 API 计费'],
 ]},
 gemini:{name:'Gemini / Google AI',updated:'2026-09-18',intro:'先确认需要的 Google AI 套餐及实际账号权益，再区分个人订阅、家庭权益和第三方激活服务。相似的商品名称不能代替账号内的计划与有效期。',questions:[
  ['Google AI Pro 和 Ultra 怎么选？','以 Google 当前套餐页和自己账号显示的权益为准，再判断是否需要更高档位。不要根据商品标题里的“高级”“激活”推定它包含完整 Pro 或 Ultra 订阅。'],
  ['家庭权益或激活服务等于个人订阅吗？','不能直接等同。付款前分别确认谁控制账号、是否依赖他人家庭组、自己能否管理续费，以及具体功能和结束时间，再决定是否满足使用需求。'],...shared],links:[
  ['/guides/gemini-membership-options','Google AI Pro 交付与家庭权益'],[PURCHASE_GUIDE_PATHS.play,'Google Play 的购买与管理'],['https://gemini.google/us/subscriptions/','Google：官方套餐与适用条件'],
 ]},
};
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function brandBuyingGuide(family){
 const guide=BRAND_BUYING_GUIDES[family];if(!guide)return '';
 const links=[...guide.links,['/official-prices','官方价格与地区参考'],[PURCHASE_GUIDE_PATHS.apple,'Apple 余额与礼品卡'],[PURCHASE_GUIDE_PATHS.payment,'支付失败排查']];
 return `<section class="brand-buying-guide" aria-label="${esc(guide.name)} 选购说明"><h2>${esc(guide.name)} 订阅怎么选？</h2><p>${esc(guide.intro)}</p>${guide.questions.map(([q,answer])=>`<details><summary>${esc(q)}</summary><p>${esc(answer)}</p></details>`).join('')}<nav aria-label="${esc(guide.name)} 选购相关阅读">${links.map(([href,label])=>`<a href="${esc(href)}"${href.startsWith('https:')?' rel="noopener noreferrer"':''}>${esc(label)}</a>`).join('')}</nav><p class="note">选购说明核对于 <time datetime="${guide.updated}">${guide.updated}</time>；套餐规则以官方当前说明为准。</p></section>`;
}
