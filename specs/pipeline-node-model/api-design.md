# 发布流水线 / 节点模型 · 接口契约（api-design）

> 模块：`servers/deploy-console`（控制台，端口 6200）
> 适用分支：`feat/from-zero-bootstrap-prod-release`（pipeline-node-model 批次）
> 配套设计文档：`specs/pipeline-node-model/design.md`、`./pipeline-configs.md`、`./approval-permission-design.md`
> 运行时真相源：非 production 环境访问 `http://<deploy-console>:6200/api/docs`（Swagger，由 `@nestjs/swagger` 注解自动生成），本文档为「先文档」落盘版，供工程 AI 自进化与前后端对齐。

## 0. 通用约定

- **Base Path**：所有接口前缀 `/api`（gateway 代理 / 直连 6200 同）。下文路径均省略 `/api`。
- **鉴权**：全局 `JwtAuthGuard`（`APP_GUARD`）保护全部路由，除标记 `@Public()` 的端点。
  - 控制台类接口：请求头 `Authorization: Bearer <console-jwt>`，操作人取 JWT 内的 `username`。
  - `POST /auth/login`（公开）、`/hooks/*`（HMAC 签名）、`/mcp/*`（`@Public()` + `McpKeyGuard`，API Key 鉴权，操作人取 `req.mcpOperator`）为三条特例入口。
- **写操作审计**：几乎所有写接口（create/update/delete/审批/重启/配置）统一落 `audit` 表，本文档不逐条复述审计动作，仅标注「写操作留审计」。
- **prod 约束**：涉及 `env=prod` 的提交/发布类接口，多数要求请求体显式带 `confirm=true`（运行时判断，非 DTO 强校验），否则 `400 Prod operations require confirm=true`。
- **命令注入防护**：`branch` / `commitId` / `service` / `port` 等会拼进 shell/ git 的参数均有白名单校验（正则），非法即 `400`。
- **响应结构**：成功返回业务对象/数组；失败返回全局异常过滤器统一结构（非 HttpException 在生产环境透出「服务器内部错误」）。

---

## 1. 发布流水线 `pipelines`（PipelineController → `pipelines`）

> 控制台 JWT 入口；等价 MCP 能力见 `mcp/pipeline/*`（api-design 总文档）。二者共用同一个 `PipelineService`。

### 1.1 `POST /pipelines` — 提交发布流水线（异步）
- 入参 `SubmitPipelineDto`：

  | 字段 | 类型 | 必填 | 说明 |
  |---|---|---|---|
  | `env` | string | 是 | 目标环境（受 `SUPPORTED_ENVS` 约束） |
  | `moduleKey` | string | 是 | 模块 key |
  | `mode` | `'direct' \| 'grayscale'` | 否 | 默认 `direct`；`grayscale` 写灰度规则不切 stable 指针 |
  | `branch` | string | 否 | 目标分支，默认 `master`（拼进 git 命令，白名单 `^[A-Za-z0-9._/-]{1,128}$） |
  | `commitId` | string | 否 | 目标 commitId（短哈希）；不传取分支最新 |
  | `versionTag` | string | 否 | **@deprecated** 等价于 `commitId`，兼容旧调用 |
  | `templateId` | string | 否 | 流水线模板 ID；不传 = 模块默认模板 |
  | `target` | `'local' \| 'remote'` | 否 | 投递目标；默认自动判定 |
  | `grayscaleRule` | Record<string,unknown> | 否 | `mode=grayscale` 时必填：`{ type:'percent'|'user-list'|'header', ... }` |
  | `confirm` | boolean | prod 必填 | 透传字段（不在 DTO 内，运行时判断），`env=prod` 且 `confirm!==true` → `400` |

- 返回：`{ jobId, status, approvalId? }`（需审批环境返回 `approvalId`）
- 副作用：异步执行引擎（构建→投递→写版本表→切指针→等 gateway TTL 验证→清理）；写审计；触发通知

### 1.2 `GET /pipelines` — 流水线列表
- Query：`env?` `moduleKey?` `templateId?` `limit?`（默认 20）
- 返回：流水线记录数组（状态/阶段/进度/操作人等）

### 1.3 `GET /pipelines/meta/releases` — 可发布版本（含磁盘产物）
- Query：`env?` `component?`
- 返回：版本表记录 + 磁盘上未登记的历史产物，按 `versionTag` 去重（回滚候选）

### 1.4 `GET /pipelines/meta/summary` — 各模板运行摘要
- Query：`templateIds?`（逗号分隔）
- 返回：总次数 / 成功数 / 最近执行时间等

### 1.5 `GET /pipelines/:id` — 流水线详情
- 返回：状态 / 阶段 / 进度 / 日志 / 结果 / 操作人 / 起止时间

### 1.6 `POST /pipelines/:id/cancel` — 取消（幂等）
- 立即 `SIGKILL` 后台 shell；已结束任务返回原终态

### 1.7 `POST /pipelines/:id/promote` — 灰度转全量
- 将灰度规则生效版本切为 stable 指针

### 1.8 `GET /pipelines/meta/approvers` — 可审批人
- 返回：拥有 `deploy:pipeline:approve` 权限的系统用户列表

### 1.9 `POST /pipelines/:id/retry` — 重试失败流水线
- 相同参数重新提交

### 1.10 `POST /pipelines/:id/approve` — 审批通过
- 入参：`{ comment?: string; nodeKey?: string }`
- 通过后继续执行；节点级挂起则从该节点之后继续

### 1.11 `POST /pipelines/:id/reject` — 审批拒绝
- 入参：`{ comment: string; nodeKey?: string }`，**`comment` 必填**（否则 `400 拒绝必须填写审批意见`）
- 仅待审批 / 节点挂起流水线可拒绝

### 1.12 `DELETE /pipelines/:id` — 删除执行记录
- 纯清理，**仅终态可删**；`running/pending` → `400`

---

## 2. 流水线变量 `pipeline-vars`（PipelineVarController → `pipeline-vars`）

> 变量属于**某一条流水线**（非全局/模板级），执行时按 `pipelineId` 解析注入节点脚本环境。

### 2.1 `GET /pipeline-vars?pipelineId=` — 变量列表（密钥掩码）
- Query：`pipelineId`（必填，否则 `400`）
- 返回：`PipelineVarItem[]`（`isSecret=true` 时 `value` 为 `********` 掩码）

### 2.2 `POST /pipeline-vars` — 新增变量
- 入参：`pipelineId`（必填）+ `UpsertPipelineVarSpec`：

  | 字段 | 类型 | 必填 | 说明 |
  |---|---|---|---|
  | `key` | string | 是 | 键，白名单 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`，同流水线内唯一 |
  | `value` | string | 否 | 值（密钥留空表示空） |
  | `isSecret` | boolean | 否 | 是否密钥，默认 false |
  | `description` | string | 否 | 说明 |
  | `enabled` | boolean | 否 | 默认 true；未启用变量执行时不注入 |

- 返回：新建的 `PipelineVarItem`（掩码视图）
- 写操作留审计

### 2.3 `PUT /pipeline-vars/:id` — 编辑变量
- 入参：`Partial<UpsertPipelineVarSpec>`
- **密钥语义**：`value` 为空且 `isSecret=true` 时不更新值（避免把掩码字符串写回覆盖真实密钥）

### 2.4 `DELETE /pipeline-vars/:id` — 删除变量
- 返回 `{ ok: true }`；写操作留审计

---

## 3. 流水线模板 `pipeline-templates`（PipelineTemplateController → `pipeline-templates`）

> 模板 = 全局流水线定义（不绑定模块，执行时选目标模块）；历史模块专属模板兼容可用。路由挂在根 `/pipeline-templates`。

### 3.1 `GET /pipeline-templates?moduleKey=` — 模板列表
- Query：`moduleKey?`；有值时返回该模块可用（全局 + 专属），否则全部

### 3.2 `POST /pipeline-templates` — 新建全局模板
- 入参：`TemplateSpec`（模板规格：name/key/description/steps/nodes/skipVerify/rollbackOnFailure/approval/defaultTarget/enabled 等）
- 写操作留审计

### 3.3 `POST /pipeline-templates/:id/duplicate` — 复制模板（含内置默认）
- 返回新模板

### 3.4 `PUT /pipeline-templates/:id` — 编辑模板
- 入参：`Partial<TemplateSpec>`；**内置默认模板不可改名**

### 3.5 `DELETE /pipeline-templates/:id` — 删除模板
- **内置默认模板不可删除**

---

## 4. 阶段命令 `modules/:key/stage-commands`（StageCommandController → `modules`）

> 每模块每阶段一条 shell 命令，是发布流水线的**唯一执行真相源**；`build` 阶段未配置即 fail-fast，其余阶段未配置回落流程内置逻辑。
> 注意：`modules` 基路径下挂了 3 个 controller（模块注册表 / 阶段命令 / 分支），按子路径区分。

### 4.1 `GET /modules/:key/stage-commands` — 各阶段命令（含未配置）
- 返回：每个 `CONFIGURABLE_STAGES` 阶段一行（configured/command/enabled/timeoutSec/updatedAt/updatedBy）

### 4.2 `GET /modules/:key/pipeline-script-view` — 脚本合并视图
- 合并已配置命令与流程内置说明（用于 ModuleDetail / PipelineDetail 步骤展示；`list` 的合并视图版）

### 4.3 `GET /modules/stage-commands/templates?type=` — 默认构建命令模板
- `type`：`backend`→`npx tsc -p tsconfig.json`；`frontend`→`npx vite build`；`micro-frontend`→`npx vite build --mode mf`；缺省 `frontend`

### 4.4 `GET /modules/:key/stage-commands/:stage` — 某阶段命令
- 含 `actions`（多操作），未配置返回 null

### 4.5 `PUT /modules/:key/stage-commands/:stage` — 保存阶段命令
- 入参：`{ command?: string; timeoutSec?: number; actions?: StageAction[] }`
- 保存前 `bash -n` 语法校验；多操作形态下 `command` 可空（由 `actions` 承载）
- 写操作留审计

### 4.6 `DELETE /modules/:key/stage-commands/:stage` — 删除（回落内置逻辑）
- 写操作留审计

### 4.7 `POST /modules/:key/stage-commands/:stage/validate` — 仅语法校验（不保存）
- 入参：`{ command: string }`

---

## 5. 流水线节点命令 `pipeline-templates/:id/steps`（PipelineStepCommandController → `pipeline-templates`）

> R6 新真相源：每流水线每节点一条命令（操作序列），模块不再持有命令。`build` 节点未配置 fail-fast，其余节点未配置回落流程内置逻辑。

### 5.1 `GET /pipeline-templates/:id/steps` — 各节点命令（含未配置）
- 返回：每个节点的 `nodeKey/configured/command/actions/enabled/locked/timeoutSec/updatedAt/updatedBy`（`locked`=平台托管，页面渲染只读）

### 5.2 `GET /pipeline-templates/steps/templates?type=` — 默认构建命令模板
- 置于 `:id` 路由之前；同 §4.3 模板映射

### 5.3 `GET /pipeline-templates/:id/steps/:nodeKey` — 某节点命令（含 actions）

### 5.4 `PUT /pipeline-templates/:id/steps/:nodeKey` — 保存节点命令
- 入参：`{ command?: string; timeoutSec?: number; actions?: StepAction[] }`
- 保存前 `bash -n` 语法校验；多操作形态下 `command` 可空
- 写操作留审计

### 5.5 `DELETE /pipeline-templates/:id/steps/:nodeKey` — 删除（回落内置逻辑）
- 写操作留审计

### 5.6 `POST /pipeline-templates/:id/steps/:nodeKey/validate` — 仅语法校验（不保存）

---

## 6. 灰度规则 `canary`（CanaryController → `canary`）

### 6.1 `GET /canary?envId=&moduleKey=` — 灰度规则列表
### 6.2 `GET /canary/:id` — 规则详情
### 6.3 `POST /canary` — 创建（入参 `any`，含 `envId`/`moduleKey`/`canaryVersion`/`matchRule`/`enabled`）
### 6.4 `PUT /canary/:id` — 更新（入参 `any`）
### 6.5 `DELETE /canary/:id` — 删除
### 6.6 `POST /canary/:id/preview` — 命中预览
- 入参：`{ userId: string }`；返回 `{ hit: boolean, rule }`

---

## 7. 环境管理 `environments`（EnvironmentController → `environments`）

### 7.1 `GET /environments` — 环境列表
### 7.2 `GET /environments/:id` — 环境详情
### 7.3 `POST /environments` — 创建（入参 `EnvironmentDto`）
- `EnvironmentDto`：`id` `name`（必填）；`publicUrl?` `ports?:Record<string,string>` `builtin?`（选填）。**服务器连接信息已下沉到 `servers`，此处不含 host/ssh**
### 7.4 `PUT /environments/:id` — 更新（`Partial<EnvironmentDto>`）
### 7.5 `DELETE /environments/:id` — 删除（**内置环境不可删**）

---

## 8. 模块注册表 `modules`（ModuleRegistryController → `modules`）

### 8.1 `GET /modules` — 模块列表
### 8.2 `GET /modules/:key` — 模块详情
### 8.3 `POST /modules` — 创建（入参 `ModuleDto`）
- `ModuleDto`：`key` `name` `type`(`backend|frontend|micro-frontend|mini-app`) `dir`（必填）；`pm2?` `publicPath?` `buildCmd?` `defaultEnv?` `entry?` `description?` `enabled?`（选填）
### 8.4 `PUT /modules/:key` — 更新（`Partial<ModuleDto>`）
### 8.5 `DELETE /modules/:key` — 删除（**内置模块不可删**）

---

## 9. 模块分支 `modules/:key/branches`（BranchController → `modules`）

### 9.1 `GET /modules/:key/branches` — 远程分支列表
- 入参：`key`（白名单 `^[a-z0-9-]+$i`，否则 `400`）
- 返回：`{ branches: string[]; current: string|null; head: string|null }`（origin/* 已去前缀，按 committerdate 倒序；monorepo 共用仓库，模块 dir 不存在回落仓库根）

---

## 附：跨模块关键语义（AI 自进化必读）

1. **三入口一致性**：控制台 `POST /pipelines`、CI/CD `POST /hooks/release`、MCP `POST /mcp/pipeline` 三者最终都调用 `PipelineService.submit`，锁/审批/审计/通知/度量/回滚语义完全一致。
2. **版本表库真相**：发布写版本表必须落 `web_system_deploy` 库（非 `web_system`）；gateway 有 ~10s TTL 缓存，验证需等待或重启。
3. **prod 审批门禁**：`system-settings/approval-envs` 配置需审批环境（默认 `prod`）；需审批的流水线提交后处于 `pending/待审批`，由 `approve/reject` 推进。
4. **命令真相源分层**：模块级阶段命令（`modules/:key/stage-commands`）+ 流水线级节点命令（`pipeline-templates/:id/steps`）共同决定执行内容；缺失节点回落流程内置逻辑，缺 `build` 节点则 fail-fast。
5. **密钥不回显**：配置中心、流水线变量、通知渠道的密钥值永不通过 HTTP 响应明文返回（掩码/不返回）。
