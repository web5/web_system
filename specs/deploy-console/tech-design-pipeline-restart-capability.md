# 能力登记：流水线「干净重启当前指针版本」（restart action）

| 项 | 内容 |
|---|---|
| 登记日期 | 2026-11-12 |
| 设计真源 | `docs/development/reports/2026-11-12-pipeline-restart-capability-design.md`（行为语义/权限/接口/测试六维/V1–V9 判据一律以该文为准，本文不复制语义） |
| 状态 | v1 已实现（MCP + publish.sh 通道；无 UI） |

## 能力一句话

对指定 `env(dev/prod) + moduleKey(type=backend)` 的后端服务执行「干净重启到**当前指针版本**」：
不改版本、不改配置、不动 dist；pm2 delete + `env -i` 白名单（PATH/HOME/PORT(+PM2_HOME/+EXTRA_ENV)）
重建进程并探活，进程环境残留随 delete 清除。restart **构造上不可能切版本**（不接受 versionTag 入参，
恒等于 registry 当前指针，服务端自校验）。

## 入口面

| 通道 | 入口 | 鉴权/约束 |
|---|---|---|
| MCP 工具面 | `restart_service`（mcp-gateway，第 13 个业务工具） | McpKeyGuard；prod 需 `confirm:true` + `reason`；支持 `dry_run` |
| console 端点 | `POST /api/mcp/restart` | 同上；404=未登记/非 backend，400=参数/前置断言失败 |
| 本地脚本 | `bash publish.sh restart <env> <svc> [--yes] [--dry-run] [--reason "..."]` | prod 本地侧强制 `--yes`（对齐 rollback 先例） |

## 实现落点

| 层 | 文件 |
|---|---|
| 远端执行体 | `servers/deploy-console/src/deploy/backend-runtime.ts`（`action:'restart'` + `backendRuntimeRestartCommand`） |
| 服务端编排 | `servers/deploy-console/src/deploy/deploy.service.ts`（`restartService()`：指针解析/发布锁/SSH 下投/版本自校验/审计） |
| MCP 端点 | `servers/deploy-console/src/mcp/mcp.controller.ts` + `mcp/dto/restart-service.dto.ts` |
| 工具声明 | `servers/mcp-gateway/src/mcp/mcp.service.ts`（`DEPLOY_HTTP_TOOLS.restart_service`） |
| 发布脚本 | `~/skills/web-system-deploy/scripts/publish.sh`、`remote-deploy.sh`（真源在 skill 目录，不在仓库） |

## 与既有能力的关系（易混点）

- **activate 的 cleanRestart 不动**：activate 保留引导键继承（`.bootstrap` → ecosystem），restart 全新 env 构造、
  不读 ecosystem/.bootstrap/dump.pm2/pm2 env——两者是不同语义的实现，不要互抄。
- **`pm2 save` 的爆炸半径**：restart 会 save 当前全部进程现状进 dump.pm2（设计 R4），其它进程的脏 env
  需随各自干净重启逐个消化，不属于本能力的缺口。
- monitor UI 的 in-place `pm2 restart` 按钮 v1 不动（env 不刷新，已知风险，v2 评估切到本能力）。
