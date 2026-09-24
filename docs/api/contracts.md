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

这就是「契约没有单一真相源」的代价。本文的作用是**把这类契约登记到一处**，让变更时知道要同步谁、让 CI（R13）能拦。

---

## 1. 契约类别与真相源

| # | 契约 | 真相源（代码） | 派生 / 登记文档 | 机检 |
|---|---|---|---|---|
| **C1** | 对外 HTTP 接口 | 各服务 controller 的 Swagger 注解 | `specs/<svc>/api-design.md`（自动生成） | R13 |
| **C2** | **SSE 事件类型** | `packages/agent-core/src/interfaces/runtime.interface.ts` | 本文 §3 | R13（协议文件待纳入，见 §8） |
| **C3** | MCP 工具 | `servers/mcp-gateway/src/mcp/mcp.service.ts` | 本文 §4（只登记约定，不复制清单） | R13 |
| **C4** | 权限码 / 共享常量 | `packages/types/src/index.ts` | 本文 §5 | R13 |
| **C5** | 网关路由 | `servers/gateway/src/proxy/proxy.controller.ts` | 本文 §6 | — |
| **C6** | 微前端版本指针 | 发布平台库 `deploy_deployments.current_version` + gateway `__manifest__` | `docs/development/admin-dev.md` §一·C | R14（间接） |

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
token · content_delta · reasoning_delta · tool_call · tool_result
skill_load · summary · final · error · permission_request · intent
```

查看真相：

```bash
sed -n '/export type StreamEventType/,/^;/p' packages/agent-core/src/interfaces/runtime.interface.ts
```

**已知漂移（2026-09-24 实测，见 §0）**：`'card'` 由服务端推送、被两个前端各自手写，但**未进 `StreamEventType`**。

**处置（待办）**：

1. 把 `'card'` 补进 `StreamEventType`（含 `card.kind` 的取值联合）；
2. 两个前端改为**从 `@kedouai/agent-core` 导入**类型，删掉各自手写的联合类型；
3. 补一条机检：前端出现手写 SSE `type` 字面量联合 → 提示改用共享类型。

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

## 7. 契约变更纪律（改契约前必读）

1. **先判影响面**：本次改的是 §1 表格里的哪一类？消费方有哪些（端 / 服务 / DB 绑定）？
2. **先文档后实现**：接口类先落 `api-design.md`；SSE / 工具 / 权限类先在本文更新登记与约定。
3. **机检会拦**：C1–C4 的改动面命中 **CI R13**，commit 须带 `Contract: pass`（或报告路径）；纯微调走 `Micro-exempt: <理由>`。
4. **DB 绑定晚于代码同步**：`agent_definitions.capabilities` / 字典 / 权限码的 DB 侧改动，必须在**运行代码已同步到发布目录之后**再做（先后顺序反了就是「绑定即故障」）。
5. **破坏性变更写消费方清单**：谁在用、怎么迁移、保留多久。

---

## 8. 已知漂移与待补

| # | 项 | 状态 |
|---|---|---|
| D1 | `'card'` 未进 `StreamEventType`（§0） | **待修**：补类型 + 前端改为导入共享类型 |
| D2 | 两个前端各自手写 SSE `type` 联合 | **待修**：统一从 `@kedouai/agent-core` 导入 |
| D3 | R13 契约面未含 `packages/agent-core` 协议文件 | **待办**：本文件落盘后，可把协议文件**按明确路径**纳入契约面（此前因「整个 SDK 太宽」被临时排除） |
| D4 | MCP 工具清单无自动生成物 | 可选：仿 `gen-api-design.mjs` 生成工具清单，减少人工核对 |
| D5 | 各端 DTO 类型未共享 | 现状：接口类型由 `api-design.md` 描述，前端各自定义；是否抽共享类型待评估 |

---

## 9. 体检命令（一句话复跑）

```bash
# C1 接口契约是否齐（缺哪个服务一眼看出）
ls specs/*/api-design.md

# C2 SSE 事件类型
sed -n '/export type StreamEventType/,/^;/p' packages/agent-core/src/interfaces/runtime.interface.ts
# 漂移体检：前端是否在手写 SSE type 联合（D2）
grep -rn "| 'card'\|| 'token'" apps/*/src apps/*/services 2>/dev/null

# C3 MCP 工具
grep -oE "name: '[a-z0-9_]+'" servers/mcp-gateway/src/mcp/mcp.service.ts | sort -u

# C4 权限码（数量 + 双构建产物是否同时更新）
sed -n "/export const PERMISSIONS/,/^};/p" packages/types/src/index.ts | grep -cE "^[[:space:]]*'[^']+':"
ls -l packages/types/dist/index.js packages/types/dist/cjs/index.js 2>/dev/null \
  || echo "未构建 → cd packages/types && npm run build"

# C5 网关路由（特化是否在通配之前）
grep -nE "@All\('" servers/gateway/src/proxy/proxy.controller.ts
```
