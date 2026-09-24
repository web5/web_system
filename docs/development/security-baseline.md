# 安全门禁基线（Security Baseline）

> **定位**：web_system 发布与运行涉及的访问控制（Access Control）单一事实源。
> **适用**：发布人、运维、DBA、后端、任何写 `.env` / 配置 / 部署脚本的人。
> **维护**：运维 + DBA 双人复核（PR 触发 CODEOWNERS 自动 review）。
> **核心原则**：机器 IP、密码、API key 等敏感信息**不写仓库任何文件**，统一进入"安全门禁"系统（防火墙、堡垒机、KMS、凭证库）作为单一可信源。本文档只描述**规则结构**，实际值见各门禁系统。
>
> 文档外门禁系统的访问入口、运维 SLA、变更窗口全部在 1Password `web_system-infra` 维护。

---

## 〇、占位符约定

完整占位符清单与脱敏约定见 [`docs/operations/release-pipeline.md §〇`](../operations/release-pipeline.md#〇占位符约定必读)。

本规范里最常用的：

| 占位符 | 含义 |
|---|---|
| `<PROD_HOST>` / `<DEV_HOST>` / `<SSL_PROXY_HOST>` / `<BASTION_HOST>` | 各机器 IP / 域名 |
| `<SSH_ALIAS_PROD>` / `<SSH_ALIAS_DEV>` / `<SSH_ALIAS_SSL>` / `<SSH_ALIAS_BASTION>` | `~/.ssh/config` 里的 ssh 别名 |
| `<DB_PUBLIC_HOST>` / `<DB_PRIVATE_HOST>` / `<DB_PORT>` / `<DB_USER>` / `<DB_PASSWORD>` | 云库连接与账号 |
| `<DB_NAME_DEPLOY>` / `<DB_NAME_APP>` | 云库 deploy / 应用库名 |
| `<PROD_DOMAIN>` / `<ADMIN_DOMAIN>` / `<API_DOMAIN>` / `<DEV_DOMAIN>` / `<LEGACY_DOMAIN>` | 公网域名 |
| `<PROD_DOMAIN_NS>` | 去掉 TLD 后的域名前缀（npm scope） |
| `<VPC_SUBNET_CIDR>` | dev/prod 所在 VPC 子网 CIDR |
| `<REPO_ORG>` / `<REPO_NAME>` | GitHub org / 仓库名 |
| `<SSH_KEY_FILE>` | 堡垒机专用私钥文件名 |
| `<RELEASE_DIR>` / `<DEPLOY_DIR>` | mac release / 服务器部署目录 |

执行命令时把占位符**替换为实际值**再复制粘贴。复制整段 bash 但漏改占位符 = 静默失败。

---

## 一、安全门禁分类与职责矩阵

web_system 涉及的安全门禁分 7 层。每层由独立系统维护，避免单点失控。

| 层级 | 系统 | 规则结构 | 实际值存放 | 维护责任人 |
|---|---|---|---|---|
| 网络层-机器入站 | 腾讯云安全组 | "TCP 6000-6007 仅来自 `<SSL_PROXY_HOST>` + 公网" | 腾讯云控制台 → 安全组 → 规则集 | 运维 |
| 网络层-机器出站 | 腾讯云 NAT + EIP | 出站默认允许；`DB_PRIVATE_HOST:3306` 走 VPC 内网 | 腾讯云控制台 → NAT 网关 | 运维 |
| 网络层-VPC | 腾讯云私有网络 | dev/prod 在同一 VPC，子网 `<VPC_SUBNET_CIDR>` | 腾讯云控制台 → VPC | 运维 |
| 主机层-SSH | 堡垒机白名单 + 公钥 | 仅堡垒机 + 受控公钥可登录 prod | 堡垒机控制台 + `~/.ssh/authorized_keys` | 运维 |
| 主机层-sudo | sudoers 白名单 | 仅运维账号可 sudo；应用账号仅能 systemctl / pm2 reload | `/etc/sudoers.d/` | 运维 |
| 数据库层-IP 白名单 | 腾讯云 CDB 安全组 | 仅 dev/prod 内网 IP + 应急办公 IP 可连 | 腾讯云控制台 → CDB → 安全组 | DBA |
| 数据库层-账号 | MySQL GRANT | `<DB_USER>` 最小权限（仅 SELECT/INSERT/UPDATE/DELETE on `<DB_NAME_DEPLOY>.*`）；DBA 账号单独；禁止 root 直连 | `mysql.user` | DBA |
| 数据库层-连接 | MySQL 强制 SSL | `require_secure_transport = ON` | `my.cnf` | DBA |
| 应用层-mTLS | 服务间证书 | 内部 RPC 走 mTLS（dev/prod 证书分离） | 服务 config / 证书仓库 | 后端 |
| 应用层-API key | 加密存储 | 第三方 API key（LLM 厂商等）进 KMS，不进 .env | 阿里云 KMS / 腾讯云 KMS | 后端 |
| 凭证层-Secrets | 1Password vault | 发布用占位符 → 实际值映射；访问审计 | 1Password `web_system-infra` | 全员 + 审计 |
| 仓库层-branch protection | GitHub branch protection | master 需 PR + 1 approval + CI 全绿 | GitHub Settings → Branches | Maintainer |
| 仓库层-Secrets | GitHub Actions secrets | `PROD_SSH_KEY` 等只在 `Environments=production` 可见 | GitHub Settings → Secrets | Maintainer |
| 第三方-凭据 | 腾讯云 RAM 子账号 | 发布用 sub-account，权限 ≤ deploy + restart | 腾讯云 CAM | 运维 |

---

## 二、发布涉及的门禁变更流程

发布窗口里**最常踩雷**的 3 类门禁。

### A. 腾讯云安全组（机器入站）

```
发布前确认：
- [ ] 安全组已放通 prod 6000-6007 TCP 入站（来源：<SSL_PROXY_HOST> + 公网）
- [ ] 旧端口（3000-3004）已从安全组删除（避免被扫到）

变更流程：
1. 腾讯云控制台 → 安全组 → prod 安全组 → 入站规则
2. 添加：协议 TCP，端口 6000-6007，来源 <SSL_PROXY_HOST> + 0.0.0.0/0
3. 删除：端口 3000-3004 旧规则
4. 验证：https://<PROD_DOMAIN>/api/health → 200

回滚：保留旧规则 7 天，切换完成后删除
```

### B. SSH 访问控制

```
发布前确认：
- [ ] 发布人当前 mac 的 SSH 公钥（~/.ssh/id_ed25519.pub）在 prod 机器 ~/.ssh/authorized_keys
- [ ] 堡垒机白名单含发布人账号
- [ ] <SSH_KEY_FILE> 私钥在 ~/.ssh/，权限 600

新增发布人流程：
1. 发布人提供 ssh-ed25519 公钥给运维
2. 运维加入堡垒机白名单 + 同步到 prod ~/.ssh/authorized_keys
3. 私钥只在发布人本机，运维不持有

离职清理：
1. 离职时立即删除堡垒机账号 + 公钥
2. 撤销所有 GitHub 协作者权限
3. 撤销腾讯云 RAM 子账号
4. 1Password 调整共享 vault 权限
```

### C. 数据库访问控制

```
发布前确认：
- [ ] 云库 IP 白名单含 dev/prod 机器内网 IP
- [ ] prod 服务 <DB_USER> 是最小权限账号
- [ ] 应急办公 IP 在白名单（debug 用，到期移除）

新机器加白名单：
1. 腾讯云控制台 → CDB → 安全组 → 添加新机器内网 IP
2. 验证：mysql -h<DB_PRIVATE_HOST> -P3306 -u<DB_USER> -p  → 连通

账号权限最小化原则：
- 应用账号：SELECT, INSERT, UPDATE, DELETE on <DB_NAME_DEPLOY>.*
- 不要给：DROP, CREATE, ALTER, GRANT
- schema 漂移 ALTER：临时提权，跑完收回
```

---

## 三、凭证（Secrets）落地

**所有凭证都不进仓库、不进 .env、不进 pm2 ecosystem.config.js**。

| 凭证类型 | 落地位置 | 代码引用方式 |
|---|---|---|
| 数据库密码 | 腾讯云 KMS / 1Password | 服务启动时从 KMS 拉；.env 只占位 `DB_PASSWORD=KMS_REF` |
| SSH 私钥 | 1Password + 本机 `~/.ssh/`（600 权限） | `ssh-add` |
| 腾讯云 API key | 腾讯云 CAM 子账号 + 1Password | 子账号 AccessKey |
| GitHub PAT | 1Password + GitHub Settings → PAT | `gh auth login` |
| 第三方 API key（LLM 等） | 阿里云 KMS / 腾讯云 KMS | SDK 从 KMS 拉 |
| SSL 证书 | SSL 层 `/etc/nginx/ssl/<DOMAIN>/` | nginx 配置引用 |
| 主密钥（加密 secrets 用） | 1Password + 腾讯云 KMS | 服务 .env `KEY_REF` 占位 |

**轮转策略**：

| 凭证 | 轮转频率 | 触发条件 |
|---|---|---|
| 数据库密码 | 90 天 | 到期 + 任何已知泄漏 |
| SSH 私钥 | 180 天 | 离职 / 设备丢失 |
| GitHub PAT | 90 天 | 到期 |
| 第三方 API key | 180 天 | 厂商策略 |
| 主密钥 | 365 天 | 仅维护者操作，需双人复核 |

---

## 四、安全门禁的审计与回滚

**审计频率**：

| 门禁 | 审计频率 | 审计方式 |
|---|---|---|
| 腾讯云安全组 | 每周 | 腾讯云控制台 → 操作日志 → "修改安全组" 过滤 |
| SSH 登录 | 每日 | `last -f /var/log/btmp` + `/var/log/secure` |
| 数据库访问 | 实时 | MySQL general log + slow log |
| 凭证库访问 | 实时 | 1Password Activity Log |
| GitHub 操作 | 实时 | repo → Insights → Activity |
| CI 发布 | 每次 | GitHub Actions run + SSH 到 prod 后的 pm2 save 时间 |

**回滚（误操作）**：

```bash
# 1. 腾讯云安全组
# 腾讯云控制台 → 安全组 → "变更历史" → 选上一个版本 → "回滚"
# 注意：回滚只恢复规则集，不恢复关联资源

# 2. SSH authorized_keys
ssh <SSH_ALIAS_PROD> 'cp ~/.ssh/authorized_keys{.bak-YYYYMMDD-HHMM,}'
# 备份周期：每周自动 /etc/cron.d/backup-authorized-keys

# 3. 数据库权限
# DBA 重跑 GRANT 语句的 inverse（REVOKE）

# 4. GitHub
# PR 回滚 → branch protection 不可回滚，只能重新设
```

---

## 五、紧急事件响应

| 事件 | 第一响应 | 升级路径 |
|---|---|---|
| SSH 私钥泄漏 | 立即删除对应公钥 + 通知运维重发 | 30 分钟内 |
| 数据库密码泄漏 | 立即轮转 + 重启所有服务 | 15 分钟内 |
| 腾讯云 AccessKey 泄漏 | 立即禁用子账号 + 重发 | 15 分钟内 |
| 凭证库员工离职 | 移除 vault 权限 + 改共享 vault 主密码 | 24 小时内 |
| prod 被入侵 | 立即断公网（安全组 deny-all）+ 现场保全 + 报警 | 立刻 |

---

## 六、相关文档索引

- [`docs/operations/release-pipeline.md`](../operations/release-pipeline.md) — 发布规范，§五 部署窗口 / §五.A 依赖管理 / §十 安全门禁速查
- [`docs/operations/release-checklist.md` K 段](../operations/release-checklist.md#k-安全门禁每次发布必查) — 每次发布必查 7 类安全门禁
- [`docs/development/agent-capability-playbook.md`](agent-capability-playbook.md) — Agent 能力体验手册（AI agent 找本规范的事实入口）
- 凭证库 1Password `web_system-infra` — 所有占位符 → 实际值映射
- 腾讯云控制台 — 安全组 / CDB / CAM / NAT / VPC
- 堡垒机控制台 — 见凭证库

---

## 附录：本规范制定时的踩坑时间线

1. **凭证分散**：2026-09 之前发布文档直接出现机器 IP / 数据库密码 / 域名 → 9 月 23 日脱敏整改（PR #154），全部占位符化并指向 1Password。
2. **prod 端口漂移导致的安全组漏洞**：prod 跑旧构建监听 3000-3004，安全组原放通这 4 端口，新构建监听 6000-6007 但安全组没改 → 公网 502。规范要求"切换端口必须同时改生态（ecosystem + 安全组 + SSL nginx + .env）"。
3. **prod User.preferences 列缺失**：实体注释提示"生产环境 synchronize: false，需手工 DDL"，但发布流程漏跑 → admin 登录 500。规范要求"发布前扫实体注释 → dev + prod 双 ALTER"。
4. **prod 依赖落后 29 天**：body-parser / ws / adm-zip 多个包未装或装错版本 → 服务 `MODULE_NOT_FOUND` / `Cannot read properties of undefined`。规范要求"mac 与 prod 共享 lockfile + dry-run + 5.A.5 第三方依赖漏装排查"。

> 本规范与 [`docs/operations/release-pipeline.md`](../operations/release-pipeline.md) §附录 A 同步维护。