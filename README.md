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

`direct-shops` 是本项目独立实现的原始店铺公开目录采集器，与 `priceai` 的 Top 5 公开快照是两个独立数据源：分别拉取、缓存并生成快照。直采目标不从 PriceAI 的 Top 5 或线上渠道表导入，PriceAI 也不作为直采失败时的回退；跨源商品仍须由业务侧确认是否等价。

首批来源是代码内固定登记的公开 HTTPS 入口：

| 目标 id | 店铺/目录 | 类型与公开入口 | 单目标缓存周期 |
| --- | --- | --- | --- |
| `aisou` | AI搜 | Kami：`aisou.pro/user/api/index/commodity` | 30min |
| `ikunlove` | IkunLove | IkunLove JSON：`ikunlove.best/api/shop/products` | 30min |
| `mooncake` | Mooncake | Mooncake JS 目录：`fk1.ybkjs.top/mooncake-official-media/catalog.js` | 12h |
| `wzyp-harvey`、`wzyp-paimon`、`wzyp-ai-choice`、`wzyp-direct`、`wzyp-lightyear` | 派大星、派蒙AI、AI优选站、GPTplus直营、光年AI | ShopApi：固定登记的 `wzyp.cn` 店铺，读取 `/shopApi/Shop/categoryList` 与 `/shopApi/Shop/goodsList` | 60min |

采集边界与失败语义：

- 只请求固定白名单内无需登录即可读取的公开商品目录；不提交账号凭据，不绕过登录、验证码或 WAF，不把采集器当通用代理。ShopApi 路径中的店铺 token 是公开店铺标识，不是登录凭据。
- 源级最短请求间隔默认 30min；单目标另按上表复用缓存，分页请求默认间隔 500ms，并限制页数/分类数。即使 daemon 运行更频繁，也不会据此提高原站请求频率。
- 每个目标成功后原子更新本地缓存。某目标首次采集失败且没有可用缓存时，整轮 `direct-shops` 不发布不完整快照；已有缓存时沿用该目标上次的完整结果，并把汇总快照标记为 `stale: true`。请求失败不等同于商品下架或无货。
- 只发布能可靠归入本项目商品分类的条目；无法确认分类的商品保留在采集统计中，但不进入报价快照。

页面展示的是原站公开商品列表中的**挂牌价**，不等同于最终结算价。优惠券、支付渠道、手续费、汇率、购买数量/规格和结账页变动都可能改变实付金额；ShopApi 采集器也不调用结算询价接口。购买前必须回到原店铺核对商品说明与最终应付金额。

### 与 PriceAI 的许可证边界

PriceAI 官方仓库当前 `main` 使用 [PriceAI Source Available License 1.0](https://github.com/dimthink/PriceAI/blob/main/LICENSE)：这是带用途限制的 source-available 许可，不是 OSI 认可的开源许可证，未经另行许可不能据此开展其许可证禁止的商用、公开托管或竞争性价格聚合等用途。历史 MIT 许可只适用于当时仍以 MIT 授权的旧提交，例如最后一个 MIT 快照 [`15877f09052e3c272b93679f56b99efd2be3c3d2`](https://github.com/dimthink/PriceAI/tree/15877f09052e3c272b93679f56b99efd2be3c3d2)，不能倒推覆盖之后的 `main` 代码。

本项目的 `direct-shops` 按上述原站公开入口独立实现；没有复制 PriceAI 当前 `main` 的采集代码，也没有复制其线上完整渠道表。固定目标白名单由本项目单独登记与维护。

## 新增一个数据源（同类型比价站）

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

生产环境默认使用 Cloudflare **Named Tunnel**。服务三件套（见 `deploy/`）为：`price-radar-collect`（常驻采集+盯盘）、`price-radar-web`（只读 Web，绑 `127.0.0.1:18090`）和 `price-radar-named-tunnel`（稳定的公网入口）。

Named Tunnel 的配置必须仅保存在 VPS：`/etc/price-radar/cloudflared/config.yml` 与仅限该 Tunnel 的 `/etc/price-radar/cloudflared/credentials.json`。后者应为 `root:root`、`0600`，由 systemd `LoadCredential=` 只在运行时交给服务；两者都不可提交到 Git、README、聊天记录或截图。

```sh
bash deploy/deploy.sh   # 本地执行：rsync 代码 → 装 systemd → 启动三服务
```

- 脚本只有在 VPS 同时具备上述 `config.yml` 和 `credentials.json` 时才会启用 Named Tunnel；其健康状态确认后，脚本只会停用本项目旧的 `price-radar-tunnel.service`，不会影响主机上的其他 `cloudflared` 服务。
- `.env` 仅用于部署环境变量，已被 Git 忽略；当前 Web 页面不内置访问口令校验，如需限制访问应在反向代理或 WAF 层配置。
- **Quick Tunnel 仅作本地验证或首次临时回退**：若尚未配置 Named Tunnel 的两个 VPS 文件，脚本才会使用 `price-radar-tunnel.service`，其 `trycloudflare.com` 地址会随重启改变，不应用作正式域名入口。

### 可选：独立访客统计

Web 页面支持 Cloudflare Web Analytics，用于统计页面访问和独立访客。请在 Cloudflare 创建该站点的 **Web Analytics site token** 后，仅在 VPS 的 `/opt/linc/apps/price-radar/.env` 写入：

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
