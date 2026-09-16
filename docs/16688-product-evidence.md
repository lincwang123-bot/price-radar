# 16688 商品分类与在售状态

2026-09-09 核对 `https://www.16688.com.cn/shop/S230844` 的公开页面及只读接口：

- `/shopApi/goods/list` 返回商品分类编号 `goods_category_no`，不一定返回分类名称。标题可能只有 Plus、Pro 5x、Pro 20x。
- 公开脚本 `goods_category.c8e49db6.js` 使用 POST `/shopApi/goodsCategory/list`，参数为同一店铺的 `shop_no`，响应 `data[]` 包含分类编号和名称。只有缺少品牌且有分类编号时才补读一次，不枚举分类或店铺。
- `S230844` 的 `C127803` 对应 `GPT`。按编号关联分类，不从店铺主营介绍、价格、图片或其他商品推断品牌；保留原商品标题。分类证据随单个商品存入 `extra.deliveryEvidence`，存储后仍可用于识别。
- `GoodsPurchasePanel.6f72043f.js` 对 `delivery_method=2` 的人工发货商品不展示数量选择，只有 `stock_available_status=out` 才因售罄禁用购买。实际 Pro 商品为数量 `-1`、状态空；按可购买处理，具体库存仍为 `null`。零库存、明确售罄以及其他负值保留原过滤规则。
- 商品有订阅质保，同时解释封号原因并声明封号无售后，不能等同于整件商品无售后。只移除有明确封号范围的免责子句；另行声明整件商品无售后、无质保时仍排除。

公开脚本基址：`https://16688.oss-accelerate.aliyuncs.com/assets/shop/20260907-013654/assets/`。核查只读目录和脚本，没有提交订单、试购或使用登录凭据。

此修复用于所有 16688 已登记、已批准或明确发起接入测试的店铺，不新增固定店铺白名单，也不改变审核状态。
