# 官方订阅地区价格

`/official-prices` 为套餐总览。地区详情继续使用 `/product?source=cardnav-official&id=<id>`，保留历史链接；普通详情分页有独立 canonical，地区、周期、币种与渠道筛选归一到套餐基本地址。总览、详情、指南均由服务器直接输出正文。

当前数据仅为 CardNav 汇总的 App Store 地区内购参考，不是本站逐条核验的官方结账价。没有推断官网、Google Play 或用户的实际购买资格。先展示 ChatGPT Plus、ChatGPT Go、Claude Pro，其余已有产品仍可查看。

## 字段与兼容

新的 `sources/cardnav.mjs` 在 `offers.extra.officialPrice` 保存 `region`、`originalPrice`、`originalCurrency`、`purchaseChannel`、`period`、`exchangeRateDate`、`upstreamRefreshedAt` 和 `sourceUrl`。当前源没有明确周期或汇率日期，这两项保存 null；不根据套餐名或采集时间补齐。

旧记录从原有标题和地区字段读取原币显示文本，不将 `Rp 349ribu` 等本地写法强制解析为数值。人民币参考只使用已标明 CNY 的金额，兼容报价未写币种而产品已明确 CNY 的旧记录；缺价仍为空，明确零价保留零。

历史 CardNav 的 `captured_at` 原文标明北京时间、但未保存偏移；只在这类参考数据中按 +08:00 解释。新采集记录直接保留该时区。上游刷新时间和本站采集时间分开显示，不把它们当作官方调价日期或文章更新时间。

上游时间缺失、超过 72 小时或快照标记过期时，显示待复核；这是本站提示门槛，不是官方价格有效期。排序将待复核记录后置，然后按上游人民币参考金额排列；不同周期不能由此判断最低实付。

## SEO 与统计

总览进入 sitemap 和主导航。结构化数据包括总览的 CollectionPage / ItemList、详情的 Dataset / BreadcrumbList；不填写不存在的 Offer、授权或官方调价日期。两篇配套指南为渠道差异和实际支付成本，标注官方资料来源与内容核对日期。指南到总览的访问纳入现有汇总统计，不保存原始查询或来源 URL。

## 验证与发布

`test/official-prices.test.mjs` 覆盖时区、缺价与零价、源链接限制、筛选、过期排序、分页、canonical、结构化数据、HTTP 语义和内容转义。`npm run check` 包括语法检查与完整回归。

不修改现有报价数据库。发布网页模块及适配器后，重启网页和采集服务；保留采集频率限制，下一次符合采集条件且产生新快照时写入新增元数据。没有新的源更新时间时，不强制重写历史快照。

## 独立专页与引用（2026-11）

已有地区报价的套餐使用 `/official-prices/{id}`，英文为 `/en/official-prices/{id}`。
Pro 的 key 保留 `chatgpt-pro-5x` / `chatgpt-pro-20x`，公开名为 Pro 100 / Pro 200。
旧 `/product?source=cardnav-official&id=`、`/official-prices?id=` 和英文查询串详情 301 到新专页；仅保留单值 period/region/currency/purchase/page。无数据的干净专页 404，不跳总页。
分页无筛选时保留 `?page=` canonical；地区、币种、周期或购买渠道筛选 noindex 并 canonical 回专页。

页首结论与 FAQ 使用未筛选 catalog：优先已知月付；没有月付则比较已知年付；未知周期不参与最低地区比较。人民币排序仅使用来源已有的 CNY 参考额，不计算汇率；没有可比人民币金额时写「本期未收录」。美区只使用同周期 US/美国记录。HTML、FAQ JSON-LD、Markdown 共用同一结论函数，保留零价。
Dataset.dateModified 和官方专页 sitemap.lastmod 使用本站最近一次成功采集 `collectedAt`（snapshot.fetched_at 规范化为 ISO UTC），不是请求时间，也不表示官方刚调价。上游刷新时间另列，超过 72 小时或未知标待复核。动态渠道报价仍不提供无法解释的 lastmod。

`/official-prices/{id}.md` 是公开 Markdown 副本，包含数据日期、限制、地区表与问答；`/llms-full.txt` 动态整合当期官方地区资料。不包含商家推荐榜或私有入口。IndexNow 仅提交 HTML canonical。

渠道旧链在存在产品身份时迁往 `/prices/{key}`；保留购买筛选及 utm 归因，丢弃 source/id/page/next。报价 Product 的 AggregateOffer 仅计可见、有货、同币种的代充挂牌价，不含成品号、共享或未确认交付。样本仅限当前页，不声明覆盖全部店铺。所有干净产品页增加相同的买前问答。
