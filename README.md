# price-radar —— 多源 AI 订阅/API 比价雷达（个人整合站）

把「AI 订阅 / 中转 API / 卡网渠道」的**比价聚合站**（如 PriceAI、OpenPrice 等）与固定登记的原始店铺公开目录当作数据源，
统一拉取 → 存 SQLite 历史 → 规则化盯盘提醒。零第三方依赖（Node ≥ 22 内置 `fetch` + `node:sqlite`）。

## 联系方式

- X：[ @superwang](https://x.com/superwang)
- Telegram：[ @lincwang](https://t.me/lincwang)

```text
┌─────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌───────────────┐
│ priceai.cc  │──▶│  适配器(源)    │──▶│  SQLite 历史库     │──▶│ 盯盘规则引擎    │──▶ 控制台 / JSONL / Webhook
│ openprice…  │──▶│ sources/*.mjs │   │  snapshots/…      │   │  min_below…    │
└─────────────┘   └──────────────┘   └──────────────────┘   └───────────────┘
```

## 设计原则

- **源 = 适配器**：每个同类比价站一个文件，`pull(ctx)` 返回统一规范化快照即可接入，
  新增站点不动核心逻辑（采集/存储/盯盘全复用）。
- **幂等三层**：HTTP 指针层 ETag/304 → 不可变快照本地 raw 缓存 → SQLite 主键去重。
- **历史可回填**：`radar.mjs import <raw.json>` 可把旧快照灌入，立即形成价格序列。
- **盯盘去噪**：规则按「事件」触发而非每次轮询都报——跌破阈值只提醒首次与再创新低；
  跌幅只在进入窗口阈值时提醒，回升后解除；换源/下架只在状态翻转时提醒。
- **合规**：只消费各站公开接口/页面数据；频率克制（PriceAI 官方要求指针 ≥1min/次）。
  原始店铺直采只访问固定白名单，不绕过登录、验证码或 WAF，也不接受运行时任意 URL。
  报价仅作情报，不自动认定 SKU 等价、不自动采购、不据此直接上架。

## 快速开始

内置默认配置即可直接运行（含 `priceai`、`direct-shops` 等数据源与一组示例盯盘规则）。要改关键词/规则/通知，复制 `config.example.json` → `config.json` 再改（写 null/缺省即用内置默认）。

```sh
node radar.mjs pull                  # 拉取所有启用源并入库
node radar.mjs watch                 # 先 pull，再对库内最新快照求值盯盘规则 + 通知
node radar.mjs daemon --interval 300 # 常驻：每 300s 一轮 pull + watch
node radar.mjs serve --port 8090     # 启动只读 Web 页面（见下）
```

Web 页面（零依赖、服务端渲染，给身边人看）：

```sh
node radar.mjs serve --host 127.0.0.1 --port 8090
# http://127.0.0.1:8090/           整合总览：官方区价 vs 卡网渠道 vs LDXP 货源
# /product?source=priceai&id=chatgpt-plus-recharge   产品报价 + 走势图
# /alerts                          盯盘提醒
# /sources                         数据源状态
```

查看数据：

```sh
node radar.mjs products [--source ldxp-goods]   # 最新快照产品一览（默认 priceai）
node radar.mjs offers chatgpt-plus [--source X] # 某产品最新报价（价格升序）
node radar.mjs history chatgpt-plus --n 20      # 跨快照最低价走势
node radar.mjs alerts --limit 20                # 最近告警
node radar.mjs sources                          # 数据源与最新快照
node radar.mjs import <raw.json>                # 历史 raw 快照回填（幂等）
```

运行参数建议追加 `--disable-warning=ExperimentalWarning` 屏蔽 node:sqlite 实验警告：
`node --disable-warning=ExperimentalWarning radar.mjs daemon`（npm scripts 已内置）。

## 配置

复制 `config.example.json` → `config.json`（`.gitignore` 已忽略本地配置与数据）。

- `sources.<id>.enabled`：启用/停用源。
  - `ldxp-goods.keywords[]`：LDXP 盯价关键词（建议含“代充/月/年/成品”等收敛词）。
  - `ldxp-goods.min_interval_minutes`：该源轮询节流（默认 15）。
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

`direct-shops` 是本项目独立实现的原始店铺公开目录采集器，与 `priceai` 的 Top 5 公开快照是两个独立数据源：分别拉取、缓存并生成快照。候选店铺可通过公开商品链接发现，经原站和生产 VPS 核验后人工登记；不会自动导入第三方完整渠道表，PriceAI 也不作为直采失败时的回退。跨源商品仍须由业务侧确认是否等价。

首批来源是代码内固定登记的公开 HTTPS 入口：

| 目标 id | 店铺/目录 | 类型与公开入口 | 单目标缓存周期 |
| --- | --- | --- | --- |
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
| `fk10886` | 10886源头发卡网 | Kami：`fk.10886.xyz/user/api/index/commodity` | 30min |
| `gugugaga` | Gpt全自助发货 | Kami：`gugugugagaga.taootp.com/user/api/index/commodity` | 30min |
| `flyai` | FlyAI | Dujiao：`flyai.qzz.io/api/v1/public/products` | 30min |
| `whh985` | 王哈哈AI | Dujiao：`shop.whh985.com/api/v1/public/products` | 30min |
| `aictk` | 艾琳AI | Dujiao：`shop.aictk.shop/api/v1/public/products` | 30min |
| `ccdawang` | CC大王 | Dujiao：`ccdawang.win/api/v1/public/products` | 30min |
| `morimm` | MoriMM | Dujiao：`morimm.com/api/v1/public/products` | 30min |
| `burstpro-ai` | BurstPro AI | Dujiao：`burstpro-ai.online/api/v1/public/products` | 30min |
| `ikunlove` | IkunLove | IkunLove JSON：`ikunlove.best/api/shop/products` | 30min |
| `mooncake` | Mooncake | Mooncake JS 目录：`fk1.ybkjs.top/mooncake-official-media/catalog.js` | 12h |
| `wzyp-harvey`、`wzyp-paimon`、`wzyp-ai-choice`、`wzyp-direct`、`wzyp-lightyear` | 派大星、派蒙AI、AI优选站、GPTplus直营、光年AI | ShopApi：固定登记的 `wzyp.cn` 店铺，读取 `/shopApi/Shop/categoryList` 与 `/shopApi/Shop/goodsList` | 60min，非默认 |

以上 21 个默认店铺均已在生产 VPS 验证可达。`web3chirou` 的 Kami 目录会出现“请求 100 条但首页仅返回 96 条”的情况；采集器在存在 `total` 时不再以单页长度提前结束，并用唯一 ID、重复页、连续空页和最大页数共同限定请求。Dujiao 多规格商品按 SKU 独立生成报价，只补充已确认的品牌名，不把父商品中的 Plus / Pro 5x / Pro 20x 混入每个 SKU。自动生成的 `SKU-1` 仅在单规格商品中回退到父标题，多规格仍不猜测。

`otaor`（`acc.otaor.com`）仅登记为可选候选：2026-09-05 核验时所有商品都明确标为售罄，因此未加入默认来源；旧地址 `xtacc.top` 不重复计入。无法正常访问、返回挑战页或已不再是商品站的候选不启用。

`wzyp.cn` 的 ShopApi 目标仍可在 `config.json` 中显式启用，但当前会对 airadar.vip 生产 VPS 返回 WAF 挑战页，因此不纳入生产默认列表，也不尝试绕过。

采集边界与失败语义：

- 只请求固定白名单内无需登录即可读取的公开商品目录；不提交账号凭据，不绕过登录、验证码或 WAF，不把采集器当通用代理。ShopApi 路径中的店铺 token 是公开店铺标识，不是登录凭据。
- 源级最短请求间隔默认 30min；单目标另按上表复用缓存，分页请求默认间隔 500ms，并限制页数/分类数。即使 daemon 运行更频繁，也不会据此提高原站请求频率。
- 每个目标成功后原子更新本地缓存。某目标首次采集失败且没有可用缓存时，整轮 `direct-shops` 不发布不完整快照；已有缓存时沿用该目标上次的完整结果，并把汇总快照标记为 `stale: true`。请求失败不等同于商品下架或无货。
- 原始缓存会保留店铺返回的完整商品状态，便于核对采集结果；公开快照会排除售罄商品，以及标题明确标注“无质保 / 无售后”的商品。它们不参与最低价、报价排行或产品计数，避免用不可购买或无保障的异常低价误导用户。
- 只发布能可靠归入本项目商品分类的条目；无法确认分类的商品保留在采集统计中，但不进入报价快照。
- Perplexity Pro 和 Notion AI 商业版按 1 / 12 / 24 个月拆分，Manus 按 2000 / 5000 / 10000 积分拆分，Cursor 区分 Pro / Pro+ / Ultra 以及明确月卡和期限未注明，X Premium+ 与 Premium 单独排行。质保天数不用于推断订阅期限；永久权益、多个档位共用一个起售价以及多产品全家桶不进入单一订阅排行。
- 补充 `Max5X`、`20×`、繁体接码等明确写法；API 中转优先于标题中的 Pro / Max 号池词识别。“库存紧张”保留为可购买报价。
- Gemini 权限激活和权益领取链接单独展示，不参与完整订阅的最低价；历史走势也排除已明确改分到其他商品组的报价。
- ChatGPT Plus 明确年卡代充单独分组；免费 GPT / Grok 账号不因附带 Outlook 邮箱或“成品”字样混入邮箱、付费订阅排行。
- 直采快照 ID 包含内容指纹和本轮观察时间。每个通过节流检查的观察均独立入库，保留 A→B→A 的价格回归、报价不变时的新核验时间，以及失败后恢复的状态；旧快照不覆盖、不删除。

页面展示的是原站公开商品列表中的**挂牌价**，不等同于最终结算价。优惠券、支付渠道、手续费、汇率、购买数量/规格和结账页变动都可能改变实付金额；ShopApi 采集器也不调用结算询价接口。购买前必须回到原店铺核对商品说明与最终应付金额。

### 与 PriceAI 的许可证边界

目前未能核实 PriceAI 当前仓库许可：此前引用的 `main/LICENSE` 链接不可用，不能据此声称已获得特定许可、已确认当前条款或可复用其源码。本项目仅接入其公开文档说明的快照接口，公开接口存在也不自动构成对所有再利用方式的授权；如需扩大使用范围，应先核实当前条款或联系权利方。

本项目的 `direct-shops` 按上述原站公开入口独立实现；没有复制 PriceAI 当前 `main` 的采集代码，也没有复制其线上完整渠道表。固定目标白名单由本项目单独登记与维护。

## 新增一个数据源（同类型比价站）

### 站长后台与投稿备份

### 搜索抓取与索引基础

`/robots.txt` 声明站点地图与私有路径限制，保留边缘既有搜索/训练机器人策略；`/sitemap.xml` 从当前真实产品动态生成，仅包含规范公开页，不包含筛选组合、投稿、后台或 API。由于行情观察时间不等于页面实际修改时间，暂不输出可选 `lastmod`，避免虚假更新信号。

公开页有清洁 canonical、描述和与页面类型相符的 JSON-LD；UTM/渠道筛选不另建索引页，报价分页保留规范页码。不存在的产品返回真实 404。源站仅对可信本机 Tunnel 传入的 HTTP 协议标记重定向至固定 HTTPS 主域；不会为 SEO 修改后台鉴权或共享缓存私人内容。

Google Search Console 与百度搜索资源平台仍需真实账号验证和提交。可在服务器配置 `GOOGLE_SITE_VERIFICATION`、`BAIDU_SITE_VERIFICATION` 的官方公开验证值；缺省为空，不伪造验证。技术可索引不等于已收录，也不保证收录时间。`www.airadar.vip` 的 DNS/跳转需另行在域名控制台核实配置。第一方统计要求公开页到达源站，当前保留 `no-store`，不盲目开启 HTML 边缘缓存。

### 第一方访问统计（2026-09-05）

当前使用VPS第一方服务器统计，不依赖Cloudflare付费产品或另一个追踪脚本。后台 `/admin/analytics` 提供7/30天页面访问量、访客估算、区间重新去重、趋势和仅认证可导出的按日CSV；未开始统计的历史显示“未采集”。这不是精准真人PV，也不是实际人数，共享网络可能合并、换IP或浏览器可能重复。

只信任当前本机Tunnel转发的 `CF-Connecting-IP`，不信任任意XFF；缺少可信IP不计。HMAC去标识摘要在线保留31天、按日汇总长期保留，不存原始IP、完整UA、查询参数或表单信息。后台、API、提交页、HEAD、错误页、预取、管理员和已知机器人不计；每标识每分钟最多60次、全站最多600次。统计写入在响应结束后执行，锁等待上限5ms，故障不影响公开页。公开隐私说明：`/privacy`。

统计库固定到 `ANALYTICS_DB_PATH=/opt/linc/apps/price-radar/analytics/analytics.sqlite`，备份到 `ANALYTICS_BACKUP_DIR=/opt/linc/backups/price-radar/analytics`，均不进Git或代码同步删除范围。每日备份同时覆盖投稿与统计库，最多14份，均经过隔离恢复检查。

管理员用户名、scrypt hash与统计HMAC密钥独立存于服务器root所有、0600的 `/etc/price-radar/web.env`，只由Web单元读取；collector的文件系统禁止访问投稿、统计、备份与Web配置。首次配置可在本机运行 `node scripts/provision-admin.mjs <仓库外私密目录绝对路径>`，自动生成强随机口令到本机0600交付文件，仅将hash送往服务器，拒绝覆盖既有配置。不要将该文件提交Git、发送聊天或打印内容。

`/admin` 是独立的站长模块。没有同时配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH` 和 HTTPS `PUBLIC_ORIGIN` 时返回 404；本次实现不会自动创建账号。口令 hash 格式由 `lib/admin.mjs` 的 `hashAdminPassword()` 生成（scrypt，口令至少 16 字符），原口令不得写入仓库、命令行参数或聊天。会话有效期 1 小时，退出或服务重启后失效；状态与内部备注在同一事务中追加操作审计，后台不提供删除投稿、改价、自动上架或对外联系功能。

使用 `node radar.mjs backup-submissions` 执行 SQLite 在线备份，包含已提交的 WAL。`SUBMISSIONS_BACKUP_DIR` 必须是独立绝对路径；生产模板使用 `/opt/linc/backups/price-radar/submissions`，备份文件 0600、目录 0700，默认保留最近 14 份。每份在临时目录恢复并执行 `quick_check` 与表计数，再成为可用备份。此过程不覆盖生产数据库，也不输出投稿正文。`price-radar-backup.timer` 每天 UTC 19:40 左右运行（北京时间次日 03:40），掉线期间错过的任务在恢复后补跑。

这只是本机备份，不能防止整台 VPS 丢失；异地副本还需要单独确定目的地。后台“采集与备份”页面显示最近验证结果，时间过旧也应视为异常。

直采失败时最多使用 24 小时缓存（`direct-shops.max_cache_age_minutes` 可配置），超龄来源退出当轮报价并展示“不可用、不代表售罄”；原始历史保留。持续停机仍需通过后台和日志监控发现，不能把旧快照时间当作实时保证。

渠道筛选与产品品牌独立：16688、链动小铺、登记独立站及未确认渠道。框架标签只写已识别接口类型，不能推导托管或担保。渠道选择会重算当前报价、最低价、总数及趋势，保留分页和返回品牌状态。

`npm run check` 执行语法检查与完整测试；部署脚本要求干净且已提交的版本，先备份投稿和旧代码，再停止本项目服务同步，检查本机与公网 HTTP。失败时恢复旧代码及 web/collector 单元；数据库不做倒退恢复。旧代码归档在 `/opt/linc/backups/price-radar/code-before-<commit>.tar.gz`。首次新版本部署前须确认管理员凭据交付，或保持后台关闭。不要把第一次执行前的脚本审查当成已验证的生产回滚演练。

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

### 已接入源

| 源 | 数据形态 | 更新节奏 | 备注 |
| --- | --- | --- | --- |
| `priceai` | PriceAI 官方公开快照流：45 产品 / 每产品 Top5+ 最低价 offer（含库存、来源店、原站 URL） | 约 5min 一代（指针 ≥1min 轮询） | 官方为脚本/Agent 发布的只读流，见 <https://priceai.cc/price-radar-api.md> |
| `ldxp-goods` | RelayWatch 聚合的**链动小铺(LDXP) 卡网商品**：按关键词定向查询，真实 CNY 价格+库存+店铺 | 受 `min_interval_minutes`（默认 15min）节流 | relaywatch 项目 MIT；只做关键词定向轻量查询，不做全量镜像 |
| `cardnav-official` | CardNav **官方订阅 App Store 区价**：17 产品 × 39-40 地区，本地价+折算 CNY（SSR 表格） | 官方价约每日刷新，默认 12h 拉一次 | 个人非商用低频使用；不镜像全量 |
| `goaihop-relay` | GoAIHop **中转 API 站套餐+可用性**：12 家中转站 × 73 套餐，全 CNY；含实测 success/availability/P50 延迟快照 | 默认 6h 拉一次 | 同域公开 JSON API（见 `docs/goaihop-relay-packages-parsing-spec.md`）；含赞助站已在 extra 标注 |
| `direct-shops` | 固定白名单内原始店铺的公开 JSON/JS/ShopApi 商品目录 | 源级 ≥30min；单目标 30min / 60min / 12h 缓存 | 独立实现；失败可沿用旧缓存并标记 `stale`；展示挂牌价而非最终结算价 |

### 候选源评估结论（未接入的理由）

- **openprice.cc**：产品数据客户端渲染（无 SSR/公开 JSON），需无头浏览器逆向；其源码许可还禁止把线上数据快照用于竞品/商业服务 → 不爬（非商用小站可另议，但技术上仍是 C 级）。
- **relaywatch `/api/models` 全量**：约 1.6 万模型 × 站点倍率、分页极多且慢，整爬过重（只用其 LDXP 商品定向端点）。
- **cardnav `/shops` 商家/商品目录**：表格为客户端渲染（无 SSR），不爬。
- PriceAI 匿名档每产品只给 Top 5 offer + 最低价；任意搜索/全量报价导出不在公开流内。

### 跨源差异提醒

- 各源的产品 id 与商品规格体系不同（priceai 用 `chatgpt-plus-recharge` 等品类 id；ldxp-goods 用关键词 slug 如 `gpt-pro`；direct-shops 只发布可可靠分类的原店条目），跨源对比请自行在业务侧映射，工具不臆断 SKU 等价。
- ldxp-goods 的搜索为商品名 `contains` 匹配，同词可能混入成品号/额度/会员等形态，盯盘阈值请按需收敛关键词。
- 快照含灰产形态报价（成品号/共享/无售后等），仅作情报参考；不据此自动采购、不据此直接上架。
