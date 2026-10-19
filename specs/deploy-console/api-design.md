# 部署控制台（deploy-console）· 接口契约总文档（api-design）

> 服务：`servers/deploy-console`（控制台，端口 6200）
> Base Path：`/api`（gateway 代理 / 直连 6200 同）
> 读者：工程 AI 自进化 + 前后端对齐。运行时真相源见 `http://<deploy-console>:6200/api/docs`（Swagger）。
> 范围：本文件覆盖**非流水线/节点模型**的运营、配置、监控、审计、MCP、CI 发布入口等模块。流水线相关（`pipelines` / `pipeline-vars` / `pipeline-templates` / `modules/:key/stage-commands` / `pipeline-templates/:id/steps` / `canary` / `environments` / `modules` / `modules/:key/branches`）见 `specs/pipeline-node-model/api-design.md`。

## 0. 通用约定

- **鉴权**：全局 `JwtAuthGuard`（`APP_GUARD`）保护全部路由，除标记 `@Public()` 的端点。
  - 控制台类：请求头 `Authorization: Bearer <console-jwt>`。
  - `POST /auth/login`（公开，返回 JWT）。
  - `/hooks/*`：HMAC-SHA256 签名（`X-Hub-Signature-256` + `X-Ws-Timestamp`），不走 JWT。
  - `/mcp/*`：`@Public()` 关闭 JWT 后由 `McpKeyGuard`（每用户 API Key → `req.mcpOperator`）鉴权。
- **写操作审计**：配置/通知渠道/环境/模块/工具/监控重启/系统设置等写接口统一落 `audit` 表。
- **prod 约束**：发布类接口 `env=prod` 需 `confirm=true`，否则 `400`。
- **命令注入防护**：拼进 shell/git 的参数（`service`/`port`/`branch`/`key` 等）均有白名单，非法即 `400`。
- **构建隔离门禁**：流水线提交前及实际 shell 执行前校验工作目录/`RELEASE_DIR`；与运行根重合、包含或经软链重合时拒绝。Git 工作区未提交内容或清理预览非空时不执行拉码/清理。
- **服务器运行根**：部署、远端后端产物巡检和快照列表共用环境级/全局运行根解析，默认 `/data/web_system`，旧 `web_system_git` 不能继续作为新目标。旧格式后端在改写 dist 前核对 PM2 的实际入口；登记树与运行树不同则拒绝，不能只重启另一棵树的同名进程后报成功。目录实迁移须使用离线计划和维护窗口，构建/静态/独立依赖根不合并。
- **目录切换门禁**：`RELEASE_WORKSPACE_CUTOVER_MS` 为可选正整数毫秒时间戳。切换前的历史发布单审批恢复返回 `409`，在改审批状态和启动脚本前拒绝；须在新目录重新提交并复核，不能自动恢复旧任务。
- **编排构建前置**：新编排中 `git` 任务成功后，先校验实际 commit，再等待既有 pull 收尾钩子完成依赖同步和共享包预构建，之后才进入后续构建步骤；从发布确认恢复时不重复已完成的拉码/准备动作。收尾钩子的依赖失败处理沿用既有语义，不把本条当作安装成功保证。
- **依赖锁定**：发布目录的依赖安装使用 `--frozen-lockfile`，不得在发布过程中重写锁文件；安装失败不写入成功指纹。
- **后端依赖打包**：pnpm 10 使用共享锁文件的新 deploy 路径，仅本次命令启用 workspace 注入和 isolated linker；不改仓库配置。禁止 legacy deploy（hoisted 工作区中会忽略锁文件并重新解析版本）。运行包离线从冻结锁与已有 store 生成，不回落联网解析。
- **重复指针写入**：脚本激活后流水线收尾再次写入同一版本时，保留原 previous_version；只有版本实际变化才推进回滚历史。编排 stage 随实际运行/待审批步骤更新，不固定停留在 git。
- **重复提交**：同模块同环境在 pending、running 或待审批状态均拒绝新提交；提交检查与记录创建由独立原子锁串行化，避免待审批产物被下一次构建覆盖。旧任务须先完成/取消，再提交新构建。
- **shell 恢复**：shell/site-version 校验目标环境版本目录中的 index.html，通过应用域写版本并刷新 gateway 缓存，不生成微前端 index.js 指针、不降级成后端或整站恢复。
- **shell 版本选择**：应用版本列表按请求环境按需列举 HTML 版本，并标记 current/previous；入口 URL 使用 `<envId>/<version>/index.html`，不再返回空候选或 JS 地址。进入概览不额外批量探测生产产物，实际切换/回滚仍须单独确认。
- **dev 手动探活通道**：服务健康接口默认保持 direct HTTP。可通过 `SERVICE_HEALTH_TRANSPORT_DEV=ssh` 显式启用 dev 登记 PM2 主机内探活：使用该服务环境绑定的具体主机和既有 SSH 凭据，在目标机请求登记端口的 loopback HTTP，不回落到控制台本机或环境默认主机。显式 upstream URL 仍直连；非 PM2、无主机/端口、SSH 故障或异常结果如实失败。响应包含 transport、probeHost、probeTarget，界面标明 SSH 路径；不改业务上游、不新增公网暴露，未配置的 prod/local 行为不变。
- **shell 验证**：release-verify 以应用域指针与 Fact 的 HTML 入口探测分别验证版本、产物，不要求不存在的 JS 指针。事实采集期间指针变化、只有 JS 指针或目录非空都不能判定 HTML 就绪；HTTP 与配置摘要仍在 knownGaps 单独披露。
- **shell 提案真相源**：release-plan 与 release-verify 均读取应用域当前指针，不以 legacy deploy_deployments 的上次发布记录替代回滚后的实际应用指针。
- **隔离后端产物**：web-system-runtime-v1 产物包含 dist、独立 node_modules、身份/平台/Node ABI 和文件摘要。适配该格式的发布先检查完整性，再切目标服务 dist 并只重启所属进程；真实 HTTP 和端口归属验证失败时恢复原 dist。运行仓库不执行拉码、reset 或依赖安装/共享包重建；旧格式保持兼容，不以新格式的验收结果替代旧模板评审。
- **后端运行位置**：隔离产物激活到目标用户的 web_system_runtimes 独立目录，dist 只链接到该版本，环境文件链接回原服务目录；可用 BACKEND_RUNTIME_ROOT_DEV 等环境配置指定根。禁止与运行仓库或构建根重合，不能沿用 NODE_PATH/保留 symlink 的运行参数来回落共享依赖。
- **旧模板迁移门**：已知的 RROOT 运行仓库 reset 同步脚本在提交、审批恢复、实际编排前返回 409，拒绝前不改变审批状态；这是旧模板迁移门，不是任意 shell 的安全沙箱。未迁移的 prod 模板不放行，不影响现有服务运行。
- **后端指针与回退**：编排保存后端模块类型，不走前端收尾的纯 commit 指针；只有部署探活通过后的动作才能推进后端完整版本引用。后端回退从取版本到恢复结束持有唯一操作锁，不能与在途发布交叉覆盖。
- **提案能力边界**：后端运行包不适用静态 index.js 入口检查。只读提案不连接目标机时明确返回 unknown，不能伪造已通过；由投递后的格式/摘要校验、进程与 HTTP 探活补证。

---

## 1. 认证 `auth`（AuthController → `auth`）

### 1.1 `POST /auth/login`（公开）— 登录
- 入参 `LoginDto`：`{ username: string; password: string }`
- 返回：`{ token, ... }`（失败 `401 用户名或密码错误`）
- 实现代理给 `auth-service`（system=deploy）

### 1.2 `GET /auth/profile` — 当前用户信息
- 返回：`req.user`（JWT 解析结果）

---

## 2. 部署管理 `deploy`（DeployController → `deploy`，**部分已弃用**）

> ⚠️ 动作类端点（`build/deploy/rollback/publish-version/modules/publish`）**已弃用**，统一走 `POST /pipelines` 流水线；保留仅兼容旧调用方。查询类端点继续保留。

### 2.1 已弃用（deprecated）—— 仅旧调用方
- `POST /deploy/build` — 启动本地构建
- `POST /deploy/deploy` — 启动部署（prod 需 `confirm=true`）
- `POST /deploy/rollback` — 回滚（prod 需 `confirm=true`）
- `POST /deploy/publish-version` — 发布指定版本（秒级切换，prod 需 `confirm=true`）
- `POST /deploy/modules/publish` — 发布微前端模块（prod 需 `confirm=true`）

### 2.2 保留（查询 / 写版本记录）
- `GET /deploy/tasks` — 部署任务列表
- `GET /deploy/task/:id` — 任务详情（不存在 `404`）
- `GET /deploy/stream/:taskId` — SSE 实时推送部署日志（`text/event-stream`）
- `GET /deploy/versions?env=&component=` — 发布版本记录列表
- `GET /deploy/modules` — 可发布模块列表
- `GET /deploy/module-deployments/:moduleKey` — 模块各环境当前版本 + 历史
- `POST /deploy/modules/:moduleKey/versions` — 写版本记录（流水线「发布」节点脚本调用）
  - 入参：`{ versionTag, env?, gitCommit?, gitBranch?, note? }`
- `POST /deploy/modules/:moduleKey/envs/:env/deploy` — 部署版本（改指针，不探活）
  - 入参：`{ versionTag }`
- `GET /deploy/current-versions?env=` — 环境各模块当前版本
- `GET /deploy/releases?env=` — 远程可用发布版本目录

---

## 3. 配置中心 `config`（ConfigController → `config`，**仅控制台 JWT，不暴露 MCP**）

> 安全边界：列表接口对密钥只返回掩码；明文只在发布/重启注入进程时服务端解密使用，不经任何 HTTP 响应。

### 3.1 `GET /config/items?scope=&envId=&moduleKey=` — 配置项列表（密钥掩码）
### 3.2 `PUT /config/items` — 新增/更新配置项（密钥加密存储）
- 入参 `UpsertConfigDto`：`{ scope, envId?, moduleKey?, key, value?, isSecret? }`
- 审计：密钥只记「已变更」，绝不明文入审计
### 3.3 `DELETE /config/items/:id` — 删除配置项
### 3.4 `POST /config/snapshots` — 生成配置快照
- 入参：`{ envId, moduleKey, versionTag }`（缺任一 `400`）
### 3.5 `POST /config/snapshots/restore` — 回滚配置到指定版本快照
- 入参：`{ envId, moduleKey, versionTag }`

---

## 4. 通知 `notifications`（NotificationController → `notifications`，仅控制台 JWT）

> 通道配置经服务端环境变量（`NOTIFY_WEBHOOK_URL` / `NOTIFY_WECOM_URL`）管理，不暴露写入接口。

### 4.1 `GET /notifications/channels` — 通道配置状态（是否已接通）
### 4.2 `GET /notifications?limit=` — 通知历史（站内，`limit` 须为数字）

---

## 5. 服务监控与诊断 `monitor`（MonitorController → `monitor`，仅控制台 JWT）

> 任务 23：端口检测/进程重启/日志检索页面化，无需 SSH。读取类不写库；重启属运维操作留审计。

### 5.1 `GET /monitor/health?env=` — 服务健康检查
### 5.2 `GET /monitor/pm2?env=` — 远程 PM2 进程列表
### 5.3 `GET /monitor/logs?env=&service=&lines=&keyword=` — 拉取远程日志（`LogsQueryDto`：`service`/`lines?`，`lines` 默认 100；`keyword` 结果侧过滤，不进命令）
### 5.4 `POST /monitor/pm2/restart?env=&service=` — 重启远程服务（`service` 白名单 `^[a-zA-Z0-9_-]+$`，写操作留审计）
### 5.5 `GET /monitor/port?env=&port=` — 端口占用检测（`lsof LISTEN`，`port` 须 1–65535）
### 5.6 `GET /monitor/local/pm2` — 本机 PM2 进程列表
### 5.7 `GET /monitor/local/health` — 本机健康检查
### 5.8 `GET /monitor/local/logs?service=&lines=&keyword=` — 本机日志
### 5.9 `POST /monitor/local/pm2/restart?service=` — 重启本机服务（`service` 白名单，留审计）
### 5.10 `GET /monitor/local/port?port=` — 本机端口占用检测

#### 取数口径（2026-09-24 起，契约评审：`docs/api/reviews/monitor-env-scope-20260924.md`）

- **环境视角的 5.1–5.5：目标主机与地址来自「主机管理」**
  `deploy_service_envs(env_id, service_key) → host_name` → `deploy_hosts(name).host / sshUser / sshKeyPath`。
  旧表 `deploy_servers` 的 `<env>-default` 仅在发布侧作回退（前端模块尚未登记进 `deploy_service_envs`）。
- **可管环境**：`managed_by` 为空（所有控制台可见）或等于本实例 `CONSOLE_INSTANCE`。
  请求**不可管环境** → `502`（文案：`环境 <env> 在「主机管理」中没有可解析且归属本控制台的主机`）。
- **SSH 私钥缺失**不再静默：抛 `502` 并给出主机 / 用户 / 密钥路径（此前是 `privateKey=undefined` 导致一片 timeout）。
- **健康探活**：每台主机**只建一条 SSH 连接**，一条命令并行探完该主机所有端口；
  探测目标先 `127.0.0.1:<port>/health`，`000` 再退 `host:<port>/health`；`execSsh` 超时 30s。
- **`CONSOLE_INSTANCE` 为部署期必配项**：缺失即启动 FATAL（与 `CONFIG_MASTER_KEY` 同规格，不兜底）。

### 5.11 `GET /monitor/envs` — 当前控制台可管的环境列表

- 返回：`[{ id, name }]`；推导见上「可管环境」
- 用途：替代前端硬编码的 `local/dev/prod` 页签（dev 控制台 → `dev/prod`；编排者本机控制台 → `local/dev/prod`）

### 5.12 `GET /monitor/pm2/hosts?env=` — PM2 进程（**按主机分组**，逐台取数）

- 返回：`[{ name, host, scope, runtime, ok, error?, tookMs, procs }]`
  - `procs` 元素同 5.2（`name/pid/status/cpu/memory/uptime/restarts/port`）
  - `ok=false` 时 `error` 为该主机的取数失败真因（SSH 连接失败 / 超时 / jlist 解析失败）
- 单台失败不影响其它主机；**不可达主机的分组仍然返回**（不整块消失）

---

## 6. 审计日志 `audit`（AuditController → `audit`，仅控制台 JWT）

### 6.1 `GET /audit/list?page=&limit=` — 分页查询审计日志
- `page` 默认 1，`limit` 默认 20

---

## 7. MCP 发布接口 `mcp`（McpController → `mcp`，`@Public()` + `McpKeyGuard`）

> 与控制台 `pipelines` 区别：鉴权走 API Key（操作人 `req.mcpOperator`）；返回结构对齐任务语义（jobId/status/progress/logs）；`mcp-gateway` 是唯一 MCP 端点，此处为其背后执行接口。

### 7.1 `POST /mcp/pipeline` — 提交发布流水线（异步，返回 jobId）
- 入参（松散 `any`）：`{ env, moduleKey, mode?, versionTag?, target?, grayscaleRule?, confirm? }`（`env=prod` 需 `confirm=true`）
- 返回：`{ jobId, status }`

### 7.2 `GET /mcp/pipeline/:jobId` — 查询流水线状态/进度/日志
- 返回：`{ jobId, env, moduleKey, versionTag, mode, status, stage, progress, logs, error, result, operator, startTime, endTime }`

### 7.3 `POST /mcp/pipeline/:jobId/cancel` — 取消（幂等）
- 编排实例构建完成且处于 running 时返回 409，不强杀交付/激活中的远端命令；等待执行结果后使用模块级回滚。待审批仍可取消并关闭审批单。
- 构建中的取消保留取消标记和执行锁，直到后台执行器停止；最后一个动作完成时也检查取消标记，不能把已取消任务收尾成成功或推进指针。
### 7.4 `POST /mcp/pipeline/:jobId/promote` — 灰度转全量
### 7.5 `POST /mcp/pipeline/:jobId/approve` — 审批通过
- 入参：`{ comment?, nodeKey?, confirm? }`（`env=prod` 需 `confirm=true`，否则 `400`）
- 返回：`{ jobId, id, status: 'approved', resumedFrom? }`
- 约束（与控制台一致，**不因通道放宽**）：
  - 仅**提交者本人**可审批（`p.operator === req.mcpOperator`，不符返回 `404` 而非 403）
  - 审批人由 Key 的 `ownerId` 解析成用户名（ownerId 直接当用户名必然 403），权限仍走 `deploy:pipeline:approve`
- 背景：补齐「自动化发布最后一公里」——此前挂起 `awaiting-approval` 后 MCP 无审批路由，只能自签控制台 JWT

### 7.6 `POST /mcp/pipeline/:jobId/reject` — 审批拒绝
- 入参：`{ comment, nodeKey? }`（`comment` 必填，空则 `400`）；返回 `{ jobId, id, status }`

### 7.7 `POST /mcp/version` — 发布指定版本（秒级切换）
- 入参：`{ env, versionTag, component?, confirm? }`（`env=prod` 需 `confirm=true`）；版本表无记录时回退 `switchPointer`
- 返回：`{ status, component?, versionTag, env, fallback? }`

### 7.8 `POST /mcp/rollback` — 指定模块回滚到目标版本
- 入参：`{ env, versionTag, component, confirm? }`；返回 `{ taskId, status: 'started', env, versionTag }`。
- `component` 必填并参与真实执行；env-dir 应用复用应用域指针切换，后端复用模块级版本恢复，不调用整站 `rollback.sh` 或 `pm2 restart all`。
- 缺少 `component`、非法环境/版本引用返回 `400`，不创建任务；`env=prod` 仍必须 `confirm=true`。
- 模块不存在、目标产物缺失等执行期错误落任务 `failed`；HTTP `started` 不表示回滚已成功。
- 任务到达 `success` 才表示回滚已完成；模块回滚失败记 `failed`，不得降级为整站恢复。
- 兼容性变更（2026-10-17）：旧调用未传 `component` 现在被拒绝，调用方须升级；遗留整站恢复不再经本 MCP 入口暴露。

### 7.9 `GET /mcp/modules` — 可发布模块清单
### 7.10 `GET /mcp/current-versions?env=` — 某环境各模块当前版本
### 7.11 `GET /mcp/releases?env=&component=` — 版本历史（回滚候选，含磁盘产物）
### 7.12 `POST /mcp/mock-job` — **[dev-only]** 模拟长任务（`seconds`，1–600）；production 返回 404
### 7.13 `GET /mcp/mock-job/:jobId` — **[dev-only]** 查询模拟任务状态

---

## 8. 服务器组 / 环境服务路由 `servers` `env-service-routes`（ServerController → 两 controller 合一文件）

### 8.1 `GET /servers?serverName=` — 列出服务器（可按 serverName 过滤）
### 8.2 `POST /servers` — 新增服务器（归属某 serverName 组）
- 入参 `ServerDto`：`serverName` `host` `sshUser` `remoteDir`（必填）；`sshKeyPath?`（选填）
### 8.3 `DELETE /servers/:id` — 删除服务器
### 8.4 `GET /env-service-routes/overview` — 服务地址总览（服务 × 环境 大表）
### 8.5 `GET /env-service-routes?env=` — 列出环境服务路由
### 8.6 `POST /env-service-routes` — 新增/更新路由（服务名 → serverName）
- 入参 `EnvServiceRouteDto`：`envId` `serviceName` `serverName`（必填）；`port?`（选填）
### 8.7 `DELETE /env-service-routes/:id` — 删除路由

---

## 9. 系统设置 `system-settings`（SystemSettingsController → `system-settings`，仅控制台 JWT）

### 9.1 `GET /system-settings/notify-channels` — 通知渠道配置（DB 优先，env 兜底）
- 返回：`{ webhookUrl, wecomUrl }`（非机密，允许回显）
### 9.2 `PUT /system-settings/notify-channels` — 更新通知渠道（空串=关闭）
- 入参：`{ webhookUrl?, wecomUrl? }`
### 9.3 `GET /system-settings/approval-envs` — 需审批环境列表（逗号分隔，默认 `prod`）
### 9.4 `PUT /system-settings/approval-envs` — 更新审批门禁环境
- 入参：`{ envs?: string }`（逗号分隔，清空回落默认 `prod`）

---

## 10. 工具目录 `tools`（ToolCatalogController → `tools`，仅控制台 JWT）

> `service` 工具=内置执行器（探活/写版本/切指针/回滚等，与流水线步骤对应）；`shell` 工具=外部 CLI 元数据。写操作审计。

### 10.1 `GET /tools?category=&kind=` — 工具列表（分类/kind 过滤，自动补齐种子）
### 10.2 `POST /tools` — 新增 shell 工具（code 由名称生成）
- 入参 `ToolSpec`（含 `name`/`kind`/`category`/`description?`/`example?` 等）
### 10.3 `PUT /tools/:code` — 编辑工具（说明/示例/分类/可用性）
- 入参：`Partial<Omit<ToolSpec,'name'>>`
### 10.4 `DELETE /tools/:code` — 删除工具（**内置不可删除**）

---

## 11. CI/CD 发布触发 `hooks`（ReleaseHookController → `hooks`，`@Public()` + HMAC）

> 与控制台/MCP 并列的第三条发布入口，**不新增执行路径**——内部仍调 `PipelineService.submit`，锁/审批/审计/通知/度量/回滚语义三者一致。不返回任何敏感信息（无密钥/内部路径/阶段日志）。

### 11.1 `POST /hooks/release` — 提交发布意图（HMAC 签名 + deliveryId 幂等）
- 鉴权：必须用**原始请求体**（`req.rawBody`）验签 `sha256=hmac(secret, rawBody)` + `X-Ws-Timestamp`
- 入参（松散）：CI 事件体 → `hooks.parse` 转 `SubmitPipelineDto` 形态
- 返回：`PipelineService.submit` 结果

### 11.2 `GET /hooks/pipelines/:jobId` — 查询流水线状态（供 CI 轮询至终态）
- 鉴权：复用触发端 HMAC，GET 无请求体，签名对象为空串 `sha256=hmac(secret, `${ts}.`)`
- 返回：流水线状态（不含敏感信息）

---

## 12. 发布度量 `metrics`（MetricsController → `metrics`，仅控制台 JWT）

> 数据全部来自 `deploy_pipelines` 聚合，无需额外埋点。所有接口支持 `env?` `moduleKey?` `from?` `to?`（时间戳，毫秒；`from>to` → `400`）。

### 12.1 `GET /metrics/releases/overview` — 发布概览（成功率、平均/P95 时长）
### 12.2 `GET /metrics/releases/trend` — 按天发布趋势（成功/失败）
### 12.3 `GET /metrics/releases/stage-failures` — 失败阶段分布
### 12.4 `GET /metrics/releases/top-modules?limit=` — 发布频次 Top N
### 12.5 `GET /metrics/releases/failures?stage=&limit=` — 失败下钻（具体失败记录与错误）

---

## 13. 流水线配置版本 `pipelines/:id/revisions`（PipelineOrchestrationController，仅控制台 JWT）

> 2026-09-29 新增。给「流水线定义」装时间机器：每次保存编排树即生成快照，可回看、可恢复。
> 详细设计（只增语义、恢复约束、取号方式）见 `specs/pipeline-step-task/design.md` §5.1。

### 13.1 `GET /pipelines/:id/revisions` — 版本列表（不含快照正文，倒序）
- 流水线不存在 → `404`（不再返回 200 空列表，避免 Agent 调用时静默失效）
- 返回：`[{ id, rev, source, summary, restoredFromRev, createdBy, createdAt }]`

### 13.2 `GET /pipelines/:id/revisions/:rev` — 单个版本（含完整快照正文）
- 版本不存在 → `404`；快照结构损坏 → `400`
- 返回：列表项 + `snapshot: { pipeline, steps: [{ ..., tasks: [{ ..., actions: [{ ..., script }] }] }] }`

### 13.3 `POST /pipelines/:id/revisions/:rev/restore` — 恢复到指定版本
- 入参：`{ confirm: true, expectedRev?: number }`
  - `confirm !== true` → `400`（该操作整体替换当前编排树，与 prod 发布同一先例）
  - `expectedRev` 与当前版本不符 → `409`（乐观锁，防覆盖他人改动）
- 权限：需 `deploy:pipeline:approve`；`user-service` 不可达时**降级放行**并记 `warn` 审计（与发布审批同策略）
- 语义：**不回退历史** —— 以旧快照全量重建编排树（保留原 id）后**追加新版本**；恢复前还会对当前树先打一份快照，保证恢复本身可反悔
- 返回：`{ rev: <新版本号>, restoredFromRev: <来源版本> }`

### 13.4 副作用：保存类接口自动打版本
`PUT /pipelines/:id/steps`、`PUT /pipelines/:id/steps/:stepId/tasks`、`DELETE /pipelines/:id/steps/:stepId`
成功后各生成一个新 revision。**快照失败不推翻保存结果**（记审计 `pipeline-orchestration.revision.failed` 后返回 200）——
保存事务已提交，此时报 500 会让前端误显示「保存失败」而配置其实已落库。

---

## 附：与其他文档的衔接

- 流水线/节点模型接口 → `specs/pipeline-node-model/api-design.md`
- 发布平台整体设计 → `specs/release-platform/`
- 节点模型设计/配置/审批权限 → `specs/pipeline-node-model/` 下 `design.md` / `pipeline-configs.md` / `approval-permission-design.md`
- 静态产物缓存/版本保留 → `docs/architecture/static-artifact-cache-and-retention.md`
- 部署铁律（版本表库名、gateway TTL）→ `docs/development/admin-dev.md` §一·C
