# P0 报价来源与观察历史字段

适配器身份决定来源等级；外部报价携带的 `source_type` 不可信。本轮 `direct-shops` 为 `original_crawl`（原店采集），PriceAI、RelayWatch、CardNav、GoAIHop 均为 `third_party`。没有把原店爬取计为商家主动 API 同步，也没有把转录的官方价计为直取官方来源；当前 `merchant_direct` 为零。

writer `openDb` 幂等新增 `source_type`、`source_url`、`last_updated_at`、`last_verified_at`、`merchant_id`、`recorded_at`。已有 `source_name` 字段对新行记录内部适配器名称，原输入名保留在 `extra.upstreamSourceName`，店名保留在 `store_name`。用户侧只通过中性标签 helper 展示类型，不展示聚合站品牌。

- `merchant_id` 使用规范购买 URL 的 `domain:hostname`，去除 `www.`，不随聚合源中的 ID 改变；它是域名级标识，不是假定已核验的经营主体。聚合站自身域名不冒充商家。
- `recorded_at` 是本地这次观察入库时间。
- `last_verified_at` 是公开数据读取/抓取核验时间，不表示真实购买或履约认证。
- `last_updated_at` 是观察到价格、币种、库存、标题或购买 URL 变化的时间；没有变化沿用上次值。不能据此推断商家实际上在哪一秒改价。
- 不覆盖旧快照。相同价的新观察与 A→B→A 价格回归都持续入库；同 source/snapshot ID 幂等去重。
- 历史库旧行不虚构回填精确价格变更时间。只读连接不迁移，公开投影使用原抓取字段作为兼容后备；只有 writer 执行新增列迁移。

`quoteSourceLabel`、`quoteUpdatedAt`、`quoteVerifiedAt`、`quoteTimeInfo` 为前端接口。相对时间不写“实时”，过期文案为“价格可能已发生变化”。本轮没有商家 API、信用认证、第一方占比 Dashboard 或 P1 功能。
