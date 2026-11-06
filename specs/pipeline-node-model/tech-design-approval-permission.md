# 设计 · 审批人权限（`deploy:pipeline:approve`）

> 状态：**B1 已实现并本机验证**（2026-09-14）；B2 未做
> 方案选择：B —— 接权限体系（`packages/types` 权限码 → user-service → 控制台联动）
>
> **变更日志**
> - 2026-09-14 B1 落地：`deploy` 分组 + `deploy:pipeline:approve` 权限码；
>   user-service 新增 `POST /internal/users/by-permissions`；deploy-console 新增 `ApproverService`
>   （60s 缓存 + 降级放行）与 `GET /api/pipelines/meta/approvers`，approve/reject 校验操作人。
>   初始化：权限点入库并授予 `admin` / `super_admin`。
>   验证：`/internal/users/by-permissions` 与 `/api/pipelines/meta/approvers` 均返回
>   `[{"username":"admin","roles":["admin"]}]`，`degraded=false`。

---

## 1. 目标

审批人**不再是手填的用户名**，而是「在 admin 系统里拥有 `deploy:pipeline:approve` 权限的用户」：

- 配置流水线时，审批人从系统用户里**联动选出来**；
- 点审批时校验操作人确有该权限；
- 权限点由代码声明、随发布自动 seed，和 admin 系统共用一套权限真相源。

---

## 2. 现状（调研结论）

| 项 | 现状 |
|---|---|
| 权限码定义 | `packages/types/src/index.ts`：`PermissionGroup`(无 `deploy`) / `PermissionDef` / `PERMISSIONS` / `ROLE_PERMISSIONS`（`super_admin`/`admin` 自动全量，`editor`/`viewer` 手写） |
| 权限点表 | user-service `permissions`（`code` PK），启动时 `seed()` upsert，另有 `POST /internal/permissions/sync` 供发布后同步 |
| 角色 | `roles` 表 + `role_permissions`（`roleCode`+`permissionCode`）；**无 user_roles 表**，用户角色在 `users.roles` JSON 列 |
| 按权限码查用户 | **不存在**（internal 只有 `/internal/roles/permissions`、`/internal/permissions/sync`、`/internal/keys/verify`） |
| 内部鉴权 | `x-internal-key` 比对 `INTERNAL_API_KEY`（`api-key/internal.guard.ts`） |
| deploy-console | **无用户表**，登录是 `.env` 的单一管理员；已有调 user-service 的先例（`syncPermissionPoints`、`/internal/keys/verify`） |
| admin 前端 | `userStore.hasPermission(code)`、菜单/路由/按钮三级过滤；「角色管理」页可全量覆盖赋权 |

---

## 3. 改动清单（文件 × 改动 × 风险）

| # | 文件 | 改动 | 风险 / 说明 |
|---|---|---|---|
| 1 | `packages/types/src/index.ts` | `PermissionGroup` 加 `'deploy'`；`PERMISSIONS` 加 `deploy:pipeline:approve`（名称「流水线审批」）；`editor`/`viewer` **不给** | 低。`super_admin`/`admin` 自动继承全量 |
| 2 | `servers/user-service/.../permission/internal.controller.ts` | 新增 `POST /internal/users/by-permissions { codes[] }` → 返回 `[{id, username, nickname, roles}]` | 中。新接口；实现=先查 `role_permissions` 得角色集合，再 `JSON_CONTAINS(u.roles,'"<role>"')` 过滤 |
| 3 | `servers/deploy-console`（新增 `approval/approver.service.ts`） | 拉可审批人（60s 缓存），失败降级为**不校验 + 告警**（不能因权限服务挂了就批不了） | 中。需 `USER_SERVICE_URL` + `INTERNAL_API_KEY`（已配置项） |
| 4 | `servers/deploy-console/pipeline/pipeline.controller.ts` | 新增 `GET /pipelines/approvers`（前端下拉数据源） | 低 |
| 5 | `servers/deploy-console/pipeline/pipeline.service.ts` | `approve/reject` 校验 `reviewer` 在可审批人内（列表取不到时放行并记日志） | 中。校验失败要清晰报错，不能变成"审批按钮点了没反应" |
| 6 | `apps/deploy-console` 模板配置 / 审批弹窗 | 审批人改为**下拉联动**（拉第 4 项接口），不再手填 | 中。属 P3 前端范围 |
| 7 | 初始化数据 | 发布后 `PIPELINE_PERM_SYNC` 自动 seed；`admin`/`super_admin` 自动持有 | 低 |

---

## 4. 接口契约

```ts
// user-service（内部）
POST /internal/users/by-permissions
Headers: { 'x-internal-key': INTERNAL_API_KEY }
Body:    { codes: string[] }                 // 需全部满足（AND）
Resp:    { users: Array<{ id: string; username: string; nickname?: string; roles: string[] }> }

// deploy-console（控制台）
GET  /api/pipelines/approvers
Resp: { users: [...], degraded: boolean }    // degraded=true 表示权限服务不可用，前端提示"未校验"
```

---

## 5. 待确认（阻塞设计，需你定）

**deploy-console 的登录账号 ≠ admin 系统的用户**（前者是 `.env` 单一管理员，后者在 user-service）。两种绑定强度：

| 方案 | 含义 | 代价 |
|---|---|---|
| **B1 弱绑定（建议先做）** | 只按**用户名字符串**匹配：console 登录名必须能在 user-service 里找到同名用户且该用户有此权限；找不到同名用户时**放行 + 告警** | 小，可先落地 |
| **B2 强绑定** | console 改成走 user-service 认证（JWT 统一），审批人就是登录态用户 | 大：改 console 登录体系 + 前端登录页 |

建议：**先 B1**，把权限码与联动打通；B2 作为后续独立议题。
（2026-09-14：已按 B1 实现 —— console 登录名 `admin` 与 user-service 的 `admin` 用户同名，
校验即可命中。）

**尚未做的部分**

- 前端「审批人下拉联动」：目前流水线节点还没有配置界面（P3 画布），接口 `GET /api/pipelines/meta/approvers` 已就绪，画布落地时直接接上；`ApprovalNode.approvers` 仍按白名单取交集。
- B2（console 改走 user-service 认证）未做。

---

## 变更日志

- 2026-09-14 首版：方案 B 影响清单（权限码 / user-service 新接口 / console 校验与下拉 / 初始化），待确认 B1/B2。
