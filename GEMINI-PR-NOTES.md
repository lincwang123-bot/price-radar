# Gemini 双维分类与有依据同款折叠

## 改动

- 仅 `gemini-*` 目录产品使用独立交付方式、订阅资格；交付包含家庭组邀请。缺少依据、时间或存在冲突的维度为「待核验」，不从标题、价格、另一维度或采集字段推断。
- 报价页增加独立筛选、依据/核验时间展示、分类纠错与误折叠反馈（复用 `/submit?type=feedback`）。旧数据默认两维待核验。
- 同款需两维均确认、人工核验套餐及期限匹配、现有完整规格一致，并有同一上游来源+商品 ID、供应商+SKU 对接记录或可交叉核验的商家同源确认。证据缺失、冲突、暂停/拆组不折叠；筛选隐藏冲突成员也不会恢复折叠。
- 原排序代码不变；`directoryQuotes().entries` 保留全部报价，Gemini 每条增加 `originalPosition`；`displayRows` 只聚合展示，提供首条原位置、完整成员和店铺数。聚合在分页前完成，每页最多 10 个展示组；原生 `<details>` 无需 JS，展开保留每条完整报价、分类、核验状态和店铺链接。
- `config/gemini-reviews.json` 初始为空。只信任人工维护的核验账本，不信任采集响应中的同名字段。记录包含成员主键、独立分类、证据与时间、同源身份、操作者及原因；追加修订保留旧记录，最后一条为当前状态。
- 未修改商家采集/入驻文件、自然排序、其他品牌分类、商家数据、生产配置；无返佣/金币功能。

## 人工核验入口与回填

本 PR 提供本地操作工具，不新增生产管理 HTTP 写接口。核验人员查证公开 SKU 与对接凭据后，准备 JSON，运行：

```sh
node scripts/gemini-review.mjs /tmp/review.json
```

工具校验并追加记录；检查 diff 后单独提交审批。每次提交完整替代记录（不是字段补丁）；不要删除历史记录。`key` 是 JSON 字符串 `[source, product_id, offer_id]`，须与数据库的实际身份完全一致；`productKey` 是归属的 Gemini 目录 key（包括期限拆分后的目录）。多个报价各自记录相同可核验来源身份才可聚合，不是按标题绑定。

示例（虚构标识，不是实际核验结果）：

```json
{
  "key": "[\"direct-shops\",\"gemini-pro-recharge\",\"example-offer-id\"]",
  "productKey": "gemini-pro",
  "actor": "reviewer",
  "reason": "公开 SKU 与上游对接记录交叉核验",
  "recordedAt": "2026-11-08T00:00:00Z",
  "delivery": {"kind":"account","status":"confirmed","basis":"公开 SKU 明确交付独享成品账号","verifiedAt":"2026-11-08T00:00:00Z"},
  "eligibility": {"kind":"paid","status":"confirmed","basis":"供应商确认普通付费订阅并核对凭据","verifiedAt":"2026-11-08T00:00:00Z"},
  "plan": "Google AI Pro",
  "term": "1m",
  "sameSource": {
    "type":"upstream","status":"confirmed","sourceId":"supplier-id","goodsId":"upstream-product-id",
    "basis":"对接记录与上游公开商品交叉核验",
    "reference":"可复核的公开记录编号或链接",
    "verifiedAt":"2026-11-08T00:00:00Z"
  }
}
```

其他依据：`type=integration` 使用 `supplierId` 和 `sku`；`type=merchant` 使用 `sourceId` 和 `crossCheckId`，`basis/reference` 必须记录商家同源确认及交叉核验凭据。单纯使用相同对接系统不构成依据。所有类别都必须有核验时间、依据和复核引用。只存允许公开的摘要和引用，不放账号、密码、卡密或私密记录原文。

独立分类状态：`confirmed / unknown / conflict`；未知可省略该维度，但不可因此推断另一维度。同源状态：`confirmed / paused / split`；暂停/拆组时复制完整原记录（包括来源身份），修改状态并填写操作者、原因、新时间后追加，保留所有报价。修正后再追加经查证的完整确认记录。

上线前需站长审阅字段及人工操作方式；没有实际核验材料，本 PR 不做猜测回填。账本需随代码发布并重启/清理页面缓存，确认页面与分类同步；本分支未部署。若商品 ID 被复用、套餐/期限发生变化，需重新查证并追加修订。

## 验证

- 定向：`node --test --test-isolation=none test/gemini-eligibility.test.mjs test/gemini-directory-web.test.mjs test/product-directory.test.mjs test/directory-delivery.test.mjs`，34 项全通过。新增 9 项覆盖独立待核验、无证据不折叠、三类硬证据、冲突/暂停/拆组、套餐期限保护、展开成员与链接、原顺序、非 Gemini 隔离、实际网页筛选与分页。网页测试直接触发真实 HTTP request handler，无需监听端口。
- `npm run check` 语法检查通过；全量测试未绿：208 个测试文件中 123 通过、85 失败。在 `/tmp/gemini-baseline-b4b056f` 对基线 `b4b056f` 使用相同依赖运行同一检查：206 个文件中 121 通过、85 失败，失败文件集合完全一致，没有新增失败。大量既有 HTTP 测试受沙箱禁止本地监听影响（`listen EPERM 127.0.0.1`），另有既有 `mac-backup` 加密归档校验失败。本 PR 不修改无关测试或绕过检查；需要允许监听的环境复跑后才可认定全绿。
- 日志：`/tmp/gemini-final-check.log`、`/tmp/gemini-baseline-check.log`、`/tmp/gemini-targeted.log`。
- `git diff --check` 通过。未修改 `lib/merchant-onboarding.mjs` 或 `lib/merchant-collection.mjs`。

当前环境复用 `/workspace/price-radar-live/node_modules`（本地忽略的符号链接），未安装或下载依赖。


## 交付环境限制

分支仍为 `feat/gemini-delivery-eligibility`，HEAD 为基线 `b4b056f`。本工作树的 Git 管理目录实际位于 `/workspace/price-radar-live/.git/worktrees/wt-gemini`，沙箱只读。尝试 `git add` 报 `Unable to create .../index.lock: Read-only file system`，因此无法暂存或提交。没有 push、开 PR、合并、部署或发送消息。代码及说明保留在工作树；`CODEX-TASK.md`、`GEMINI-PLAN.md` 是原有未跟踪输入，没有改动。

解除 Git 写权限限制后，应仅暂存本任务的 9 个改动文件并提交，例如 `feat: classify Gemini delivery and eligibility with evidence-based grouping`；不要误提交上述两个输入文件。完整任务补丁将保存在 `/tmp/gemini-delivery-eligibility.patch`，便于移交。
