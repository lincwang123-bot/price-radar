# AIradar IndexNow 操作说明

本工具只发送 `airadar.vip` 的有限公开 canonical URL，不读用户、商家、关注、成交或账号数据库。无后台任务，不接入采集循环，不改变页面布局。首次启用后，只通知有实质变化的页面；旧变更继续由 sitemap 发现，不倒灌。

## 初始化

先发布 `lib/indexnow.mjs`、`lib/seo.mjs`、`scripts/indexnow.mjs`，确认新验证地址公网 GET 返回正确纯文本、HEAD 正常。然后创建专用私有状态目录并执行一次：

```sh
node scripts/indexnow.mjs --init --state /srv/price-radar/seo-state/indexnow.json
```

初始化不发送 URL。已有状态不允许重置，避免破坏启用时间与去重记录。验证文件可被搜索引擎读取，验证串不用于账号登录或服务器权限；不把它打印到发布宣传材料。

## 后续真实更新

发布成功、完成 HTTP 验收后，生成本次变更清单，字段如下：

```json
{
  "changes": [
    {
      "url": "https://airadar.vip/guides/read-price-changes",
      "changedAt": "填写带时区的实际发布时间",
      "revision": "填写本次发布文件或可复核公开内容的 64 位 SHA-256",
      "reason": "写明实际新增或更正的信息，并保留发布证据"
    }
  ]
}
```

这只是格式示例，不能原样提交。只改样式、时钟、抓取时间或添加验证文件，不属于要通知的正文变化。原始标题/价格/优惠不为了提交而改动。

```sh
node scripts/indexnow.mjs --state /srv/price-radar/seo-state/indexnow.json --manifest /absolute/reviewed-changes.json
node scripts/indexnow.mjs --state /srv/price-radar/seo-state/indexnow.json --manifest /absolute/reviewed-changes.json --send
```

第一条只做计划，不发网络提交。第二条明确发送；发送前重新检查验证文件、HTTP 200、canonical 和 robots。最多 20 个已核对网址；私有页、任意参数、片段、未知页、外站网址均不能进入清单。当前试点仅支持仍在线的页面，迁移/删除通知暂不支持，不把所有 404 填入工具。

200 表示收到；202 表示收到、key 待验证。两者都不表示收录、排名提高或被 AI 引用。请求意图在发送前写入 `pending`：网络超时、崩溃或拒绝均保留待核验记录，不自动重试。根据回执和 `retry-after` 核查后，由维护者处理 pending，不能直接删掉整个状态文件。并发锁不得在仍有进程运行时删除。

状态、清单和日志放在站点不公开的运维目录，不加入 sitemap、不推送到公共仓库。本工具没有绑定 Bing Webmaster Tools 账号；站长工具中的站点归属和报表仍需在既有账号内核实。

协议依据：https://www.indexnow.org/documentation ；提交时机：https://www.indexnow.org/faq 。

## 默认关闭的自动任务

自动任务是独立发布/定时任务，不在 web 请求或采集循环里运行：

```sh
node scripts/indexnow.mjs --auto
```

只有 `AIRADAR_INDEXNOW_AUTO=1` 或 `on`（大小写不敏感）开启；未设置、0、off、其它值直接退出，不读库、不请求网络。状态路径 `AIRADAR_INDEXNOW_STATE` 默认 `seo-state/indexnow.json`（gitignore），数据库路径必须显式设置 `AIRADAR_INDEXNOW_DB`。数据库以只读方式打开，不修改采集、留存或运维数据库。

任务由站长配置的 systemd timer / cron 或发布后任务触发（建议每 5 分钟）；本 PR 不安装服务、不改生产配置。比较官方地区记录的地区、原币、已有 CNY 金额、周期、渠道、来源及指南正文的 SHA-256。首次运行只建基线，后续新增页面或实质变化才提交；时钟、抓取时间、上游时间、样式、验证文件变化不触发。不是每轮缓存刷新发送。已退役/无数据页面不提交，HTML 200、canonical、robots 和 key 均在发送前核验。

每批最多 20 条，超出留待下次；沿用每 URL 5 分钟冷却及 revision 去重。冷却中的变化保留待下轮；发送前保存 pending，网络异常或拒绝保留 pending、错误/响应状态，后续不盲目重试，由人工查看状态处理。任务有独占锁，状态原子写入，禁止将状态文件公开或纳入 sitemap。预检失败记 lastResponse，需要运维检查（不会无限自动重试同一内容）。同样支持原人工 manifest / --send 流程。

上线前：

1. 公网 GET `https://airadar.vip/22c6e86b2f1e1681b55d9bf306810a8b.txt` 必须返回与 INDEXNOW_KEY 完全一致、无换行的纯文本；动态路由已提供。这不是 `/3135103.txt`。
2. 如未初始化，先创建私有状态目录，再运行 `node scripts/indexnow.mjs --init --state <私有状态路径>`；不要重置已存在的状态。
3. 设置 `AIRADAR_INDEXNOW_STATE`、`AIRADAR_INDEXNOW_DB`，先运行一次建立基线；由站长决定是否设置 `AIRADAR_INDEXNOW_AUTO=1` 并启用独立 timer/发布任务。web 不需要承担发送任务；环境变量在任务服务中生效，重启该服务或更新 cron 环境。
4. 默认保持关闭，等站长确认 key、状态目录权限和任务安排后再开。关闭变量或停用任务即可停止自动提交；API 接收不代表已收录。

allowlist 新增采集器已支持的官方 HTML 专页及英文干净路径；Markdown 副本、验证文件、筛选串、账号和后台路径均不得提交。扩展采集器套餐时同步审核 allowlist。

关键落地页的指纹还覆盖已审核 `/prices/{key}` 的产品名与买前问答、官方总页的来源声明和人工核对基准；普通渠道挂牌价波动不触发。官方专页声明/问答正文同样进入指纹，但数据日期和时效标签不进入指纹。
