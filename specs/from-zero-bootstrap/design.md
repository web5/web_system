# 设计 · 从零初始化与 prod 首次发布

> 配套需求见 `requirements.md`（缺陷 D1-D8、判据 V1-V8）。

## 1. 总体思路

**不新造体系，把既有工具编排成一个入口**，并补上"首次"这个它们没覆盖的场景。

```
scripts/bootstrap.sh                      ← 新增：唯一入口（在目标机本地执行）
  ├── 依赖检查 / pnpm install
  ├── 构建共享包  shared → types → mcp-core → agent-core
  ├── 建库        local-db.sh（本地） / mysql 客户端（dev·prod，仅缺库时创建）
  ├── 迁移        apply-migrations.sh local   ← 在目标机上执行 = 应用到这台机的库
  ├── 构建后端    12 个服务（清单来自 scripts/modules.json，单一真相源）
  ├── 启动        pipeline/restart-backend.sh（干净环境 + 依赖校验；新增首次纳管支持）
  ├── 初始数据    seed-admin.mjs（admin 密码）/ 可选 seed-dev-deployment.mjs
  └── 验证        pipeline/verify-backend.sh + health-check.sh
```

关键取舍：
- **服务清单单一真相源** = `scripts/modules.json`（补全后 12 个 backend）。`local-up.sh` 与 `bootstrap.sh` 都从它读，避免再出现 D1/D2 那种"清单漂移"。
- **`bootstrap.sh` 在目标机本地执行**（local 即本机；prod 为 `ssh prod 'cd /data/web_system && ./scripts/bootstrap.sh --env prod'`），从而复用 `apply-migrations.sh local` 与 `restart-backend.sh`，不必再引入一层 SSH。
- **启动统一走 `restart-backend.sh`**（而不是 `pm2 startOrRestart ecosystem.config.cjs`）：避免 `--update-env` 把执行会话变量固化进 `pm2_env`（D7 的根因）。

## 2. `scripts/bootstrap.sh` 设计

### 2.1 接口

```bash
./scripts/bootstrap.sh --env <local|dev|prod> [选项]

  --env <env>          必填。决定建库方式/迁移严格度/seed 行为
  --dry-run            只打印将执行的步骤（零副作用；对应 V1）
  --skip-build         跳过构建（改配置后快速重启）
  --no-start           只做数据层（建库+迁移+构建），不动进程
  --admin-password P   seed admin（缺省则跳过 seed 并提示）
  --with-front         额外构建前端产物 + CDN（默认不构建）
  --yes                跳过交互确认（生产建议人工确认）
```

退出码：0 成功；非 0 失败并指出**失败步骤**与**排查命令**。

### 2.2 环境差异表

| 步骤 | local | dev / prod |
|---|---|---|
| 建库 | `local-db.sh`（socket、root 无密码） | `mysql` 客户端，凭据取自目标机 `/data/web_system/.env`（`DB_*`）；**仅当库不存在时 CREATE** |
| 建哪几个库 | `web_system` / `web_system_deploy` / `web_system_knowledge` | 同左 |
| 迁移 | `apply-migrations.sh local` | `apply-migrations.sh local`（在目标机上=本机库）；**强制**，不允许跳过 |
| 启动 | `restart-backend.sh`（`PM2_ALLOW_NEW=1`） | 同左 |
| seed admin | `seed-admin.mjs`（`--admin-password`） | 同左（生产要求显式传密码；未传则跳过并 WARN） |
| 后端进程名 | `web-<key>` | `<key>`（dev/prod 现状）——由 `restart-backend.sh` 的候选名解析兼容 |

> 生产"强制迁移"的理由：`NODE_ENV=production` 时 TypeORM `synchronize=false`，漏迁移 = 进程 online 但端口不监听（历史上已踩）。

### 2.3 步骤骨架（伪码）

```bash
step "1/7 依赖与工具链"   check node/pnpm/pm2/mysql; 需要时 pnpm install
step "2/7 共享包构建"     for p in shared types mcp-core agent-core; do pnpm --filter ... build; done
step "3/7 数据库"         ensure_databases "$ENV"     # 幂等
step "4/7 迁移"           bash apply-migrations.sh local      # dev/prod 强制
step "5/7 后端构建"       for svc in $(backend_services); do nest build || tsc; done
step "6/7 启动"           for svc in $(backend_services); do PM2_ALLOW_NEW=1 restart-backend.sh ...; done
step "7/7 初始数据与验证"  seed admin → verify-backend.sh → health-check.sh "$ENV"
```

`--dry-run` 时每一步只打印命令不执行；所有破坏性动作（`pm2 delete`、`DROP`）在 dry-run 下**永不执行**。

## 3. `pipeline/restart-backend.sh` 增强（首次纳管）

现状：`resolve_name()` 在 pm2 里找不到进程时直接 `die`（首次 bootstrap 跑不通）。

改动（最小、可控）：
- 新增 `PM2_ALLOW_NEW=1`：当 pm2 中无候选名时，**回退到命名约定**（`PM2_NAME` → `web-<key>` → `<key>`）并提示"首次纳管"；
- 未设置该变量时保持原严格行为（typo 的 `MODULE_KEY` 不会被误创建）—— 保护既有调用方。

## 4. 新增 `scripts/pipeline/verify-backend.sh`（verify 阶段脚本化）

把历史事故的两类"假健康"都拦在发布闸门内：

| 检查 | 判据 | 失败信息要点 |
|---|---|---|
| 进程在线 | `pm2 jlist` 中该服务 `status=online`（轮询 12×2s） | 提示 `pm2 logs <name>` |
| 端口探活 | `127.0.0.1:$PORT` TCP 可连 | 提示端口占用排查 |
| **AI 链路**（仅 ai-agent / mcp-gateway / knowledge-service） | 调 `/mcp/tools/call` 的 `knowledge_list`；返回 `401` → 网关密钥不一致；`4010` → 网关与知识服务内部密钥不一致 | 直接给出"改哪个 `.env` 的哪个键" |

设计要点：
- 与 `restart-backend.sh` 同源（同批变量 `RELEASE_DIR/MODULE_KEY/MODULE_DIR/PORT`），可被流水线原样调用；
- `DRY_RUN=1` 时只打印将执行的检查；
- 非 AI 服务跳过第三项（不引入额外依赖）。

## 5. 改动清单

| # | 文件 | 改动 | 风险 | 判据 |
|---|---|---|---|---|
| C1 | `scripts/bootstrap.sh` | **新增**：唯一初始化入口 | 中（编排逻辑需幂等） | V1 V2 |
| C2 | `scripts/pipeline/verify-backend.sh` | **新增**：verify 阶段脚本化 | 低 | V7 |
| C3 | `scripts/pipeline/restart-backend.sh` | 加 `PM2_ALLOW_NEW` 首次纳管 | 低（默认行为不变） | V4 |
| C4 | `scripts/local-up.sh` | 服务/包清单改为从 `modules.json` 读，修 D1/D2/D3 | 低 | V4 |
| C5 | `scripts/local-db.sh` | 幂等创建三库（修 D4） | 低 | V5 |
| C6 | `scripts/modules.json` | 补 `ai-agent` / `knowledge-service`（修 D5） | 低（影响发布平台模块列表） | V6 |
| C7 | `scripts/deploy-prod.sh` | 顶部标注**已废弃**并指向 `bootstrap.sh --env prod`（修 D7） | 低 | V8 |
| C8 | `docs/development/local-dev-setup.md` | 顶部加"部分过时"提示并指向新文档 | 无 | V8 |
| C9 | `docs/development/prod-release-plan.md` | 补"实现"章节（脚本用法 + 环境数据修正项） | 无 | V8 |

不做（本次范围外）：流水线远程执行能力（路径 B）、prod console 部署（路径 A）、`deploy_environments.prod.ports` 数据修正（环境操作）。

## 6. 任务拆分

| 任务 | 内容 | 依赖 |
|---|---|---|
| T1 | C5 + C6（数据层与清单修正，最小可验证） | — |
| T2 | C3 + C4（启动与清单收口） | T1 |
| T3 | C1（bootstrap.sh，编排 T1-T2 的产物） | T2 |
| T4 | C2（verify 脚本 + dev 实测） | — |
| T5 | C7 + C8 + C9（文档与废弃标注） | T1-T4 |
| T6 | 验证 V1-V8 并留证据 | 全部 |

## 7. 回滚

- 全部改动为**新增文件 + 局部修改**，无 DB 结构变更；回滚 = `git revert` 单个 commit。
- `bootstrap.sh` 支持 `--dry-run`，且不删除任何数据；建库仅 `CREATE DATABASE IF NOT EXISTS`。
- `restart-backend.sh` 的 `PM2_ALLOW_NEW` 默认关闭 → 老调用方行为不变。

## 变更日志

- 2026-09-13 首版。
