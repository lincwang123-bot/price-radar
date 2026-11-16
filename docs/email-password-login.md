# 邮箱验证码、可选密码与 Google 登录

用户入口：主导航“登录 / 注册”，登录后显示“我的账号”。浏览和查价不要求登录。

- `/register`、`/login`：默认只填邮箱和验证码，首次验证创建普通账号；已有邮箱复用账号、密码、关注和退订状态，不要求商家联系方式。
- `/login?method=password`：保留原有邮箱 + 密码登录。`/register?method=password` 保留旧密码设置入口。
- 商家入口 `/register?role=merchant` 也先验证邮箱，之后才到 `/account?next=%2Fsubmit-shop` 补手机号和联系账号。`/submit-shop` 的服务端仍强制已登录和完整商家资料，不依赖前端角色字段授权。
- `/reset-password`：邮箱验证码 + 新密码，重置后撤销该账号所有会话，需重新登录。
- `/account`：邮箱、密码设置状态、我的关注、重置密码、退出。普通用户无管理员权限，不自动认领或批准店铺。
- `/following`：游客本机关注保留；登录后用户主动确认导入，不自动合并共享设备的数据。新注册账号的提醒默认关闭。

## 数据与安全

复用私有库的 `retention_accounts` 和 `retention_sessions`。新增 `reader_credentials`、`reader_login_attempts`；`retention_codes` 增加 `purpose` 列（旧记录为 `legacy`）。迁移可重复执行，无需清空或替换现有库。

普通用户密码 8–128 字符（按站长要求降低注册门槛），支持空格和 Unicode，拒绝明显常见及重复字符弱密码。注册、重置及页面提示复用同一长度配置；现有密码保持有效，管理员口令规则不变。较短密码抗猜测能力弱于较长密码，仍建议使用唯一的随机密码或密码管理器。

使用 Node 内置异步 scrypt：N=131072、r=8、p=1、随机 16 字节盐。最多并发两个 KDF，不阻塞 Node 事件循环。密码不出现在 URL、本地存储、API 响应、邮件或日志中。

验证码 10 分钟有效、最多 5 次验证；按邮箱登录/密码设置/密码重置绑定用途。每邮箱/网络每小时合计最多 5 次、同邮箱 60 秒冷却、全站每小时 200 次。不存在账号的重置请求返回相同格式并占用限流额度，但不发送邮件。密码登录不发送验证码。

密码登录：每邮箱 15 分钟最多 10 次尝试、每网络最多 30 次、全站最多 300 次；持久化 HMAC 限流摘要，15 分钟后清除。未知邮箱使用同成本校验并返回统一错误，不提供邮箱查询接口。

登录 Cookie 使用 HttpOnly、SameSite=Lax，生产 HTTPS 下 Secure，30 天到期。登录旋转当前会话与 CSRF，重置撤销全部会话。写接口要求 POST JSON + 同源 Origin + 双提交 CSRF；旧 `/api/retention/verify-code` 返回 410，新验证码登录使用 `/api/retention/email-login`，不能复用旧用途验证码。账号表单无 JavaScript 时禁用，不能降级为带密码的 GET 请求。

账号页面使用 no-store、noindex、no-referrer 与 CSP，不加载第三方统计脚本。站内返回地址仅允许明确的公开业务路径，禁止外部、后台和 API 跳转。

## 邮件与运行

继续使用已配置的 `MERCHANT_SMTP_*` 和 `MERCHANT_MAIL_FROM`，没有新增供应商或密钥。验证码使用 `retention_mail` 独立队列和绿色品牌模板，不占用店铺申请通知次数，不改变商家邮件规则。后台每 15 秒处理队列；“提交发送”不等于收件箱送达。

部署前备份私有库；工作区存在其他修改时只发布经核对的文件。Google 登录新增依赖 `google-auth-library` 和两个独立数据表，不覆盖旧数据。回滚代码时保留数据库，不能用旧备份覆盖上线后新产生的用户记录。

验证：`node --test test/account-auth.test.mjs test/retention.test.mjs`，`npm run check`，隔离库上的桌面/手机浏览器注册、登录、退出、重置、关注导入。测试使用模拟发件，不给真实商户发测试邮件。

参考：[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[认证](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[忘记密码](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)。

## Google 配置

使用 AIradar 专用的 Web OAuth 客户端，不改其他网站的客户端或品牌设置。服务器私密环境中设置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`PUBLIC_ORIGIN=https://airadar.vip`。授权重定向 URI 必须为 `https://airadar.vip/api/retention/google-callback`。未配置时隐藏按钮并拒绝启动授权，不展示无效入口。

仅请求 `openid email`，不申请 Gmail 或联系人权限。采用服务端授权码交换、PKCE S256、state + 浏览器绑定 Cookie、nonce 和官方 SDK 的签名/issuer/audience/时效校验。流程 10 分钟失效且只可消费一次；不保存 access/refresh token。Gmail 或 Google 托管域邮箱才能直接作为已验证邮箱，其他邮箱请用本站验证码登录。

同一已验证邮箱复用普通账号，Google subject 冲突时拒绝登录，不授予管理员权限或自动通过店铺审核。删除账号同时删除 Google 身份映射。

验证：`node --test test/account-auth.test.mjs test/account-simple.test.mjs test/account-google.test.mjs test/account-login-http.test.mjs test/merchant-account.test.mjs`。其中 Google 测试使用隔离签名和模拟交换，不代替完成真实 OAuth 客户端配置后的端到端登录验证。

官方协议说明：[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)、[验证 Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。
