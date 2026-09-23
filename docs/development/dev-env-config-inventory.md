# dev 环境配置对账表（Config Inventory）

> **用途**：新环境初始化、或环境间对齐时的**对账手册** —— 把「本地（参照）↔ 远端（dev/prod）」
> 的配置差异逐项列出，判定**该写 / 该人工提供 / 别动**。
> 后续同类工作（新机器、新环境、配置漂移排查）照本表执行即可。
>
> **流程铁律**：① 备份受影响的表 → ② 按本表逐项对账 → ③ **只写"值一致或缺失"的项，冲突不动** → ④ 校验条数与内容。
> 首次建立：2026-09-23（dev 初始化 + 控制台 IAM 一期升级）。

## 0. 判定规则（先读）

| 规则 | 说明 |
|---|---|
| **权威层** | 配置中心（`config_items`，发布时**强制注入**）> 服务-环境登记（`deploy_service_envs`，端口/主机/上游）> 服务 `.env`。写入配置中心意味着**会覆盖 .env 同名键**，所以只写值一致或缺失的项 |
| **备份** | 写远端库前一律 `mysqldump` 受影响表到 `~/backups`（本机亦可 `/tmp`） |
| **冲突不动** | 远端现值 ≠ 预期值 → **不覆盖**，记录并交人工确认（覆盖可能打断正在工作的服务） |
| **密钥不复制** | `is_secret=1` 的项、JWT/内部密钥、webhook 里的 key —— **不从别处复制值**，由该环境 `.env` 或人工提供；文档与聊天中不得出现明文 |
| **端口按环境** | local 6101 / dev 6001 / prod 3001（auth 为例，见 runbook §1.1）。**远端探活取 `deploy_service_envs.port`，绝不回落编排者本机 pm2**（runbook §4.10） |
| **幂等** | 写入一律带 `WHERE NOT EXISTS (...) SELECT ...`，可重复执行 |

## 1. 配置中心 `config_items`（控制台库 `web_system_deploy`）

| 键（scope/env · module.key） | 本地（参照） | dev 写入前 | dev 现在 | 判定 / 动作 |
|---|---|---|---|---|
| `global/* · REPO_URL` | `git@github.com:web5/web_system.git` | 无 | **已写入**（同值） | ✅ 发布拉码用，非敏感，环境无关 |
| `module/dev · <12 个服务>.AUTH_SERVICE_URL` | local 侧未写入（走 .env） | 无 | **已写入 `http://127.0.0.1:6001`**（12 条） | ✅ 平台**生产唯一必需键**（`REQUIRED_SERVICE_URLS_IN_PROD`）；dev 全服务 `NODE_ENV=production`，漏配会 fail-fast 退出 |
| `module/local · ai-agent.HY3_API_KEY / TOKENHUB_API_KEY` | 有（secret） | — | — |  **secret：不复制**，dev 如需，从 dev 本机 `.env` 取或人工提供 |
| `module/local · gateway.GATEWAY_SERVICE_KEY`、`deploy-console.GATEWAY_SERVICE_KEY` | 有（secret） | — | — | ⛔ 同上 |
| 其余服务互调地址（`USER_SERVICE_URL` / `SYSTEM_SERVICE_URL` / `UPLOAD_SERVICE_URL` / …） | 本地走 .env | dev 各服务 `.env` 已配 | 未写入配置中心 | ⏸ **暂不搬**：12 个服务 × 多组地址一次性覆盖风险大；建议后续**按服务逐个**对账后再写 |

**本次写入校验**：`SELECT COUNT(*) FROM config_items` → dev 由 0 → **13**（1 global + 12 服务）。

## 2. 系统设置 `system_settings`（控制台库）

| 键 | 本地 | dev 写入前 | dev 现在 | 判定 / 动作 |
|---|---|---|---|---|
| `NOTIFY_WEBHOOK_URL` | 空字符串 | 无 | **已写入（空值）** | ✅ 占位，空值不发通知，无副作用 |
| `NOTIFY_WECOM_URL` | 已配企微机器人（**URL 含 key**） | 无 | 未写入 | ️ **待人工确认**：写入后 dev 的流水线通知会发到该企微群（用户可见噪音）；确认后从本机取值写入 |

## 3. 服务-环境登记 `deploy_service_envs`（端口 / 主机组 / 上游）

| 环境 | 后端模块登记覆盖 | 状态 |
|---|---|---|
| local | 11/11 | ✅ |
| dev | 11/11 | ✅ |
| prod | 8/11 —— **缺 `ai-agent` / `upload-service` / `deploy-console`** | ⚠️ **需人工提供端口号**；补齐后 `PORT_SOURCE=unresolved` 才能升级为硬失败 |

- 端口真相源即本表（发布探活读它）；配置中心 `PORT` 仅在需要覆盖时使用（曾在 dev 临时写过一条 auth PORT，**已删除**，回归本表）。

## 4. 存储与静态产物（dev）

| 项 | 现状 | 判定 |
|---|---|---|
| 统一存储根 `/data/web_system/uploads` | 存在，10 个文件，可写 | ✅ |
| 业务库 `system_configs` | 1 条：`storage.upload_dir=/data/web_system/uploads` | ✅ 权威来源（`source=system_configs`） |
| `upload-service/.env` | `INTERNAL_API_KEY`（与 system-service 同值）、`STORAGE_ALLOWED_ROOTS=/data/web_system`、`STORAGE_UPLOAD_DIR`（兜底） | ✅ |
| 静态模块 `static/modules/` | 只有 `admin`、`portal` | ⚠️ **无 shell 基座**，门户加载方式待确认 |
| 微前端目录口径 | env-dir：`modules/<key>/<envId>/<commit>/` + 指针 `<key>/<envId>/index.js`；dev 的 admin 指针层此前**从未生成**（本次修复后由控制台「版本部署」生成） | ✅ 口径已统一（p28） |

## 5. 迁移账本 `schema_migrations`（业务库）

| 项 | 本地 | dev | 判定 |
|---|---|---|---|
| 记账行数 | **11**（0001…） | **0** | ❌ dev 表结构其实已到位（61 表 / 控制台 38 表），是"已应用但没记账" |
| 仓库迁移文件 | `.sql` 30 个 + `.mjs` 26 个（控制台库） | — | 需逐条判定"其创建的对象在 dev 是否已存在" |

**baseline 做法（务必先出对照表、再记账）**：
1. 逐个迁移文件提取其创建的**表/列/索引**；
2. 在 dev 库查该对象是否存在 → 存在标 `已应用`、不存在标 `待应用`；
3. **只写记账行，不执行任何 DDL**（这一步不改结构）；
4. 标为"待应用"的迁移单独评审后决定是否执行（`apply-migrations.sh` 在无记账时**会把全部当待应用**，含 `0001_standardize_business_tables` 这类基线/重命名脚本，**切勿盲跑**）。

## 6. 基础设施（dev 主机）

| 项 | 写入前 | 现在 | 判定 |
|---|---|---|---|
| 内存 | 1.9Gi（free 71Mi，危险） | **3.6Gi / free 1.4Gi**（已升配） | ✅ |
| 进程管理 | `pm2-ubuntu.service` enabled、`dump.pm2` 有 | 12 进程，**重启后全部自动 online、restarts=0** | ✅ 自启健康 |
| 日志轮转 | **无**（31MB/24 文件，会无限增长） | `pm2-logrotate` 已装：`max_size=50M`、`retain=7`、`compress=true` | ✅ |
| 定期备份 | **无 crontab** | `~/web-system-backup.sh` + cron 每日 03:20（两个库 dump + uploads + 静态产物，保留 7 天）；试跑产出 5 文件 / 72M | ✅ |
| Web 层 | nginx 装了但 80/443 未监听；caddy 只有 `/covers` | **dev 不需要 nginx**（对外入口在 42.194.200.69，那台归我们管） | ✅ 不改 |
| 对外入口 | `dev.kedouai.com` → 42.194.200.69（≠ 本机 175.27.189.123） | 边缘在另一台；控制台 UI/API 走 `/console/*`（前缀剥离后打到 dev:6200） | ℹ️ 记录 |

## 7. 复现命令（本次实际使用）

```bash
# 取远端库连接参数（从目标机控制台 .env 读，不硬编码）
ssh <env> 'cd <root>/servers/deploy-console && \
  H=$(grep -m1 "^MYSQL_HOST=" .env|cut -d= -f2-); P=$(grep -m1 "^MYSQL_PORT=" .env|cut -d= -f2-); \
  U=$(grep -m1 "^MYSQL_USER=" .env|cut -d= -f2-); export MYSQL_PWD=$(grep -m1 "^MYSQL_PASSWORD=" .env|cut -d= -f2-); \
  D=$(grep -m1 "^MYSQL_DB=" .env|cut -d= -f2-)'

# ① 备份
mysqldump -h $H -P ${P:-3306} -u $U $D config_items system_settings > ~/backups/devcfg.bak-$(date +%Y%m%d-%H%M).sql

# ② 幂等写入（示例：global 项；module 项把 env_id/module_key 换成实际值）
mysql -h $H -P ${P:-3306} -u $U $D -e "INSERT INTO config_items
  (id,scope,env_id,module_key,\`key\`,value,is_secret,enabled,description,updated_by,created_at,updated_at)
  SELECT UUID(),'global','','','REPO_URL','git@github.com:web5/web_system.git',0,1,'发布拉码地址','infra-init',NOW(),NOW()
  WHERE NOT EXISTS (SELECT 1 FROM (SELECT 1) z WHERE EXISTS (SELECT 1 FROM config_items c
    WHERE c.scope='global' AND c.env_id='' AND c.module_key='' AND c.\`key\`='REPO_URL' AND c.env_id IS NOT NULL))"

# ③ 校验
mysql -h $H -P ${P:-3306} -u $U $D -e "SELECT scope,env_id,module_key,\`key\`,LEFT(value,46) FROM config_items ORDER BY env_id"
```

> 踩坑：上面那段 `WHERE NOT EXISTS` 的**外层必须包 `FROM (SELECT 1) z`**，否则 MySQL 会因"同表既读又写"或空 FROM 报错（本次第一次拼坏了 SQL，0 行写入但**没有破坏任何数据**，靠备份+校验兜住）。

## 8. 遗留（需人工 / 后续）

1. `NOTIFY_WECOM_URL`：是否让 dev 也发企微通知（会进群）。
2. prod 的 3 个端口：`ai-agent` / `upload-service` / `deploy-console`。
3. 迁移账本 baseline：先出「对象存在性」对照表，评审后再记账（不动 DDL）。
4. 服务互调地址是否逐服务搬进配置中心。
5. dev 静态模块缺 `shell` 基座，确认门户是否需要。
