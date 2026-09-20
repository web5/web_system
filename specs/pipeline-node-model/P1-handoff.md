# P1 开工上下文（给新对话用 · 2026-09-15）

> **用法**：新对话开场直接说
> 「读 `specs/pipeline-node-model/P1-handoff.md` 与 `specs/deploy-console/pipeline-edit-ui.md`，从「未完成」第一节开始做」
> 即可开工，**无需重新探索代码**。

---

## 0. 本轮一句话

流水线**节点模型终态 + 编辑页 UI 交互定稿 + 环境归属合入**已全部落地并发布；
**48 条流水线（16 模块 × local/dev/prod）全部启用**；
剩一个真缺口：**后台模块投递到「版本目录」，而服务跑的是 `dist/`，缺「部署生效」动作**。

---

## 1. 已完成（全部已合并到 master 并发布）

| PR | 内容 |
|---|---|
| #63 | 节点模型收敛为 `shell / approval` 终态 + 平台能力降级为 `service` action；按环境拆流水线；编辑页独立化 + Tabs；**同时带上了另一会话的「模块-环境归属」**（解决 `ModuleDetail` 冲突） |
| #64 | 提交时**环境必须与流水线 env 一致**（后端 400 + 前端下拉只列本环境流水线） |
| #65 | `p6-module-env-ownership.mjs` 改 mysql2 直连（原 `mysql` CLI 本机没有 → 127 崩溃，是环境表事故的元凶） |
| #66 | admin 本机 `PUBLISH_PATH` 去掉多余产品线段（回归发现重复目录 `admin-local/admin-local/`） |
| #67 | 新建模块改为独立页面 `/modules/new`（不再弹窗） |
| #68 | 节点抽屉加 **watchdog 开关**（失败自动回滚锚点，全局互斥） |
| #69 | 补 `portal` / `shell` / `mcp-gateway` 流水线；dev/prod 因 SSH 已验证改为启用 |
| #70 | 剩余 10 个模块补齐 → **16 模块 × 3 环境 = 48 条** |

---

## 2. 系统现状（开工前核对用）

| 项 | 状态 |
|---|---|
| 分支 / 线上 | `master`；发布目录 `~/web_system_release` 已在 master；前端产物 `index-TwKQF6Px.js`；6200 HTTP 200 |
| 流水线 | 48 条，全部 `enabled=1`，**无 builtin**（内置「默认」已物理删除且不再懒建） |
| 节点形态 | 终态四节点 `git(shell) → build(shell) → gate(approval) → release(shell)`，release 带 `actions=[shell 上传产物, service write-version]` |
| `deploy_environments` | 已迁移为**复合主键 `(module_key, id)`**，51 行（48 回填 + 3 legacy）；备份 `/tmp/env-backup-2026-09-15081750.json` |
| 远程 | dev `175.27.189.123`(ubuntu) / prod `106.52.176.246`(root) **SSH 已通**，`/data/web_system` 可写 |
| 配置 | 工作区与发布目录 `.env` 已互相同步（`RELEASE_*` 路径 + `CONFIG_MASTER_KEY` / `RELEASE_HOOK_SECRET` / `PIPELINE_V5_NODES`）；备份 `/tmp/ws-env.bak`、`/tmp/rel-env.bak` |
| 回归 | `admin local`、`mcp-gateway local` 均真跑通（拉码 → 构建 → 审批 → 投递 → 写版本） |

---

## 3. 未完成（按优先级）

### 3.1 后台模块「部署生效」动作 —— ✅ 已完成（PR #72 + #73，已验证）

**问题**：后台投递脚本把产物放到 `servers/<key>/<流水线key>/<commit>/`，而服务实际运行的是 `servers/<key>/dist/`。
前端类无此问题（网关按指针直接读版本目录）。

**已实现**：`DeployService.deployVersion()` 改指针后，对 backend 模块调用 `applyBackendVersion()`：
复制版本目录 → `servers/<dir>/dist`（保留版本目录可回滚），旧 dist 备份 `dist.bak-<ts>`（留最近 3 份），
再重启 pm2（候选名：注册表 `pm2` 字段 → `web-<key>` → 裸 key，实测注册表存裸 key 而进程叫 `web-<key>`）。
仅 local 生效；dev/prod 需远程通道，暂只改指针并 warn。前端类仍只改指针。

**已验证**：`mcp-gateway` 部署到 local → dist 内容与 `mcp-gateway-local/49caaae` 一致、旧 dist 已备份、
`web-mcp-gateway` 进程重启成功（restarts 计数 +1、status online）。

- 落点参考：`servers/deploy-console/src/deploy/deploy.service.ts`（现按前端切指针实现）
- 路径常量：`command.service.ts` 的 `nodeBinDir()` / `pm2Bin()` / `pnpmBin()`（读 `RELEASE_NODE_BIN` / `RELEASE_PM2_BIN` / `RELEASE_PNPM_BIN`）
- 判据：backend 模块部署后 `dist/main.js` 更新且 pm2 进程重启，页面/接口可用

备选：② 改投递脚本直接覆盖 `dist/`（丢版本化，回滚能力弱）；③ 维持现状（那部署动作必须补，否则发布完不生效）。

### 3.2 其余模块的投递路径未逐个验证

48 条里只有 `admin`、`mcp-gateway` 真跑过。`kedou-ai-minigram` 的构建是 `node scripts/upload.js`（上传小程序），
它现在的 `PUBLISH_PATH` 是按「前端类」给的 `static/modules/kedou-ai-minigram`，**可能需要改**。

### 3.3 历史技术债（未做，不影响当前）

- 表名 `deploy_pipeline_templates`、字段 `templateId`、路由 `/pipeline-templates` 仍是「模板」命名（决策 #7 登记）
- `scripts/migrations/p3-pipeline-4nodes-env-split.mjs` 已标 DEPRECATED 保留（弯路记录）
- 流水线级 `defaultTarget` 后端仍在读（`pipeline.service.ts`），UI 已移除，保持默认 `auto`

---

## 4. 必读文件

| 文件 | 内容 |
|---|---|
| `specs/deploy-console/pipeline-edit-ui.md` | **UI 交互定稿**（页面路由 / Tabs / 基本信息字段 / 新建流程 / 抽屉分流 / §6.5 回滚语义） |
| `specs/pipeline-node-model/design.md` §3、§9 | 节点模型定义；§9 UI 交互定稿摘要 |
| `specs/pipeline-node-model/pipeline-configs.md` §5 | 48 条流水线终态清单 + **后台投递缺口** |
| `specs/module-env-ownership/design.md` | 环境归属（另一会话的工作，已合入） |

## 5. 关键代码锚点

| 文件 | 作用 |
|---|---|
| `servers/deploy-console/src/pipeline/pipeline.service.ts` | `submit()`（含环境一致性校验）、`approve()`、`isRollbackAnchor` 回滚判定 |
| `servers/deploy-console/src/pipeline-template/pipeline-template.service.ts` | `findGlobal()`（**只查不建**，内置默认不再被懒建） |
| `servers/deploy-console/src/shell/command.service.ts` | node / pm2 / pnpm 路径解析 |
| `apps/deploy-console/src/views/PipelineEdit.vue` | 编辑/新建页（4 Tabs + 抽屉 + watchdog 开关） |
| `apps/deploy-console/src/components/pipeline/PipelineVarPanel.vue`、`VarReferenceTable.vue` | 变量 / 参数面板（抽屉与页面 Tab 共用） |
| `scripts/migrations/p5-pipeline-shell-approval-3env.mjs` | 流水线终态迁移（幂等；`MODULES` 加模块即补流水线） |
| `scripts/migrations/p6-module-env-ownership.mjs` | 环境归属迁移（mysql2；可重复执行） |
| `scripts/publish-deploy-console.sh` | 发布脚本（同步 release 当前分支 → 构建 → 干净重启 6200） |
