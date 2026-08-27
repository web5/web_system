# Agent 定义配置化（数据库化管理）方案

## 0. 分层约束（硬性）— agent-core / kedou-agent 绝不碰数据库

`@kedou-ai/agent-core` 是**纯 TS、零运行时依赖**的通用库（`private: false`，可被 CLI 与服务共用）；`kedou-agent` 是独立 CLI，用户本地运行**没有 PostgreSQL/MySQL**。

因此 **数据库操作只能存在于 Nest 服务层（ai-service / ai-agent）**，绝不下沉到 agent-core 或 kedou-agent：

| 层 | 数据库 | 职责 |
|----|--------|------|
| ai-service / ai-agent（Nest） | ✅ TypeORM 操作 `agent_definitions` 等表 | 建表、CRUD、发布、轮询拉取、把 DB 行 → `AgentDefinition` 对象 |
| @kedou-ai/agent-core（纯 TS） | ❌ 无任何 DB/HTTP/框架依赖 | 仅内存 `AgentRegistry`（`register/upsert/get/list`），暴露"更新内存定义"能力 |
| kedou-agent（CLI，零依赖） | ❌ 无 | 直接用本地代码里的 agent 定义，不依赖 DB |

> **`AgentRegistry.upsert()` 放 agent-core 是合法且必要的**：它只操作内存 Map、不碰 DB，CLI 用不到也不受影响。**从 DB 拉取/写入**放在 Nest 服务层的"定义同步器"里，由服务把 DB 行转成 `AgentDefinition` 再调 `upsert()` 灌入注册表。

## 1. 背景与痛点

当前项目里所有 Agent 都是**工程硬编码 + 启动时内存注册**：

| Agent | 定义文件 | 所在服务 |
|-------|---------|---------|
| `contract-risk`（合同翻译官） | `servers/ai-agent/src/contract/agents/contract-risk.agent.ts` | ai-agent (6010) |
| `study-assistant`（AI 学习助手） | `servers/ai-service/src/agent/agents/study-assistant.agent.ts` | ai-service (6003) |
| `bianbian`（变变） | `servers/ai-service/src/agent/agents/bianbian.agent.ts` | ai-service (6003) |

`AgentDefinition`（来自 `@kedou-ai/agent-core`）：
```ts
{ id, name, systemPrompt, model, tools[], maxSteps, temperature?, memory }
```

注册方式：两个服务的 `agent.module.ts` 在 `onModuleInit()` 里 `agentRegistry.register(agent)`，`AgentRegistry` 是内存 `Map<string, AgentDefinition>`。

**现有痛点**：
1. 改 systemPrompt 要改代码、编译、重启服务 —— 运营/PM 无法快速调 prompt
2. 新增/下线/调参 Agent 都要发版 —— 不能灰度、不能 A/B 对比
3. Agent 定义分散在两个服务，admin 没有统一"定义管理"入口
4. 无法回滚到某次 prompt 版本，出问题只能靠 git

## 2. 方案目标

1. Agent 定义（systemPrompt / model / tools / memory / maxSteps 等）从**代码**迁移为**数据库可配置**
2. admin 新增「Agent 定义管理」：查看/编辑/新建/启停/发布版本
3. **运行时生效**：改 prompt 不必重启服务（近实时刷新）
4. 兼容现状：不破坏 `AgentDefinition` 结构，代码内置定义作为兜底

## 3. 总体架构

```
┌─────────────┐   GET /agent-runs/definitions    ┌──────────────────┐
│  admin 前端   │ ──────────────────────────────▶ │   ai-service     │
│ (Agents模块)  │ ◀────────────────────────────── │  AgentDefinition │
└─────────────┘      CRUD / 发布 / 启停           │  (DB 管理面)     │
                                                 └────────┬─────────┘
                                                          │ 拉取/推送定义
                    ┌─────────────────────────────────────┼─────────┐
                    ▼                                     ▼         ▼
          ┌──────────────────┐                ┌──────────────────┐
          │  ai-service       │                │  ai-agent (6010) │
          │  AgentRegistry    │                │  AgentRegistry   │
          │  (DB→内存缓存)     │                │  (DB→内存缓存)    │
          └──────────────────┘                └──────────────────┘
```

### 3.1 来源优先级（从高到低）

1. **数据库定义**（`agent_definitions` 表，status=published 的最新版本）
2. **代码内置定义**（各服务 `agents/*.agent.ts` 里的常量，作为首次启动 / DB 未配置时的兜底）

> 原则：**DB 有值用 DB，DB 没有回退代码**。这样即使 DB 挂了服务也能跑起来（用内置定义）。

### 3.2 数据表设计（ai-service 统一库）

```sql
-- agent_definitions：Agent 定义主表（每行一个 agent 的"当前发布版本"快照）
CREATE TABLE agent_definitions (
  id          VARCHAR(64) PRIMARY KEY,          -- agent id，如 contract-risk
  name        VARCHAR(128) NOT NULL,            -- 展示名
  system_prompt MEDIUMTEXT NOT NULL,            -- systemPrompt 原文
  model       VARCHAR(64) NOT NULL,             -- 模型 id
  tools       JSON NOT NULL,                    -- tools 数组
  max_steps   INT NOT NULL DEFAULT 10,
  temperature FLOAT NULL,
  memory      JSON NOT NULL,                    -- AgentMemoryConfig
  status      VARCHAR(16) NOT NULL DEFAULT 'published', -- published / draft / disabled
  source      VARCHAR(16) NOT NULL DEFAULT 'db',        -- db / builtin（标记是否来自代码兜底）
  version     INT NOT NULL DEFAULT 1,           -- 当前版本号
  enabled     TINYINT(1) NOT NULL DEFAULT 1,    -- 是否启用
  published_at DATETIME NULL,
  updated_by  VARCHAR(64) NULL,
  -- 继承 AbstractEntity 的时间戳
);

-- agent_definition_versions：历史版本（支持回滚）
CREATE TABLE agent_definition_versions (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  agent_id      VARCHAR(64) NOT NULL,
  version       INT NOT NULL,
  system_prompt MEDIUMTEXT NOT NULL,
  model         VARCHAR(64) NOT NULL,
  tools         JSON NOT NULL,
  max_steps     INT NOT NULL,
  temperature   FLOAT NULL,
  memory        JSON NOT NULL,
  change_note   VARCHAR(255) NULL,              -- 变更说明（便于排查）
  created_by    VARCHAR(64) NULL,
  created_at    DATETIME NOT NULL,
  KEY idx_ver_agent (agent_id, version)
);
```

### 3.3 同步机制（各服务如何拿到定义）

**方案 A：启动拉取 + 定时刷新（推荐，简单可靠）**
- 服务启动时，调 ai-service `GET /internal/agent-definitions`，把返回的定义灌入本地 `AgentRegistry`
- 之后每 N 秒（如 30s）轮询一次，增量更新 `AgentRegistry`（支持运行时改 prompt 生效）
- 优点：改动小、无消息中间件依赖、容错好（拉取失败继续用旧缓存）

**方案 B：发布时推送（事件驱动，可选增强）**
- admin 发布时，ai-service 通过 Redis Pub/Sub 或 HTTP 通知各服务刷新
- 优点：近实时；缺点：多一个依赖。可作为后续增强，首期先做 A

> 首期推荐 **方案 A**（轮询），把"发布后最多 30s 生效"作为可接受延迟。

### 3.4 `AgentRegistry` 增强

agent-core 的 `AgentRegistry` 目前只支持 `register`（重复会抛错），需要小幅增强以支持**更新**：

```ts
// agent-core/src/registry/agent.registry.ts
export class AgentRegistry {
  register(agent: AgentDefinition): void;      // 原有：新增
  upsert(agent: AgentDefinition): void;        // 新增：存在则更新（改 prompt 用）
  get(id): AgentDefinition;                    // 原有
  list(): AgentDefinition[];                   // 原有
}
```

> 影响面：agent-core 是共享包，`upsert` 为纯新增方法，不破坏现有调用方。

## 4. 改动清单

### 4.1 后端
| 模块 | 文件 | 说明 |
|------|------|------|
| agent-core | `registry/agent.registry.ts` | 新增 `upsert()`，支持运行时更新定义 |
| agent-core | `interfaces/agent.interface.ts` | 可选：补充 `version/status` 可选字段 |
| ai-service | `src/agent-def/entities/agent-definition.entity.ts` | 主表实体 |
| ai-service | `src/agent-def/entities/agent-definition-version.entity.ts` | 版本表实体 |
| ai-service | `src/agent-def/agent-def.service.ts` | CRUD + 发布 + 版本管理 + 回滚 |
| ai-service | `src/agent-def/agent-def.controller.ts` | admin 接口（鉴权）|
| ai-service | `src/agent-def/agent-def.internal.controller.ts` | 各服务拉取定义（无 auth）|
| ai-service | `agent/agent.module.ts` | 启动时用 DB 定义覆盖/补充 `AgentRegistry`（原代码注册作为 fallback）|
| ai-agent | `agent/agent.module.ts` | 启动时从 ai-service 拉取定义覆盖 `AgentRegistry` + 定时刷新 |
| gateway | `proxy.service.ts` / `proxy.controller.ts` | 新增 `/api/agent-def/*` 代理 → ai-service |
| types | `packages/types/src/index.ts` | 新增权限 `agents:manage`（编辑/发布）|

### 4.2 前端（admin）
| 文件 | 说明 |
|------|------|
| `src/api/agent-defs.ts` | CRUD/发布/版本接口封装 |
| `src/views/Agents/AgentDefList.vue` | agent 定义列表（含状态/版本/启用开关）|
| `src/views/Agents/AgentDefEdit.vue` | 编辑 systemPrompt/model/tools/memory，保存为 draft，可发布新版本 |
| `src/views/Agents/AgentDefVersion.vue` | 历史版本 + 回滚 |
| `router/index.ts` / `BasicLayout.vue` | 在 Agents 下加子菜单：运行记录 / 定义管理 |

### 4.3 迁移策略
- 首版提供「内置定义 → 写入 DB」的一次性 seed 脚本，把现有 3 个 agent 的 TS 定义导入 `agent_definitions`（source 标记为 db）
- 后续 agent 定义以 DB 为准，代码里的 `*.agent.ts` 保留作为兜底/默认值（标注 `source: builtin`）

## 5. 权限设计

| 权限 | 作用 |
|------|------|
| `agents:view`（已有）| 查看运行记录 + 查看定义 |
| `agents:manage`（新增）| 编辑/新建/启停/发布 agent 定义 |

`ROLE_PERMISSIONS`：`admin` 全量；`editor` 加 `agents:manage`（可编辑）；`viewer` 仅 `agents:view`。

## 6. 接口设计（草稿）

```
# admin（经 gateway /api/agent-def/* → ai-service）
GET    /api/agent-defs                     # 列所有 agent 定义（含版本/状态）
GET    /api/agent-defs/:id                 # 单条详情
POST   /api/agent-defs                     # 新建 draft
PUT    /api/agent-defs/:id                 # 保存草稿（不发布）
POST   /api/agent-defs/:id/publish         # 发布为新版本（version+1）
POST   /api/agent-defs/:id/enable          # 启用/停用
GET    /api/agent-defs/:id/versions        # 历史版本列表
POST   /api/agent-defs/:id/rollback        # 回滚到指定版本

# 内部（各服务启动/轮询拉取）
GET    /api/internal/agent-definitions     # 返回所有 status=published 且 enabled 的定义
```

## 7. 运行时生效时序

```
admin 编辑 systemPrompt → 存 draft → 点"发布"（version+1）
  → ai-service 写入 agent_definitions + agent_definition_versions
  → 各服务轮询(≤30s)拉到新定义 → AgentRegistry.upsert() 更新内存
  → 后续该 agent 的 run 使用新 prompt（已在途的 run 不受影响）
```

## 8. 风险评估与规避

| 风险 | 规避 |
|------|------|
| DB 挂了导致 agent 不可用 | 启动时已缓存到内存；轮询失败继续用旧缓存；DB 无记录时回退代码内置定义 |
| 编辑出错影响线上 | 先存 draft 再 publish；发布才生效；支持回滚到历史版本 |
| 多服务缓存不一致 | 统一以 ai-service DB 为唯一事实源，各服务轮询拉取，最多 30s 收敛 |
| agent-core 改动影响面 | `upsert()` 纯新增方法，不破坏现有 `register/get/list` |

## 9. 分期实施（已按决策更新）

### 一期：Agent 定义配置化（本次实施，P1 运行时生效）

- `agent_definitions` + `agent_definition_versions` 表（ai-service 库）
- ai-service `agent-def` 模块：CRUD / 发布 / 启停 / 版本管理 / 回滚 + 内部拉取接口
- 各服务（ai-agent / ai-service）启动拉取 + **定时轮询（30s）** 覆盖本地 `AgentRegistry`，做到**运行时生效**
- agent-core：`AgentRegistry` 增加 `upsert()`
- admin：Agents 下「定义管理」子菜单（列表 / 编辑 / 发布 / 版本回滚）
- 迁移：把现有 3 个 `contract-risk / study-assistant / bianbian` 的 TS 定义 seed 进 DB，**迁移完成后删除代码里的 `*.agent.ts` 定义常量**（DB 为唯一事实源；agent-core 层仍保留"未配置时 fallback"能力但本项目直接依赖 DB）

> 决策记录：P1（30s 轮询自动生效）；库放 ai-service；迁移完删除代码定义。

### 二期：工具配置化 + MCP 化（独立工程，单独设计）

**背景**：一期只配置化了 `AgentDefinition`（prompt / model / tools 数组 / memory）。工具的**元数据**（name / description / 参数 schema）和**实现**仍是代码。

**方向**（决策 3）：工具也入库 + MCP 化。拆成两层：
1. **工具元数据入库**：`tool_registrations` 表存每个工具的 name / description / parameters schema / 归属（agent、mcp module）/ 启用状态。admin 可统一查看、启停工具。
2. **工具实现 MCP 化**：把本地确定性工具（`contract-rule` / `contract-irr` / `contract-cleaner`）从"代码内直接执行"迁移为"MCP 网关暴露的远程工具"，通过 `McpToolAdapter` 懒加载调用（现有 `McpService` 已支持此模式）。

**范围与影响**：
- 这是一个独立于"Agent 定义配置化"的**较大工程**，涉及 MCP 网关侧的工具实现迁移 + 协议对齐 + 幂等/超时/错误处理
- 涉及把 `contract-rule` 依赖的 `@web-system/shared` 法定标准库计算逻辑迁到 MCP 工具服务
- 需要单独写一版设计（工具协议、网关端点、鉴权、缓存）

**建议**：二期放在一期稳定后单独规划执行，避免与 Agent 定义 DB 化耦合导致一期过大。

### 三期（可选）：A/B 测试、prompt 效果评测

同一 agent 多版本按流量比例分流、对 run 记录做效果打分（结合 `agent_runs` 的原始数据）。

## 10. 待确认问题

> 已确认：1️⃣ P1（30s 轮询自动生效）；2️⃣ 库放 ai-service；3️⃣ 工具 MCP 化 + 入库（拆为二期）；4️⃣ 迁移完删除代码定义。

**二期开工前需补充确认**：
1. MCP 网关（`MCP_GATEWAY_URL`，port 6006 mcp-gateway）当前是否已在生产/开发环境跑起来？工具 MCP 化依赖它。
2. `contract-rule` 这类**确定性规则工具**（依赖本地法定标准库 `@web-system/shared`）MCP 化后，计算逻辑放哪个服务？（放 mcp-gateway 侧 / 独立工具服务 / 保留在 ai-agent 但通过 MCP 协议暴露）
3. 工具 MCP 化的优先级：是否一期先只做**元数据入库 + 启停管理**（不动实现），二期再做真正的 MCP 远程调用迁移？
