# 契约登记（contracts）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：跨端 / 跨服务契约的**单一登记点** —— 讲清「有哪些契约 / 真相源在哪 / 改了要同步谁 / 已知漂移」。
> **本文不复制清单**（清单以代码与自动生成文档为真相源），只登记契约类别、真相源、变更纪律与漂移记录。
> 关联：`specs/rd-process-model/design.md`（S4.2 `contract-reviewer` · CI R13）· `docs/development/release-review-checklist.md`。

---

## 0. 为什么需要它（一个真实案例）

`card` 事件（对话流式推送的结构化卡片，如音乐卡 / 翻译卡）：

| 位置 | 状态 |
|---|---|
| `servers/ai-agent/src/agent/agent.controller.ts` | 服务端**推送** `{ type: 'card', card, step }` |
| `apps/portal/src/api/agent.ts` | 前端**手写**联合类型 `\| 'card'` |
| `apps/kedou-ai-minigram/services/agent-stream.ts` | 小程序**手写**联合类型 `\| 'card'` |
| `packages/agent-core/src/interfaces/runtime.interface.ts` | `StreamEvent` **有 `card?` 载荷字段**，但 `StreamEventType` 联合里**没有 `'card'`** |

三处各自维护同一契约，而「共享类型包」没登记 —— 于是：

- 消费方只能**靠猜**有没有这个事件：小程序一度漏写 `type === 'card'` 分支，音乐卡片在实时推送里不出现（只在历史回放时才见）；
- 任何一方改事件名 / 载荷形状，其他两方**静默失效**（编译能过、测试能过）。

这就是「契约没有单一真相源」的代价。本文的作用是**把这类契约登记到一处**，让变更时知道要同步谁、让 CI（R13 / R16）能拦。

> 该漂移已于 2026-09-24 修复（见 §9 D1 / D2），并由 **R16** 守跨端一致性 —— **登记 + 机检**才是完整闭环；只登记不机检，下次仍会漂。

---

## 1. 契约类别与真相源

| # | 契约 | 真相源（代码） | 派生 / 登记文档 | 机检 |
|---|---|---|---|---|
| **C1** | 对外 HTTP 接口 | 各服务 controller 的 Swagger 注解 | `specs/<svc>/api-design.md`（自动生成） | R13 |
| **C2** | **SSE 事件类型** | `packages/agent-core/src/interfaces/runtime.interface.ts` | 本文 §3 | R13（`interfaces/*`）+ **R16（跨端一致性）** |
| **C3** | MCP 工具 | `servers/mcp-gateway/src/mcp/mcp.service.ts` | 本文 §4（只登记约定，不复制清单） | R13 |
| **C4** | 权限码 / 共享常量 | `packages/types/src/index.ts` | 本文 §5 | R13 |
| **C5** | 网关路由 | `servers/gateway/src/proxy/proxy.controller.ts` | 本文 §6 | — |
| **C6** | 微前端版本指针 | 发布平台库 `deploy_deployments.current_version` + gateway `__manifest__` | `docs/development/admin-dev.md` §一·C | R14（间接） |
| **C7** | **Agent 生成参数与模型清单** | `packages/agent-core/src/clients/base-ai.client.ts`（`ChatOptions`）+ `interfaces/agent.interface.ts`（`AgentDefinition` 调参字段） | 本文 §7 | R13（`interfaces/*`）+ `scripts/check-agent-core-exports.mjs` |

> 判据：**只要两方（或以上）各自维护同一事实，它就是契约**。单一消费方的内部约定不算。

---

## 2. C1 对外 HTTP 接口

**真相源**：各服务的 controller 装饰器（`@Get/@Post/@Put/@Delete` + Swagger 注解）。
**派生文档**：`specs/<svc>/api-design.md`，由 `scripts/gen-api-design.mjs` 从注解自动提取（含 DTO 字段级 schema，最多 2 层嵌套）。

现有 16 份：

```
ai-agent · ai-service · auth-service · content-hub · deploy-console · dict-module
gateway · knowledge-service · mcp-gateway · module-env-ownership · mp-platform
pipeline-node-model · system-service · todo-service · upload-service · user-service
```

**重新生成**（后端改了 controller 注解之后）：

```bash
node scripts/gen-api-design.mjs
```

**变更纪律**：

- 新增 / 改接口 → 先落 `specs/<svc>/api-design.md`（或改注解后重生成），再谈实现；
- 破坏性变更（删字段 / 改语义 / 改必填）须在 PR 说明里列出**消费方清单**；
- 废弃接口保留一版过渡期，标注 `@deprecated` 与替代路径。

---

## 3. C2 SSE 事件类型

**真相源**：`packages/agent-core/src/interfaces/runtime.interface.ts` 的 `StreamEventType`（联合类型）+ `StreamEvent`（载荷）。

当前登记的 `type` 值（以代码为准，此处仅为索引）：

```
content_delta · reasoning_delta · tool_call · tool_result · skill_load
summary · final · error · permission_request · intent · card
```

查看真相：

```bash
sed -n '/export type StreamEventType/,/^;/p' packages/agent-core/src/interfaces/runtime.interface.ts
```

**已修复（2026-09-24）**：`'card'` 已补进 `StreamEventType`；`card.kind` 收敛为「已知值 `'music'` + 扩展位 `(string & {})`」。
同时清理了两个**死类型**：`'token'`（agent-core，无生产者 / 无消费者）与 `'start'`（两端，本地合成事件误入契约）。

**一致性由机检守（CI R16）**：`scripts/redline/check-sse-contract.py` 以 `StreamEventType` 为真相源，比对各端手写联合：

| 级别 | 含义 |
|---|---|
| `MISSING` | 消费方缺真相源里的类型（新增事件后最容易漏） |
| `EXTRA` | 消费方多出真相源没有的类型：手写联合里的死类型 / 本地事件混入契约，**或 import 型消费方的 `switch case` 用了已删类型**（admin `AgentPlayground.vue` 即此形态） |
| `LOOSE` | 用裸 `\| string` 兜底（类型检查失效、已知值提示全丢）；应改为「已知联合 + `(string & {})`」 |

**待办**：两端仍是手写复制（均未依赖 `@kedouai/agent-core`），import 化见 §8 D2。

**特殊约束**：

- `intent` 事件**必须是本轮第一个事件**（早于任何 token）——消费方据此渲染 agent 徽标；
- `permission_request` 带确认请求 id，走「人在环」确认后再继续。

---

## 4. C3 MCP 工具

**真相源**：`servers/mcp-gateway/src/mcp/mcp.service.ts` 的工具定义数组（`name` / `description` / `params`）。

查看真相（按前缀分组统计）：

```bash
grep -oE "name: '[a-z0-9_]+'" servers/mcp-gateway/src/mcp/mcp.service.ts | sort -u
```

工具的**共同约定**（这几条才是契约，清单本身不在此复制）：

| 约定 | 说明 |
|---|---|
| 鉴权 | 调 `/mcp/tools/call` 须带 `MCP_CLIENT_KEY`（Bearer）；该 key 必须与 ai-agent 的配置一致，否则 401 |
| 能力绑定 | 工具要真正可用，必须由 agent 定义（`agent_definitions.capabilities`）显式绑定；**绑定是 DB 侧改动，必须先确认运行代码已同步到发布目录**，否则「绑定即故障」（运行时报「工具未注册」） |
| 命名 | 前缀表领域（`knowledge_*` / `get_*` / `publish_*` / `create_*`），改名前必须同步 DB 绑定与 agent 提示词 |
| 前置校验 | 部分工具要求先调另一个（如 `knowledge_search` 须先 `knowledge_list` 确认集合可用） |

**变更纪律**：改工具名 / 参数 / 描述 → 同步 ① agent 定义的能力绑定（DB）② 引用它的 agent 提示词 ③ 本文档若涉及约定。

---

## 5. C4 权限码 / 共享常量

**真相源**：`packages/types/src/index.ts`。

结构（真相源为代码，此处登记形状）：

| 导出 | 作用 |
|---|---|
| `PERMISSIONS` | 权限点定义表：`code` / `name` / `group` / `type` |
| `ROLE_PERMISSIONS` | 内置角色的权限集合（后端各服务鉴权读**代码常量**） |
| `PermissionGroup` | 分组枚举（dashboard / users / settings / logs / mcp / agents / database / knowledge / deploy） |
| `PermissionType` | 类型（menu / action / api） |

查看真相：

```bash
grep -n "PERMISSIONS = \|ROLE_PERMISSIONS" packages/types/src/index.ts
# 权限点数量：注意键后的对齐空格，用 "': {" 这种紧邻模式会漏（实测只匹配到 6 个）
sed -n "/export const PERMISSIONS/,/^};/p" packages/types/src/index.ts | grep -cE "^[[:space:]]*'[^']+':"
```

### ★ 双构建约束（历史事故点）

`packages/types` 的 `build` 脚本是：

```
tsc && tsc -p tsconfig.cjs.json && node -e "…写 dist/cjs/package.json {type:commonjs}"
```

**只跑 `npx tsc` 只会更新 ESM 产物（`dist/index.js`），后端 `require` 的 cjs 产物仍是旧的** → 新权限码 / 新常量「代码写了但不生效」。

发布与本地验证一律跑：

```bash
cd packages/types && npm run build
```

### 变更纪律（新增权限码）

权限是**双读**：后端鉴权读代码常量（`ROLE_PERMISSIONS`），前端菜单读 DB（`/api/permissions/my`）。而 DB 里的权限点由 `PermissionService.seed()` 在 user-service 启动时写入 —— 所以新增权限码后**必须同步一次**，否则「接口调得通、菜单不出现」：

- 正常走发布流水线：收尾自动同步（`PIPELINE_PERM_SYNC`，失败只告警不阻断）；
- 手工兜底：`bash scripts/sync-permissions.sh` 或 admin「角色权限」页的**同步权限点**按钮。

---

## 6. C5 网关路由

**真相源**：`servers/gateway/src/proxy/proxy.controller.ts`。

查看真相：

```bash
grep -nE "@All\('|@Post\('|@Get\('" servers/gateway/src/proxy/proxy.controller.ts
```

**契约级约束**（源码注释里写明的，容易踩）：

| 约束 | 原因 |
|---|---|
| **精确 + 通配成对注册** | 每个前缀都成对出现（`@All('x')` 与 `@All('x/:path(*)')`），少一个会导致无尾斜杠的请求 404 |
| **特化路由必须注册在通配之前** | 如 `admin/permissions`、`admin/roles`、`admin/skills`、`permissions/my` 必须先于 `admin/:path(*)`，否则被通配抢走 |
| **SSE / 二进制端点走原生 http 转发** | `ai/chat/stream`、`ai-agent/agent/run`、`ai-agent/agent/admin-run`、`ai/tts/speak`、`ai/tts/stream` 不能用 http-proxy-middleware（会缓冲，破坏流式） |
| **认证由后端服务负责** | Gateway 只做代理转发（`@Public()`），不做鉴权 |

---

## 7. C7 · Agent 生成参数与模型清单

> 为什么它也算契约：**同一个「生成参数」同时存在于三处** —— 契约面字段（`AgentDefinition`）、
> 持久化列（DB `agent_definitions`）、运行时入参（`ChatOptions`）。任一处不同步，现象都是
> 「后台填了值但不生效」或「填了也没人读」，编译与测试全绿 —— 与 D1 同型的静默失效。

### 7.1 真相源

| 层 | 真相源 | 说明 |
|---|---|---|
| 参数形状（运行时） | `packages/agent-core/src/clients/base-ai.client.ts` → `ChatOptions` | `temperature` / `maxTokens` / `topP` / `thinking` |
| 参数形状（定义侧） | `packages/agent-core/src/interfaces/agent.interface.ts` → `AgentDefinition` | Agent 级默认参数，随定义下发 |
| 持久化 | `servers/ai-service/src/agent-def/entities/agent-definition.entity.ts` + DB `agent_definitions` | 后台编辑落这里，30s 轮询下发 |
| 模型清单 | DB 字典 `llm_models`（admin 字典管理）→ `ModelCatalogService` | **ai-agent 已字典驱动；ai-service 曾硬编码** |

### 7.2 契约级约定（改这块前必读）

| # | 约定 | 违反后果 |
|---|---|---|
| **C7-a** | 契约面新增一个调参字段 → **必须同时**加 DB 列 + DTO + 下发映射，三处缺一即「填了不生效」 | 后台能填、引擎不读 |
| **C7-b** | **`temperature` 与 `topP` 互斥**：二者只填其一，保存时校验报错 | 同时填 → 输出时好时坏，无法归因（官方口径：只改其一） |
| **C7-c** | `thinking` 优先级：`RunInput` 单次覆盖 > Agent 定义字段 > env `TOKENHUB_THINKING` > 客户端按模型名推断 | 优先级反了会出现「关不掉 / 开不了」 |
| **C7-d** | **意图分类链路不受 Agent 定义控制**：固定 `maxTokens=256` + `thinking: disabled`，由 `CLASSIFY_MAX_TOKENS` 与代码强制 | 放开即复现「思考 token 吃光输出预算 → 100% 兜底」 |
| **C7-e** | 新增字段**全为 null 时行为必须与旧版完全一致**（可回归对照） | 存量 agent 行为漂移 |
| **C7-f** | Agent 定义里的 `model` 必须能在 `ClientRegistry` 解析；解析不到按服务侧策略回落（ai-agent → `hy3`） | 选了没注册的模型直接报错 |
| **C7-g** | `src/index.ts` 对 `interfaces/agent.interface` 是**包级 `export *`** —— 契约面新增字段对所有 import 方**自动可见**（编译时即生效，无需对方改代码） | 「我加了字段对方怎么知道」的答案是：一定知道；反过来说，删字段会**直接编译失败**（比静默失效好） |
| **C7-h** | 老前端（表单没有新字段）保存时，后端对新增参数必须走**「传了才覆盖」**而非 `?? null` | 否则一次表单保存就把后台已配参数**静默清空**（见 §9 D10） |

### 7.3 消费方清单（改字段时要同步谁）

| 消费方 | 位置 | 依赖形态 |
|---|---|---|
| ai-service | `agent-def/entities/agent-definition.entity.ts` + `dto/agent-def.dto.ts` + 定义同步 | DB 列 ↔ 契约字段映射 |
| ai-agent | `agent/agent.module.ts` / `ModelCatalogService` / `AgentRegistry` | 读下发定义、解析 model |
| `packages/kedou-agent` | 组装 `RunInput` | 单次覆盖 |
| admin `AgentPlayground.vue` | `RunInput.model` 临时覆盖 | 单次覆盖（UI 门） |
| admin `AgentDefList.vue` + `api/agent-defs.ts` | Agent 定义表单 | **UI 侧尚未补齐**（§9 D10）：表单只有 temperature，且把 `null` 强转成 0.7 |

### 7.4 档位约定（P0 落地，写入文档而非只靠人记）

| 场景 | temperature | topP | maxTokens | thinking |
|---|---|---|---|---|
| 分类 / 意图路由 | 0 ~ 0.1 | 不填 | 256 | **disabled**（强制，见 C7-d） |
| 结构化抽取 / JSON | 0 ~ 0.2 | 不填 | 按字段量 | disabled |
| 代码生成 | 0 ~ 0.2 | 不填 | ≥3000 | 视复杂度 |
| 通用对话 | 0.6 ~ 0.7 | 不填 | 800~2000 | 可开小预算 |
| 创意 / 文案 | 0.8 ~ 1.0 | 或改 topP 0.95 | 放宽 | 可开 |
| Agent 工具调用 | 0.2 ~ 0.4 | 不填 | 按工具返回量 | 视链路长短 |

> 推理模型（DeepSeek V4 思考模式）例外：官方口径 temperature 0.6~0.7，且思考模式下 temperature 不生效、top_p 被钳在 0.95~1.0。压到 0.1 不更准，只会复读。

---

## 8. 契约变更纪律（改契约前必读）

1. **先判影响面**：本次改的是 §1 表格里的哪一类？消费方有哪些（端 / 服务 / DB 绑定）？
2. **先文档后实现**：接口类先落 `api-design.md`；SSE / 工具 / 权限类先在本文更新登记与约定。
3. **机检会报**：C1–C4、C7 的改动面命中 **CI R13**（跨端一致性另由 **R16** 检查），commit 须带 `Contract: pass`（或报告路径）；纯微调走 `Micro-exempt: <理由>`。
   > 级别现状：R13 / R16 均为 **warning** —— `quality-gate.yml` 调用 `scan-rules.sh diff` **不带 `--strict`**，因此 warning 只出现在日志里、**不阻断合并**。升为阻断需配套存量过渡（见 `specs/rd-process-model/design.md` §7.1 的 Q3 决议）。
4. **DB 绑定晚于代码同步**：`agent_definitions.capabilities` / 字典 / 权限码的 DB 侧改动，必须在**运行代码已同步到发布目录之后**再做（先后顺序反了就是「绑定即故障」）。**调参字段同理**（C7-a）：先发带新列的代码，再在后台填值。
5. **破坏性变更写消费方清单**：谁在用、怎么迁移、保留多久。

---

## 9. 已知漂移与待补

| # | 项 | 状态 |
|---|---|---|
| D1 | `'card'` 未进 `StreamEventType` | **已修（2026-09-24）**：补进类型；`card.kind` 收敛为「已知值 `'music'` + 扩展位 `(string & {})`」（既给提示，又不破坏消费方编译） |
| D2 | 两端各自手写 SSE `type` 联合 | **已对齐 + 已机检**：两端集合与真相源一致（删死类型 `'start'`、补 `skill_load` / `permission_request`），并由 **R16** 守一致性。**尚未 import 化**——两端均未依赖 `@kedouai/agent-core`，改为导入留作后续（`apps/admin` 已有依赖先例） |
| D3 | R13 契约面未含协议文件 | **已修**：按明确路径纳入 `packages/agent-core/src/interfaces/*`（不再冒「整个 SDK 太宽」导致摩擦的风险） |
| D4 | MCP 工具清单无自动生成物 | 可选：仿 `gen-api-design.mjs` 生成工具清单，减少人工核对 |
| D5 | 各端 DTO 类型未共享 | 现状：接口类型由 `api-design.md` 描述，前端各自定义；是否抽共享类型待评估 |
| D6 | 死类型清理 | `'token'`（无生产者；**其消费者 admin 的 `case 'token'` 已一并删除**——教训：删类型前必须查 **import 型**消费方，否则 `switch` case 会 TS2678 编译失败）与 `'start'`（两端手写联合里混入的本地事件）已于 2026-09-24 清理。**未清理**：`minigram/packageContract/pages/contract/{chat,assistant}.ts` 与 admin `evtTag` 里的 `'start'` 消费点——它们**无兜底**，删了若真有生产者会导致文案静默消失，故留待确认生产者后处理 |
| D7 | 模型客户端文档漂移 | **待修（2026-10-10 登记）**：`packages/agent-core/README.md` 与 `clients/tokenhub.client.ts` 注释仍写 `DeepseekClient`（已被 `TokenHubClient` 取代且不再导出）；`servers/ai-service/src/common/client.registry.ts` 日志里 `DEPSEEK_API_KEY` 拼写错误；`docs/development/agent-capability-playbook.md` 的 📌 提示语随 README 修复而过期。**防复发**：`scripts/check-agent-core-exports.mjs` 对拍 README 声明与 `src/index.ts` 实际导出 |
| D8 | 调参字段只有 `temperature` 贯通 | **待修（2026-10-10 登记）**：`ChatOptions` 支持 `maxTokens` / `topP` / `thinking`，但 `AgentEngine` 只传 `temperature`；`agent_definitions` 也无对应列 → 按 C7-a 三处同步补齐 |
| D9 | 两侧模型装配不一致 | **待修（2026-10-10 登记）**：ai-agent 字典驱动（`ModelCatalogService`），ai-service 硬编码 `Hy3Client` + `TokenHubClient('deepseek-v4-flash')`；且 ai-service 普通 chat 链路另走自研 `common/http/deepseek.client.ts`（官方直连，另一套 key）。**已修 ai-service Agent 链路**（新增 `agent/model-catalog.service.ts`，同源复制待后续抽 `packages/llm-catalog`） |
| D10 | admin 表单未跟上 C7 三字段 | **待修（2026-10-10 登记，走 UI 门）**：`AgentDefList.vue` 只有 temperature 控件、`api/agent-defs.ts` 的 `SaveAgentDefPayload` 缺 maxTokens/topP/thinking；且 `def.temperature ?? 0.7` 把「null = 沿用默认」强转成 0.7（违反 C7-e）。**后端已按 C7-h 兜住**（更新时「传了才覆盖」，不会因老前端保存而清空），UI 补齐需先过 UI 门 |
---

## 10. 体检命令（一句话复跑）

```bash
# C1 接口契约是否齐（缺哪个服务一眼看出）
ls specs/*/api-design.md

# C2 SSE 事件类型
sed -n '/export type StreamEventType/,/^;/p' packages/agent-core/src/interfaces/runtime.interface.ts
# 跨端一致性（D2）：R16 已自动化，这是它的等价手动入口（无输出=一致）
python3 scripts/redline/check-sse-contract.py

# C3 MCP 工具
grep -oE "name: '[a-z0-9_]+'" servers/mcp-gateway/src/mcp/mcp.service.ts | sort -u

# C4 权限码（数量 + 双构建产物是否同时更新）
sed -n "/export const PERMISSIONS/,/^};/p" packages/types/src/index.ts | grep -cE "^[[:space:]]*'[^']+':"
ls -l packages/types/dist/index.js packages/types/dist/cjs/index.js 2>/dev/null \
  || echo "未构建 → cd packages/types && npm run build"

# C5 网关路由（特化是否在通配之前）
grep -nE "@All\('" servers/gateway/src/proxy/proxy.controller.ts

# C7 生成参数：契约面字段 ↔ DB 列 是否三处同步（缺谁一眼看出）
grep -nE "maxTokens|topP|thinking" packages/agent-core/src/interfaces/agent.interface.ts
grep -nE "maxTokens|topP|thinking" servers/ai-service/src/agent-def/entities/agent-definition.entity.ts
# 模型客户端文档是否漂移（README 声明 ↔ index.ts 实际导出，无输出=一致）
node scripts/check-agent-core-exports.mjs
```
