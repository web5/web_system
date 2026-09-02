# Agent 平台产品说明书（PRD）

> 版本：v1.0 · 2026-08-31
> 状态：待评审
> 关联分支：`feature/contract-risk-ai`

## 1. 产品定位

在 Admin 后台的 **Agents** 模块中，为运营/开发者提供一套完整的 Agent 生命周期管理能力：

1. **零代码新建 Agent**，并为其配置三类能力（本地工具 / MCP 远程工具 / Skills）
2. **技能库**：沉淀可复用的行为守则（SKILL.md），支持 zip 包一键导入，供 Agent 按需挂载
3. **对话调试（Playground）**：直接发起对话，实时观察工具调用链与最终输出
4. **权限管理模块**：标准 RBAC，管理后台功能的访问权限（角色 → 权限点）

## 2. 用户故事

| # | 角色 | 故事 |
|---|------|------|
| US-1 | admin | 我想新建一个 Agent，只填 systemPrompt 和模型就能保存草稿，再给它勾选工具 / MCP 模块 / 技能 |
| US-2 | editor | 我想在"对话调试"里测试我刚改的 prompt，输入一句话看到它依次调用了哪些工具、每一步的结果，不用切到别的系统 |
| US-3 | admin | 我想把一个 MCP 技能包（zip）导入技能库，之后任何 Agent 都能挂载它 |
| US-4 | admin | 我想让一个同事只能看运行记录、不能改 Agent 定义，也不想让他发起调试对话消耗 token |
| US-5 | editor | 我想在 Playground 里多轮对话（同一会话继续追问），并查看每一轮的完整原始数据 |
| US-6 | admin | 我想配置角色权限：新建"运营"角色，勾选它能访问的菜单和按钮，再把这个角色分给用户 |

## 3. 功能规格

### 3.1 权限管理模块（RBAC）

**数据模型**

| 表 | 说明 |
|----|------|
| `permissions` | 权限点：`code`（PK，如 `agents:manage`）、`name`、`group`（菜单分组）、`type`（menu/action/api）、`sort` |
| `roles` | 角色：`code`（PK，如 `editor`）、`name`、`description`、`isSystem`（内置角色不可删） |
| `role_permissions` | 角色↔权限多对多：`roleCode` + `permissionCode` 联合主键 |
| `users.roles` | **保持不变**（JSON 数组），一期不做 `user_roles` 表 |

**功能**

- 权限点由代码声明（`packages/types` 的 `PERMISSIONS` 常量），启动 seed 进 DB；管理页**不能新建权限点**，只能勾选分配
- 角色 CRUD：新建/编辑/删除自定义角色；`admin`/`editor`/`viewer` 为内置角色（`isSystem=true`，不可删除）
- 角色权限配置：按 `group` 分组展示权限树，勾选保存到 `role_permissions`
- **`admin` 角色特判放行所有权限**，无需写入 `role_permissions`

**校验链路**

```
登录 → JWT{ sub, username, roles }
前端：GET /api/permissions/my → 返回权限码数组 → 路由守卫 + v-hasPerm 按钮控制
后端：@RequirePermission('agents:manage') → PermissionGuard → req.user.roles
      → 查 role_permissions（带 Redis 缓存）→ 命中放行 / 403
```

**新增权限点**

| code | name | group | type |
|------|------|-------|------|
| `agents:view` | Agents 对话（只读） | agents | menu |
| `agents:debug` | 对话调试 | agents | action |
| `agents:manage` | Agent 定义管理 | agents | action |
| `skills:view` | 技能库查看 | agents | menu |
| `skills:manage` | 技能库管理 | agents | action |
| `roles:view` | 查看角色权限 | settings | menu |
| `roles:manage` | 配置角色权限 | settings | action |

> 默认角色分配：viewer = `agents:view`+`skills:view`；editor = +`agents:debug`+`agents:manage`；admin = 全部。

### 3.2 技能库（Skills）

**Skill 模型**（对齐 SKILL.md 形态）

```ts
interface Skill {
  id: string;
  code: string;            // 唯一，如 web-system-finnews
  name: string;
  description: string;     // on-demand 时注入 system 的摘要（50~100 字）
  version: string;
  content: string;         // SKILL.md 正文（Markdown 行为守则）
  requiredTools: string[]; // 依赖的工具：本地工具名 或 'mcp:module/tool'
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

**功能**

- CRUD：新建 / 编辑 / 启用停用 / 删除
- **zip 包一键导入**：上传 zip → 解析目录下的 `SKILL.md`（frontmatter + 正文）→ 自动提取 `name/description/version` → 入库；`requiredTools` 从正文工具表解析（或手工补充）
- 挂载约束：Agent 配置页勾选 skill 时**自动勾选并置灰 `requiredTools`**，防止"守则要求但工具缺失"

### 3.3 Agent 能力配置（Capability 统一抽象）

```ts
type CapabilityType = 'tool' | 'mcp' | 'skill';

interface CapabilityRef {
  type: CapabilityType;
  ref: string;      // tool: 'contract-irr'；mcp: 'finnews/get_market_pulse'；skill: 'web-system-finnews'
  enabled: boolean;
  config?: Record<string, unknown>;  // mcp 可覆盖 timeout；skill 可设挂载模式（一期仅 on-demand）
}
```

- `AgentDefinition` 由 `tools: string[]` 升级为 `capabilities: CapabilityRef[]`（向后兼容：老数据 tools 迁移为 `type:'tool'` 的能力）
- 发布后运行时生效（沿用现有 30s 轮询机制）

### 3.4 对话调试（Playground）

- 入口：Agent 概览 / 定义管理 / 运行记录 均可进入
- 左侧：Agent 选择 + 输入框 + `conversationId`（多轮）+ 发送
- 右侧：SSE 实时时间线
  - `content_delta`：逐字渲染最终回答
  - `tool_call` / `tool_result`：折叠卡片（工具名、入参、结果）
  - `skill_load`：**标记模型何时加载了哪个技能**（核心可观测点）
  - `final` / `error`：高亮
- 运行结束后生成 run 记录，可一键跳转 `AgentRunDetail` 查看原始数据

### 3.5 on-demand 技能挂载（引擎行为）

- 运行时只注入**技能目录**（`code` + `description`，每条约 50 token）
- 内置工具 `load_skill`（固定命名）：模型判断需要时调用，传入 skill code，返回该 skill 的完整正文作为 tool_result
- 同一 run 内已加载的 skill 重复调用时返回"已加载"提示（`Set<string>` 去重）

## 4. 验收标准（EARS）

### 权限模块

- **When** 任意用户访问 admin，**系统应**在登录后拉取 `/permissions/my` 并据此控制菜单与按钮
- **While** 用户角色为 viewer，**when** 调用 `POST /admin/agent-defs`，**系统应**返回 403
- **While** 用户角色为 admin，**when** 调用任意带权限注解的接口，**系统应**直接放行
- **When** 管理员在角色配置页勾选权限并保存，**系统应**写入 `role_permissions` 并在 60s 内生效（缓存 TTL）
- **When** 尝试删除 `isSystem=true` 的角色，**系统应**拒绝

### 技能库

- **When** 管理员上传 zip 技能包，**系统应**解析出 `SKILL.md` 并入库，返回技能 `code`
- **When** 解析失败或包内无 `SKILL.md`，**系统应**返回明确错误且不产生脏数据
- **While** 技能被任一已发布 Agent 引用，**when** 尝试删除，**系统应**拒绝并提示引用方

### Agent 能力配置

- **When** 编辑 Agent 时勾选 MCP 工具，**系统应**从 mcp-gateway 拉取可用模块/工具列表供选择
- **When** 勾选技能，**系统应**自动勾选并置灰其 `requiredTools`
- **When** 发布 Agent，**系统应**保留历史版本快照（含 capabilities）

### Playground

- **When** 用户在 Playground 发送消息，**系统应**通过 SSE 流式返回步骤事件并在时间线渲染
- **When** 模型调用 `load_skill`，**系统应**在时间线显示 `skill_load` 事件及加载的技能名
- **When** 用户传入 `conversationId`，**系统应**基于该会话历史继续对话
- **When** 运行结束，**系统应**落库 run 记录并支持跳转原始数据详情

## 5. 非功能需求

| 项 | 要求 |
|----|------|
| 安全 | 所有写操作走后端权限校验；Skill 正文是生产 prompt 资产，仅 `skills:manage` 可改 |
| 成本 | Playground 发起对话需 `agents:debug`；无该权限的登录用户不可调用 `agent/run` |
| 性能 | 权限查询带 Redis 缓存（TTL 60s）；技能目录注入 ≤ 5 条/Agent |
| 兼容 | 存量 `agent_definitions.tools` 数据迁移为 `capabilities` 的 `tool` 类型 |
| 交付 | admin 为微前端子模块，改完必须走「构建→拷贝→更新版本表→验证」四步 |
