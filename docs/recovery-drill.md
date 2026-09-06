# 2026-09-06 恢复与回滚演练

## 真实 Mac 加密数据恢复

使用现有真实档案 `airadar-20260906T035452470Z-c0ae6f3bd8b5.enc`，在 Mac 新建的 `mkdtemp` 私有目录中完成解密、独立恢复和 SQLite 校验。档案生成时间为 `2026-09-06T03:54:54.827Z`。

| 数据库 | 恢复文件字节数 | 校验 |
| --- | ---: | --- |
| 行情 radar.sqlite | 69,500,928 | AES-256-GCM 鉴别、清单 SHA-256、SQLite quick_check 通过 |
| 投稿 submissions.sqlite | 57,344 | 同上 |
| 统计 analytics.sqlite | 1,363,968 | 同上 |

没有查询投稿正文、联系人、原始访客信息，也没有打印密钥。恢复未覆盖线上或本地现用数据库，没有停止生产服务。完成后删除整棵演练目录，并确认目录不存在。

这证明该份数据档案可以恢复为可读取的 SQLite 文件；不证明服务器操作系统、环境配置、管理员凭据、Tunnel、DNS 或完整服务重建已演练。三个数据库分别保证在线一致性，不保证跨数据库同一瞬间的原子快照。

## 部署失败的隔离回滚

执行 `test/deploy-drill.test.mjs`：读取当前真实 `deploy/deploy.sh`，仅将应用和备份根路径替换为新建的临时 fixture 目录。保留真实部署流程、EXIT trap、代码恢复脚本和单元恢复脚本。真实 tar 和 rsync 在临时目录间运行；SSH、sudo、systemctl、HTTP 检查通过本地适配器模拟，绝不连接生产或操作本机真实服务。

覆盖两条失败路径：

1. rsync 已传输新代码后返回失败；实际部署 EXIT trap 执行回滚。
2. 服务安装和重启模拟完成后，HTTP smoke 检查失败；实际部署 EXIT trap 执行回滚。

两种路径均验证：

- 旧代码按内容恢复，新增代码文件消失。
- web、collector、backup.service、backup.timer、named-tunnel 共五个单元的原始文件、enabled/disabled 和 active/inactive 状态恢复。
- 行情、投稿、统计三个独立 fixture SQLite 在新版本同步后写入的值仍保留，回滚后 quick_check 通过；数据库没有跟随代码倒退。
- `.env`、`config.json`、`backups/`、`.git/` 保留。
- 部署仍返回失败退出码，而不是把回滚成功冒充新版本部署成功。

`test/deploy-rollback.test.mjs` 另覆盖恢复命令故障明确返回非零。所有测试结束后删除本轮创建的应用、单元和远端临时目录。

本次没有故意使线上健康检查失败，没有验证真实 systemd、网络中断或真实生产停机恢复；它是当前部署脚本控制流与文件恢复行为的隔离演练，不应描述为生产事故回滚实测。

## 回执边界

`test/offsite-receipt.test.mjs` 验证：固定文件名、仅白名单字段、0600 文件、无回执/近期/过期/无效状态；文件和目录符号链接拒绝；较旧回执不得覆盖较新确认；SSH fixture 超时被终止并等待退出。Mac 上传失败保留本地成功档案的行为由 `test/mac-backup.test.mjs` 覆盖。

回执是经过既有 SSH 认证通道上传的 Mac 校验声明，不包含档案内容或密钥，也不代表服务端此刻可以访问 Mac 文件，更不代表整机灾难恢复已完成。

运行命令：

```sh
node --test test/deploy-drill.test.mjs test/deploy-rollback.test.mjs test/offsite-receipt.test.mjs
node --test test/mac-backup.test.mjs
```
