# Agent 平台技术设计（design.md）

> 版本：v1.0 · 2026-08-31

## 1. 架构总览

```
┌──────────────────── Admin (Vue3) ────────────────────┐
│ Agents/{Overview,Runs,RunDetail,DefList,SkillList,   │
│         Playground}   Settings/Roles                 │
└──────────────────────┬───────────────────────────────┘
                       │ /api/*（gateway 代理）
┌──────────────────────▼───────────────────────────────┐
│ gateway (6000)  __manifest__ + 代理 + AuthGuard(JWT) │
└──────┬──────────┬──────────┬──────────┬──────────────┘
       │          │          │          │
┌──────▼───┐ ┌────▼─────┐ ┌──▼──────┐ ┌─▼──────────────┐
│user-service│ │ai-service│ │ ai-agent │ │ mcp-gateway    │
│ 6002      │ │ 6003     │ │ 6010     │ │ 6006           │
│ RBAC 三表 │ │ agent-def│ │ SkillLoader│ │ mcp_modules    │
│ /permissions│ │ skill   │ │ MCP 注册  │ │ mcp_tools      │
│ /internal/rp│ │ agent-runs│ │         │ │                │
└───────────┘ └──────────┘ └──────────┘ └────────────────┘
        │               ▲              ▲
        └─ PermissionGuard 通过内部 HTTP 查询（Redis 缓存 60s）
```

**权限数据归属 user-service**（用户资产），其余服务通过 `INTERNAL_API_KEY` 调用其内部接口获取角色权限映射。

## 2. 数据模型（DDL）

### 2.1 权限三表（user-service 库）

```sql
CREATE TABLE permissions (
  code      VARCHAR(64) PRIMARY KEY COMMENT '权限点 code，如 agents:manage',
  name      VARCHAR(64)  NOT NULL COMMENT '权限名',
  grp       VARCHAR(32)  NOT NULL COMMENT '分组：dashboard/users/settings/logs/mcp/agents',
  type      VARCHAR(16)  NOT NULL DEFAULT 'action' COMMENT 'menu/action/api',
  sort      INT          NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) COMMENT '权限点定义（代码声明，seed 写入）';

CREATE TABLE roles (
  code        VARCHAR(64) PRIMARY KEY COMMENT '角色 code，如 admin/editor/viewer',
  name        VARCHAR(64) NOT NULL COMMENT '角色名',
  description VARCHAR(255) NULL,
  is_system   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '内置角色不可删',
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) COMMENT '角色';

CREATE TABLE role_permissions (
  role_code       VARCHAR(64) NOT NULL,
  permission_code VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_code, permission_code)
) COMMENT '角色-权限关联';
```

### 2.2 技能表（ai-service 库）

```sql
CREATE TABLE agent_skills (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  code          VARCHAR(64)  NOT NULL UNIQUE COMMENT '技能唯一标识，如 web-system-finnews',
  name          VARCHAR(128) NOT NULL COMMENT '技能名',
  description   VARCHAR(512) NOT NULL COMMENT 'on-demand 摘要，注入 system',
  version       VARCHAR(32)  NOT NULL DEFAULT '1.0.0',
  content       MEDIUMTEXT   NOT NULL COMMENT 'SKILL.md 正文',
  required_tools JSON        NULL COMMENT '依赖工具名数组（含 mcp:module/tool）',
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  created_by    VARCHAR(64)  NULL,
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) COMMENT 'Agent 技能库（SKILL.md）';
```

### 2.3 Agent 定义改造（ai-service 库，`agent_definitions`）

```sql
ALTER TABLE agent_definitions
  ADD COLUMN capabilities JSON NULL COMMENT '能力数组[{type:tool|mcp|skill, ref, enabled, config}]' AFTER tools,
  ADD COLUMN skills JSON NULL COMMENT '冗余：技能 code 数组，便于反查';
-- 存量迁移：capabilities = tools.map(t => ({type:'tool', ref:t, enabled:true}))
-- tools 字段保留用于兼容，不再作为主配置源
```

## 3. 后端 API 契约

### 3.1 权限（user-service）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/admin/permissions` | `roles:manage` | 权限点全量（按 group 分组） |
| GET | `/admin/roles` | `roles:view` | 角色列表（含每个角色的权限码） |
| POST | `/admin/roles` | `roles:manage` | 新建角色 |
| PUT | `/admin/roles/:code` | `roles:manage` | 更新角色（含权限分配，全量覆盖） |
| DELETE | `/admin/roles/:code` | `roles:manage` | 删除角色（`is_system` 拒绝） |
| GET | `/permissions/my` | 登录 | 当前用户权限码数组（含 admin 特判） |
| POST | `/internal/roles/permissions` | INTERNAL_API_KEY | 入参 `{roles:[]}` → 返回权限码集合；Redis 缓存 60s |

### 3.2 技能（ai-service）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/admin/skills` | `skills:view` | 技能列表 |
| GET | `/admin/skills/:code` | `skills:view` | 技能详情（含正文） |
| POST | `/admin/skills` | `skills:manage` | 新建 |
| PUT | `/admin/skills/:code` | `skills:manage` | 编辑（全量覆盖） |
| DELETE | `/admin/skills/:code` | `skills:manage` | 删除（被引用时拒绝） |
| POST | `/admin/skills/import` | `skills:manage` | **zip 导入**（multipart）：解压→找 SKILL.md→frontmatter+正文→入库 |
| GET | `/admin/skills/:code/deps` | `skills:view` | 该技能被哪些 Agent 引用（删除前校验用） |

### 3.3 Agent 定义（ai-service，改造）

| 方法 | 路径 | 变化 |
|------|------|------|
| POST/PUT | `/admin/agent-defs` | DTO 增加 `capabilities`（替代 tools 为可选兼容） |
| POST | `/admin/agent-defs/:id/publish` | 快照含 capabilities |
| GET | `/admin/mcp-modules` | 【新】从 mcp-gateway 拉取模块+工具（供配置器选择） |

### 3.4 运行（ai-agent）

| 方法 | 路径 | 变化 |
|------|------|------|
| POST | `/agent/run` | SSE 事件新增 `skill_load`；body 增加 `skillCodes?: string[]`（声明可挂载技能） |

## 4. agent-core 引擎改造点

| 文件 | 改动 |
|------|------|
| `interfaces/agent.interface.ts` | `AgentDefinition` 增加 `capabilities?: CapabilityRef[]`；导出 `Skill`、`CapabilityRef` 类型 |
| `interfaces/runtime.interface.ts` | `StreamEvent` 增加 `{ type:'skill_load', name, content, step }` |
| `core/agent-engine.ts` | ① 技能目录注入 system；② `load_skill` 内置工具（不进 ToolRegistry，`LOAD_SKILL` 常量名）；③ `Set` 去重；④ tool 循环分支处理 `load_skill` |
| `skills/skill-loader.ts` | 【新】`SkillLoader`：持有 agent 技能表，提供 `list()`（目录）与 `load(code)`（正文） |

**关键约束**：`load_skill` 不注册进全局 `ToolRegistry`（全局单例会跨 Agent 冲突），由引擎闭包按当前 agent 的 skills 处理；其 schema 仅在 `agent.capabilities` 含 skill 时追加。

## 5. Admin 组件树

```
views/Agents/
  AgentOverview.vue        现状
  AgentRuns.vue            现状
  AgentRunDetail.vue       现状
  AgentDefList.vue         改造：编辑弹窗加三 Tab（本地工具 / MCP / Skills）
    └─ CapabilityConfigurator.vue  【新】三 Tab 配置器
  SkillList.vue            【新】技能库（表格 + 编辑弹窗 + zip 导入）
    └─ SkillImportModal.vue       【新】zip 上传 + 解析预览
  AgentPlayground.vue      【新】对话调试
    └─ PlaygroundTimeline.vue    【新】SSE 时间线
views/Settings/
  RoleManagement.vue       【新】角色权限配置
  (UserList.vue 增加角色列)        改造
directives/
  v-has-perm.ts            【新】按钮级权限指令
```

## 6. 权限校验链路（全链路）

```
① 登录 → auth-service 签发 JWT{ sub, username, roles }
② admin 启动/刷新 → GET /api/permissions/my → 存 userStore.permissions
③ 路由守卫：meta.permission ∈ permissions，否则 /403
④ 按钮：v-has-perm="'agents:manage'"
⑤ 后端：@UseGuards(AuthGuard) + @RequirePermission('agents:manage')
      → PermissionGuard：
        admin 角色 → 放行
        否则 → POST user-service /internal/roles/permissions{roles}
               （Redis 缓存 key: rbac:perms:{roles.join(',')}，TTL 60s）
        命中 → 放行；未命中 → 403 ForbiddenException
```

**PermissionGuard 实现位置**：`packages/shared/src/auth/`（前端不 import 后端包；后端各服务通过 workspace 依赖引用）。

## 7. 兼容与迁移

| 项 | 处理 |
|----|------|
| `agent_definitions.tools` | 保留列；seed/迁移脚本把存量行 tools → capabilities（type:'tool'）；后续 tools 列为兼容只读 |
| `ROLE_PERMISSIONS` 常量 | 降级为 seed 数据源；`packages/types` 保留（前端仍用它 fallback），后端权限以 DB 为准 |
| `users.roles` | 不变，仍是 JWT 与校验的输入 |
| 老 run 记录 | 不迁移，直接展示 |
| 内置 3 个 Agent | seed 时写入 capabilities |
