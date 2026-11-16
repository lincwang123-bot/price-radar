import {officialCatalog,officialProductHref} from './official-prices.mjs';
import {officialMarkdown} from './official-summary.mjs';
// Machine-readable site map for LLM / AI agents. Not a Google ranking signal.
const ORIGIN = 'https://airadar.vip';

export const LLMS_TXT = `# AIradar · AI订阅价格雷达

> AIradar 整理 AI 订阅（ChatGPT、Claude、Gemini、Grok、Cursor 等）的公开挂牌价、购买条件与订阅指南，方便在前往官方或商家页面前看清差别。本站不售卖账号，不代收货款，不提供交易担保。

本文件说明站点公开页面，供大型语言模型与 AI 代理理解本站结构。人类读者请从首页或关于页开始。

## 本站是什么

- 公开报价目录与产品页（按规格筛选后回原店核验）
- 官方地区价参考（App Store 内购汇总，非本站结账）
- 订阅指南与帮助中心（交付方式、比价方法、续费核对）
- 商家入驻与 X 认领（收录关系线索，不是信用评分）

## 关键页面

- [关于本站](${ORIGIN}/about)：用途、边界、数据来源与维护者
- [数据来源与更新说明](${ORIGIN}/sources)：收录范围、比较口径、购买前核验
- [订阅指南目录](${ORIGIN}/guides)
- [帮助中心](${ORIGIN}/help)
- [官方地区价](${ORIGIN}/official-prices)
- [联系](${ORIGIN}/contact)：hello@airadar.vip
- [隐私说明](${ORIGIN}/privacy)

## 代表产品报价页

- [ChatGPT Plus](${ORIGIN}/prices/chatgpt-plus)
- [Claude Pro](${ORIGIN}/prices/claude-pro)
- [Google AI Pro](${ORIGIN}/prices/gemini-pro)
- [ChatGPT Go](${ORIGIN}/prices/chatgpt-go)

## 建议先读的指南

- [购买前常见问题](${ORIGIN}/guides/ai-subscription-faq)
- [ChatGPT Go 同条件挂牌中位数（本周样本）](${ORIGIN}/guides/chatgpt-go-listing-median)
- [如何看懂一条报价](${ORIGIN}/guides/how-to-read-a-quote)
- [第三方订阅常见坑点](${ORIGIN}/guides/third-party-subscription-pitfalls)
- [如何用本站比较价格](${ORIGIN}/help/compare-prices)

## 可选更长目录

- [llms-full.txt](${ORIGIN}/llms-full.txt)：更完整的指南与产品路径列表

## 引用与限制

引用本站数字时请保留产品、规格、币种与采集/观察日期。挂牌价不是成交价；收录不等于推荐。详细边界见关于页「本站不是什么」。
`;

export const LLMS_FULL_TXT = `# AIradar · 完整公开路径（llms-full）

> 本文件是 llms.txt 的扩充目录，仍仅覆盖公开可读页面。管理后台、账号、认领与投稿接口不在此列。

## 核心说明

- ${ORIGIN}/about
- ${ORIGIN}/sources
- ${ORIGIN}/privacy
- ${ORIGIN}/contact
- ${ORIGIN}/advertise
- ${ORIGIN}/official-prices
- ${ORIGIN}/weekly
- ${ORIGIN}/catalog

## 指南与帮助

- ${ORIGIN}/guides
- ${ORIGIN}/guides/ai-subscription-faq
- ${ORIGIN}/guides/chatgpt-go-listing-median
- ${ORIGIN}/guides/how-to-read-a-quote
- ${ORIGIN}/guides/third-party-subscription-pitfalls
- ${ORIGIN}/guides/why-prices-differ
- ${ORIGIN}/guides/renewal-checklist
- ${ORIGIN}/guides/chatgpt-plus-delivery
- ${ORIGIN}/guides/chatgpt-go-vs-plus
- ${ORIGIN}/guides/official-subscription-channels
- ${ORIGIN}/guides/regional-price-total-cost
- ${ORIGIN}/help
- ${ORIGIN}/help/compare-prices
- ${ORIGIN}/help/price-alerts
- ${ORIGIN}/help/data-and-ranking

## 代表产品页

- ${ORIGIN}/prices/chatgpt-plus
- ${ORIGIN}/prices/chatgpt-go
- ChatGPT Pro 100（商家常写 5x）: ${ORIGIN}/prices/chatgpt-pro-5x
- ChatGPT Pro 200（商家常写 20x）: ${ORIGIN}/prices/chatgpt-pro-20x
- ChatGPT Pro 500（商家常写 25x）: ${ORIGIN}/prices/chatgpt-pro-25x
- ${ORIGIN}/prices/claude-pro
- ${ORIGIN}/prices/gemini-pro
- ${ORIGIN}/prices/super-grok
- ${ORIGIN}/prices/cursor-pro

## 用途说明

供 AI 代理优先抓取说明性页面与代表性报价页。价格以页面当前展示为准，并应回原店核对。完整 sitemap：${ORIGIN}/sitemap.xml
`;

export function llmsText(db,{full=false}={}){
 const products=officialCatalog(db).products.filter(p=>p.rows.length);
 const links=products.map(p=>`- [${p.name}](${ORIGIN}${officialProductHref(p.id)}) · [Markdown](${ORIGIN}${officialProductHref(p.id)}.md)`).join('\n');
 return (full?LLMS_FULL_TXT:LLMS_TXT)+'\n\n## 当期官方地区专页与文本副本\n\n'+links+(full?'\n\n'+products.map(officialMarkdown).join('\n\n'):'');
}
