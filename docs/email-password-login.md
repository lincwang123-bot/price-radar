# 邮箱与密码登录

用户入口：主导航“登录 / 注册”，登录后显示“我的账号”。浏览和查价不要求登录。

- `/register`：邮箱验证码 + 必填密码 + 确认密码。已有无密码邮箱账号设置密码时保留原 ID、关注、退订状态。
- `/login`：邮箱 + 密码；不提供仅验证码登录。
- `/reset-password`：邮箱验证码 + 新密码，重置后撤销该账号所有会话，需重新登录。
- `/account`：邮箱、密码设置状态、我的关注、重置密码、退出。普通用户无管理员权限，不自动认领或批准店铺。
- `/following`：游客本机关注保留；登录后用户主动确认导入，不自动合并共享设备的数据。新注册账号的提醒默认关闭。

## 数据与安全

复用私有库的 `retention_accounts` 和 `retention_sessions`。新增 `reader_credentials`、`reader_login_attempts`；`retention_codes` 增加 `purpose` 列（旧记录为 `legacy`）。迁移可重复执行，无需清空或替换现有库。

密码 15–128 字符，支持空格和 Unicode，使用 Node 内置异步 scrypt：N=131072、r=8、p=1、随机 16 字节盐。最多并发两个 KDF，不阻塞 Node 事件循环。密码不出现在 URL、本地存储、API 响应、邮件或日志中。

验证码 10 分钟有效、最多 5 次验证；按注册/重置绑定用途。每邮箱/网络每小时合计最多 5 次、同邮箱 60 秒冷却、全站每小时 200 次。不存在账号的重置请求返回相同格式并占用限流额度，但不发送邮件。正常登录不发送验证码。

密码登录：每邮箱 15 分钟最多 10 次尝试、每网络最多 30 次、全站最多 300 次；持久化 HMAC 限流摘要，15 分钟后清除。未知邮箱使用同成本校验并返回统一错误，不提供邮箱查询接口。

登录 Cookie 使用 HttpOnly、SameSite=Lax，生产 HTTPS 下 Secure，30 天到期。登录旋转当前会话与 CSRF，重置撤销全部会话。写接口要求 POST JSON + 同源 Origin + 双提交 CSRF；旧 `/api/retention/verify-code` 返回 410，不能绕过密码要求。账号表单无 JavaScript 时禁用，不能降级为带密码的 GET 请求。

账号页面使用 no-store、noindex、no-referrer 与 CSP，不加载第三方统计脚本。站内返回地址仅允许明确的公开业务路径，禁止外部、后台和 API 跳转。

## 邮件与运行

继续使用已配置的 `MERCHANT_SMTP_*` 和 `MERCHANT_MAIL_FROM`，没有新增供应商或密钥。验证码使用 `retention_mail` 独立队列和绿色品牌模板，不占用店铺申请通知次数，不改变商家邮件规则。后台每 15 秒处理队列；“提交发送”不等于收件箱送达。

部署前备份私有库，随后正常执行 `deploy/deploy.sh`。旧程序回滚会恢复旧无密码接口，安全上不应把回滚当作长期运行方案。出现问题优先修复或临时关闭账号入口。

验证：`node --test test/account-auth.test.mjs test/retention.test.mjs`，`npm run check`，隔离库上的桌面/手机浏览器注册、登录、退出、重置、关注导入。测试使用模拟发件，不给真实商户发测试邮件。

参考：[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[认证](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[忘记密码](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)。
