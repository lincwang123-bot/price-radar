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
