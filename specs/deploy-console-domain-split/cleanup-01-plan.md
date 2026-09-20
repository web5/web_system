# 清理清单 · deploy-console 历史遗留（开工前置）

> 状态：**待确认执行**（2026-09-18）
> 目的：按用户要求，在双域重构实施前清理临时方案与死代码，减少对新方案的干扰
> 扫描范围：`apps/deploy-console/src/**`、`servers/deploy-console/src/**`、相关 `scripts/**`
> 执行原则：**只删零引用项**；在用但属 legacy 的一律**先确认再动**；属新方案改造范围的不在本次清理

---

## A. 零风险可删（4 项，无引用 / 无调用）

| # | 对象 | 证据 | 处理 |
|---|---|---|---|
| A1 | `apps/deploy-console/src/components/EnvManagerPanel.vue` | 全仓库无 `import`（仅出现在 specs 与注释） | 删除文件 |
| A2 | `apps/deploy-console/src/components/PipelineSubmit.vue` | 全仓库无 `import`（仅被两处注释提及） | 删除文件 |
| A3 | `apps/deploy-console/src/api/index.ts` → `serverApi` 整组（`listServers`/`createServer`/`removeServer`/`listRoutes`/`createRoute`/`removeRoute`/`serviceOverview`） | 零调用方（`deploy-console` 内无任何页面/组件引用） | 删除该导出块 |
| A4 | `servers/deploy-console/src/entities/config-change-log.entity.ts` | 全仓库零引用 | 删除文件 |

---

## B. 需确认（3 项，动前请点头）

| # | 对象 | 现状 | 建议 |
|---|---|---|---|
| B1 | **`stage-command` 链路**：前端 `stageCommandApi`（打 `/modules/:key/stage-commands`）+ 后端 `stage-command` 模块 + `deploy-module-stage-command.entity` + 表 `deploy_module_stage_commands` | **legacy**（已被 `deploy_pipeline_step_commands` + nodes 取代），但 **`PipelineCenter.vue:610` / `PipelineDetail.vue:403,441` 仍在调用**（`scriptView` / `get`） | **本次不动**；建议纳入 P3 一并处理：先把这两处读迁移到 `pipelineStepApi`，再删 legacy 链路 |
| B2 | `deploy-env-service-route` 实体 + `server.service` 相关端点 | 前端 CRUD 已死；仅 `deploy.service.ts:941 resolveServers` 作为**回退**在用 | 实体**暂留**（新方案用 `deploy_service_envs` 替代）；待 P2 完成指向迁移后删除 |
| B3 | `scripts/deploy.sh:94-97` 的 `/bin/rm -rf dist` | 绕过 pnpm safe-delete 包装器的历史补丁 | 需确认是否仍必要；若可换标准删除则一并清（低优先） |

---

## C. 归入新方案分期（不在本次清理，避免白做）

| # | 对象 | 归属期 |
|---|---|---|
| C1 | 各页面 mock 数据（AppManager/AppDetail/EnvironmentManager/EnvironmentDetail/ServiceManager/ServiceDetail） | P1 / P2 接真实接口时替换 |
| C2 | 28 处 `type` 分支判断 | P3（按 `tech-design.md` §3.1 清单收敛） |
| C3 | 流水线 legacy 两级回退（`steps` 子集 / `PIPELINE_STAGES` 九阶段） | P3 / P4 |
| C4 | `check-base` 特判、`locked` 托管节点、`git` DB 脚本优先 | P3 / P4（与 `pipeline-node-model` 协同） |
| C5 | 旧实体退役（`deploy-module` / `deploy-deployment` / `deploy-server` / `deploy-environment`）与旧表 DROP | **P4 的 M9**（迁移观察期后） |
| C6 | `PipelineCenter.vue` 中已无调用的 `gotoModuleDetail` | P3（顺带） |

---

## D. 保留（运维必需，不清）

| # | 对象 | 原因 |
|---|---|---|
| D1 | `scripts/publish-deploy-console.sh`（含 6200 孤儿进程清理、`pm2 delete + start`、`--skip-sync/--skip-health`） | deploy-console 不能走流水线（自杀式 restart），该脚本是唯一正确通道 |
| D2 | `scripts/release-deploy-console.sh`、`scripts/apply-migrations.sh` | 发布与迁移的必需入口 |
| D3 | `scripts/migrations/p3–p9`（一次性数据迁移） | 已执行但保留作审计留痕（执行完可归档，不删） |

---

## 执行记录

| 项 | 状态 |
|---|---|
| A1–A4 | ✅ **已执行**（2026-09-18）：删除 2 个孤儿组件 + `config-change-log.entity.ts`；移除 `serverApi` 整组 |
| B1 `stage-command` legacy | ⏸ **本次不动**：`PipelineCenter.vue:610` / `PipelineDetail.vue:403,441` 仍在调用，删除会破坏「发布脚本查看」功能 → 归 **P3**（先迁到 `pipelineStepApi` 再删） |
| B2 `deploy-env-service-route` | ⏸ 实体暂留（`deploy.service.resolveServers` 回退仍用）→ 归 **P2** 完成指向迁移后删 |
| B3 `scripts/deploy.sh` 的 `/bin/rm -rf` | ⏸ **保留**：注释明确为绕过 pnpm safe-delete 批量删除拦截，属运维必需，非历史补丁 |
| C1–C6 | 纳入分期 |
| D1–D3 | 保留 |

## 文档目录清理（2026-09-18 执行）

| 删除对象 | 依据 |
|---|---|
| `docs/archive/`（29 文件） | 显式归档目录（旧 ARCHITECTURE/DEPLOYMENT、旧 spec、截图） |
| `docs/analysis/`（18 文件） | 分析记录（agent-platform 原型 HTML、合同翻译官诊断稿；功能已上线） |
| `docs/intents/` | 一次性意图产物（对应 spec 已落盘） |
| `docs/development/optimization-roadmap.md` | 2026-08 审查路线图（临时） |
| `docs/development/ai-native-sdlc-implementation-summary.md` | 自述"历史快照/已下线" |
| `docs/development/prod-release-plan.md` | 自述"方案稿待核实"，prod 已发布 |
| `docs/architecture/系统优化计划.md` | 2026-08-14 过期回顾 |
| `docs/工程完善计划.md` / `docs/发布与运维手册.md` | 已被 `docs/development/local-release-runbook.md` 取代 |
| `specs/deploy-admin-to-dev/` | 功能已上线 |
| `specs/agent-platform/` + `specs/agent-platform-evolution/` | 已交付（含 acceptance-result） |
| `specs/iam-multi-system/` `kedou-agent/` `contract-risk/` `contract-conversation-history/` `database-browser/` `agent-kit-sync-catchup/` `model-pricing-to-dict/` | 已交付、无活跃引用 |

**保留判定**：`docs/README.md`、`docs/development-guide.md`、`docs/architecture/*`、`docs/development/*`（在用开发/发布手册）、`docs/ui/*`（UI 单事实源）、`docs/products/*`、`docs/api/`、`docs/miniprogram/`、`docs/plans/`（含流水线重构 D1–D10 决策）、`docs/drawing/`；
`specs/<svc>/api-design.md`（`scripts/gen-api-design.mjs` 自动生成的接口契约，11 个服务）、活跃 spec（deploy-console、deploy-console-domain-split、pipeline-node-model、release-platform、ci-cd、gateway、module-env-ownership、llm-models-unify、from-zero-bootstrap）—— 后四者因被迁移脚本/设计文档引用而保留。

---

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-18 | v1.0 | 首轮盘点：可删 4 项、需确认 3 项、归入分期 6 项、保留 3 项 |
