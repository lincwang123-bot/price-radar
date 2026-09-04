# price-radar —— 多源 AI 订阅/API 比价雷达（个人整合站）

把「AI 订阅 / 中转 API / 卡网渠道」这类**比价聚合站**（如 PriceAI、OpenPrice 等）当作数据源，
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
- **合规**：只消费各站公开/页面数据；频率克制（PriceAI 官方要求指针 ≥1min/次）。
  报价仅作情报，不自动认定 SKU 等价、不自动采购、不据此直接上架。

## 快速开始

内置默认配置即可直接运行（priceai + ldxp-goods 双源、一组示例盯盘规则）。要改关键词/规则/通知，复制 `config.example.json` → `config.json` 再改（写 null/缺省即用内置默认）。

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

## 部署到 VPS（给身边人访问）

服务三件套（见 `deploy/`）：`price-radar-collect`（常驻采集+盯盘）、`price-radar-web`（只读 Web，绑 127.0.0.1:18090）、`price-radar-tunnel`（Cloudflare Quick Tunnel 公网入口）。

```sh
bash deploy/deploy.sh   # 本地执行：rsync 代码 → 装 systemd → 启动三服务
```

- `.env` 仅用于部署环境变量，已被 Git 忽略；当前 Web 页面不内置访问口令校验，如需限制访问应在反向代理或 WAF 层配置。
- 当前公网地址（Quick Tunnel 重启会变）：

```sh
ssh <ssh-host> "sudo journalctl -u price-radar-tunnel --no-pager -n 60 | grep -oE 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -1"
```

- 正式长期入口建议后续换 Cloudflare Named Tunnel（同 16688-ops 的做法），Quick Tunnel 只适合亲友小范围。

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

### 候选源评估结论（未接入的理由）

- **openprice.cc**：产品数据客户端渲染（无 SSR/公开 JSON），需无头浏览器逆向；其源码许可还禁止把线上数据快照用于竞品/商业服务 → 不爬（非商用小站可另议，但技术上仍是 C 级）。
- **relaywatch `/api/models` 全量**：约 1.6 万模型 × 站点倍率、分页极多且慢，整爬过重（只用其 LDXP 商品定向端点）。
- **cardnav `/shops` 商家/商品目录**：表格为客户端渲染（无 SSR），不爬。
- PriceAI 匿名档每产品只给 Top 5 offer + 最低价；任意搜索/全量报价导出不在公开流内。

### 跨源差异提醒

- 两源的产品 id 体系不同（priceai 用 `chatgpt-plus-recharge` 等品类 id；ldxp-goods 用关键词 slug 如 `gpt-pro`），跨源对比请自行在业务侧映射，工具不臆断 SKU 等价。
- ldxp-goods 的搜索为商品名 `contains` 匹配，同词可能混入成品号/额度/会员等形态，盯盘阈值请按需收敛关键词。
- 快照含灰产形态报价（成品号/共享/无售后等），仅作情报参考；不据此自动采购、不据此直接上架。
