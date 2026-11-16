# AdSense 申请准备与指南末尾试投

当前默认关闭。网站准备不等于提交申请、审核通过或产生广告收入。没有真实发布商 ID 时，首页不输出验证信息，`/ads.txt` 返回 404；不使用占位 ID 冒充已配置。

## 第一步：只验证网站归属

由站长在 Google AdSense 添加 `airadar.vip`，提供自己的发布商 ID（`pub-` 后 16 位数字），选择 meta tag 验证。Google Ads 是付费推广产品，不是此处使用的 AdSense。

在 web 服务使用的私有环境配置中设置：

```dotenv
ADSENSE_MODE=verify
ADSENSE_PUBLISHER_ID=填写本人真实发布商ID
```

上述中文是填写说明，不是可部署的 ID。也接受账号代码中的 `ca-pub-` 格式。重启 web 后验证：

- 首页 head 的 `google-adsense-account` 与后台一致。
- `/ads.txt` 返回该 ID 对应的 `google.com, pub-…, DIRECT, f08c47fec0942fa0`，不重定向到登录或挑战页。
- 所有页面均无 `adsbygoogle.js`、广告单元和占位留白。
- 首页、指南、关于本站、联系页（`/contact`，公开邮箱 `hello@airadar.vip`）、隐私及数据来源页公开可读；账号、后台仍受保护。
- `/privacy#google-advertising` 在 verify 阶段也应写明：准备接入 / 接入后将展示广告，以及 Cookie、设备标识与退出个性化广告的方式；不要写死「永不启用」。

然后在 AdSense 点击验证和请求审核。审核状态只能以真实后台为准。勿开启自动广告或通过自己、粉丝点击广告“支持网站”。

## 第二步：审核通过后单独开启试投

创建一个响应式展示广告单元，取得真实 slot ID。只在实际存在的 `/guides/…` 文章结束后放一个广告；指南目录、帮助、首页、报价、投稿、账号和错误页均不放 Google 广告。

开启前逐项实测：

1. AdSense 的本站状态已允许投放。
2. 自动广告、自动插入、锚定、全屏及可能自动重新开启格式的优化实验均关闭；站点代码不能替代后台配置。
3. 根据实际访问地区配置隐私消息；涉及 EEA、英国、瑞士的个性化广告，应配置 Google 认证、集成 TCF 的 CMP。可使用 Google 的“隐私权和消息”。确认接受、拒绝以及撤回/修改选择的入口真实可用。
4. 实测 CMP 的请求时序和广告行为，包括需同意地区同意前的处理。非个性化广告也可能使用存储，不应当作绕过同意的开关。
5. `/privacy#google-advertising` 的披露符合实际部署和合作伙伴。代码不会部署 CMP，也不会判断审核状态。

完成以上验证后才设置：

```dotenv
ADSENSE_MODE=guide
ADSENSE_PUBLISHER_ID=填写本人真实发布商ID
ADSENSE_GUIDE_SLOT=填写实际广告单元ID
ADSENSE_PILOT_READY=true
```

`ADSENSE_PILOT_READY` 只记录人工验证已完成，不是 Google 审核或隐私合规的自动检测。缺少该值或有效 slot 时仍只有站点验证，无广告脚本。上线后应另外测试真实广告填充、手机宽度、同意选择及后台数据；本地测试不调用 Google，不验证真实填充。

## 暂停与观察

- 改回 `ADSENSE_MODE=verify` 并重启即可停止广告，同时保留归属验证和 ads.txt。
- `ADSENSE_MODE=off` 停止广告并撤下验证信息及 ads.txt 授权；不要用它作为普通短期暂停方式。
- 原有直接赞助位及商家跳转统计不统计 Google 广告；Google 曝光、收入等以 AdSense 报告为准，不从出站点击推算成交。
- 先观察 14 天的指南页浏览量、AdSense 页面 RPM/收入及真实回访趋势。分母应是广告所在指南页面，不能用全站访问量或 X 推文曝光量替代。不预估保证收入。

## 官方资料

- [网站连接与 meta tag 验证](https://support.google.com/adsense/answer/7584263?hl=en)
- [ads.txt](https://support.google.com/adsense/answer/12171612?hl=en-GB)
- [Google 同意管理要求](https://support.google.com/adsense/answer/13554116?hl=en)
- [自动广告设置](https://support.google.com/adsense/answer/9305577?hl=en)
- [AdSense 计划政策](https://support.google.com/adsense/answer/48182?hl=zh-Hans)
