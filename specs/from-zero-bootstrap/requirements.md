# 需求 · 从零初始化与 prod 首次发布

> 分支：`feat/from-zero-bootstrap-prod-release`（基于 master）
> 关联：`docs/development/from-zero-init-data.md`（数据清单）、`docs/development/prod-release-plan.md`（路径对比）

## 1. 背景与问题

两个场景现在都"能跑但不可复现"，且存在**已确认的缺陷**：

| # | 缺陷 | 影响 | 证据 |
|---|---|---|---|
| D1 | `scripts/local-up.sh` 的 `SERVICES` 含 `finnews` | `cd servers/finnews` 不存在，`set -e` 直接中断 → **一键启动跑不通** | `servers/` 下无 `finnews`（只有 `content-hub`） |
| D2 | 同脚本 `SERVICES` 缺 `ai-agent` / `knowledge-service` | 这两个服务不会被构建，但仍被 pm2 拉起 → 跑旧产物 | `ecosystem.config.cjs` 有 12 个服务，脚本只列 10 个 |
| D3 | 同脚本 `PACKAGES` 缺 `agent-core` | `ai-service` 构建可能缺 `@kedouai/agent-core` | `servers/ai-service/package.json` 依赖它 |
| D4 | `scripts/local-db.sh` 只建 `web_system` | `web_system_deploy` / `web_system_knowledge` 缺失 → 发布平台与 RAG 起不来 | 脚本第 53-57 行 |
| D5 | `scripts/modules.json` 缺 `ai-agent` / `knowledge-service` | 发布平台的模块注册表不完整，这两个服务无法在控制台发布 | 只有 10 个 backend 条目 |
| D6 | 无「从零到可登录」的单一入口 | 手工步骤多（建库→迁移→构建→启动→seed→验证），易漏（尤其**生产漏跑迁移**） | 只有分散的 `local-db.sh` / `local-up.sh` / `apply-migrations.sh` |
| D7 | `scripts/deploy-prod.sh` 严重过时 | 写死 3000 端口、只发 portal/auth/gateway，且用 `pm2 restart --update-env`（会污染 pm2_env） | 脚本内 `npx vite build` / 端口 3000/3001 |
| D8 | `docs/development/local-dev-setup.md` 过时 | 3000 端口、6 服务，误导新人 | 文档主体 |

## 2. 目标与非目标

### 目标
- **G1**：一条命令完成「本机从零到可登录」，且**幂等、可预演**。
- **G2**：同一入口支持 `--env dev|prod` 的**首次 bootstrap**（生产必须先迁移）。
- **G3**：修复 D1~D5 的清单/配置缺陷。
- **G4**：把 verify 阶段的探活脚本化（含 **AI/MCP 链路**），与已落地的 `restart-backend.sh` 配套。
- **G5**：`deploy-prod.sh` 明确处置（重写为委托或标注废弃），不再误导。

### 非目标（本次不做）
- 不做流水线的「远程执行阶段命令」能力改造（路径 B，改动大，需单独立项）。
- 不部署 prod 的 deploy-console（路径 A 的落地动作，属环境操作）。
- 不改动 `deploy_environments.prod.ports` 等**环境数据**（属环境操作，文档列出）。

## 3. 验收判据（V1…V8，逐条可验）

| 编号 | 判据 | 验证方式 |
|---|---|---|
| V1 | `bash scripts/bootstrap.sh --env local --dry-run` **只打印计划、零副作用** | 对比执行前后 pm2/DB 无变化 |
| V2 | 本机空库场景可跑到「登录返回 accessToken」 | 删除三库后执行，末尾自检通过 |
| V3 | 所有改动脚本 `bash -n` 通过 | 逐文件语法检查 |
| V4 | `local-up.sh` 不再引用不存在的目录，构建清单含 `agent-core` 且覆盖 12 个服务 | 阅读脚本 + `bash -n` + 实跑构建 |
| V5 | `local-db.sh` 幂等创建三个库 | 连续执行两次均成功 |
| V6 | `modules.json` 含 `ai-agent` / `knowledge-service` | `node -e` 校验条目数 = 12 backend |
| V7 | `scripts/pipeline/verify-backend.sh` 在 dev 实测：健康时 exit 0；人为造 401/4010 时 exit≠0 并给出可定位信息 | dev 实机执行 |
| V8 | 文档命令可**直接复制执行**（`from-zero-init-data.md` 与脚本实际参数一致） | 逐条比对 |

## 4. 边界与反例

- **反例 1**：`bootstrap.sh` 无 `--dry-run` → 用户在已有环境误执行会重建/重启服务。**必须提供预演**。
- **反例 2**：脚本自动 `CREATE DATABASE` 而不确认 → 生产环境对**已存在但结构不符**的库无保护。**处置**：生产仅在库不存在时创建，且迁移走 `apply-migrations.sh`（幂等记账）。
- **反例 3**：把 `pm2 startOrRestart ecosystem.config.cjs` 作为生产重启手段 → 会沿用历史 `pm2_env`（污染）。**生产必须走 `pipeline/restart-backend.sh`**（干净环境重建）。
- **反例 4**：`bootstrap.sh` 内硬编码密码/服务器地址 → 违反仓库约定（凭据只从 `.env`/`.env.deploy` 读取）。
- **反例 5**：verify 脚本把"端口通"当成功 → 这正是历史上"假健康"的来源。**必须叠加业务层探活**（AI 链路 `knowledge_list`）。

## 5. 待确认项

1. `bootstrap.sh` 是否需要覆盖「前端产物构建 + CDN」？（当前计划：本机 `--with-front` 可选；prod 必做，但先以文档步骤呈现）
2. prod 的 `deploy_environments.ports` 由谁修正（环境数据，非代码）。
3. prod 是否需要本次一并产出「首次 bootstrap 执行手册」（步骤 + 回滚）。

## 变更日志

- 2026-09-13 首版。
