# price-radar —— AI 订阅/API 报价导航

按产品查看 AI 订阅与中转 API 的店铺、规格和报价，支持固定登记的原始店铺公开目录采集、SQLite 历史记录与规则化盯盘提醒。
行情使用 Node ≥ 22 内置 `fetch` + `node:sqlite`；邮件使用已锁定版本的 `nodemailer`。

## 关注与回访功能（2026-09-08）

- `/following`：游客本机关注；邮箱验证码确认后合并并同步清单。保存期限、交付方式、地区、币种等明确规格，可设置目标价、恢复库存、累计降价幅度或每周报价。未知规格只收藏，不发价格通知。单项暂停、全局邮箱退订、退出及删除线上账号均可操作。
- 条件通知只针对确认邮箱。沿用现有 `MERCHANT_SMTP_*`、`MERCHANT_MAIL_FROM` 发送配置，身份摘要使用持久化 `RETENTION_SECRET` 或既有 `SUBMISSION_HASH_SECRET`；不会自动订阅现有投稿邮箱，也不读取商家邮件队列。每邮箱最多每24小时一封行情或续费汇总，验证码另有限流；发送前重新检查关注状态及报价。SMTP接受不等于到达收件箱；不确定发送不自动重试。
- 用户可设置到期日期、提前提醒天数，并导出 `.ics` 到日历。日期由用户填写，网站不读取账号或实际订单。游客用日历提醒，邮箱确认后可收站内记录对应的邮件提醒。
- 产品目录及旧产品页提供关注入口、同规格观察统计和购买条件说明。新增跨源观察历史从功能实际启用起记录，展示实际天数；既有来源历史完全保留，不回填或虚构30天行情。
- `/weekly`：滚动7日同规格变化，支持按截止日期查看往期。至少跨两个有记录的日期且变化达到1%才展示。分享按钮在用户浏览器生成带规格、日期的PNG，同时复制对应页面链接；不会自动发到X。
- `/admin/analytics` 新增关注、提醒入口回访、暂停、退订及7/30天回访观察。只追踪主动使用相关功能的去标识行为，游客与邮箱账号分别计数；未满观察期显示暂无成熟样本，不把它算作0%回访。

新表统一以 `retention_` 为前缀保存在现有私有 `submissions.sqlite`，沿用其文件权限、每日备份及异机备份。账号、会话、验证码、关注和通知不进搜索索引或站点地图。站点地图增加实际产品目录入口和公开周报；所有私人接口要求同源验证与适当会话权限，退订签名只允许取消提醒。

前端为普通JavaScript，无构建步骤。验证命令：`npm run check`，包括静态语法检查和自动测试。界面检查需覆盖游客关注/刷新、邮箱同步、不同账号隔离、暂停退订、手机表单、日历和分享下载。测试发件使用模拟SMTP；不要向现有商家或用户发送测试通知。

## 店主 X 认领（2026-09-08）

已收录店铺可从报价旁或 `/claim-shop?new=1` 申请关联 X。店主取得认领码后，将其放在自己的 X 帖子或简介，并提交店铺归属说明；站长在 `/admin/x-claims` 分别核对账号控制和店铺归属后批准。账号链接展示在该店报价及 `/shop?id=…` 的店铺主页，产品报价页默认综合排序，优先 X 已关联、再店铺已收录，同类按价格升序；也可切换价格升序或降序。关联不代表信誉认证。店主可自愿打开 X 分享店铺页；本站不代发帖子。

更换已有账号需明确确认替换，撤销后立即停止展示，操作留存审核记录。联系邮箱、内部依据及私密进度链接不进入公开页面；不自动提取旧投稿联系方式。详情、核验方式与数据维护见 [店主 X 认领说明](docs/merchant-x-claims.md)。

> 2026-09-06 更新：扩源、覆盖验收、报价来源字段、P0 商业化入口和 Mac 回执已完成首轮发布验收。既有历史记录继续保留；完整商家账号、API 与信用体系仍属于后续阶段。

> 原店采集范围持续维护，当前启用目标以配置和 registry 为准。登记目标数不等于有效报价数，也不等于独立域名数；可用性以最近一次采集记录为准。

## 联系方式

- X：[ @superwang](https://x.com/superwang)
- Telegram：[ @lincwang](https://t.me/lincwang)

```text
┌─────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌───────────────┐
│ 公开商品目录 │──▶│  适配器(源)    │──▶│  SQLite 历史库     │──▶│ 盯盘规则引擎    │──▶ 控制台 / JSONL / Webhook
│ 店铺报价     │──▶│ sources/*.mjs │   │  snapshots/…      │   │  min_below…    │
└─────────────┘   └──────────────┘   └──────────────────┘   └───────────────┘
```

## 设计原则

- **源 = 适配器**：每类公开目录通过独立适配器读取，`pull(ctx)` 返回统一规范化快照即可接入，
  新增站点不动核心逻辑（采集/存储/盯盘全复用）。
- **幂等三层**：HTTP 指针层 ETag/304 → 不可变快照本地 raw 缓存 → SQLite 主键去重。
- **历史可回填**：`radar.mjs import <raw.json>` 可把旧快照灌入，立即形成价格序列。
- **盯盘去噪**：规则按「事件」触发而非每次轮询都报——跌破阈值只提醒首次与再创新低；
  跌幅只在进入窗口阈值时提醒，回升后解除；换源/下架只在状态翻转时提醒。
- **采集边界**：仅访问公开接口/页面，核对适用的访问规则与许可，遵守限速要求。
  原始店铺直采只访问固定白名单，不绕过登录、验证码或 WAF，也不接受运行时任意 URL。
  报价仅作情报，不自动认定 SKU 等价、不自动采购、不据此直接上架。

## 快速开始

内置默认配置包含采集设置与一组示例盯盘规则，实际启用项以 `lib/config.mjs` 和本地配置为准。要改采集范围/规则/通知，复制 `config.example.json` → `config.json` 再改（写 null/缺省即用内置默认）。

```sh
node radar.mjs pull                  # 拉取所有启用源并入库
node radar.mjs watch                 # 先 pull，再对库内最新快照求值盯盘规则 + 通知
node radar.mjs daemon --interval 300 # 常驻：每 300s 一轮 pull + watch
node radar.mjs serve --port 8090     # 启动只读 Web 页面（见下）
```

Web 页面（零依赖、服务端渲染，给身边人看）：

```sh
node radar.mjs serve --host 127.0.0.1 --port 8090
# http://127.0.0.1:8090/           按产品查看报价与店铺
# /?family=chatgpt&product=chatgpt-plus   ChatGPT Plus 店铺与规格
# /alerts                          盯盘提醒
# /sources                         数据源状态
```

查看数据：

```sh
node radar.mjs products --source direct-shops   # 原店采集的最新产品一览
node radar.mjs offers chatgpt-plus-recharge --source direct-shops # 最新报价（价格升序）
node radar.mjs history chatgpt-plus-recharge --source direct-shops --n 20 # 跨快照最低价走势
node radar.mjs alerts --limit 20                # 最近告警
node radar.mjs sources                          # 数据源与最新快照
node radar.mjs import <raw.json>                # 历史 raw 快照回填（幂等）
```

运行参数建议追加 `--disable-warning=ExperimentalWarning` 屏蔽 node:sqlite 实验警告：
`node --disable-warning=ExperimentalWarning radar.mjs daemon`（npm scripts 已内置）。

## 配置

复制 `config.example.json` → `config.json`（`.gitignore` 已忽略本地配置与数据）。

- `sources.<id>.enabled`：启用/停用源。
  - `direct-shops.targets[]`：只接受内置固定目标 id，不接受任意域名或 URL。
  - `direct-shops.min_interval_minutes`：直采源实际请求的最短间隔（默认 30）。
  - `direct-shops.request_delay_ms`：同一轮分页请求之间的延迟（默认 500ms）。
- `watch.rules[]`：盯盘规则，`source` 指定数据源，`product` 可写 `"*"` 表示该源下全部产品。
- `notify.webhooks[]`：通知通道。

### 盯盘规则 kinds

| kind | 语义 | 必填 |
| --- | --- | --- |
| `min_below` | 最低价 ≤ `threshold` 提醒；阈值之下再创新低再次提醒 | `threshold` |
| `drop_pct` | 相对近 `window` 个快照窗口高点的跌幅 ≥ `pct%` | `window`, `pct` |
| `cheapest_changed` | 最低价 offer 换店/换链接提醒 | — |
| `offer_gone` | 上一快照的最低价 offer 消失/全场无货提醒 | — |

### 通知通道

- `console`（默认开）、`logFile`（写 `data/alerts.jsonl`，默认开）。
- `webhooks` 数组：
  - Telegram：`{ "format": "telegram", "token": "123:ABC", "chat_id": "-100..." }`
  - 企业微信机器人：`{ "format": "wecom", "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." }`
  - 钉钉/飞书/通用文本：`{ "format": "generic", "url": "..." }`（POST `{"text": ...}`）
  - Server酱：`{ "format": "serverchan", "url": "https://sctapi.ftqq.com/<KEY>.send" }`

## 原始店铺直采（`direct-shops`）

`direct-shops` 是本项目独立实现的原始店铺公开目录采集器，负责拉取、缓存并生成原店报价快照。候选店铺可通过公开商品链接发现，经原站和生产 VPS 核对后人工登记；固定目标白名单由本项目维护，不接受运行时任意 URL。不同店铺的商品仍须按具体规格确认是否可比。

首批来源是代码内固定登记的公开 HTTPS 入口：

| 目标 id | 店铺/目录 | 类型与公开入口 | 单目标缓存周期 |
| --- | --- | --- | --- |
| `aikashop` | AikaShop | 固定 Suno 页面：`aikashop.com/products/suno.html` | 12h |
| `otaor` | OTAOR | Dujiao：`acc.otaor.com/api/v1/public/products` | 30min |
| `aisou` | AI搜 | Kami：`aisou.pro/user/api/index/commodity` | 30min |
| `redeemgpt` | RedeemGPT | Kami：`faka.redeemgpt.com/user/api/index/commodity` | 30min |
| `ai666` | AI666 | Kami：`ai666.id/user/api/index/commodity` | 30min |
| `shopcardai` | CardAI | Kami：`shopcardai.click/user/api/index/commodity` | 30min |
| `web3chirou` | 蔚莱云AI | Kami：`web3chirou.com/user/api/index/commodity` | 60min |
| `lynnzee` | LynnZee | Kami：`lynnzee.myweb999.cfd/user/api/index/commodity` | 30min |
| `zhanghao66` | 账号66 | Kami：`zhanghao66.com/user/api/index/commodity` | 30min |
| `yufenggpt` | 御风AI | Kami：`yufenggpt.com/user/api/index/commodity` | 30min |
| `google7676` | 以太AI | Kami：`google7676.top/user/api/index/commodity` | 30min |
| `tehuio` | Tehuio | Kami：`tehuio.com/user/api/index/commodity` | 30min |
| `codesky` | 花生店铺 | Kami：`store.codesky.qzz.io/user/api/index/commodity` | 30min |
| `gugugaga` | Gpt全自助发货 | Kami：`gugugugagaga.taootp.com/user/api/index/commodity` | 30min |
| `flyai` | FlyAI | Dujiao：`flyai.qzz.io/api/v1/public/products` | 30min |
| `whh985` | 王哈哈AI | Dujiao：`shop.whh985.com/api/v1/public/products` | 30min |
| `aictk` | 艾琳AI | Dujiao：`shop.aictk.shop/api/v1/public/products` | 30min |
| `ccdawang` | CC大王 | Dujiao：`ccdawang.win/api/v1/public/products` | 30min |
| `morimm` | MoriMM | Dujiao：`morimm.com/api/v1/public/products` | 30min |
| `burstpro-ai` | BurstPro AI | Dujiao：`burstpro-ai.online/api/v1/public/products` | 30min |
| `ikunlove` | IkunLove | IkunLove JSON：`ikunlove.best/api/shop/products` | 30min |
| `mooncake` | Mooncake | Mooncake JS 目录：`fk1.ybkjs.top/mooncake-official-media/catalog.js` | 12h |
| `16688-s…`（30 家） | 固定店铺名单见 `collectors/direct/platform16688.mjs` | 16688 原店公开 `/shopApi/goods/list`，按已核对 `shop_no` 读取列表 | 60min |
| `aichong` | AI补给站 | `aichong.xin/api/products`，仅在原站明确启用本地购买 `self_pay=true` 时收录 | 60min |
| `wzyp-harvey`、`wzyp-paimon`、`wzyp-ai-choice`、`wzyp-direct`、`wzyp-lightyear` | 派大星、派蒙AI、AI优选站、GPTplus直营、光年AI | ShopApi：固定登记的 `wzyp.cn` 店铺，读取 `/shopApi/Shop/categoryList` 与 `/shopApi/Shop/goodsList` | 60min，非默认 |

默认清单统一由 registry 提供，配置不再维护另一份重复数组；停用及屏蔽规则优先于历史登记清单，自动采集遵循缓存和最小间隔。AikaShop 的 6 条 Suno 套餐没有明确库存证据，均为“待核验”，不参与可售起价或覆盖成绩。`web3chirou` 的 Kami 目录会出现“请求 100 条但首页仅返回 96 条”的情况；采集器在存在 `total` 时不再以单页长度提前结束，并用唯一 ID、重复页、连续空页和最大页数共同限定请求。Dujiao 多规格商品按 SKU 独立生成报价，只补充已确认的品牌名，不把父商品中的 Plus / Pro 5x / Pro 20x 混入每个 SKU。自动生成的 `SKU-1` 仅在单规格商品中回退到父标题，多规格仍不猜测。

`otaor`（`acc.otaor.com`）在 2026-09-05 核验时全部售罄，曾仅登记为候选；2026-09-06 复核 41 条 SKU 中 1 条 Gemini 权益兑换链接标有库存，其余 40 条售罄，故本次恢复默认目标。兑换链接不是完整订阅，不能计作订阅覆盖；旧地址 `xtacc.top` 不重复计入。无法正常访问、返回挑战页或已不再是商品站的候选不启用。

`wzyp.cn` 的 ShopApi 目标仍可在 `config.json` 中显式启用，但当前会对 airadar.vip 生产 VPS 返回 WAF 挑战页，因此不纳入生产默认列表，也不尝试绕过。

采集边界与失败语义：

- 只请求固定白名单内无需登录即可读取的公开商品目录；不提交账号凭据，不绕过登录、验证码或 WAF，不把采集器当通用代理。ShopApi 路径中的店铺 token 是公开店铺标识，不是登录凭据。
- 源级最短请求间隔默认 30min；单目标另按上表复用缓存，实际店铺请求之间和分页请求默认间隔 500ms，并限制页数/分类数。缓存命中不产生原站请求。即使 daemon 运行更频繁，也不会据此提高原站请求频率。
- 每个目标成功后原子更新本地缓存。失败目标单独记录健康状态，已有缓存可在期限内保留；健康店铺仍可发布和比价。报价是否可用按对应目标判断，不能只凭汇总 `stale` 字段把所有店铺一起禁用。缺失/超龄目标不冒充在售，请求失败不等同于商品下架或无货。
- 缓存保留规范化商品状态，公开快照排除售罄和标题明确标注“无质保 / 无售后”的商品；16688 额外检查商品说明中的明确无保障条款，命中后在解析阶段排除。不能将缓存数量当作原站商品总数。被排除的条目不参与最低价、报价排行或产品计数，避免异常低价误导用户。
- 只发布能可靠归入本项目商品分类的条目；无法确认分类的商品保留在采集统计中，但不进入报价快照。
- Perplexity Pro 和 Notion AI 商业版按 1 / 12 / 24 个月拆分，Manus 按 2000 / 5000 / 10000 积分拆分，Cursor 区分 Pro / Pro+ / Ultra 以及明确月卡和期限未注明，X Premium+ 与 Premium 单独排行。质保天数不用于推断订阅期限；永久权益、多个档位共用一个起售价以及多产品全家桶不进入单一订阅排行。
- 补充 `Max5X`、`20×`、繁体接码等明确写法；API 中转优先于标题中的 Pro / Max 号池词识别。“库存紧张”保留为可购买报价。
- Gemini 权限激活和权益领取链接单独展示，不参与完整订阅的最低价；历史走势也排除已明确改分到其他商品组的报价。
- 订阅报价按交付对象区分成品号、代充、共享/合租及席位。首页分别展示成品号与代充起价，点入后仅在所选交付类内排序；所有类及店铺报价仍可切换查看。裸卡密、没有交付说明或说明冲突的报价单独保留，不能作为代充最低价。报价类型来自商品/SKU及受控公开说明，不以价格判断，也不等同于成交验证。
- ChatGPT Plus 明确年卡代充单独分组；免费 GPT / Grok 账号不因附带 Outlook 邮箱或“成品”字样混入邮箱、付费订阅排行。
- 直采快照 ID 包含内容指纹和本轮观察时间。每个通过节流检查的观察均独立入库，保留 A→B→A 的价格回归、报价不变时的新核验时间，以及失败后恢复的状态；旧快照不覆盖、不删除。

页面展示的是原站公开商品列表中的**挂牌价**，不等同于最终结算价。优惠券、支付渠道、手续费、汇率、购买数量/规格和结账页变动都可能改变实付金额；ShopApi 采集器也不调用结算询价接口。购买前必须回到原店铺核对商品说明与最终应付金额。

## 运行与维护

### 站长后台与投稿备份

### 搜索抓取与索引基础

`/robots.txt` 声明站点地图与私有路径限制，保留边缘既有搜索/训练机器人策略；`/sitemap.xml` 从当前真实产品动态生成，复用前台目录加入有公开报价或官方/API 参考报价的品牌分类页与产品汇总页，同时保留现有按来源区分的产品详情页。新增目录条目仅使用 `family`、`product` 规范参数，不收录空目录、排序/渠道/交付方式筛选组合、投稿、后台或 API。由于行情观察时间不等于页面实际修改时间，暂不输出可选 `lastmod`，避免虚假更新信号。

公开页有清洁 canonical、描述和与页面类型相符的 JSON-LD；UTM/渠道筛选不另建索引页，报价分页保留规范页码。不存在的产品返回真实 404。源站仅对可信本机 Tunnel 传入的 HTTP 协议标记重定向至固定 HTTPS 主域；不会为 SEO 修改后台鉴权或共享缓存私人内容。

本站已完成 Google Search Console 和百度搜索资源平台的所有权验证；先前 Google Sitemap 已成功读取，但不是全部页面收录的证明，百度提交仍受账号实际配额与平台状态限制。新部署者须使用自己的真实账号验证和提交，可配置 `GOOGLE_SITE_VERIFICATION`、`BAIDU_SITE_VERIFICATION` 的官方公开验证值；缺省为空，不伪造验证。技术可索引不等于已收录，也不保证收录时间。`www.airadar.vip` 的 DNS/跳转需另行在域名控制台核实配置。第一方统计要求公开页到达源站，当前保留 `no-store`，不盲目开启 HTML 边缘缓存。

### 第一方访问统计（2026-09-05）

当前使用VPS第一方服务器统计，不依赖Cloudflare付费产品或另一个追踪脚本。后台 `/admin/analytics` 提供7/30天页面访问量、访客估算、区间重新去重、趋势和仅认证可导出的按日CSV；未开始统计的历史显示“未采集”。这不是精准真人PV，也不是实际人数，共享网络可能合并、换IP或浏览器可能重复。

只信任当前本机Tunnel转发的 `CF-Connecting-IP`，不信任任意XFF；缺少可信IP不计。HMAC去标识摘要在线保留31天、按日汇总长期保留，不存原始IP、完整UA、查询参数或表单信息。后台、API、提交页、HEAD、错误页、预取、管理员和已知机器人不计；每标识每分钟最多60次、全站最多600次。统计写入在响应结束后执行，锁等待上限5ms，故障不影响公开页。公开隐私说明：`/privacy`。

统计库固定到 `ANALYTICS_DB_PATH=/opt/linc/apps/price-radar/analytics/analytics.sqlite`，备份到 `ANALYTICS_BACKUP_DIR=/opt/linc/backups/price-radar/analytics`，均不进Git或代码同步删除范围。每日备份同时覆盖投稿与统计库，最多14份，均经过隔离恢复检查。

管理员用户名、scrypt hash与统计HMAC密钥独立存于服务器root所有、0600的 `/etc/price-radar/web.env`，只由Web单元读取；collector的文件系统禁止访问投稿、统计、备份与Web配置。首次配置可在本机运行 `node scripts/provision-admin.mjs <仓库外私密目录绝对路径>`，自动生成强随机口令到本机0600交付文件，仅将hash送往服务器，拒绝覆盖既有配置。不要将该文件提交Git、发送聊天或打印内容。

`/admin` 是独立的站长模块。没有同时配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH` 和 HTTPS `PUBLIC_ORIGIN` 时返回 404；本次实现不会自动创建账号。口令 hash 格式由 `lib/admin.mjs` 的 `hashAdminPassword()` 生成（scrypt，口令至少 16 字符），原口令不得写入仓库、命令行参数或聊天。会话有效期 1 小时，退出或服务重启后失效；状态与内部备注在同一事务中追加操作审计，后台不提供删除投稿、改价、自动上架或对外联系功能。

使用 `node radar.mjs backup-submissions` 执行 SQLite 在线备份，包含已提交的 WAL。`SUBMISSIONS_BACKUP_DIR` 必须是独立绝对路径；生产模板使用 `/opt/linc/backups/price-radar/submissions`，备份文件 0600、目录 0700，默认保留最近 14 份。每份在临时目录恢复并执行 `quick_check` 与表计数，再成为可用备份。此过程不覆盖生产数据库，也不输出投稿正文。`price-radar-backup.timer` 每天 UTC 19:40 左右运行（北京时间次日 03:40），掉线期间错过的任务在恢复后补跑。

服务器备份与异机备份分开管理。后台分别报告服务器副本与 Mac 确认回执；没有回执时不能声称 Mac 已同步。旧版本没有 SHA-256 的服务器副本明确标为仅大小校验。

### Mac 加密异机备份

在已配置 `linc-vps` SSH 别名的 Mac 上运行：

```sh
node --disable-warning=ExperimentalWarning scripts/mac-backup.mjs backup
node --disable-warning=ExperimentalWarning scripts/mac-backup.mjs verify /绝对路径/airadar-时间-随机值.enc
node --disable-warning=ExperimentalWarning scripts/mac-backup.mjs restore /绝对路径/airadar-时间-随机值.enc /尚不存在的恢复目录
```

- 通过既有 SSH 拉取行情历史、私人投稿、访问统计三个 SQLite 在线一致副本；每个数据库包含已提交 WAL，但不宣称跨库同一瞬间的原子快照。不开通第三方云存储，不采集更多访客信息。
- 默认档案位于 Mac 用户目录的 `Backups/Airadar`，AES-256-GCM 密钥单独保存在 `Library/Application Support/Airadar Backup/backup.key`。目录 0700，文件 0600；密钥和档案均不进入仓库。密钥丢失/变更会停止操作，不能通过重建密钥恢复旧备份。
- 每次保存独立加密版本，不覆盖、不自动删除旧档案；解密验证、SHA-256 与 SQLite 恢复检查全部通过才更新 `status.json`。备份失败保留上次有效副本。
- 新版本验证成功后通过既有 SSH 上传白名单元数据回执到服务器 `/opt/linc/backups/price-radar/mac-receipt.json`，只含版本、创建/检查/接收时间、加密文件大小与校验等级，不上传密钥、档案或私人正文。超过 36 小时标为过期；回执上传失败不会删除已验证的 Mac 副本，并明确报告同步异常。回执表示曾完成检查，不保证当前 Mac 文件仍存在或硬件无故障。
- 不备份原始网页缓存、服务器环境文件、Tunnel/管理员凭据。环境配置需另行安全保管，代码从 GitHub 恢复。需要恢复时只解密到一个新目录，不自动覆盖线上数据库。
- Mac 的每日执行由 Codex 本任务中的“Airadar 每日 Mac 异机备份”管理，当前北京时间 09:00；成功不通知，异常报告。Mac/Codex 不可运行或服务器不可达时不能保证完成，应核对 `status.json` 的最后成功时间。
- 按站长选择保留所有历史版本，空间会随运行时间增长。统计摘要在线保留 31 天，服务器备份最多 14 份；加密异机历史可能长期保留，仅用于灾难恢复，不用于延长访问追踪。
- 弱网传输默认最多等待 15 分钟；到时终止本轮并清理未完成档案，保留所有旧版本。正常中断会清理临时目录并等待子进程退出；断电或 SIGKILL 无法执行清理，遗留 `.running` 锁需先确认没有活动备份后人工处理，不自动猜测解锁。

### 数据记录与功能边界

采集覆盖应按同产品、同规格、周期、币种及质保口径核对有效在售报价。目标登记数、缓存条目数和过去抽样数量不能代替实际覆盖证明；过期或失败记录不能作为新鲜报价。

新报价持久化 `source_type/source_name/source_url/merchant_id/last_updated_at/last_verified_at/recorded_at`。来源由受控适配器决定，不能由外部 payload 自报。`direct-shops` 使用 `original_crawl`（原店采集）类型；原店公开目录采集不等于商家主动提交报价。更新时刻与最近抓取核验时刻分开，核验不代表购买认证；相同价格继续记录观察，A→B→A 不丢失。writer 幂等迁移新增列，旧库只读仍兼容，旧记录不伪造回填。

本轮 P0 还包含统一 `/go` 店铺跳转及最小点击统计、独立 Sponsored 广告模型/展示、`/advertise` 合作申请和商家认领申请入口。广告不改变自然价格排序；申请不自动通过身份认证、开通商家权限或上架广告。P1 的完整认领验证、商家后台/报价编辑/API、第一方占比 Dashboard、用户价格有效性反馈及专门的 30 日价格统计尚未实现；P2 信用体系也未做，不能把现有访问统计、历史曲线或覆盖验收页称为这些功能。

共享平台根域不能代表单一商家：`16688.com.cn` 和 `wzyp.cn` 的普通链接仍可正常跳转，但按未归属报价隔离统计，不跨店合并；在平台店铺身份核验完成前不允许投放归属于该共享域的 Sponsor。独立域名标识也只是数据归并键，不是认证背书。当前没有真实生效广告，分类、首页和全站合作仅接受意向申请。

2026-09-06 只读核验生产 `/opt/linc/apps/price-radar/config.json` 不存在，旧版 21 个目标来自内置默认；因此发布新版代码即可采用 23 个默认目标，无需创建或覆盖配置。若其他环境显式设置 `sources.direct-shops.targets`，默认数组不会覆盖自定义选择，应先将完整配置备份至 Git 忽略的 `backups/`（目录 0700、文件 0600），只合并经确认的新目标，保留其余字段和通知秘密，禁止打印完整配置。现有显式旧提醒规则另用 `scripts/migrate-watch-defaults.mjs --config /绝对路径/config.json` 先 dry-run，确认后才加 `--apply`。

### 报价展示口径

目录 ID 只是产品族，不代表所有报价属于同一 SKU。公开报价根据实际商品描述区分期限、交付方式、地区、优惠类型、数量/容量及币种；未知或多选规格保留原始说明，不生成有误导性的统一最低价。行情、网页排行、历史和提醒复用 `offer-spec.mjs` / `quote-policy.mjs`，统一排除售罄和明确无质保报价。历史按查询重算，原始记录与旧链接保留。

直采每条报价保留对应店铺健康信息，一个店铺失败不会让其他正常店铺全部失效。采集整体失败或报价超过有效期时不参与当前最低价；提醒对不完整采集轮次保守跳过，避免把失败误认成下架。ShopApi 目录未取完时拒绝发布不完整结果。

用户页面展示商品、可比规格、挂牌价格、库存与更新时间、原始店铺和交易平台；真实来源保留在内部数据和后台。品牌、交易平台、关键词、用途、已核验框架组合筛选支持服务器渲染；反馈和合作表单有安全 POST 兜底，脚本失效时不会把正文和联系方式写进网址。

直采失败时最多使用 24 小时缓存（`direct-shops.max_cache_age_minutes` 可配置），超龄来源退出当轮报价并展示“不可用、不代表售罄”；原始历史保留。持续停机仍需通过后台和日志监控发现，不能把旧快照时间当作实时保证。

渠道筛选与产品品牌独立：16688、链动小铺、登记独立站及未确认渠道。框架标签只写已识别接口类型，不能推导托管或担保。渠道选择会重算当前报价、最低价、总数及趋势，保留分页和返回品牌状态。

`npm run check` 执行语法检查与完整测试；部署脚本要求干净且已提交的版本，先备份投稿、统计和旧代码，再停止本项目服务同步，检查本机与公网 HTTP。失败时精确恢复旧代码，以及 web、collector、备份 service/timer 和既有 Tunnel 的单元文件与启用/运行状态；数据库不做倒退恢复。旧代码归档在 `/opt/linc/backups/price-radar/code-before-<commit>-<timestamp>.tar.gz`。首次新版本部署前须确认管理员凭据交付，或保持后台关闭。不要把脚本与隔离测试通过当成已完成生产回滚演练。

### 扩展采集适配器

1. 在 `sources/` 新建 `xxx.mjs`，实现：

```js
export const sourceId = "xxx";            // 稳定 id
export const sourceLabel = "XXX（定位）";
export async function pull(ctx) {
  // ctx: { db, dataDir, log }
  // 1) 拿到该站最新一版数据的源侧 id 与原始 JSON
  // 2) 归一化成:
  //    { source, snapshotId, fetchedAt, generatedAt?, publishedAt?, stale?,
  //      products: [{ productId, name?, platform?, productType?, spec?,
  //                   lowestPrice?, currency?, offerCount?, inStockCount?,
  //                   offers: [{ offerId, sourceName?, storeName?, title?,
  //                              price?, currency?, status?, stockCount?,
  //                              url?, capturedAt?, expiresAt? }] }] }
  // 3) raw 下载可写 data/raw/<sourceId>-<snapshotId>.json 做幂等缓存
  return { source: sourceId, snapshotId, snapshot, reusedCache };
}
```

2. 在 `sources/registry.mjs` 登记。
3. `config.json` 的 `sources` 开启该源；按需加盯盘规则。
4. `node radar.mjs pull` 验证入库 → `history/offers` 查看。

注意：不同站产品 id 体系不同，跨站对比需在业务侧自行做映射（例如
`chatgpt-plus-recharge` 等价物在各站叫法不一），本工具不臆断跨站 SKU 等价。

## 部署到 VPS（公网访问）

生产环境默认使用 Cloudflare **Named Tunnel**。服务三件套（见 `deploy/`）为：`price-radar-collect`（常驻采集+盯盘）、`price-radar-web`（公开页面与投稿接口，绑 `127.0.0.1:18090`）和 `price-radar-named-tunnel`（稳定的公网入口）。

Named Tunnel 的配置必须仅保存在 VPS：`/etc/price-radar/cloudflared/config.yml` 与仅限该 Tunnel 的 `/etc/price-radar/cloudflared/credentials.json`。后者应为 `root:root`、`0600`，由 systemd `LoadCredential=` 只在运行时交给服务；两者都不可提交到 Git、README、聊天记录或截图。

```sh
bash deploy/deploy.sh   # 本地执行：rsync 代码 → 装 systemd → 启动三服务
```

- 脚本要求本站既有 Named Tunnel 处于运行状态，不安装、修改隧道配置或凭据，也不操作旧 Quick Tunnel 和其他项目。既有 Tunnel 依赖 web，部署重启 web 后会启动同一 Tunnel 服务恢复连接。
- `.env` 仅用于部署环境变量，已被 Git 忽略；公开行情无需登录，`/admin` 内置独立口令、会话及 CSRF 保护，后台密钥仅由 web 加载 `/etc/price-radar/web.env`。
- `PUBLIC_ORIGIN=https://airadar.vip` 用于校验投稿请求来源。部署脚本只会在缺少该项时补入，不会覆盖现有值。
- `SUBMISSIONS_DB_PATH` 指向单独的投稿目录，`SUBMISSION_HASH_SECRET` 用于生成短期防滥用摘要；部署脚本会在首次启用时生成随机密钥，不会将密钥输出到终端或仓库。
- 仓库保留旧 Quick Tunnel 单元仅供历史参考，当前部署脚本不会自动启用它。

### 可选：Cloudflare Web Analytics

现用第一方统计见上文。代码仍保留可选 Cloudflare beacon 接口，但 Cloudflare Web Analytics 的 Visits 是访问会话口径，不能当作独立访客 UV。若以后有明确需求再配置，勿重复注入；仅可在 VPS 的 `/opt/linc/apps/price-radar/.env` 写入公开 site token：

```sh
CLOUDFLARE_WEB_ANALYTICS_TOKEN=你的公开_site_token
```

不要把 Cloudflare 账户 API Token 填入这里，也不要同时开启 Cloudflare 的自动注入。重启 `price-radar-web` 后，页面会加载 Cloudflare 的官方 beacon。令牌未配置或格式无效时，页面不会加载任何统计脚本，也不会影响网站访问。

## 数据库

`data/radar.sqlite`（WAL，已 gitignore）。核心表：

- `snapshots`（源 × 快照 id，幂等主键）
- `products`（每快照 × 产品：最低价、有货数、offer 数）
- `offers`（每快照 × 产品 × offer 明细，可回溯任意一代）
- `rule_state`（盯盘去重状态）、`alerts`（告警历史）

同一产品的价格序列 = 按 `fetched_at` 排序 join `snapshots + products`（`history` 命令即此查询）。

### 数据反馈与供需提交

页面顶部的“提交”提供两条独立流程：

- **纠正公开数据**：选择价格、库存、质保、分类、链接、缺失数据或页面问题，再补充产品、链接和必要说明。
- **供需合作**：供给方或采购方选择产品方向、合作规模、保障与结算方式，并填写合作说明和联系方式。

本地和生产环境默认都写入权限隔离的 `submissions/submissions.sqlite`，手工查询与 Web 服务使用同一路径，不与行情库混用。Web 以 SQLite 只读方式打开行情库，systemd 只允许它写投稿和独立统计目录。投稿库保存用户主动填写的信息及短期防滥用摘要，不保存原始 IP 或 User-Agent；超过 48 小时的投稿限流摘要会清除，统计摘要使用另述的 31 天策略。页面禁止提交密码、卡密与 API Key，接口拦截常见敏感凭据格式，并有同源、CSRF、16 KiB 上限、24 小时去重和频率限制。

已提供受保护的 `/admin` 后台；仍可通过 SSH 命令查看和处理（输出包含私人信息，不要粘贴到公开日志）：

```sh
node radar.mjs submissions --kind feedback --status new --limit 50
node radar.mjs submissions --kind cooperation --status new --limit 50
node radar.mjs submission-status FB-20260905-ABC234 resolved
```

## 现状与已知限制

### 原店采集能力

| 源 | 数据形态 | 更新节奏 | 备注 |
| --- | --- | --- | --- |
| `direct-shops` | 固定白名单内原始店铺的公开 JSON/JS/ShopApi 商品目录 | 源级 ≥30min；单目标 30min / 60min / 12h 缓存 | 独立实现；失败可沿用旧缓存并标记 `stale`；展示挂牌价而非最终结算价 |

### 商品差异与风险提醒

- 不同店铺的产品 id 与商品规格体系不同，必须按实际商品说明确认对应关系，不能仅凭名称或价格认定 SKU 等价。
- 成品号、代充、共享/合租、席位及用途未明确的卡密分别展示，不将不同交付方式的价格混作同一最低价。
- 报价仅供信息导航；店铺收录不代表交易安全保证，不据此自动采购或认定商品可信。
