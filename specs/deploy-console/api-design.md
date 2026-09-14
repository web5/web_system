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
### 7.4 `POST /mcp/pipeline/:jobId/promote` — 灰度转全量
### 7.5 `POST /mcp/version` — 发布指定版本（秒级切换）
- 入参：`{ env, versionTag, component?, confirm? }`（`env=prod` 需 `confirm=true`）；版本表无记录时回退 `switchPointer`
- 返回：`{ status, component?, versionTag, env, fallback? }`

### 7.6 `POST /mcp/rollback` — 回滚到指定版本
- 入参：`{ env, versionTag, component?, confirm? }`；返回 `{ taskId, status, env, versionTag }`

### 7.7 `GET /mcp/modules` — 可发布模块清单
### 7.8 `GET /mcp/current-versions?env=` — 某环境各模块当前版本
### 7.9 `GET /mcp/releases?env=&component=` — 版本历史（回滚候选，含磁盘产物）
### 7.10 `POST /mcp/mock-job` — **[dev-only]** 模拟长任务（`seconds`，1–600）；production 返回 404
### 7.11 `GET /mcp/mock-job/:jobId` — **[dev-only]** 查询模拟任务状态

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

## 附：与其他文档的衔接

- 流水线/节点模型接口 → `specs/pipeline-node-model/api-design.md`
- 发布平台整体设计 → `specs/release-platform/`
- 节点模型设计/配置/审批权限 → `specs/pipeline-node-model/` 下 `design.md` / `pipeline-configs.md` / `approval-permission-design.md`
- 静态产物缓存/版本保留 → `docs/architecture/static-artifact-cache-and-retention.md`
- 部署铁律（版本表库名、gateway TTL）→ `.codebuddy/CODEBUDDY.md` §4 / §2.5
