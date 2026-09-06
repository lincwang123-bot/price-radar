# 本轮原店扩源证据

2026-09-06；仅公开读操作，未购买、登录、提交订单或写生产库。候选限定 3 个有出处原站，无无限扫描。HTTP 403/WAF 不绕过。

## AI卡商城 `aikashop.com`

候选来自公开搜索。机器人规则 `https://aikashop.com/robots.txt` 返回 200，明确允许 `*`、GPTBot、OAI-SearchBot、ChatGPT-User；只禁止 `/thanks.html`。本机和生产 VPS 的 `/products/suno.html` 均返回 200，有页面自身 `plansData` JSON。

实际 6 个挂牌 SKU：Suno Pro 月/季/年 CNY 50/151/504，Premier 月/季/年 CNY 151/454/1512。这是原店挂牌人民币字段，未使用汇率推算或聚合站低价。解析器只读取这一固定页面，每 12 小时最多读取一次，并复核 robots；固定 origin、12 秒超时、512 KiB 上限、禁止重定向。

页面没有逐 SKU 库存证据，`paylink` 为空，因此全部 `status=unknown`；能查询，不进入可售起价或覆盖达标成绩。站方宣传销量、评价、到账速度、加密货币付款安全均未验证，不采入评分或背书。Suno 六个明确套餐采用独立产品 ID。

## Acc-OTAOR `acc.otaor.com`

项目已有登记但此前全售罄未默认启用的候选。本机与生产 VPS 均验证公开 `/api/v1/public/products?page=1&page_size=100` 可用，现返回 41 SKU，其中 40 售罄、1 有货（库存 15）：Gemini Pro 18个月 Google One 5TB 兑换链接，CNY 9.99。

仅恢复启用既有 Dujiao 适配器，售罄规则照常排除 40 条。剩余 1 条归入“权益领取链接”辅助服务，不冒充已开通的 Gemini 订阅。不能声称由此补齐 Telegram/Claude Team/即梦：这些该店商品本次均售罄。robots 对通用读取允许 `/`，托管内容规则仅允许引用用途、禁止训练及指定训练爬虫；本站仅存公开报价字段，不复制商品全文、不进行训练。

## 停止的候选与未达成项

`xtacc.top` 由现有报价原站 URL 发现；其 Claude Team 商品页本机请求失败，未绕过、未注册默认源。WZYP 已知 VPS WAF 目标未重新绕过。

默认白名单 21→23，但有效在售贡献仅 OTAOR 的一条辅助服务；AI卡商城六条是库存待确认。不能将新增店数或挂牌条数冒充覆盖率提升。停用 PriceAI 仍须逐日覆盖验收，不因本次扩源自动执行。
