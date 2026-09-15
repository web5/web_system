# 任务：后台模块「部署生效」（方案 ①）—— 交接文档

> 给新对话用。开场可直接说：
> 「读 `specs/deploy-console/backend-deploy-effect-tasks.md`，从 T1 开始做」
>
> 最近更新：2026-09-15（**本机 local 部分已完成并验证**；剩 T1 远程 / T2 回滚 / T3 逐模块验证）

---

## 0. 背景与决策

**问题**：发布流水线把后台模块产物投递到**版本目录**
`servers/<dir>/<流水线key>/<commit>/`，而服务实际运行的是 `servers/<dir>/dist/`。
前端类（micro-frontend / frontend）没有这个问题 —— 网关按指针直接读版本目录；
但后台模块「部署」只改指针 = **没生效**。

**选定方案 ①（已与用户确认）**：在「模块管理 → 部署」里，对 **backend 模块**执行
「把版本目录内容落到 `dist/` + 重启 pm2」，与前端类的「切指针」并列。

优点：保留版本化（版本目录仍在，可回滚），前后端生效模型统一（前端切指针 / 后端换 dist + 重启）。

备选（未采用）：② 投递脚本直接覆盖 `dist/`（丢版本化）；③ 维持现状（等于发布完不生效）。

---

## 1. 已完成（本机 local）

| 项 | 内容 | 落点 |
|---|---|---|
| 落地 | 复制版本目录 → `servers/<dir>/dist`（**复制**，版本目录保留可回滚） | `DeployService.applyBackendVersion()` |
| 备份 | 旧 dist → `dist.bak-<ts>`，只保留最近 3 份 | 同上 |
| 重启 | pm2 候选名：注册表 `pm2` 字段 → `web-<key>` → 裸 key，成功即停 | 同上 + `CommandService.pm2Bin()` |
| 范围 | 仅 `env === 'local'`；dev/prod 只改指针并 warn | 同上 |
| 单测 | 8 条（落地+重启 / 备份 / 版本目录缺失报错 / 前端类不落地 / 非 local 只改指针 / pm2 名回退） | `deploy.service.spec.ts` |
| 验证 | `mcp-gateway` 部署到 local：dist 与版本目录一致、旧 dist 已备份、`web-mcp-gateway` 重启成功 | 2026-09-15 实测 |

PR：**#72**（落地 + 重启）、**#73**（pm2 进程名回退）。

> ⚠️ 实测坑：`deploy_modules.pm2` 存的是**裸 key**（如 `mcp-gateway`），
> 而 pm2 进程实际叫 `web-mcp-gateway`。所以必须有候选回退，不能只认注册表。

---

## 2. 待办任务

### T1 · 远程（dev / prod）后台部署生效

**现状**：`applyBackendVersion()` 在 `env !== 'local'` 时只 warn 并跳过。

**要做**：
1. 复用远程通道（`deploy_servers` 的 `host` / `ssh_user` / `ssh_key_path`，已验证 SSH 通、
   `/data/web_system` 可写）：`scp` 版本目录到远端临时目录 → 远端 `mv` 到 `servers/<dir>/dist`
   （先在远端备份旧 dist）→ 远端 `pm2 restart <name>`
2. 远端 pm2 名同样走候选回退
3. 失败策略：远端任一步失败 → 恢复备份、指针不更新（或回滚指针），返回明确错误

**V 判据**：
- V1：`deployVersion({moduleKey:'gateway', env:'dev', versionTag:'gateway-local/<commit>'})`
  执行后，远端 `175.27.189.123:/data/web_system/servers/gateway/dist` 内容与版本目录一致
- V2：远端 pm2 进程（`web-gateway`）被重启，`status=online`
- V3：中途失败（如 scp 断）时远端保留旧 dist，且接口返回错误而非"成功"
- V4：有单测覆盖「远端成功路径」与「失败回滚」（mock `ssh2`）

---

### T2 · 回滚动作（后台）

**现状**：只有"部署（切到某版本）"，回滚走的是"再部署一次旧版本"—— 目前可用
（因为版本目录保留），但**没有一键回滚 + 未验证旧版本目录是否总在**。

**要做**：
1. 「回滚」按钮对 backend 模块：取上一版本 tag → 走与部署相同的落地 + 重启流程
2. 兜底：版本目录缺失时，用最近的 `dist.bak-<ts>` 恢复
3. 前端类保持现有"切指针"回滚

**V 判据**：
- V1：部署 A → 部署 B → 回滚 → `dist` 内容 == A，pm2 重启成功
- V2：删掉 A 的版本目录后回滚 → 用 `dist.bak-*` 恢复成功（有 warn 日志）
- V3：单测覆盖两条路径

---

### T3 · 其余模块逐个验证投递路径

**现状**：48 条流水线（16 模块 × 3 环境）里只有 `admin`、`mcp-gateway` 真跑过。

**要做**：每类至少跑一条 local 全链路（拉码 → 构建 → 审批 → 投递 → 部署生效）：
- 前端类：`portal`（micro-frontend）、`shell`（frontend）
- 后台：`gateway`、`ai-agent`（跑通后顺带验证 T1 前的本机流程）
- 特殊：`mini-contract` —— 它的构建是 `node scripts/upload.js`（上传小程序），
  当前 `PUBLISH_PATH` 是按前端类给的 `static/modules/mini-contract`，**大概率要改**

**V 判据**：
- V1：每条跑通 `succeeded`，版本记录写入
- V2：前端类产物出现在 `static/modules/<key>/<流水线key>/<commit>/`，页面可加载
- V3：后台类部署后 `dist` 更新 + pm2 重启
- V4：不通的模块记录原因并修正 `PUBLISH_PATH` / 构建命令（改 `p5` 的 `MODULES` 后重跑）

---

## 3. 代码锚点

| 文件 | 位置 / 作用 |
|---|---|
| `servers/deploy-console/src/deploy/deploy.service.ts` | `deployVersion()`（改指针入口）、`applyBackendVersion()`（落地 + 重启，含 pm2 候选回退） |
| `servers/deploy-console/src/shell/command.service.ts` | `pm2Bin()` / `pnpmBin()` / `nodeBinDir()` / `exec()`（读 `RELEASE_PM2_BIN` 等） |
| `servers/deploy-console/src/deploy/deploy.module.ts` | 已引入 `ShellModule`（提供 `CommandService`） |
| `servers/deploy-console/src/deploy/deploy.service.spec.ts` | 现有 8 条相关单测 |
| `scripts/migrations/p5-pipeline-shell-approval-3env.mjs` | `MODULES`（改投递路径后重跑即生效）、`localUploadScript` / `remoteUploadScript` |
| `scripts/migrations/p6-module-env-ownership.mjs` | 环境归属（deploy_environments 复合主键） |

## 4. 相关文档

- `specs/pipeline-node-model/P1-handoff.md` —— 本轮总体交接（含 48 条流水线、未完成项）
- `specs/deploy-console/pipeline-edit-ui.md` —— UI 交互定稿
- `specs/pipeline-node-model/pipeline-configs.md` §5 —— 流水线清单与「后台投递缺口」记录
