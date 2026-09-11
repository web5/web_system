# Agent 能力体验手册

> **定位**：web_system 项目 Agent 体系的**唯一速查入口** —— 讲清「有哪些能力 / 各自在哪 / 怎么亲手验一遍」。
> **适用**：新同学上手、迭代后回归验证、向他人演示。
> **维护约定**：见 [§8 维护约定](#8-维护约定)。**只要本文覆盖范围内的源码发生变化，必须同步修订本文并追加变更日志。**

| 项 | 值 |
|---|---|
| 文档版本 | v1.0 |
| 创建日期 | 2026-09-10 |
| 校验环境 | macOS 本地 + pm2 `web-*` 全量 online + nginx `https://local.kedouai.com` |

**变更日志**

| 日期 | 版本 | 变更内容 | 修订人 |
|---|---|---|---|
| 2026-09-10 | v1.0 | 初版：四层架构、8 个 UI 入口、CLI 入口、走查路线、易混淆点 | AI |
| 2026-09-10 | v1.1 | 模型清单真相源迁移到 DB 字典：§3.2 增 `ModelCatalogService` 行；§7 增坑 10/11（改 env 不生效、字典里的 hy3 被过滤）；admin 新增「字典管理」页、原「模型单价」页改为「模型」页（可用清单 × 单价聚合） | AI |
| 2026-09-10 | v1.2 | 权限同步机制落地：§7 坑 2 的处理办法从"重启 `web-user`"改为**优先跑 `scripts/sync-permissions.sh` / 点「同步权限点」按钮**（无需重启）；§8.1 增"新增权限码"触发场景、§8.2 补权限真相与同步命令 | AI |
| 2026-09-11 | v1.3 | 权限同步自动化：**发布流水线收尾自动同步**（`PIPELINE_PERM_SYNC`，失败不阻断）、同步动作落审计（`operation_logs` → `sync_permission`）、角色权限页顶部差异提示；§7 坑 2 补自动化与提示说明 | AI |
| 2026-09-11 | v1.4 | 单价真相源迁到字典：§2 链路改为按字典价核算、§3.4 `model_pricing` 标弃用、§4 入口 10 改为只读总览（权限改 `system:dict:view`）；§7 增坑 12（价格在哪维护、多久生效、旧表已失效） | AI |

---

## 0. 一页速查

**主入口**（最省事，后端全部常驻 pm2）：

```
https://local.kedouai.com/admin/agents/playground     ← 对话调试，先看这里
```

**看不到的原因 99% 是权限** —— 到 `/admin/settings/roles` 给自己的角色勾全：

```
agents:view  agents:manage  agents:debug
skills:view  skills:manage
knowledge:view  knowledge:manage
agents:cost:view
```

**服务端口**：gateway `6000` · ai-service `6003` · ai-agent `6010` · knowledge-service `6011` · mcp-gateway `6006`

**两条链路别搞混**：

| 链路 | 路径 | 经过 Agent 编排？ |
|---|---|---|
| portal AI 助手 `/portal/chat` | `/api/ai/*` | ❌ 纯 LLM 对话 |
| admin Playground / mini-contract 合同 | `/api/ai-agent/*` | ✅ ReAct 编排 |

---

## 1. 四层架构

```
┌─ 体验层 ───────────────────────────────────────────────────────┐
│ admin「Agents」菜单 8 页 │ portal /chat │ mini-contract │ kedou-agent CLI │
└────────────────────────────────────────────────────────────────┘
        │  /api/*  统一经 gateway:6000 反代，前端不直连后端
┌─ 管控层 · servers/ai-service:6003 ──────────────────────────────┐
│ AgentDefModule 定义/版本/发布/回滚 │ SkillModule 技能库(SKILL.md) │
│ AgentLogModule 运行观测/成本核算   │ AgentModule 轻量编排副本      │
└────────────────────────────────────────────────────────────────┘
        │  GET /internal/agent-definitions  每 30s 轮询下发（AGENT_DEF_POLL_MS 可调）
┌─ 编排层 · servers/ai-agent:6010 ────────────────────────────────┐
│ SSE 事件流 │ DbConversationMemory │ PermissionBroker 权限中介      │
│ MCP 长任务 │ OCR │ 合同四件套工具                                 │
└────────────────────────────────────────────────────────────────┘
        │  workspace 依赖 @kedouai/agent-core（纯消费 + 实现端口）
┌─ 内核层 · packages/agent-core ──────────────────────────────────┐
│ AgentEngine(ReAct) │ Tool/Agent/ClientRegistry │ hy3 + tokenhub   │
│ Compaction 记忆压缩 │ MCP 适配 + 长任务插件 │ WSA/Bing 搜索        │
│ Coding 工具集 │ Telemetry 可选遥测口                              │
└────────────────────────────────────────────────────────────────┘
旁路：knowledge-service:6011（RAG） · mcp-gateway:6006（远程工具）
```

**三条关键链路**

1. **定义下发**：admin `/api/agent-defs/:id/publish` → `agent_definitions` + 版本快照 → 各服务 30s 轮询 → `AgentRegistry.upsert` → **改 prompt 运行时生效，无需重启**。
2. **执行**：前端 → `POST /api/ai-agent/agent/run`（SSE）→ `AgentRunner.stream` → `AgentEngine` ReAct 循环（工具：本地合同工具 / web-search / MCP 懒加载 / `load_skill`）→ 遇危险工具发 `permission_request` 挂起等确认。
3. **观测**：run 结束 → `AgentRunPusher` 异步 POST `/internal/agent-runs` → 落 `agent_runs` + `run_metrics` 聚合 → 按**字典 `llm_models` 的价格字段**核算成本（ai-service `ModelPricingCatalog`，2026-09-11 起；旧表 `model_pricing` 仅留痕）。

> ⚠️ Agent 定义**不在代码里**（`*.agent.ts` 已删除），全在 DB。想改行为就改 DB，不要去找 hardcode。

---

## 2. 环境准备 checklist

```bash
# ① 后端是否全在线（12 个 web-*，重点确认 5 个）
pm2 list | grep -E "web-(gateway|ai|ai-agent|knowledge|mcp-gateway)"
curl -s localhost:6000/__manifest__        # 期望 200

# ② 起 / 重启
bash scripts/local-up.sh                   # 构建 + 全量启动
bash scripts/local-up.sh --no-build        # 只重启（改 .env 后最快）
bash scripts/local-up.sh --seed            # 额外重置 admin 密码为 admin123

# ③ 前端两种访问方式（二选一）
https://local.kedouai.com/admin/           # nginx 集成（推荐，需 sudo ~/local/nginx/sbin/nginx）
bash scripts/start-frontend.sh             # 或 dev server：admin 5174 / portal 5173
```

> **admin / portal 是微前端模块**，改完前端源码必须走「构建 → 拷贝 → 更新版本表 → 等缓存」四步才生效，否则浏览器仍加载旧产物。详见 [`.codebuddy/CODEBUDDY.md`](../../.codebuddy/CODEBUDDY.md) §4.1。
> 微前端之间没有 agent 专属模块 —— agent 能力全部承载在 **admin 模块内部**。

---

## 3. 能力清单（按层）

### 3.1 内核层 · `packages/agent-core`

零运行时依赖（Node ≥18），**不碰数据库**。

| 能力 | 关键文件 | 要点 |
|---|---|---|
| ReAct 引擎 | `src/core/agent-engine.ts` | 记忆摘要 → 技能目录注入 → 流式推理 → 工具回写 → final；内建 `load_skill` 工具 |
| 引擎封装 | `src/core/agent-runner.ts` | 生成 runId，委托 engine，返回流式事件 |
| 能力归一 | `src/core/capability-resolver.ts` | `capabilities`(tool/mcp/skill，含 `enabled`) → `tools[] + skills[]`；兼容旧 `tools/skills` 字段 |
| 工具注册表 | `src/registry/tool.registry.ts` | 立即注册 + **懒加载工厂**（MCP 远程工具按需实例化） |
| Agent 注册表 | `src/registry/agent.registry.ts` | `upsert` 支撑「改 prompt 运行时生效」 |
| 客户端注册表 | `src/registry/client.registry.ts` | `getOrFallback`（默认回落 hy3）、`listModels`（含可用状态） |
| 模型客户端 | `src/clients/hy3.client.ts`<br>`src/clients/tokenhub.client.ts` | hy3 = 混元 Turbo；TokenHub 网关可托管任意模型（默认 `deepseek-v4-flash`）<br>基类 `base-ai.client.ts` 含 `parseJsonToolCall`（还原模型口胡的 JSON 工具调用） |
| 记忆压缩 | `src/memory/compaction.ts` | 增量摘要：旧摘要 + 早期消息 → 新摘要，摘要模型跟随所选模型 |
| MCP 适配 | `src/mcp/mcp-tool.adapter.ts` | 远程工具元数据 → `ToolDefinition`；写操作 `requiresConfirm` |
| 长任务 | `src/plugins/long-running.ts` | `withLongRunning`：把「返回 jobId 的工具」包成「自动轮询到终态的同步工具」 |
| 搜索 | `src/search/` | WSA（腾讯云联网，手写 TC3 签名）优先，Bing 兜底 |
| Coding 工具 | `src/tools/coding/` | 只读三件套 `list-dir`/`read-file`/`grep-search`；写操作 `write-file`/`shell-exec` **强制确认** + 命令白名单 + 路径越界防护 |
| 遥测 | `src/interfaces/telemetry.interface.ts` | 全部可选；字段口径对齐 OTel GenAI SemConv，但不引 SDK |

> 📌 `README.md` 里的 `DeepseekClient` **已下线**（官方直连取消）。当前只有 `Hy3Client` + `TokenHubClient(model)`；`dist/` 残留旧产物，**以 `src/` 为准**。

### 3.2 编排层 · `servers/ai-agent:6010`

gateway 侧 `^/api/ai-agent` → 剥前缀 → `/agent/*`。

| 方法 | 外部路径 | 权限 | 用途 |
|---|---|---|---|
| POST | `/api/ai-agent/agent/run` | 登录 | **C 端 SSE 运行**（mini-contract 在用） |
| POST | `/api/ai-agent/agent/admin-run` | `agents:debug` | Playground 调试运行，额外返回定义快照 |
| GET | `/api/ai-agent/agent/models` | `agents:debug` | 已注册模型 + 可用性 |
| POST | `/api/ai-agent/agent/permission/:requestId` | 登录 | 危险工具二次确认 `{approve}` |
| GET | `/api/ai-agent/agent/conversations` | 登录 | 我的对话列表（分页，pageSize ≤ 50） |
| GET | `/api/ai-agent/agent/conversations/:id` | 登录（仅本人） | 详情（report 快照 + meta + messages） |
| POST | `/api/ai-agent/ocr/recognize` | 登录 | 腾讯云 OCR（合同图片 base64） |

**SSE 事件类型**：`content_delta` / `reasoning_delta` / `tool_call` / `tool_result` / `skill_load` / `summary` / `final` / `error` / `permission_request`

**内部构件**

| 构件 | 文件 | 说明 |
|---|---|---|
| `PermissionBroker` | `src/agent/permission-broker.ts` | SSE 挂起 ↔ 确认接口的中介；uuid requestId + 校验同一 userId + **60s 超时自动拒绝** |
| `DbConversationMemory` | `src/agent/memory/db-conversation-memory.ts` | 实现 `ConversationMemoryPort`，落 `agent_conversations`，含「不覆盖 report/meta」保护 |
| `AgentDefSyncService` | `src/agent/agent-def-sync.service.ts` | 30s 轮询拉定义 + **按 capabilities 懒注册 MCP 远程工具** |
| `ModelCatalogService` | `src/agent/model-catalog.service.ts` | 模型清单三级回落：**字典 `llm_models` → `TOKENHUB_MODELS` → 代码内置**；60s 轮询（`MODEL_POLL_MS`），拉取失败只 WARN 保留当前清单；`hy3` 由 Hy3Client 承载，清单里出现会被过滤 |
| `AgentRunPusher` | `src/agent/agent-run-pusher.ts` | 异步回推 run 记录，失败只 warn，不拖垮主链路 |
| `AgentSkillProvider` | `src/skill/agent-skill-provider.ts` | 向 ai-service `GET /internal/skills/:code` 拉全文，60s 内存缓存 |
| 合同四件套 | `src/contract/tools/` | `contract-rule`（法定标准库扫描）/`contract-irr`（IRR 测算）/`contract-cleaner`（OCR 清洗）/`contract-benchmark`（市场基准） |
| 报告解析 | `src/contract/contract-report.parser.ts` | 结构化合同报告解析（代码块/截断容错，非报告返回 null） |

### 3.3 管控层 · `servers/ai-service:6003`

**Agent 定义** `/api/agent-defs/*`

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | `/api/agent-defs` | `agents:view` | 列表 |
| GET | `/api/agent-defs/capabilities?agentId=` | `agents:view` | 能力资产总览（tool/mcp/skill/knowledge 聚合，只读） |
| GET | `/api/agent-defs/:id` | `agents:view` | 详情 |
| POST | `/api/agent-defs` | `agents:manage` | 新建草稿 |
| PUT | `/api/agent-defs/:id` | `agents:manage` | 保存草稿（**不发布**） |
| POST | `/api/agent-defs/:id/publish` | `agents:manage` | 发布为新版本（才生效） |
| POST | `/api/agent-defs/:id/enabled` | `agents:manage` | 启用/停用 |
| GET | `/api/agent-defs/:id/versions` | `agents:view` | 历史版本 |
| POST | `/api/agent-defs/:id/rollback` | `agents:manage` | 回滚到指定版本并发布 |
| DELETE | `/api/agent-defs/:id` | `agents:manage` | 删除 |

**运行观测** `/api/agent-runs/*`（均需 `agents:view`）
`GET /agents` 概览 · `GET /metrics?agentId=&startDate=&endDate=` 日指标 · `GET /?agentId=&userId=&status=&keyword=&page=` 列表 · `GET /:id` 详情（含完整 systemPrompt/steps/finalAnswer）

**技能库** `/api/admin/skills/*`（读 `skills:view` / 写 `skills:manage`）
列表 · `:code` 详情正文 · 新建 · 全量覆盖编辑 · 删除 · `POST /import`（zip 技能包 ≤5MB）

**成本核算** `/api/admin/model-pricing`（`agents:cost:view`）：列表 / 幂等 upsert / 删除

### 3.4 数据表（7 张）

> 无迁移脚本，靠 TypeORM `synchronize`（非 production）自动建表；DDL 设计稿见 `docs/architecture/agent-definition-db-design.md` §3.2。

| 表 | 所在库 | 核心字段 |
|---|---|---|
| `agent_definitions` | ai-service | id(=agentId)、name、systemPrompt、model、tools、capabilities、skills、maxSteps、temperature、memory、streaming、version、status、enabled |
| `agent_definition_versions` | ai-service | agentId、version、全量快照、changeNote、createdBy |
| `agent_runs` | ai-service | agentId、userId、conversationId、steps(json)、finalAnswer、error、status、durationMs、source、agentVersion、prompt/completion/totalTokens、cost |
| `run_metrics` | ai-service | agentId、model、date、runCount、okCount、errorCount、totalTokens、totalCost、totalDurationMs |
| `model_pricing` | ai-service | ⚠️ **已弃用**（2026-09-11）：单价已迁到字典 `llm_models` 的 `input_price_per1k` / `output_price_per1k` / `currency`；本表只留痕，写接口已下线 |
| `agent_skills` | ai-service | code(unique)、description(on-demand 摘要)、content(SKILL.md 正文)、requiredTools、enabled |
| `agent_conversations` | **ai-agent** | id、userId、summary、summarizedCount、messages(json)、title、report、meta |

> ⚠️ **没有** `agent_session` / `agent_tool` 表。会话用 `agent_conversations`；工具以 `capabilities` JSON 的能力引用表达，从 `GET /api/agent-defs/capabilities` 聚合查看。

### 3.5 旁路服务

| 服务 | 端口 | 经网关 | 说明 |
|---|---|---|---|
| knowledge-service | 6011 | `/api/knowledge/*` | 集合/文档/chunk 管理 + topK 检索 |
| mcp-gateway | 6006 | `/api/mcp/*` | MCP 远程工具；`withLongRunning` 包装后供 agent 当同步工具用 |

---

## 4. UI 体验入口（admin 共 8 页）

> 基座前缀 `https://local.kedouai.com`（或 `http://localhost:5174`）。**admin 路由 base 是 `/admin/`**，漏了会 404。

| # | 菜单名 | URL | 权限 | 页面 | 验证重点 |
|---|---|---|---|---|---|
| 1 | **对话调试** | `/admin/agents/playground` | `agents:debug` | `AgentPlayground.vue` | SSE 时间线 `tool_call → tool_result → skill_load → final`；可临时覆盖模型；高危操作确认弹窗 |
| 2 | Agent 概览 | `/admin/agents` | `agents:view` | `AgentOverview.vue` | 各 agent 的 run 数 / 错误数 / 最近运行 |
| 3 | Agent 观测 | `/admin/agents/metrics` | `agents:view` | `MetricsPage.vue` | 按日期/模型：调用数、成功失败、token、成本、耗时 |
| 4 | 运行记录 | `/admin/agents` 点进某 agent → `/admin/agents/runs/:agentId` | `agents:view` | `AgentRuns.vue` | 分页 + 状态/关键词/时间过滤 |
| 5 | Run 详情 | `/admin/agents/runs/:agentId/run/:id` | `agents:view` | `AgentRunDetail.vue` | systemPrompt、步骤时间线、finalAnswer、token/成本、**定义版本快照** |
| 6 | 能力资产 | `/admin/agents/capabilities` | `agents:view` | `CapabilitiesPage.vue` | tool/mcp/skill/knowledge 只读聚合；不带 agentId 看全部 |
| 7 | 知识集合 / 检索调试 | `/admin/agents/knowledge`<br>`/admin/agents/retrieval` | `knowledge:view`<br>`agents:debug` | `KnowledgeCollectionsPage.vue`<br>`RetrievalDebuggerPage.vue` | 建集合灌文档看 chunk；选集合输入 query 调 topK 看相似度 |
| 8 | 定义管理 | `/admin/agents/definitions` | `agents:manage` | `AgentDefList.vue` + `CapabilityConfigurator.vue` | CRUD + 发布 + 启停 + 版本历史 + 回滚 + MCP 工具勾选 |
| 9 | 技能库 | `/admin/agents/skills` | `skills:view` | `SkillList.vue` | SKILL.md 正文、增删改、zip 导入 |
| 10 | 模型（只读总览） | `/admin/settings/models` | `system:dict:view` | `ModelsPage.vue` | 看清单与价格、发现"启用未配价"；**维护在「字典管理 · 大模型清单」**（字段定义走独立页面、记录走抽屉） |

> 📌 菜单「运行记录」指向 `/agents`（概览页），真正的 run 列表需**从概览页点进某个 agent**。
> 📌 全仓库直接打 `/api/ai-agent` 的前端只有 2 处：`AgentPlayground.vue`（3 个）和 `apps/mini-contract/services/{contract,ocr}-api.ts`。排查时优先看这两个文件。

**门户与小程序入口**

| 入口 | 位置 | 走的链路 |
|---|---|---|
| AI 助手 | `/portal/chat`，导航栏「AI 助手」触发器在 `AppNavbar.vue` | `/api/ai/*`（**不经过 agent 编排**，源码注释标注为「保留旧页面兼容」） |
| 合同风险 / OCR | `apps/mini-contract` | `/api/ai-agent/*`（真编排） |

---

## 5. CLI 体验（脱离 UI，最快看清 ReAct 全过程）

```bash
# 构建（agent-core 必须先构建，kedou-agent 依赖它）
pnpm --filter @kedouai/agent-core build && pnpm --filter kedou-agent build

pnpm --filter kedou-agent start       # 或 node packages/kedou-agent/bin/kedou-agent.js
kedou-agent config                    # 首次配置 key（存 ~/.kedou/agent-cli.config.json，600 权限）
kedou-agent models                    # 查看模型/搜索凭据状态
kedou-agent agents                    # 查看可用 agent 及模型就绪情况
kedou-agent --message "北京今天天气"    # 单轮非交互
```

REPL 内斜杠命令：`/help` `/agents` `/agent <id>` `/clear` `/exit`

**环境变量**（优先级高于配置文件）：`HY3_API_KEY` / `HY3_BASE_URL`、`TOKENHUB_API_KEY` / `TOKENHUB_BASE_URL`（缺省回落 HY3）、`BING_SEARCH_API_KEY`、`TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`（WSA）、`MCP_GATEWAY_URL`（配了才启用 MCP 工具 + deploy 助手）

内置 Agent：`general-assistant`（联网 + 读写 + 执行，maxSteps 10）、`deploy`（可跳过 ara 配置才注册）

> 💡 **验证危险操作闸门用 CLI 最方便**：直接让它写文件或跑命令，观察确认弹窗、拒绝分支、以及非交互模式下默认拒绝的行为。

---

## 6. 推荐走查路线（30 min）

| 阶段 | 时长 | 动作 | 通过标准 |
|---|---|---|---|
| ① 看运行 | 5 min | playground 发一句需联网/需工具的话，盯 SSE 事件流 | 能看到 `tool_call`/`tool_result`，`skill_load` 在合适时机被触发 |
| ② 验热更新 | 10 min | definitions 改 systemPrompt / 勾一个新工具 → **publish** → 等 30s → 回 playground | **无需重启服务**即生效（这是本架构最值得确认的一点） |
| ③ 验观测闭环 | 5 min | 刚才那次 run 应已进入 `/admin/agents/runs/*/run/:id` | token/成本与 model-pricing 能对上 |
| ④ 验权限闸门 | 5 min | CLI 或 playground 触发 `write-file`/`shell-exec` | 挂起 → 确认/拒绝两条分支都通；60s 超时自动拒绝 |
| ⑤ 验知识检索 | 5 min | knowledge 灌一篇文档 → retrieval 调 topK 召回 → definitions 挂到某 agent → playground 复问 | 能正确引用刚灌进去的文档内容 |

**回归速验**（改完代码只想确认没坏）：playground 跑一轮 → metrics 出现新记录 → Swagger `http://localhost:6010/api-docs` 可达。

---

## 7. 坑与易混淆点（按踩坑频率排序）

1. **前后链路混淆** —— portal `/chat` 走 `/api/ai/*` 不经编排；admin playground 与 mini-contract 才走 `/api/ai-agent/*`。报问题时先分清。
2. **菜单看不见** —— 100% 是权限。到 `/admin/settings/roles` 补 §0 的权限码；忘记密码 `bash scripts/local-up.sh --seed`（admin / admin123）。
   ⚠️ **新增权限码后菜单仍不出现**：权限是"双读"——后端各服务鉴权读**代码常量**（`ROLE_PERMISSIONS`），前端菜单读 **DB**（`/api/permissions/my`）。而权限点是 `PermissionService.seed()` 在 user-service 启动时才写进 DB 的，所以加了新码只重启后端服务，会出现"接口调得通、菜单不出现"。
   **处理**：**发布流水线收尾会自动同步一次**（`PIPELINE_PERM_SYNC`，默认开，失败只告警不阻断发布），所以正常走发布流程无需人工干预。若是没走流水线（手工改代码/临时调试），按下面来：
   ① 跑 `bash scripts/sync-permissions.sh`（幂等，走内部接口）；
   ② 或点 admin「角色权限」页右上角**同步权限点**按钮（同步后立即刷新自身权限，菜单当场出现，不必重登）；
   ③ 或重启 `web-user`。
   ①②③ 等价（都执行 `seed()`，全量覆盖内置角色权限），但只有 ①② 不需要重启服务。
   **页面会主动提示**：「角色权限」页顶部在代码声明与 DB 不一致时出现黄色告警（缺失/多余权限点 + 内置角色差集），点「立即同步」即可 —— 不用等别人告诉你"菜单没出来"。
   **审计**：每次同步都会落一条 `sync_permission` 操作日志（operator 为 `pipeline:<提交人>` 或页面用户名），在「操作日志」页可查。
3. **改了 admin 源码没生效** —— 微前端四步没走完，或版本表写错库。⚠️ 版本表在 **`web_system_deploy`** 库的 `deploy_deployments`，不是 `web_system`；且 gateway 有 **TTL 10s 版本缓存**（要等或 `pm2 restart web-gateway`）。详见 `.codebuddy/CODEBUDDY.md` §4.1。
4. **改了定义没生效** —— 忘了点 **publish**（保存草稿不生效），或没等满 30s 轮询周期（`AGENT_DEF_POLL_MS` 可调）。
5. **「数字人」≠ 产品功能** —— `.codebuddy/agent-kit/` 是给 AI 用的开发侧方法论（11 skill + 5 红线），没有前端页面。面向用户的概念统一叫 Agent。
6. **`.codebuddy/agent-kit/` 是副本，运行时加载 `.codebuddy/skills/`**，两者不互通，CI 同步不会更新运行时行为。`scripts/sync-agent-kit.sh` 补这段：默认 dry-run 报 diff，`--mirror` 覆盖副本，**永不自动覆盖运行源**（会丢 fe/be 项目专属路由）。
7. **`ai-agent` / `knowledge-service` 未注册到 `scripts/modules.json`** —— 虽跑在 pm2 且有网关路由，但不在发布流水线和微前端清单里，deploy-console 管不到。
8. **`DeepseekClient` 已下线** —— `README.md` 未同步，`dist/` 有残留，以 `src/` 为准。
9. **SSE 超时** —— AI 类链路三层超时取最短层，走 `API_TIMEOUT.AI_TASK`（90s；agent-core 内部常量为 180s）/ gateway `PROXY_TIMEOUT.AI_TASK`，被截短会从最内层往外查。
10. **改 `.env` 的 `TOKENHUB_MODELS` 想加模型却不生效** —— 模型清单现在的真相源是 **DB 字典 `llm_models`**（admin →「字典管理」，`MODEL_SOURCE=db` 默认）；`.env` 只在字典不可用/为空时兜底，代码内置常量再兜底。改字典后等 60s（`MODEL_POLL_MS`）或重启 `web-ai-agent`。排查入口：`GET /api/ai-agent/agent/models`（还带 `available`）与 ai-agent 日志里的「模型清单已更新：来源=db/env/builtin」。
11. **字典里的 `hy3` 不会生效** —— `hy3` 由 `Hy3Client` 专用通道承载（与 TokenHub 的 key/base 不同），`ModelCatalogService` 会过滤并 WARN；要调 hy3 请确认 `HY3_API_KEY`，不要往 `llm_models` 里加。
12. **改了模型价格却不生效（或以为要去旧表改）** —— 单价真相源已从 `model_pricing` 表迁到**字典 `llm_models` 的三个字段**（`input_price_per1k` / `output_price_per1k` / `currency`，2026-09-11）。维护入口：admin「字典管理 → 大模型清单」（字段定义走独立页面、记录走抽屉）。ai-service 由 `ModelPricingCatalog` 每 60s 拉一次（`PRICE_POLL_MS`），改完最多一分钟生效。旧表与 `admin/model-pricing` 的**写接口已下线**（只留只读对账），在上面改价**不会有任何效果**。`PRICE_SOURCE` 三档：`dict`（默认，字典未命中回落旧表）/`dict-only`/`legacy`（完全回退到旧表）。未配价的模型成本记 0 —— admin「模型」页顶部会提示「N 个启用中的模型未配置单价」。

---

## 8. 维护约定

### 8.1 何时必须更新本文档

| 触发场景 | 需修订章节 |
|---|---|
| 新增/删除 **工具** 或改工具名 | §3.1 工具行 |
| 新增/更换 **模型客户端** | §3.1 模型客户端行、§5 环境变量表 |
| `ai-agent` 增删/改 **HTTP 接口** | §3.2 接口表、§0 速查 |
| `ai-service` 增删/改 **管理接口** 或权限码 | §3.3 接口表、§0 权限清单 |
| 新增/改 **权限码**（`packages/types`） | §0 权限清单、§7 坑 2；同步交给**发布流水线收尾自动执行**（`PIPELINE_PERM_SYNC`），未走流水线时跑 `scripts/sync-permissions.sh`（否则后端放行、前端菜单不出现） |
| 新增/改 **数据表或字段** | §3.4 表清单（注意分库） |
| admin 增删/改 **Agent 页面或路由** | §4 UI 入口表 |
| 新增 SSE **事件类型** | §3.2 事件类型行 |
| 服务端口 / 网关前缀变更 | §0 端口、§3.5 |
| 发现新的踩坑点 | §7（追加） |
| 任何上述变更 | **§顶部变更日志追加一行** |

### 8.2 变更时同步确认的单事实源

```bash
# 接口真相：controller 装饰器
grep -rn "@Post\|@Get\|@Put\|@Delete" servers/ai-agent/src servers/ai-service/src/agent-def servers/ai-service/src/agent-log servers/ai-service/src/skill

# 权限真相：路由 meta + 菜单 v-if
grep -rn "permission:" apps/admin/src/router/index.ts
grep -rn "hasPermission" apps/admin/src/layouts/BasicLayout.vue

# 权限点真相（代码声明）→ 同步进 DB（新增权限码后必跑，否则后端放行、前端菜单不出现）
grep -n "PERMISSIONS = \|ROLE_PERMISSIONS" packages/types/src/index.ts
bash scripts/sync-permissions.sh

# 网关路由真相
grep -n "ai-agent\|knowledge" servers/gateway/src/proxy/proxy.controller.ts

# 工具真相
ls packages/agent-core/src/tools/coding/
```

### 8.3 修订原则

- **只改增量**：用 `replace_in_file` 定点改，不整篇重写（避免丢失人工补充）。
- **每次必留痕**：变更日志追加一行，写清改了什么、为什么。
- **口径一致**：接口表列全「方法 + 外部路径 + 权限 + 用途」四要素，不要只写路径。
- **沉淀易踩坑点**：新踩的坑写进 §7，并写明「症状 → 根因 → 处理」，便于他人自助排查。

---

## 附：相关文档索引

| 主题 | 入口 |
|---|---|
| 项目总入口 / 发布部署铁律 | [`.codebuddy/CODEBUDDY.md`](../../.codebuddy/CODEBUDDY.md) |
| Agent 定义数据模型设计 | [`docs/architecture/agent-definition-db-design.md`](../architecture/agent-definition-db-design.md) |
| agent-core 库说明 | [`packages/agent-core/README.md`](../../packages/agent-core/README.md) |
| 合同场景端到端评测 | [`servers/ai-agent/e2e/contract-risk/`](../../servers/ai-agent/e2e/contract-risk) |
| 本地发布运维手册 | [`docs/development/local-release-runbook.md`](local-release-runbook.md) |
| admin 微前端开发 | [`docs/development/admin-dev.md`](admin-dev.md) |
| 评测框架（L1~L4） | [`.codebuddy/agent-kit/references/eval-framework.md`](../../.codebuddy/agent-kit/references/eval-framework.md) |
