# 数据浏览器 · 实施清单

> 配套：`requirements.md`（验收标准）· `design.md`（技术方案）
> 顺序即执行顺序，任务 3 是硬前置，不可跳过

---

## 任务 3 · system-service 补齐鉴权 + 角色权限（P0，安全前置）

- [ ] 3.1 复制 `todo-service/src/auth/auth.guard.ts` → `system-service/src/auth/auth.guard.ts`
- [ ] 3.2 新增 `system-service/src/auth/permissions.guard.ts`（读 `request.user.roles` → `ROLE_PERMISSIONS` → 校验权限码）
- [ ] 3.3 新增 `system-service/src/auth/public.decorator.ts`（`@Public()` 豁免）
- [ ] 3.4 新增 `system-service/src/auth/permission.decorator.ts`（`@RequirePermission('xxx:view')`）
- [ ] 3.5 `main.ts` / `app.module.ts` 注册 `APP_GUARD`
- [ ] 3.6 `packages/types/src/index.ts`：`Role` 加 `'super_admin'`；`PermissionGroup` 加 `'database'`；`PERMISSIONS` 加 `database:view` / `database:query`；`ROLE_PERMISSIONS` 补 `super_admin` 并从 `admin` 中剔除 `database:query`
- [ ] 3.7 给既有三个模块补权限码：`settings:view`/`settings:edit`、`logs:view`、`bianbian:view`/`bianbian:manage`；`GET /admin/settings/public/:key` 标 `@Public()`
- [ ] 3.8 重新 build `packages/types`（各端共享）
- [ ] 3.9 回归验证：admin 前端的「系统设置 / 操作日志 / 变变管理」页面无 401/403
- [ ] 3.10 提供 `scripts/db/grant-super-admin.mjs`（按 username 升级为 super_admin）

**验收**：AC-1 ~ AC-5

---

## 任务 4 · 后端 db-explorer（方案 B）

- [ ] 4.1 创建只读 MySQL 账号（docker 或 node 脚本执行 `GRANT SELECT ON web_system.*`）
- [ ] 4.2 `system-service/.env` 写入 `DB_READONLY_USER` / `DB_READONLY_PASSWORD`；未配置时启动打 warn
- [ ] 4.3 `app.module.ts` 追加名为 `'readonly'` 的第二个 TypeORM 连接（`entities: []`、`synchronize: false`）
- [ ] 4.4 新建 `database-explorer.module.ts` / `.controller.ts` / `.service.ts`
- [ ] 4.5 `GET /admin/db/tables`：查 `information_schema.tables`，排除 `migrations`/`typeorm_metadata`，按角色过滤敏感表
- [ ] 4.6 `GET /admin/db/tables/:name/schema`：查 `information_schema.columns` + `statistics`，标注每列 `sensitive` 级别
- [ ] 4.7 `GET /admin/db/tables/:name/rows`：表名白名单校验 + 参数化排序 + 强制分页（pageSize ≤ 200）+ 脱敏
- [ ] 4.8 脱敏工具函数（`hidden` → `***`；`masked` → 打码）
- [ ] 4.9 单元测试：表名白名单、脱敏规则、分页上限

**验收**：AC-6 ~ AC-20、AC-28 ~ AC-30

---

## 任务 5 · SQL 控制台（方案 A）

- [ ] 5.1 新增 `utils/sql-guard.ts`（`assertReadOnlySql` 纯函数）
- [ ] 5.2 `POST /admin/db/query`：权限码 `database:query` + SQL 校验 + 强制 `LIMIT 200` + 走只读连接
- [ ] 5.3 查询超时保护（30s，防慢查询拖垮服务）
- [ ] 5.4 审计写入 `operation_logs`（type=`database_query`，含 SQL 原文 / 行数 / 耗时）
- [ ] 5.5 `POST /admin/db/reveal`（二期）：明文查看单个脱敏字段，仅 `database:query` + 审计
- [ ] 5.6 单元测试：各类非法 SQL 均被拒（AC-21 全量关键词用例）

**验收**：AC-21 ~ AC-27

---

## 任务 6 · 前端数据浏览器页面

- [ ] 6.1 新增 `apps/admin/src/api/database.ts`（4 个接口 + 类型定义）
- [ ] 6.2 新增 `apps/admin/src/views/Database/DataBrowser.vue`
  - [ ] 6.2.1 页头（h1 + caption + 右上「刷新」）
  - [ ] 6.2.2 `a-tabs` 两个 Tab，SQL Tab 用 `v-if hasPermission('database:query')`
  - [ ] 6.2.3 左栏：搜索框 + 表列表（行数 tabular-nums，敏感表标注）
  - [ ] 6.2.4 右栏 `a-tabs`（`size="small"`，卡片级）：标签「数据 (行数)」「表结构 (字段数)」，默认选中「数据」
  - [ ] 6.2.5 数据 Tab：动态列表格 + 分页 + NULL 弱化 + 长文本截断
  - [ ] 6.2.6 表结构 Tab：字段表格（字段/类型/可空/默认值/键/注释 + 敏感标注）+ 索引表
  - [ ] 6.2.7 切表时保持当前选中的右栏 Tab，仅刷新内容
  - [ ] 6.2.8 `a-drawer` 单元格全文（mono + 可复制）
  - [ ] 6.2.9 SQL Tab：alert 说明 + textarea + 执行按钮（防重复锁）+ 结果表格
- [ ] 6.3 状态矩阵全覆盖（loading / 空态 / 失败重试）
- [ ] 6.4 样式只引 `--ws-*`，`.ws-hairline` / `.ws-mono`，**零新增 `!important`**
- [ ] 6.5 light / dark 双主题自查

**验收**：AC-13 ~ AC-26、AC-31

---

## 任务 7 · 接入与发布验证

- [ ] 7.1 `router/index.ts` 追加 `/database` 路由 + `meta.permission: 'database:view'`
- [ ] 7.2 `BasicLayout.vue`：菜单项（`DatabaseOutlined`）+ `currentTitle` + `selectedKeys` watch + `handleMenuClick` 四处同步
- [ ] 7.3 `RoleManagement.vue`：角色下拉补 `super_admin` 选项
- [ ] 7.4 后端构建部署（deploy-console 流水线，env=local）
- [ ] 7.5 前端微前端四步：构建 → 拷贝到 `servers/gateway/public/static/modules/admin/<hash>/` → 更新 `web_system_deploy.deploy_deployments.current_version` → 等 12s 后 `curl localhost:6000/__manifest__` 验证
- [ ] 7.6 三角色（editor / admin / super_admin）端到端走查，截图存档 `docs/ui/baselines/admin-database-browser-{light,dark}.png`
- [ ] 7.7 按 `docs/ui/design.md §5` 自检，修正记录追加 `docs/ui/geist-token-评审记录.md`

**验收**：AC-1 ~ AC-31 全量

---

## 风险登记

| 风险 | 应对 |
|---|---|
| 全局 Guard 引起既有页面 403 回归（RISK-2） | 任务 3.9 专项回归；出问题先给对应接口补权限码或临时 `@Public()` 并记录 |
| `admin` 角色失去 `database:query` 后，存量管理员无法用 SQL 控制台 | 这是预期行为；确需使用者由超管执行 `grant-super-admin.mjs` 升级 |
| 只读账号创建失败（mysql CLI 缺失，RISK-3） | 走 docker exec 或 node `mysql2` 脚本；仍失败则服务降级用主账号 + 启动 warn |
| 大表查询慢 | `rows` 接口强制走主键排序分页；只读连接 `acquireTimeout` 与查询超时设 30s |
| 第二个 TypeORM 连接启动失败拖垮服务 | readonly 连接失败时捕获并记录，接口返回 503 而非崩溃 |
