# 提案 · 权限码同步机制（方案 B 已实现）

> 状态：**方案 B 已实现**（2026-09-10 用户选定）｜落地点：
> `POST /admin/permissions/sync`（roles:manage，页面按钮）、
> `POST /internal/permissions/sync`（x-internal-key，供脚本/流水线）、
> `scripts/sync-permissions.sh`、admin「角色权限」页同步按钮（同步后立即刷新自身权限，菜单当场出现）。
> **均已落地（2026-09-11）**：审计日志（写 `operation_logs`，类型 `sync_permission`；
> 由 system-service `POST /internal/logs` 统一汇聚）、发布流水线收尾自动同步
> （`PIPELINE_PERM_SYNC`，失败只告警不阻断发布）、角色权限页差异只读提示
> （`GET /admin/permissions/diff`）。
> 起因：字典模块上线后，admin 侧边栏看不到「字典管理」入口。排查结论——**不是前端产物问题**，
> 而是新权限码只进了代码常量（后端鉴权用），没进 DB（前端菜单用）。

---

## 1. 问题（现状事实）

权限体系是"双读"的：

| 读取方 | 数据来源 | 新增权限码何时生效 |
|---|---|---|
| 各后端服务 `PermissionsGuard` | `@web-system/types` 的 `ROLE_PERMISSIONS` **常量** | 构建 + 重启该服务即生效 |
| 前端菜单 / 路由守卫 | `GET /api/permissions/my` → user-service **DB**（`permissions` / `role_permissions` 表） | **只有 user-service 重启执行 seed 才生效** |

`PermissionService.seed()`（`onModuleInit`）会把 `PERMISSIONS` upsert 进 `permissions` 表，
并把内置角色权限**按 `ROLE_PERMISSIONS` 全量覆盖**到 `role_permissions`。

于是形成一个易踩的组合坑：

> 加了新权限码 → 后端接口调得通（常量已生效）→ **前端菜单就是不出现**（DB 未更新）
> → 以为"前端没发版"，实际是 **user-service 没重启**。

2026-09-10 实际踩到：字典模块加 `system:dict:view` / `system:dict:manage`，重启了 gateway/system/ai-agent，漏了 web-user。

---

## 2. 目标

- 新增权限码后，**不依赖"记得重启某个服务"**也能让前后端一致；
- 保留 DB 角色权限可编辑的价值（`/admin/settings/roles` 能改自定义角色）；
- 不引入"代码常量 vs DB"的第二真相源风险。

---

## 3. 方案对比

### 方案 A：文档兜底（最小改动）
在发布流程/手册里写死："改 `packages/types` 权限码 → 必须重启 `web-user`"。
- ✅ 零代码；❌ 靠人记住（今天已经漏过一次）；❌ 换人/换环境必再踩。

### 方案 B：seed 触发接口（推荐）
新增 `POST /admin/permissions/sync`（`roles:manage`），调用 `seed()`；
再在发布脚本 / deploy-console 流水线的 restart 阶段后自动调用一次。
- ✅ 保留"代码声明为准"语义；✅ 可 CI 化；✅ 不改读取路径（无真相源风险）；❌ 多一个接口。

### 方案 C：读取时合并常量
`getMyPermissions` / `getPermissionsForRoles` 返回 `DB 权限 ∪ ROLE_PERMISSIONS[role]`。
- ✅ 永不脱节；❌ **DB 角色编辑形同虚设**（内置角色改不动了）；❌ 自定义角色语义变复杂。

### 方案 D：启动时只增不减 + 定时 seed
保留启动 seed，另加 5 分钟定时 seed（幂等）。
- ✅ 无需人操作；❌ 每秒/每分都在写库（无谓 IO）；❌ 覆盖语义在定时场景更难解释。

**推荐 B + A**：接口给自动化用，文档给人工兜底；C 只作为"最后一道容忍"（本期不做）。

---

## 4. 方案 B 落地要点（评审通过后实施）

| 项 | 内容 |
|---|---|
| 接口 | `POST /admin/permissions/sync`，权限 `roles:manage`；返回 `{ permissionsAdded, rolesUpdated }` |
| 幂等 | 复用现有 `seed()`，天然幂等 |
| 审计 | 调 `operation-log` 记一条 `update_setting`（或新增 `sync_permission` 类型，字典 `operation_log_type` 可加） |
| 前端 | `/admin/settings/roles` 加「同步权限点」按钮（`Modal.confirm` 写明"以代码声明为准，覆盖内置角色权限"） |
| 自动化 | deploy-console 流水线 restart 阶段后追加一次调用（或写入 `scripts/publish-*.sh`） |
| 验收 | 改一个权限码 → 只跑发布 → 前端菜单出现，无需手工重启 user-service |

## 5. 待确认

1. 是否按 **B + A** 走？还是先只上 A（文档）够用？
2. 同步操作是否记审计日志？记的话用 `operation_log_type` 现有值还是新增 `sync_permission`？
3. 是否要顺带把「角色权限页展示代码声明与 DB 的差异」做成只读提示（影响面更直观，成本更高）？
