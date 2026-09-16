# goaihop.com「中转站/套餐」页解析规范（/en/relay-packages）

> 探查时间：2026-09-04 09:5x CST（页面内数据 lastChecked 2026-09-04T01:03Z）。
> 方法：浏览器 UA + `curl --compressed`，每 URL 仅抓一次。原始文件保存在 `_scrape/relay-packages.html`（414,274 B）、`_scrape/relay-packages-desc.html`（验证 sort）、`_scrape/relay-provider-sudo-bug.html`（验证 provider 过滤）、`_scrape/detail-sudo-bug.html`、`_scrape/detail-provider-sudo-bug.html`、`_scrape/providers.html`（1.93 MB）。
> 站点为 Next.js App Router SSR。抓取用 UA：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`。

---

## 0. 结论速览（先看这里）

| 目标 | 手段 | 结果 | 等级 |
|---|---|---|---|
| 取列表页全部 73 个「套餐行」（provider+套餐名+价格+币种+计费+有效期+状态+限购，及各 provider 的 successRate/availability/latency 指标） | **只用可见 DOM 文本/正则** | 只有 12/73（页面明确写 `Showing 12 of 73 packages`） | **C** |
| 同上 | **同一 HTML 里的 `self.__next_f` RSC 数据流**（解码后按对象切） | 73/73 全量对象（含全部指标），单页即可 | **A** |
| 同上 | 同域 JSON API `GET /api/relay-packages`（2 次 GET，offset 0/50） | 73/73，与页面同源同库，最干净 | **A（最推荐）** |
| provider×主流模型×模型级价格/可用性 | relay-packages 任何形式 | 列表页**无模型级价格**，只有“套餐包”级价格 | — |
| 同上 | 逐 provider 抓 `/en/providers/<slug>`（及 `/en/providers/<slug>/models`）或直连其 JSON API | 模型级价目表在 provider 粒度页面 | **B（必须逐页/逐 API）** |

一句话：**“套餐包”级别的全量数据在一个 HTML 内就能拿全（RSC 数据流），不必逐页；但“模型级价格表”不在该页，必须按 provider 逐页抓（或直连其价格 API）。**

---

## 1. 页面结构（决定解析策略）

单个 `/en/relay-packages` HTML ≈ 414 KB，由两部分组成：

1. **静态可见 DOM（≈163 KB，去 script 后）**：筛选条（provider / type / period / sort）→ 卡片瀑布流
   `<div class="mt-5 columns-1 gap-4 md:columns-2 lg:hidden">`（移动/平板布局，12 个 `<article>`）→ 同数据的大屏表格
   `<div class="mt-5 hidden overflow-hidden rounded-lg border border-border bg-background lg:block">`（lg+ 布局，同一 12 行）→
   进度条 `Showing 12 of 73 packages` + `Load more packages` 按钮（点击后客户端从 JSON API 续拉）。
   **两套布局是同一份 12 条数据，勿双计。**
2. **RSC flight 数据流**：`<script>self.__next_f.push([1,"..."])</script>` × 15 段（最大一段 ~197 KB）。
   关键发现：**flight 里序列化了全部 73 个套餐对象**（73 个 `"name":{"en":…}`、73 个 `"priceAmount":"…"`、
   12 家 provider 的 `slug`、73 份 provider metrics），与 `/api/relay-packages` 返回逐字段一致。
   页面只是首屏只“渲染”前 12 条，数据却全部下发（支持客户端无感展开）。

SSR 可见文本是**真实 SSR 输出**（无 skeleton / `--` 占位符；验证过 0 处 `animate-pulse`、0 处占位 dash 数字）。

---

## 2. 最小重复单元与边界正则

### 2.1 可见 DOM 单元（只能拿到 12/73，用于“卡片”级别校验或仅要首屏）

**卡片单元（推荐用它做 DOM 正则，语义最干净）：**

- 起始标记：`<article class="flex min-h-64`（整页恰好 12 处，无嵌套 article）
- 结束标记：`</article>`

可直接复制（JS 风格，`g` 标志整页匹配，得到恰好 12 个单元）：

```js
const cards = html.matchAll(/<article class="flex min-h-64[^>]*>[\s\S]*?<\/article>/g);
```

转义版（若用 `String.raw`/别处粘贴需注意 `\s`、`\d`、`\/`）：原样字符串为

```
/<article class="flex min-h-64[^>]*>[\s\S]*?<\/article>/g
```

**表格行单元（大屏布局，同一 12 条）：**

```js
// 12 个数据行（外加 1 个表头行也是 tr[data-slot=table-row]，需按是否含 td[data-slot=table-cell] 过滤）
const rows = [...html.matchAll(/<tr data-slot="table-row"[^>]*>[\s\S]*?<\/tr>/g)]
  .filter(m => m[0].includes('data-slot="table-cell"'));
```

### 2.2 全量单元：RSC flight 里的对象（73/73，单页拿全）

解码流程（零依赖 Node，可直接照抄）：

```js
// 1) 取出所有 push 段的字符串字面量并逐个 JSON.parse 还原
const segs = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
  .map(m => JSON.parse('"' + m[1] + '"'));      // 已验证每个段都是合法 JSON 字符串字面量
const flight = segs.join('');

// 2) 找到 73 个套餐对象。真实套餐对象的 id 形如 relay-package-<uuid>；
//    其 usageLimits 子项的 id 带 :limit:N 后缀，provider 字段为 { 内联对象 或 "$6:…" 引用两种形态。
//    先用 "provider" 下一字符区分即可（下面给两种通用切法之一）。

// 方法 A（零依赖、稳妥）：按 id 起点 + 花括号配平切对象
function sliceObjects(text, reStart) {
  const out = [];
  for (const m of text.matchAll(reStart)) {
    const s = m.index + m[0].length - 1; // 定位到 '{'
    let depth = 0, i = s, inStr = false, esc = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { if (--depth === 0) break; }
    }
    out.push({ id: m[1], obj: text.slice(s, i + 1) }); // obj 为完整 JSON 对象字面量，可 JSON.parse
  }
  return out;
}
// 73 个套餐对象（含 12 个 provider 是 "$…" 引用的；被引用对象里也有完整 provider，可按 slug 合并）
const pkgs = sliceObjects(flight, /"id":"relay-package-([0-9a-f-]+)","provider":/g);
// 若要拿到内联完整 provider（含 metrics）的对象：用 /"id":"relay-package-([0-9a-f-]+)","provider":\{/g（本次 61/73，其余 12 家从组结构/全量列表取）
```

> 事实核对：本次页面 flight 中 `"name":{"en":` 恰好 73 处、`"priceAmount":"` 73 处、全 12 家 slug；
> `"successRate7d":` 73 处（每套餐一份 provider.metrics）。与 `/api/relay-packages` 两页结果完全同集。
> 若只想要 provider 级指标去重：以 `provider.slug` 为 key，取 metrics 最新一份即可（同页多份值相同）。

**推荐给适配器的首选路径（比 flight 更好切、零风险）：**

```
GET https://goaihop.com/api/relay-packages?sort=price-asc&offset=0&limit=50
GET https://goaihop.com/api/relay-packages?sort=price-asc&offset=50&limit=50
```
响应：`{"data":{"items":[…],"total":73,"offset":0,"limit":50}}`；`limit` 服务端上限 50（本次 total=73 → 两页取完）。
匿名可访问、无需 cookie/鉴权、与 SSR 页面同源同字段。若坚持“只解析页面 HTML 不碰额外接口”，则用 §2.2 的 flight 切法。

---

## 3. 卡片单元内部：字段提取（可见 DOM 版）

一张卡片（`<article>…</article>`，4782 B 完整卡，截断如下）的结构固定为若干语义块。抓取时注意 class 内有多处 `&amp;`、`&#x27;` 实体转义。

```html
<article class="flex min-h-64 flex-col rounded-lg border … p-5">
  <div class="flex items-start justify-between gap-3">                 <!-- 头部：logo+provider+套餐名 | 状态徽章 -->
    <div class="flex min-w-0 items-center gap-3">
      <span …><img data-testid="provider-logo-image" src="https://assets.goaihop.com/relay-logos/…" alt="SudoBug" …/></span>
      <div class="min-w-0">
        <div class="flex flex-wrap …">
          <a class="min-w-0 flex-initial truncate text-xs …" href="/en/relay-packages/sudo-bug">SudoBug</a>
        </div>
        <h2 class="mt-1 line-clamp-2 text-lg font-semibold tracking-[-0.015em]">$5 trial day plan/trip plan</h2>
      </div>
    </div>
    <span data-slot="badge" class="… text-emerald-800 dark:text-emerald-300">Available</span>   <!-- 状态(绿=可用) -->
  </div>
  <div class="mt-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="text-2xl font-semibold tabular-nums">CN¥4.00</p>        <!-- 价格 -->
      <p class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <span>Recurring</span><span aria-hidden="true">·</span><span>Valid for 1 days</span></p>  <!-- 计费+有效期 -->
    </div>
    <span data-slot="badge" class="…">Subscription</span>               <!-- 类型徽章 -->
  </div>
  <div class="mt-4 flex flex-wrap gap-1.5">
    <span data-slot="badge" class="… font-normal">Limit 1 per account</span>   <!-- 购买限制标签（可多个/可无） -->
  </div>
  <div class="mt-5 border-t border-border pt-4">
    <p class="text-sm text-muted-foreground">No structured usage limits have been published.</p> <!-- 限额说明 -->
  </div>
  <div class="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
    <a data-slot="button" class="…" href="/en/relay-packages/sudo-bug">Compare packages<svg …></svg></a>
  </div>
</article>
```

字段提取规则（均在“卡片单元”内执行；`slug` 值示例 `sudo-bug` 等均为小写连字符）：

| 字段 | 定位方式 | 可直接复制的正则（单元内） | 说明 / 样例 |
|---|---|---|---|
| provider slug | provider 顶链 href | `href="\/en\/relay-packages\/([a-z0-9-]+)"` 第一个匹配 | `sudo-bug` |
| provider 显示名 | 顶链内文本 | `<a class="min-w-0 flex-initial truncate text-xs[^"]*"[^>]*>([^<]+)<\/a>` 第一个匹配 | `SudoBug`、`合租巴士`、`绝命毒师`（品牌原名，非语言切换） |
| 套餐名 plan | `<h2>` | `<h2[^>]*>([\s\S]*?)<\/h2>`（再剥标签/实体） | `$5 trial day plan/trip plan` |
| 价格文本 | `<p class="text-2xl font-semibold tabular-nums">` | `<p class="text-2xl font-semibold tabular-nums">([^<]+)<\/p>` | `CN¥4.00`、`CN¥4,980.00`（注意千分位逗号） |
| 币种 | 价格前缀 | 上面价格串内 `(CN¥|US\$|USD|¥|€|\$|CNY)` | 本次全站 73 条均为 `CN¥`；表行内价格可能为 `$5.00` |
| 价格数字 | 同上 | `([\d,]+\.\d{2})` → 去逗号 | `4.00`（flight/JSON 里为 `priceAmount":"4.0000"` 4 位小数，展示层裁 2 位） |
| 状态 availability | 卡片右上第一个 `span[data-slot=badge]` | 取该卡内**第一个** `<span data-slot="badge"[^>]*>\s*(Available|Unavailable|Sold out|Paused|Coming soon)\s*<\/span>` | 绿字 `Available`（= JSON status `active`）；本次 73 条全 active |
| 计费方式 | 价格下方 meta 首 span | meta `<p class="mt-1 flex[^"]*">([\s\S]*?)<\/p>` 剥标签后首段 | `Recurring`（= JSON `billingMode":"recurring"`；可另见 One-time 形态） |
| 有效期 | meta 文本 | 剥标签后 `/Valid for (\d+) (day|month|year)s?/i` | `Valid for 1 days`（原文 1 也不加 s，照录即可） |
| 类型 type | 价格行右侧徽章 | 卡内第 2 个 `<span data-slot="badge"[^>]*>([^<]+)<\/span>` | `Subscription`（JSON `type`；全值见 §4） |
| 购买限制 | 标签行 | `<div class="mt-4 flex flex-wrap gap-1\.5">([\s\S]*?)<\/div>` 内所有 `span[data-slot=badge]` 文本 | `Limit 1 per account`（可多个/可无） |
| 限额说明 | 分隔线段落 | `<div class="mt-5 border-t border-border pt-4"><p class="text-sm text-muted-foreground">([^<]+)<\/p><\/div>` | `No structured usage limits have been published.` |
| 详情链接 | CTA | `<a data-slot="button"[^>]*href="(\/en\/relay-packages\/[a-z0-9-]+)"[^>]*>Compare packages` | `/en/relay-packages/sudo-bug` |

注意：
- 若正则跨多个字段建议一次 match 后用上述子表达式；多个 card 时用 §2.1 的 matchAll 外层循环，字段正则全部在该单元串内做。
- 卡片与表格两套布局内容相同，**任选一套**，别两套都算。
- 抓取后如需指标（success rate / latency / uptime），**卡片 DOM 文本里没有**——请走 §2.2 flight 的 `provider.metrics` 或 JSON API。

---

## 4. 过滤/排序参数与单元数量

- 每页 SSR 单元数：`min(12, 命中总数)`。文案格式 `Showing {shown} of {total} packages`（本次默认页 `Showing 12 of 73 packages`；`total` 随过滤变化）。
- 默认排序 = 价格升序。已验证：无 query 的 SSR 首 12 条与 `?sort=price-asc` 及 JSON `sort=price-asc` 前 12 完全一致。
- `?sort=price-desc` 已验证 SSR 生效（首条 `CN¥4,980.00`）。
- 可用参数（取自筛选条真实链接 + 页面 JS 常量表，均已抓包验证）：

```
/en/relay-packages
  ?sort=price-asc | price-desc          # 仅此两个排序值（无 name/rating 排序）
  &provider=<slug>                      # 本次 12 家：code-proxy sudo-bug lv-ping i-code-easy
                                        #   fish-x-code daw-code hezu-ink 78-code codego
                                        #   sss-ai-code jmds-api saierdachuanshuo
  &type=subscription|recharge|token-pack|custom   # 常量表 RELAY_PACKAGE_TYPES；本次全为 subscription
  &period=1-day|1-week|1-month|6-month  # 筛选“有效期长度”
```

- provider 过滤页：`?provider=sudo-bug&sort=price-asc` SSR 返回该 provider 全部 9 个套餐（无 “Showing” 文案 =
  已全部展示）。**当前 12 家每家套餐数都 ≤ 10，因此纯 HTML 兜底方案 = 12 次 provider 过滤请求即可拿全 73**
  （若未来某家 > 12 条则同样会截断，需回到 JSON API 翻页）。
- JSON API 同参：`/api/relay-packages?provider=&type=&period=&sort=&offset=&limit=`，`limit` ≤ 50。

---

## 5. SSR 真实性判定（占位符 vs 真实数字）

**结论：无客户端占位符骗局。凡 SSR 里出现的数字/文本都是服务端真实数据；但“哪些指标出现在该页”要分清三层：**

1. **卡片/表格可见文本** —— 全部 SSR 真实：价格 `CN¥4.00`/`CN¥4,980.00`（与 JSON `priceAmount:"4.0000"`、`"4980.0000"` 一致）、
   `Recurring`、`Valid for 1 days`、徽章 `Available`（对应 `status:"active"`）、`Limit 1 per account` 等。
   实测 DOM 内 **0 处** skeleton / `animate-pulse` / `--` 数值占位。
2. **该页 DOM 文本中不存在** success rate / latency / uptime 的百分比或毫秒数字 —— 这些指标只出现在
   RSC flight 的 `provider.metrics` 对象里（同样是 SSR 下发的真实数字，非占位）。样例（SudoBug，flight 原文，
   与 JSON API 同值）：
   ```json
   "metrics":{"sampleCount":109,"lastCheckedAt":"2026-09-04T01:03:03.617Z","successRate7d":100,
   "availability7d":100,"recentStatuses":["operational",…×12],"testedModelCount":4,
   "totalLatencyP50Ms":1856,"totalLatencyP95Ms":4007,"compatibilityScore":100,
   "lastCheckedMinutes":38,"firstTokenLatencyMs":1949,"availabilityEvidence":{…} }
   ```
   指标取值本身是“最近一次测量”（lastCheckedMinutes 等会变），是**快照**而非实时；不要指望与当下毫秒级一致。
3. **客户端再填充的部分**：`Load more packages` 后续批、图表放大、价格走势等，触发后由浏览器再调 §2.2 的
   JSON API —— 数据源仍是同一后端，只是不在首屏 HTML 里（但 flight 已把 73 条全量下发，见 §2.2）。

佐证样例（页面原始文字）：
- `Showing 12 of 73 packages`（证明可见 DOM 只有 12，总数 73）
- flight 内 `"name":{"en":` × 73、`"priceAmount":"` × 73、`"slug":` × 73（证明数据流是全量）
- 价格大字 `CN¥4.00` 与 JSON `"priceAmount":"4.0000","currency":"CNY"` 一一对应。

---

## 6. 样本数据（3 行，来自 JSON API = 与 HTML flight 同源）

| provider (slug) | 套餐名 name.en | name.zh-CN | 价格 | 计费/有效期 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| sudo-bug | $5 trial day plan/trip plan | 5刀体验日卡/次卡 | CNY 4.00（CN¥4.00） | recurring / 1 day | active | featured=true；metrics：availability7d 100、totalLatencyP50 1856ms、sampleCount 109 |
| jmds-api（绝命毒师） | Limited-time trial package for newcomers | 新人限时体验套餐 | CNY 9.90 | recurring / 1 month | active | 卡名显示品牌原名“绝命毒师” |
| code-proxy | Codex-Claude-Mix-Ultra | — | CNY 4,980.00（当前最贵） | recurring / 1 month | active | 价格含千分位，注意去逗号 |

JSON API 单条结构（字段名即解析键，比 DOM 正则稳定得多）：

```json
{"id":"relay-package-d26ab826-…","provider":{"slug":"sudo-bug","name":"SudoBug","logoUrl":"…",
 "status":"verified","sponsored":true,"certified":false,"metrics":{…上文 metrics…}},
 "name":{"en":"$5 trial day plan/trip plan","zh-CN":"5刀体验日卡/次卡"},
 "description":{"zh-CN":"…"},"type":"subscription","status":"active",
 "priceAmount":"4.0000","currency":"CNY","billingMode":"recurring",
 "validityValue":1,"validityUnit":"day","purchaseLimit":1,"scopeType":"all",
 "groupIds":[],"modelIds":[],"rawRuleText":{"zh-CN":"有效期: 1 天\n总额度: $5\n限购: 1"},
 "structuredStatus":"partial","featured":true,"usageLimits":[…]}
```

---

## 7. 详情页与“模型级价格”覆盖评估（问题 4）

- `/en/relay-packages/<slug>`（套餐对比页，本次抽查 `sudo-bug`，191 KB）：SSR 输出该 provider 的**套餐对比大表**，
  “一列=一个套餐”，页头写明 `9 packages`。仍是**包级**（每列是套餐的价格/额度/有效期矩阵），**无模型级价格**。
- `/en/providers/<slug>`（provider 详情，抽查 `sudo-bug`，339 KB）：SSR 含：measured 指标总览（availability 7d、
  延迟百分位等真实数字）、**Tested model prices 区**（模型组 × 模型 × 协议 × 分层价，例：`GPT-5.6 Sol / OpenAI Chat Completions /
  ≤272K tokens: Input ¥1 · Output ¥6 · Cache read ¥0.1 · Cache write ¥1.25`，带 ×倍率与价格走势），完整价目表另在
  `/en/providers/sudo-bug/models`（页内文案：`View complete price catalog (69 offers)`）。
- 因此要覆盖「每家中转站 × 主流模型 × 价/可用性」：
  - relay-packages 单页**无论如何都不够**（无模型价）→ 必须按 provider 粒度抓；
  - 建议组合：`/api/relay-packages`（2 GET，拿套餐与 provider 级指标）＋ 每家 provider 的模型价目
    （`/api/providers/{slug}/price-catalog?search=&group=&billing=&participation=&offset=&limit=` 或
    `/api/providers/{slug}/model-rankings` 等公开 JSON 端点；抓包来自页面自用 JS 常量，匿名可用，先小样本验证）；
  - sitemap 出现大量 `/en/providers/<slug>`、`/en/relay-packages/<slug>` 是**模型价/测量明细只放在 provider 页**所致，
    不等于套餐列表也要逐页抓。
- /en/providers 目录页（1.93 MB）：SSR 一次含全部 53 家 provider 的排行表行
  （`<article data-testid="relay-row-<slug>" …>`，53 行去重），可见指标为**真实 SSR 数字**（例：`1598 ms`、`100.00%`、
  aria `Availability rate in the past 7 days: 100.00%`），无需翻页；适合做 provider 清单/指标的兜底来源。

---

## 8. 可行性等级总评（按你的 A/B/C 定义）

- **A（单页可完整提取）——成立，但要用对“单页里的哪一层”**：解析 RSC flight（§2.2）或同域 JSON API（§2.2 末）：
  73/73 套餐行 + provider 级 successRate/availability/latency/compatibility 全套指标，一次页面抓取或两次 GET 全齐。
- **B（需多页）**：若坚持“只解析可见 DOM 文本”，12/73 → 不够，需每 provider 1 页共 12 次（每 provider ≤ 12 条时可行）＝ B；
  若要“模型级价格表”，列表页给不了，按 provider 逐页（约 12–53 页）＝ B。
- **C（不建议）**：只抓 `/en/relay-packages` 一个 HTML 然后**只数可见 `<article>`/`<tr>`** —— 只能得 12/73，别这么干。

## 9. 给适配器的落地清单

1. 首选：`GET /api/relay-packages?sort=price-asc&offset=0&limit=50` + `offset=50`（共 2 请求，73 条）。
2. 若必须纯 HTML：抓默认页 → §2.2 解码 flight → 花括号配平切 73 对象 → 若某对象的 `provider` 是 `"$…"` 引用，
   用同页 provider 组对象按 slug 补 metrics。
3. 模型价目标：对需要的 provider 调 `/api/providers/{slug}/price-catalog`（先验证），或抓 `/en/providers/<slug>`。
4. 频率与风控：全站数据低频小样本抓取即可；以上均为公开 GET、无鉴权；页面带 Cloudflare，记得带浏览器 UA 与 `--compressed`。
