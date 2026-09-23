# 交接文档 · 2026-09-23（远端发布 / dev 基础设施）

> 用途：让下一个会话**直接读这一份**就能接上，不需要翻聊天记录。
> 读完后先用「§0 现状自检」跑一遍，确认环境事实仍然成立再动手。

---

## 0. 现状自检（新会话第一步，只读）

```bash
# ① 三台机器可达性
set -a; . scripts/.env.deploy; set +a
for k in DEV PROD LIGHTHOUSE; do
  eval "s=\$${k}_SERVER"; eval "u=\$${k}_USER"
  printf "%-11s %-16s %s\n" "$k" "$s" "$(ssh -o BatchMode=yes -o ConnectTimeout=10 $u@$s 'echo OK' 2>&1 | head -1)"
done

# ② 服务活着（dev）
ssh ubuntu@175.27.189.123 'pm2 jlist | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d),\"进程\")"'
curl -s -o /dev/null -w "dev /console/ -> %{http_code}\n" https://dev.kedouai.com/console/

# ③ 本地（编排者）控制台：流水线在这里执行
curl -s -o /dev/null -w "local /console/ -> %{http_code}\n" http://127.0.0.1:6200/console/

# ④ 开放 PR
export GH_TOKEN=$(grep '^GITHUB_PR_TOKEN=' .env | cut -d= -f2-)
gh pr list --state open --json number,headRefName,title --template '{{range .}}#{{.number}} {{.headRefName}} — {{.title}}{{"\n"}}{{end}}'
```

---

## 1. 环境事实（已核实，别再猜）

### 1.1 机器

| 用途 | 地址 | SSH 用户 | 部署根 | 备注 |
|---|---|---|---|---|
| **dev** | 175.27.189.123 | `ubuntu` | `/data/web_system` | 12 个 pm2 进程，内存 3.6Gi |
| **prod** | 106.52.176.246 | `root` | `/data/web_system` | **跑了 8 个服务**；`pm2` 存在但 `jlist` 取不到，端口要读 `/proc/<pid>/environ` |
| **nginx / 边缘** | **42.194.200.69** | ❓未提供 | ❓ | `dev.kedouai.com` 解析到这里；**尚未登记为主机**（缺 SSH 用户/密钥/目录） |
| LIGHTHOUSE | 101.43.117.234 | `ubuntu` | 无 | **空机**，无 nginx/caddy、无部署根 —— **不是** nginx 那台，别混淆 |

- dev 主机**不跑 nginx**（对外入口在 42.194.200.69）；控制台 UI/API 走 `/console/*`（边缘剥离前缀后打到 dev:6200）。
- prod 实际在跑：gateway 3000 / auth 3001 / user 3002 / ai-service 3003 / system 3004 / todo 3005 / mcp-gateway 6006 / content-hub 6007。
- prod 上 **ai-agent 与 deploy-console 不存在**；**upload-service 有 dist 但未运行、.env 为空**。

### 1.2 数据库（⚠️ 关键）

- **dev 与 prod 共用同一个 MySQL 实例**：dev `.env` 写公网域名 `gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`，prod `.env` 写同一实例的 VPC 内网 `172.16.16.10:3306`。
- 证据：`schema_migrations` 12 行在两边**同时出现且 `applied_at` 秒级一致**；`users` 都是 2 个；`admin.systems=["admin","deploy"]` 是写给 dev 的值、prod 也能读到。
- **含义**：任何对 dev **业务库**的数据改动**同时作用于 prod**（`users.systems` 列、`storage.upload_dir`、迁移记账皆是）。
- 控制台库 `web_system_deploy` 也在同一实例上；**编排者（本机）库 ≠ 各环境控制台库**，两份要分别登记（见 §3.4）。

### 1.3 端口矩阵要点

- local auth=**6101**（本机 6001 被他项目占用，见根 `ecosystem.config.cjs`）；dev auth=**6001**；prod 走 **3000 系**。
- 端口真相源 = `deploy_service_envs.port`（远端）→ 配置中心 `PORT` 可覆盖 → 仅 local 回落本机 pm2（`pickStagePort`，发布日志里看 `PORT_SOURCE`）。

---

## 2. 本轮已完成的工作（按主题）

| # | 主题 | 落点 | 状态 |
|---|---|---|---|
| A | 远端后端发布能力（B1/B2） | `scripts/migrations/p26-remote-backend-release.mjs`（sync/restart/verify 远端动作） | ✅ 已合入 master（PR #135） |
| B | 远端写库（B6） | `scripts/migrations/p27-remote-release-remote-db.mjs`（`write-version（远端）`/`pointer（远端）`，远端分支停用写本机库动作，密钥经 ssh 从目标机 `.env` 取） | ✅ 已合入（#135） |
| C | 远端微前端投递目录修正 | `scripts/migrations/p28-remote-mf-envdir.mjs`（改回 env-dir：`modules/<k>/<envId>/<commit>/`） | ✅ 已合入（#135） |
| D | 控制台远端升级脚本 | `scripts/publish-deploy-console.sh --env dev\|prod`（构建→打包→远端备份换 dist→重启→探活→失败回滚；内建 JWT_SECRET / 模板名唯一性前置校验） | ✅ 已合入（#135） |
| E | **端口解析修复** | `servers/deploy-console/src/pipeline/pipeline.service.ts` 的 `pickStagePort`；远端取目标环境登记，**绝不回落编排者本机 pm2**；注入 `PORT_SOURCE`；`PipelineModule` 补注册 `DeployServiceEnvEntity` | ✅ 已合入（#135） |
| F | dev 控制台 IAM 登录修复 | `JWT_SECRET` 同源 + `AUTH_SERVICE_URL` + auth-service 升到 IAM 版 + `users.systems` 列 + `admin` 归属 deploy | ✅ 已生效（auth-service 发 dev **succeeded**，日志 `[verify-remote] 端口探活 6001 通过`） |
| G | dev 基础设施初始化 | 配置中心 5 条（复用 local 口径）、系统设置 2 条、主机登记 `deploy_hosts`/`deploy_servers` 各 2 台、服务×环境登记 dev 12 + prod 8、pm2-logrotate、每日备份 cron（03:20） | ✅ 已生效 |
| H | 迁移账本 baseline | dev/prod 同一库 → **12 行已记**；3 条待定未记 | 🟡 待评审 |
| I | **A5** 历史上传迁移脚本 | `scripts/migrate-uploads.mjs`（默认 DRY_RUN、幂等、不删源、目标目录只认 `/internal/storage/path`）+ 灰度验证清单 | 🟡 PR #141 待合 |
| J | **C1** 统一认证助手（灰度） | `packages/shared/src/auth/unified-auth.ts`（10 例单测）+ `todo-service` 首个接入，行为不变 | 🟡 PR #143 待合（CI 已绿） |
| K | 运维知识 | `docs/development/local-release-runbook.md`（§3.1 远端控制台登录前置条件、§4.10 事故与派生坑）、`docs/development/dev-env-config-inventory.md`（对账表） | ✅ 已合入 |

**PR 一览（截至交接）**：#135 ✅ 已合并｜#139 ✅ 已合并（对账表）｜#141 🟡 A5｜#143 🟡 C1 灰度

---

## 3. 待办（按优先级，标注阻塞者）

| 优先级 | 事项 | 说明 | 阻塞者 |
|---|---|---|---|
| **P0** | **A6 收尾**：dev 控制台 →「版本部署 → admin → `3d5ce61`」→ 部署 | admin 的 A6 产物已投递到 `modules/admin/dev/3d5ce61/`（公网 200、旧版有「存储配置」代码 / 新版 0 处已核对），**只差指针切换**；按用户口径指针切换**不自动做** | **用户点** |
| **P0** | **dev/prod 共用库**的处置决策 | 是否要拆库？若不拆，需在文档与流程里明确"改 dev 业务库 = 改 prod" | **用户决策** |
| P1 | **A8**：ai-service 生成图改调 `internal/uploads/store` 落盘 | 依赖 A3 已就绪；本轮未做（需通读 ai-service 图片落盘与路径消费点） | 我（下轮） |
| P1 | **C1 剩余 7 个服务**接入统一助手 | user-service / ai-agent / ai-service / knowledge-service / system-service（remote）；gateway（本地 JwtService）/ upload-service（手写 HMAC）→ 属 `AuthMode.local`，需注入各自校验实现 | 我 |
| P1 | **nginx 主机登记** | 42.194.200.69 的 SSH 用户 / 密钥 / 部署根目录，**未提供** | **用户提供** |
| P2 | 迁移待定 3 条评审 | `0008_knowledge_tables`（dev/prod 均缺 knowledge 3 表）、`0010_pipeline_task_states`（`deploy_pipeline_runs` 已随域拆分迁到 `web_system_deploy`，该迁移过时）、`0012_music_recommend`（music 领域未上）→ 决定"执行"还是"记账跳过" | **用户/相关领域** |
| P2 | prod 的 upload-service 是否部署 | 有产物未运行、.env 空；建议端口 3008、需配 .env（PORT/INTERNAL_API_KEY/JWT_SECRET/存储）后启动 | **用户决策** |
| P3 | A7（删 user-service 上传端点与 static serve） | 依赖 A5 验证通过；bianbian 特例路由**保留**作只读兜底 | 依赖 P1 |
| P3 | `deploy_env_service_routes` | 本机只有 staging 遗留行，dev/prod 是否需登记待确认 | 用户 |

---

## 4. 工具与命令速查

```bash
# 流水线（CI 触发端点，HMAC 验签，无需 JWT）
node /tmp/release-hook.mjs submit <module> dev|prod master remote   # 提交（会到 awaiting-approval）
node /tmp/release-hook.mjs status <jobId>                            # 查状态
# 审批：local.kedouai.com/console/pipelines → 通过（每个模块每次都要点）

# 控制台自身发布（不走流水线）
bash scripts/publish-deploy-console.sh                    # 本机（编排者）
bash scripts/publish-deploy-console.sh --env dev          # 远端（备份/探活/回滚齐全）
DRY_RUN=1 bash scripts/publish-deploy-console.sh --env dev

# 迁移脚本（DB 侧）
node scripts/migrations/p27-remote-release-remote-db.mjs            # 幂等，DRY_RUN=1 / ROLLBACK=1 可预演/回退
BACKENDS=a,b,c node scripts/migrations/p27-...                      # 指定模块
ENVS=dev,prod MODULES=admin,portal node scripts/migrations/p28-...  # 按模块/环境
DRY_RUN=1 node scripts/migrations/p29...                            # 惯例：先预演

# 迁移记账（务必先对照、再记账、不动 DDL）
#   对照方法见 docs/development/dev-env-config-inventory.md §5

# A5 历史文件迁移
node scripts/migrate-uploads.mjs                    # 默认 DRY_RUN
node scripts/migrate-uploads.mjs --apply            # 落盘
node scripts/migrate-uploads.mjs --apply --prune    # 删源（要求无冲突项）

# CI 口径（**必须用区间**，否则会把 master 领先的部分算进来）
bash scripts/ci/changed-packages.sh 'origin/master...HEAD'

# 迁移/配置类 DB 操作：先备份
mysqldump <db> <table> > ~/backups/<table>.bak-$(date +%Y%m%d-%H%M).sql
```

---

## 5. 踩坑清单（别重犯）

1. **shell 环境变量会泄漏进 `pm2 start`**：`@nestjs/config` 不覆盖已存在的 `process.env`。手工跑过动作脚本后若留下 `PORT=6001`，发布控制台会让服务去绑 6001（`EADDRINUSE`）→ 已改 `env -i`；**新会话如手工跑脚本，下一条命令先 `unset PORT MODULE_KEY ...`**。
2. **只加 `@InjectRepository` 不在 `TypeOrmModule.forFeature` 注册**：单测用 stub 测不出，运行时 Nest 报 `...Repository at index [N]` 且服务起不来。新增注入后**必须真启动一次**。
3. **配置中心不是"必需就写"**：各服务 `.env` 已有的键（如 `AUTH_SERVICE_URL`）**不要**搬进配置中心 —— 它是强制覆盖层，重复登记只会多一层维护点。判定标准是"是否需要跨环境集中管理"。
4. **迁移记账 = 以后不再执行**：宁可少记不可错记；`apply-migrations.sh` 在记账为空时会**把全部当待应用**（含 `0001_standardize_business_tables` 这类基线/重命名脚本）→ **切勿盲跑**，先出对照表。
5. **远端探活端口不能来自编排者本机 pm2**：本机 6101 ≠ dev 6001 ≠ prod 3001。
6. **远端控制台升级的 3 个前置**：`JWT_SECRET`（与同环境 auth-service 同源）、`AUTH_SERVICE_URL`（指向该环境实际端口）、auth-service 需 IAM 后版本（接受 `system` 参数）+ `users.systems` 列 + 运维账号归属 deploy。详见 runbook §3.1。
7. **分支前缀**：`feature/*` / `fix/*` / `docs/*` 才会被 `auto-pr` 识别；`feat/*` 会 **skipped**（踩过）。
8. **MySQL 幂等插入写法**：`INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM (SELECT 1) z WHERE EXISTS (SELECT 1 FROM <table> ...))`，否则同表既读又写会报错。
9. **控制台错误文案会掩盖真因**：auth-service 非 2xx 一律显示「用户名或密码错误」→ 排障先直连 `POST 127.0.0.1:<auth端口>/auth/login -d '{"username":"__probe__","password":"__probe__123","system":"deploy"}'` 看真实状态码。

---

## 6. 并发会话问题（未解决，需处理）

工作区在本轮期间被**另一个会话**使用：
- 它改着 `docs/ui/page-specs/pipeline-product-logic-v1.md`、`docs/ui/prototypes/*`、`specs/pipeline-flow-color/design.md`（时间戳 16:29，非我所为）。
- 工作区当前分支是 **`fix/pipeline-flow-arrow-color`**（那个会话的分支），**我的对账表提交 `10ecf28` 曾误落在其上**（父提交是他们的 `5d2e7d0`）。
- 我已用 worktree 把该提交摘到独立分支（已在 PR #139 中，#139 已合并，故内容已进 master）。
- **待你或那个会话执行**（用 revert 而非 reset，避免清掉其未提交改动）：
  ```bash
  git checkout fix/pipeline-flow-arrow-color && git revert --no-edit 10ecf28
  ```
- 另有两个 worktree 在用：`/tmp/wt-inventory`（docs/对账表）、`/tmp/wt-c1`（C1）、`/tmp/wt-uploads`（A5）、`/tmp/wt-handover`（本文档）。

---

## 7. 新会话建议的开工顺序

1. 跑 §0 自检 → 若 dev/prod/本机控制台都健康，直接进入 2。
2. 先做 **P0**：A6 指针切换（需用户点），顺带把 **dev/prod 共用库**的决策定下来（这会决定后续所有 DB 操作的风险等级）。
3. 再做我（AI）能独立推进的：**A8** 或 **C1 剩余 7 个服务**（二选一，都是独立 PR）。
4. 最后处理收口类：迁移待定 3 条、A7、nginx 主机登记、prod upload-service。

> 相关文档：`docs/development/local-release-runbook.md`（发布与登录前置条件、事故 §4.10）、
> `docs/development/dev-env-config-inventory.md`（配置对账表与判定规则）、
> `specs/backend-consolidation/design.md`（A/C 系列任务表与进度行）。
