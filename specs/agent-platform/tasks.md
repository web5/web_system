# Agent 平台实施清单与排期（tasks.md）

> 排期规则：权限模块先行（用户确认），每阶段完成即走四步部署验证。

## 依赖图

```
阶段一 权限模块
  T1 权限三表+seed ──→ T2 权限 API+Guard ──→ T3 权限页面 ──→ T4 存量接口注解+前端接入
阶段二 Skill 库 + 引擎
  T5 技能表+CRUD+zip导入 ──→ T6 agent-core on-demand 引擎 ──→ T7 ai-agent 接线
阶段三 Capability 化（依赖 T5，可并行 T6）
  T8 AgentDefinition capabilities 化 ──→ T9 Admin 配置器+SkillList 页
阶段四 Playground（依赖 T6/T8）
  T10 AgentPlayground 对话调试页
阶段五 收尾
  T11 四步部署验证 + 文档更新
```

## 任务清单

### 阶段一：权限管理模块（先行）

| # | 任务 | 交付物 | 验收 |
|---|------|--------|------|
| T1 | 权限数据模型 | user-service 新增 `permissions`/`roles`/`role_permissions` entity + 启动 seed（从 `@web-system/types` PERMISSIONS 常量） | 建表成功；seed 后 11+7 个权限点、3 个内置角色入库 |
| T2 | 权限后端 API + Guard | ① `/admin/permissions`、`/admin/roles` CRUD（user-service）② `POST /internal/roles/permissions`（Redis 缓存 60s）③ `packages/shared/src/auth/permission.guard.ts`（`@RequirePermission` 装饰器 + PermissionGuard，admin 特判） | curl 验证：viewer 角色调无权限接口 403；admin 放行；缓存命中 |
| T3 | Admin 权限页面 | `views/Settings/RoleManagement.vue`（角色列表 + 权限分组勾选树）+ UserList 角色编辑列 + 路由/菜单 | 建角色→勾权限→保存→重新登录后菜单/按钮按权限显隐 |
| T4 | 存量接口权限注解 + 前端接入 | ① ai-service `admin/agent-defs`、`agent-runs`、ai-agent `agent/run` 加 `@RequirePermission` ② admin 登录拉 `/permissions/my` ③ `v-has-perm` 指令 + 菜单接入 | viewer 直接 curl `POST /admin/agent-defs` 返回 403 |

### 阶段二：Skill 库 + on-demand 引擎

| # | 任务 | 交付物 | 验收 |
|---|------|--------|------|
| T5 | 技能库后端 | ai-service `agent_skills` entity + CRUD + zip 导入（multer 上传→解压→解析 frontmatter→入库）+ 被引用校验 | 上传 `mcp-skills/paper.zip` 导入成功；重复 code 拒绝；被引用删除拒绝 |
| T6 | agent-core on-demand 引擎 | `SkillLoader` + `load_skill` 内置工具 + 技能目录注入 + `skill_load` 事件 + 去重 | 单测：挂 2 技能 → 模型调 `load_skill` → 事件流含 `skill_load` + 正文 tool_result |
| T7 | ai-agent 接线 | 从 ai-service 拉已发布 Agent 的 skills → 注册 SkillLoader；MCP 工具按 capabilities 懒加载注册 | 启动日志显示技能目录注册；`agent/run` 带 `skillCodes` 可加载技能 |

### 阶段三：Capability 统一抽象

| # | 任务 | 交付物 | 验收 |
|---|------|--------|------|
| T8 | AgentDefinition capabilities 化 | `packages/agent-core` 接口 + ai-service entity/DTO/service（`capabilities` 字段 + tools 迁移 + 发布快照） | 存量 3 Agent 迁移后行为不变；发布含 capabilities |
| T9 | Admin 配置器 + SkillList | `CapabilityConfigurator.vue`（三 Tab）+ `SkillList.vue` + `SkillImportModal.vue` + 路由/菜单 | 勾 skill 自动带出 requiredTools 置灰；zip 导入预览 |

### 阶段四：对话调试

| # | 任务 | 交付物 | 验收 |
|---|------|--------|------|
| T10 | AgentPlayground | `AgentPlayground.vue` + `PlaygroundTimeline.vue`（SSE + 多轮 conversationId + 跳转 Run 详情） | 多轮对话成功；时间线含 tool_call/tool_result/skill_load；结束后可跳转详情 |

### 阶段五：收尾

| # | 任务 | 交付物 | 验收 |
|---|------|--------|------|
| T11 | 四步部署验证 | admin/ai-service/user-service/ai-agent 构建 + 拷贝 + 更新 `web_system_deploy.deploy_deployments` + curl 验证 | `__manifest__` 版本更新；Playground 全流程可用 |

## 里程碑

| 里程碑 | 内容 | 预估 |
|--------|------|------|
| M1 | 权限模块可用（T1-T4） | 权限先行交付 |
| M2 | 技能库 + on-demand 引擎（T5-T7） | 核心能力 |
| M3 | Capability 配置 + Playground（T8-T10） | 产品闭环 |
| M4 | 部署验证 + 文档（T11） | 上线 |

> ⚠️ 每个阶段结束都要跑「构建→拷贝→更新版本表→验证」四步，避免积压导致验证困难。
