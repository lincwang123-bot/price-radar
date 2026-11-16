# AI订阅雷达 · TapeOut 社区入口 v1.1

主站入口：`https://airadar.vip/tapeout/`，页脚「AI费用助手」。正常主站 `https://airadar.vip/`。社区页顶部「打开主站」、页脚域名均回主站；四个产品入口直达对应报价页。独立社区工具，不代表 TapeOut 官方合作。

## 代码与运行

- `assets/tapeout/`：独立静态应用。根目录 `index.html`，使用相对路径；可直接打包上传 DeWEB，不需要 Node 服务、构建器或数据库。
- `lib/tapeout-app.mjs`：主站固定路径白名单，GET/HEAD、ETag、MIME、CSP、no-transform；`lib/web.mjs` 在域名规范化后接入。
- 不调用任何 API、钱包或价格服务。浏览器 localStorage 键 `airadar.tapeout.costs.v1`，最多 100 项。损坏存储或并发写冲突时保留原始数据，并提示导出。
- JSON 导入按 ID 合并，已有记录优先。不同域名/访问地址的数据隔离，用导出与导入迁移。
- 币种独立计算，不做汇率换算。月付与年付计算预算，一次性充值单列。日历仅包含填写的未来/当天日期，不推算自动续费或周期事件。
- 主站链接带 `utm_source=tapeout&utm_medium=deweb&utm_campaign=deweb-entry`。`lib/growth-analytics.mjs` 仅把允许的固定三元组归为 `tapeout_deweb`，兼容旧 `ai-cost-helper` 活动；重复或未知值回退 Referer。沿用现有核心产品访问过滤、去重、保留期，不新增 Cookie、表或原始查询参数存储。
- `lib/admin-analytics.mjs` 的产品访问来源展示「TapeOut / DeWEB 来源」。不统计入口曝光，不归因下游关注、商家点击或成交；`utm_content` 只是链接位置标记，不保存或细分统计。账单金额不上传。

## 校验

`node --test test/tapeout-domain.test.mjs test/tapeout-http.test.mjs test/public-assets.test.mjs test/growth-analytics.test.mjs`

另需浏览器验证新增/编辑/删除/撤销、重载保存、JSON 备份、ICS 下载、并发冲突、移动端布局。测试中所有服务器须在 finally 中关闭。

## DeWEB 发布

将 `assets/tapeout/` 下 5 个文件放在 ZIP 根目录。脚本 MIME 使用 `text/javascript`，CSS 使用 `text/css`。这是静态发布包，主站服务模块与测试不放入 ZIP。

选择持有的命名电路容器，在 TapeCode 上传并核对交易费用，由持有人确认钱包签名。发布后验证全部文件和下载功能，再在 TapeCode「交流 → 发布应用」选择对应站点并填写介绍。主站上线不代表已上链，也不代表已进入应用列表。

本次无数据库迁移或环境变量变更，v1.1 仅需部署变更的 HTML/CSS/domain.js 和两个统计模块后重启 Web 服务；采集服务不变。

边缘统计注入：仅此工具通过 `servePublicAsset` 的可选 `noTransform` 参数增加响应头，避免 Cloudflare 自动插入统计脚本。其他公共资产默认缓存行为保持原样。依据：https://developers.cloudflare.com/web-analytics/get-started/
