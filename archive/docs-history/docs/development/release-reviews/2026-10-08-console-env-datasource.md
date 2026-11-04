# 发布评审 · deploy-console 按环境分流数据源（prod 写云数据库）2026-10-08

> 评审对象：`servers/deploy-console/.env.example`（新增 `DEPLOY_CLOUD_DB_*` 配置项）、
> `servers/deploy-console/src/cloud-db/*`（新增）、`src/registry/release-registry.service.ts`（分流 + 失败语义）、
> `src/deploy/deploy.service.ts`（legacy 指针镜像）、`src/health/health.module.ts`（探活端点）。
> 触发规则：`release-interface`（`servers/*/.env*` + 部署/数据面）。判据源：`docs/development/release-review-checklist.md`。
> 关联设计：`specs/deploy-console-env-datasource/design.md`。

## 阻塞: 0　　重要: 2

---

## 1 事实核查

| 项 | 实测 | 来源 |
|---|---|---|
| console 运行位置 | dev 机 `175.27.189.123` / `/data/web_system/servers/deploy-console`，pm2 名 `deploy-console` | `pm2 describe` / `scripts/.env.deploy` |
| dev → 云库内网 | **不通**（跨地域 ap-nanjing ↔ ap-guangzhou + 跨 VPC） | 实测 `timeout 6 /dev/tcp/172.16.16.10/3306` BLOCKED |
| dev → 云库公网 | **通**：`gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`，池化查询稳定 36ms | 2026-10-08 实测（用户控制台重开公网 + 白名单放行 175.27.189.123） |
| prod gateway 读 | 云库内网，DB 源 `DEPLOY_DB_NAME=web_system_deploy` | prod 机 `/proc/<pid>/environ` |
| 云库现状 | 8 行指针（10-08 手工同步基线），非空中库 | 云库查询 |

---

## 2 逐条判据

### A. 运行面

| # | 结论 | 证据 / 动作 |
|---|---|---|
| A1 | ✅ | 用 `scripts/publish-deploy-console.sh --env dev`：**工作区构建 → 打包 → 远端备份替换 → 重启**（发布目录 `/data/web_system` 仅作运行位置）。远端 pm2 短名 `deploy-console`（脚本按候选链解析） |
| A2 | ✅ | 发布前校验远端无流水线在跑；console 自身**不走流水线**（E1），不存在被 checkout 到别的分支的风险 |
| A3 | N/A | 未改 `packages/*` |
| A4 | ✅ | 脚本内置「6200 占用者 == pm2 pid」孤儿进程铁律（远端路径探活 + restarts 稳定检测） |
| A5 | ✅ | `deploy-console` 已在远端 pm2 登记（脚本找不到会直接 err） |

### B. 配置面

| # | 结论 | 证据 / 动作 |
|---|---|---|
| B1 | ✅ | 未使用 `pm2 restart --update-env`；远端为 `pm2 restart <name>`（新进程启动时由 `@nestjs/config` 读 `.env`） |
| B2 | N/A | 无跨服务共享密钥新增 |
| B3 | ✅ | 新增 `DEPLOY_CLOUD_DB_HOST/PORT/USER/PASSWORD/NAME` **部署前必须补齐**；缺失时服务启动不报错，但 `CloudDbService.init` 会打 error 且不镜像（**静默降级风险** → 见「重要 #1」） |
| B4 | ✅ | `.env.example` 全部留空占位，无 `{{}}` 占位符被误判为有效值；`ENABLED` 默认 `false`（默认关闭 = 回到现状） |
| B5 | ✅ | 配置只来自服务自身 `.env`（`ConfigModule.forRoot` 显式 `envFilePath`）；`CloudDbService` 只读 `ConfigService`，不依赖 `process.env`（规避「dotenv 不写 process.env」的坑） |

### C. 数据面

| # | 结论 | 证据 / 动作 |
|---|---|---|
| C1 | N/A | 无迁移文件。镜像写用原生 SQL upsert，目标库由 `DEPLOY_CLOUD_DB_NAME` 显式指定，不可能落到业务库 |
| C2 | ✅ | 全部 `INSERT ... ON DUPLICATE KEY UPDATE`，可重复执行 |
| C3 | N/A | 不走 `apply-migrations.sh` |
| C4 | ✅ | 只在 env=prod 时触发，dev/local 数据不镜像（本地库独享） |
| C5 | ✅ | 先部署代码 + 配好 `.env`，再验证写库；配置未就绪时功能默认关闭，不会「先绑后用」 |
| C6 | ✅ | **有回退路径**：`DEPLOY_CLOUD_DB_ENABLED=false` 重启即回到人工同步现状；镜像写只 upsert 不删数据；云库连接 `synchronize:false` 且 `entities:[]`，不产生 DDL |

### D. 前端面

| # | 结论 | 证据 / 动作 |
|---|---|---|
| D1–D4 | N/A | 本次不改微前端产物与版本指针语义；console 前端产物随脚本一并重建，但路由/资源未变 |

### E. 特殊通道

| # | 结论 | 证据 / 动作 |
|---|---|---|
| E1 | ✅ | 明确走 `scripts/publish-deploy-console.sh --env dev`，**不走流水线**（避免自杀式中断） |
| E2 | N/A | 非后端模块发布（无 restart 守卫字段依赖） |
| E3 | ✅ | 验证动作：① `GET /health/cloud-db` 探活；② 同值重写 prod 指针验证镜像落库（不改线上版本）；③ 断网反向用例验证任务失败语义；④ prod 页面探活 |
| E4 | ⏳ | PR 挂 auto-merge（merge commit），合入后对账 |

---

## 3 重要项（非阻塞，需跟进）

1. **重要 #1 · 配置缺失会静默降级**（判据 B3）：`DEPLOY_CLOUD_DB_ENABLED=true` 但连接配置不全时，服务照常启动、prod 发布照常「成功」，实际没写云库。
   缓解：启动即打 error 日志（已做）；建议 M5 把「云库可达性」纳入发布前预检，失败即阻断发布。
2. **重要 #2 · dev 机公网 IP 未绑 EIP**（判据 B3 延伸）：白名单写的是普通公网 IP，变配/重建后失效 → prod 发布静默失败。
   缓解：已写入设计文档 R2，建议尽快绑弹性公网 IP。

---

## 4 结论

阻塞 0，可发布。发布顺序：补齐远端 `.env` → `publish-deploy-console.sh --env dev` → 探活 → 正向/反向验证 → PR 合入对账。
