# 设计稿 · 模块 × 环境 关系改造（1 对多：环境归属模块）

> 状态：**P0 已实现（2026-09-15，待迁移脚本执行 + 联调）**；Q1/Q2/Q3 已由用户确认，Q4/Q5/Q6 按本文建议执行。
> 变更日志：
> - 2026-09-15 P0 落地：实体复合主键 + `address/server_name/port`、子资源路由 `/modules/:key/environments`、种子按模块（含新模块懒补 dev/prod）、monitor/server.service 适配、前端「本模块环境」Tab（覆盖所有模块类型）、迁移脚本 `scripts/migrations/p5-module-env-ownership.mjs`
> 决策来源：用户 2026-09-15 明确「一个模块有多个环境，一个环境只属于某个模块；dev/prod 每模块各一份」
> 关联代码：`servers/deploy-console/src/entities/deploy-environment.entity.ts`、`src/environment/*`、`src/monitor/monitor.service.ts`、`src/server/server.service.ts`、`src/config/*`、`apps/deploy-console/src/components/EnvManagerPanel.vue`、`src/views/ModuleDetail.vue`
> 接口契约：见同目录 `api-design.md`

---

## 0. 方案总览（一页）

### 0.1 目标

把「环境」从**全局一等公民（跨模块共享）**改为**模块的从属资源（1:N）**：环境表带 `module_key`，`dev / prod` 每个模块各一份，各自持有自己的服务地址、服务器组、公网地址。

### 0.2 关键决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | 关系模型 | `deploy_environments` 加 `module_key`，**复合主键 `(module_key, id)`**；一个环境行只属于一个模块 |
| D2 | 主键形态 | 不用 uuid 代理键，直接把原 PK `id` 升级为复合 PK `(module_key, id)`（其他表只存 env 字符串，不受影响） |
| D3 | 地址存储 | `ports` JSON（`{moduleKey: addr}`）→ 新增单值列 `address`；`ports` 保留一个发布周期做回滚，**双读：address 优先，回退 ports[module_key]** |
| D4 | 覆盖范围 | **所有模块类型**都生成环境行（backend 有 `address`；frontend/micro-frontend/mini-app `address` 为空，访问地址由 `publicUrl + publicPath` 派生） |
| D5 | 关联表 | `deploy_deployments` / `deploy_env_service_routes` / `deploy_canary_rules` **结构不动** —— 它们的唯一键本身是 `(envId, moduleKey)`，与新复合键语义一致，天然成立 |
| D6 | 配置作用域 | `config_items` 的 `scope=env` 与 `scope=module` 在新模型下语义重合（env 已隐含 module）→ **P1 决策：废弃 env 级，迁移为 module 级（envId+moduleKey 都有值）** |
| D7 | 兼容策略 | 旧 `GET /environments`（跨模块聚合）保留一个周期，只读取；写操作全部走新子资源 `/modules/:key/environments` |
| D8 | 全局视角 | 「某环境（如 dev）所有服务的健康/版本」这类跨模块视图，改为**按 `id` 聚合查询**（`WHERE id=?`），不再依赖单条行 |

### 0.3 全景

```
deploy_modules (PK key)
   │ 1
   │                                    ┌─ address      （backend：服务地址 host:port/域名）
   └─ N  deploy_environments            ├─ server_name  （服务器组，原 routes 的语义就近落这儿）
          PK (module_key, id)           ├─ port         （可选，覆盖组内端口）
          · name / publicUrl            └─ builtin      （dev/prod 每模块各一份，不可删）
          · address / server_name / port
                │
                │ 仍靠 (envId, moduleKey) 关联，结构不动：
                ├─ deploy_deployments        UNIQUE(envId, moduleKey)   ← 当前版本指针
                ├─ deploy_env_service_routes UNIQUE(envId, serviceName) ← serviceName == module_key
                ├─ deploy_canary_rules       (envId, moduleKey)
                └─ deploy_versions           (env, component)
```

---

## 1. 现状与问题

现状：`deploy_environments` 是全局字典，`dev/prod` 两份记录，**模块 × 环境是多对多**，靠四张关联表表达：

| 表 | 现状承载 |
|---|---|
| `deploy_environments.ports`（JSON） | 环境 → 各 backend 模块的服务地址（**写在环境里的反向多对多**） |
| `deploy_deployments` | env × module 当前版本指针 |
| `deploy_env_service_routes` | env × module → 服务器组 |
| `deploy_canary_rules` | env × module 灰度版本 |

问题（用户视角）：
1. 环境是平铺的全局字典，看到「dev」不知道跟哪些模块有关；
2. 模块的环境信息散在三处（ports / routes / deployments），改地址要同时理解这三处；
3. 前端模块在环境侧**完全没有字段**，只能靠 `publicUrl` 派生 —— 上一轮「环境信息迁移到模块」时暴露。

改造成 1:N 后：模块详情页就是该模块的环境列表（地址/服务器组/版本一屏），环境不再需要跨模块共享语义。

---

## 2. 新数据模型

### 2.1 `deploy_environments` 字段变更

| 字段 | 变更 | 说明 |
|---|---|---|
| `module_key` varchar(64) | **新增，NOT NULL**（先 nullable → 回填 → 改 NOT NULL） | 所属模块 key |
| PK | `id` → **`(module_key, id)`** | 环境 id 只在模块内唯一（每个模块都可有 dev/prod） |
| `address` varchar(255) nullable | **新增** | 该模块在该环境的服务地址（backend）；前端模块为空 |
| `server_name` varchar(64) nullable | **新增** | 服务器组（原 `deploy_env_service_routes.serverName`，就近落这里） |
| `port` int nullable | **新增** | 覆盖组内端口 |
| `ports` json nullable | **保留（废弃中）** | 旧真相源，仅回滚期双读；P2 物理删列 |
| `name` / `publicUrl` / `builtin` | 不变（语义变为「模块内」） | `publicUrl` 每模块可不同（迁移时复制原值） |
| `createdAt` / `updatedAt` | 不变 | |

### 2.2 DDL 草案（迁移步骤见 §4）

```sql
-- P0-1：加列（全部 nullable，保证可回滚）
ALTER TABLE deploy_environments
  ADD COLUMN module_key VARCHAR(64) NULL COMMENT '所属模块 key' AFTER id,
  ADD COLUMN address VARCHAR(255) NULL COMMENT '该模块在本环境的服务地址（host:port 或域名）',
  ADD COLUMN server_name VARCHAR(64) NULL COMMENT '服务器组',
  ADD COLUMN port INT NULL COMMENT '覆盖端口';

-- P0-3：回填完成后重建主键
ALTER TABLE deploy_environments
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (module_key, id);
```

### 2.3 不改动的表（及原因）

| 表 | 唯一键 | 为什么不用动 |
|---|---|---|
| `deploy_deployments` | UNIQUE(envId, moduleKey) | 等价于 (module, env)，语义不变 |
| `deploy_env_service_routes` | UNIQUE(envId, serviceName) | `serviceName` 就是模块 key，仍唯一；可作为 `server_name` 的历史来源 |
| `deploy_canary_rules` | (envId, moduleKey) 索引 | 同上 |
| `deploy_versions` / `deploy_pipelines` / `deploy_pipeline_templates` | (env, component/moduleKey) | env 只是字符串标签，配合 module 上下文定位 |
| `deploy_servers` | UNIQUE(serverName, host) | 与环境无字段耦合 |
| gateway 侧实体 | — | gateway 不读 `deploy_environments`（只吃 `DEPLOY_ENV_ID`），完全隔离 |

---

## 3. 服务层与前端改造（影响清单）

### 3.1 后端（servers/deploy-console）

| 文件:行 | 现状 | 改造 |
|---|---|---|
| `entities/deploy-environment.entity.ts` | PK `id` + `ports` | 复合 PK + `module_key` / `address` / `server_name` / `port`；`ports` 标 `@deprecated` |
| `environment/environment.service.ts:27-81` | 表空则种子 dev/prod 两条（含 JSON ports） | 种子改为：**每个模块 × dev/prod 各一行**；地址从原 `defaultPortsDev/Prod` 按 key 取值；模块新增时懒补环境 |
| `environment/environment.service.ts:83-119` | `list/get/create/update/remove` 按 `id` | 全部加 `module_key` 维度：`get(moduleKey, id)`；`create` 校验 `(module_key,id)` 不存在；`remove` 需先删关联（见 §5 风险） |
| `environment/environment.controller.ts:28-81` | `/environments` CRUD | 新增模块子资源路由（见 `api-design.md`）；旧路由降级只读 |
| `monitor/monitor.service.ts:197-239` | `healthCheck(env)` 遍历 `envEntity.ports` | 改为 `WHERE id=?` 取该环境**所有模块行**，`address` 非空者入探测列表 |
| `server/server.service.ts:145-160` | `getServiceOverview()` 读 `ports[m.key]` | 改为按 `(module_key, id)` 查环境行取 `address` / `server_name` |
| `deploy/deploy.service.ts:691-694` | `buildEnvVars()` 读 `publicUrl` | 需带 `moduleKey` 查（同一 env id 多行） |
| `config/config.service.ts`（24 处 envId） | env 级作用域 | 见 D6（P1） |
| `server.service.spec.ts:25` / `deploy.service.spec.ts:33` | mock EnvironmentService | 同步补 `module_key` 用例 |

### 3.2 前端（apps/deploy-console）

| 文件 | 改造 |
|---|---|
| `api/index.ts:107-122` | `environmentApi` 加 `moduleKey` 参数；新增 `listByModule(key)` |
| `components/EnvManagerPanel.vue` | 从「全局环境表」改为「按模块管理环境」：`buildPortsFromEnv` 整块删除，表单变 `id/name/publicUrl/address/serverName` |
| `views/ModuleDetail.vue` 「服务环境」Tab | 升级为**本模块的环境列表**（增删改直接改环境行），并覆盖前端模块（展示派生访问地址 `publicUrl + publicPath`） |
| `views/ServiceManager.vue` | 「环境管理」抽屉改为：选模块 → 管该模块的环境 |
| 环境下拉（`Dashboard`/`CanaryCenter`/`PipelineSubmit`/`DiagnoseCenter`/`AuditLog`/`PipelineCenter`/`PipelineDetail`） | 已绑定模块的场景 → 用 `listByModule(key)`；纯筛选场景（审计日志）→ 用跨模块聚合接口按 `id` 去重 |
| `views/ConfigCenter.vue` | env 筛选保持按 `id`；D6 落地后 scope 选项调整 |

---

## 4. 迁移方案（可回滚）

| 步 | 动作 | 回滚方式 |
|---|---|---|
| M1 | 加 4 个 nullable 列（不动 PK） | `DROP COLUMN` |
| M2 | 回填：对每个模块 × 每个现有环境插入一行，`address = ports[module_key]`、`server_name` 从 `deploy_env_service_routes` 取、`publicUrl/name/builtin` 复制原值 | 删 `module_key IS NOT NULL` 的行 |
| M3 | 旧全局行（`module_key IS NULL`）**保留不删**，代码只查非空行 | 无 |
| M4 | 重建主键为 `(module_key, id)`（旧行因 `module_key` 为 NULL 会阻塞 → M3.5 先给旧行填 `module_key='__legacy__'`） | 主键改回 `id`（需先清重名） |
| M5 | 代码切双读（`address` 优先，回退 `ports[module_key]`） | 切回只读 `ports` |
| M6 | 观察一个发布周期 → P2 物理删 `ports` 列 + 删 `__legacy__` 行 + 删旧路由 | — |

脚本形态：新增 `scripts/migrations/p5-module-env-ownership.mjs`（参照现有 `scripts/migrations/p2-ports-to-addresses.mjs`），支持 `--dry-run`。

---

## 5. 风险

1. **删环境不级联**：`deploy_deployments` / `deploy_env_service_routes` / `deploy_canary_rules` / `deploy_versions` 无外键，删环境会留孤儿 → `remove()` 需先统计关联数并二次确认（或软删）。
2. **模块删除**：模块删了它的环境行也应一起清（目前无级联）。
3. **同 id 多行**：所有 `findOne({where:{id}})` 未补 `module_key` 会命中多行/错行 → 全量 grep `where: { id` 与 `get(env` 逐处核对。
4. **MCP / 脚本**：MCP 的 `env` 是自由字符串、脚本 `scripts/pipeline/*.sh` 不读环境表，风险低；但 `env === 'prod'` 的二次确认仍按 `id` 判断，语义不变。
5. **全局视图退化**：「dev 环境所有服务健康」需跨模块聚合，列表页可能变多（N 模块 × M 环境）。

---

## 6. 分期

| 期 | 内容 |
|---|---|
| **P0** | DDL(M1-M4) + 实体改造 + `EnvironmentService/Controller` 子资源路由 + 种子按模块 + `monitor.service` / `server.service` 适配 + 迁移脚本 + 前端：`ModuleDetail` 环境列表、`EnvManagerPanel` 按模块、下拉按模块 |
| **P1** | D6 配置作用域合并（env → module）；旧 `/environments` 收敛为只读聚合；审计/通知等环境的软删除与关联清理 |
| **P2** | 物理删 `ports` 列、删 `__legacy__` 行、删旧写路由、清双读分支 |

---

## 7. 待确认项（评审时逐条拍）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 环境行是否覆盖**所有模块类型**（含 frontend/micro-frontend/mini-app）？ | ✅ 用户确认：**包含前后端**；前端类 `address` 留空，访问地址由 `publicUrl + publicPath` 派生 |
| Q2 | `publicUrl` 允许每模块覆盖吗？ | ✅ 用户确认：**允许** |
| Q3 | 新建模块时是否自动补 dev/prod 两条内置环境？ | ✅ 用户确认：**是**（`ModuleRegistryService.create()` 与种子导入后调用 `ensureModuleEnvs()`） |
| Q4 | `config_items` 的 `scope=env` 怎么处理？ | 建议**废弃并迁移到 module 级**（D6，P1） |
| Q5 | 还要不要保留一个「全局环境字典」用于新模块套用？ | 建议**不新建表**，沿用「复制某模块的环境配置」能力（现 EnvManagerPanel 的 base 环境概念可直接改造） |
| Q6 | 删环境时的关联记录怎么处理？ | 建议**先统计 + 二次确认，暂不做物理级联**（P1 再定软删） |
