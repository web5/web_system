# 数据浏览器 · 技术设计方案

> 版本：v1.0 ｜ 日期：2026-09-04 ｜ 配套：`requirements.md`
> 事实源：UI 数值以 `packages/ui/src/tokens.ts` 为准；判断条目以 `docs/ui/design.md` 为准

---

## 0. 现状结论（已核实）

| 项 | 结论 | 影响 |
|---|---|---|
| 数据库 | 所有业务服务共享单库 `web_system`（MySQL 127.0.0.1:3306） | 只需连一个库即可看全业务表 |
| 后端落点 | `system-service`（6004）已连该库 | 新模块放这里 |
| 网关 | 已有通配代理 `/api/admin/:path(*)` → system-service | **无需改 gateway** |
| 鉴权 | system-service **零 Guard**；gateway `proxy.controller.ts` 标 `@Public()` | 必须先补鉴权，否则整库裸奔 |
| 角色体系 | `Role = 'admin' \| 'editor' \| 'viewer'`，**无 super_admin** | 需新增角色 |
| 权限码 | `packages/types/src/index.ts` 的 `PERMISSIONS` / `ROLE_PERMISSIONS` | 需追加 `database:view` / `database:query` |
| 前端 | Vue3 + antdv，静态路由 + `meta.permission`；菜单硬编码在 `BasicLayout.vue` | 3 处接入点 |
| mysql CLI | 本地未安装 | 建只读账号走 docker / node 脚本 |

---

## 1. 整体架构

```
浏览器 (admin 微前端 /admin/database)
   │  request.ts 自动带 Bearer token，baseURL=/api
   ▼
gateway:6000  ── 通配 /api/admin/:path(*) ──►  system-service:6004
   (已有，不改)                                      │
                                                     ├─ AuthGuard（新增，调 auth-service /auth/verify）
                                                     ├─ PermissionsGuard（新增，校验权限码）
                                                     └─ DatabaseExplorerModule（新增）
                                                            │
                                                            ├─ 只读连接 'readonly' ──► MySQL web_system
                                                            └─ 审计写入 operation_logs
```

**设计要点**：db-explorer 用**独立的只读 TypeORM 连接**（named connection `'readonly'`），与主连接隔离。即便应用层校验被绕过，DB 账号本身无写权限。

---

## 2. 后端设计

### 2.1 鉴权补齐（前置任务）

**新增文件**
```
servers/system-service/src/auth/auth.guard.ts        # 复制 todo-service 模式
servers/system-service/src/auth/permissions.guard.ts # 新增：权限码校验
servers/system-service/src/auth/public.decorator.ts  # @Public() 豁免装饰器
```

**`PermissionsGuard` 逻辑**
```ts
const required = this.reflector.get<string>('permission', context.getHandler());
if (!required) return true;                       // 未标注权限码 → 只需登录
const roles: string[] = request.user?.roles ?? [];
const granted = roles.flatMap(r => ROLE_PERMISSIONS[r] ?? []);
if (!granted.includes(required)) throw new ForbiddenException('无权限访问');
```

**注册方式**（`app.module.ts`）
```ts
{ provide: APP_GUARD, useClass: AuthGuard },
{ provide: APP_GUARD, useClass: PermissionsGuard },
```

> ⚠️ 全局 Guard 会一并保护已有的 settings / logs / bianbian 三个模块。需同步：
> - `GET /admin/settings/public/:key` 标 `@Public()`（公开配置，前端未登录时也会取）
> - 其余接口标注各自权限码：`settings:view` / `settings:edit` / `logs:view` / `bianbian:view` 等
> - 联调时验证 admin 前端各页面无 401 回归

### 2.2 角色与权限

**`packages/types/src/index.ts` 改动**

```ts
export type Role = 'super_admin' | 'admin' | 'editor' | 'viewer';
export type PermissionGroup = ... | 'database';

// PERMISSIONS 追加
'database:view':  { code: 'database:view',  name: '查看业务数据', group: 'database', type: 'menu' },
'database:query': { code: 'database:query', name: '执行只读 SQL', group: 'database' },

// ROLE_PERMISSIONS
super_admin: Object.keys(PERMISSIONS),                                  // 全部（含 database:*）
admin:       Object.keys(PERMISSIONS).filter(p => p !== 'database:query'),
editor:      [...既有, 'database:view'],                                 // 可浏览，不可 SQL
viewer:      [...既有],                                                  // 不给
```

> `super_admin` 排在 `Role` 首位，`admin` 失去 `database:query` 但保留 `database:view`。
> 存量用户升级：提供一次性脚本 `scripts/db/grant-super-admin.mjs`，按 username 把 role 改为 `super_admin`。
> `RoleManagement.vue` 的角色下拉需补 `super_admin` 选项。

### 2.3 DatabaseExplorerModule

**目录**
```
servers/system-service/src/database-explorer/
├── database-explorer.module.ts
├── database-explorer.controller.ts
├── database-explorer.service.ts
├── dto/query-rows.dto.ts
├── dto/query-sql.dto.ts
└── utils/sql-guard.ts        # SQL 白名单校验（纯函数，便于单测）
```

**连接配置**（`app.module.ts` 追加第二个连接）
```ts
TypeOrmModule.forRootAsync({
  name: 'readonly',
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    type: cfg.get<string>('DB_TYPE', 'mysql') as 'mysql',
    host: cfg.get('DB_HOST'), port: cfg.get<number>('DB_PORT', 3306),
    username: cfg.get('DB_READONLY_USER', cfg.get('DB_USERNAME')),   // 降级到主账号需显式告警
    password: cfg.get('DB_READONLY_PASSWORD', cfg.get('DB_PASSWORD')),
    database: cfg.get('DB_DATABASE', 'web_system'),
    entities: [],            // 只读连接不挂实体
    synchronize: false,      // 只读连接禁止 synchronize
  }),
}),
```

**接口清单**（Controller `@Controller('admin/db')`）

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | `/admin/db/tables` | `database:view` | 表列表（敏感表按角色过滤） |
| GET | `/admin/db/tables/:name/schema` | `database:view` | 表结构 |
| GET | `/admin/db/tables/:name/rows` | `database:view` | 分页数据（脱敏后返回） |
| POST | `/admin/db/query` | `database:query` | 受限 SELECT，写审计日志 |
| POST | `/admin/db/reveal` | `database:query` | 明文查看单个脱敏字段（二期） |

**响应结构**（沿用项目 `TransformInterceptor` 的 `{code, data, message}` 包装）

```ts
// GET /tables
{ tables: Array<{
    name: string; comment: string | null;
    rows: number; sizeBytes: number;
    engine: string | null; createdAt: string | null;
    sensitive: boolean;          // 是否命中敏感表名单
  }> }

// GET /tables/:name/schema
{ tableName: string; comment: string | null;
  columns: Array<{
    name: string; type: string; nullable: boolean;
    defaultValue: string | null; key: string;    // PRI / UNI / MUL / ''
    comment: string | null;
    sensitive: 'none' | 'hidden' | 'masked';     // 脱敏策略，供前端标注
  }>;
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>; }

// GET /tables/:name/rows?page=1&pageSize=50&sortField=id&sortOrder=desc
{ tableName: string;
  columns: Array<{ name: string; sensitive: 'none'|'hidden'|'masked' }>;
  rows: Array<Record<string, unknown>>;
  total: number; page: number; pageSize: number; }

// POST /query  { sql: string }
{ columns: string[]; rows: Array<Record<string, unknown>>;
  rowCount: number; truncated: boolean; elapsedMs: number; }
```

### 2.4 安全设计（六道闸）

| # | 闸 | 实现 |
|---|---|---|
| 1 | 认证 | 全局 `AuthGuard`，无 token → 401 |
| 2 | 授权 | `PermissionsGuard`，按权限码 → 403 |
| 3 | **只读账号** | 独立 `'readonly'` 连接 + MySQL 只读账号（兜底，最关键） |
| 4 | 表名白名单 | 运行时从 `information_schema.tables` 取全集，`rows` / `schema` 的表名必须命中；排除 `migrations` / `typeorm_metadata` |
| 5 | SQL 校验（`query` 专用） | 见下 |
| 6 | 强制分页 | `rows` 接口 `pageSize` 上限 200；`query` 自动注入 `LIMIT 200` |

**SQL 校验 `utils/sql-guard.ts`**
```ts
const FORBIDDEN = [
  ';', '--', '/*', '*/', '#',
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'replace', 'rename', 'grant', 'revoke', 'lock', 'set ', 'call ',
  'into outfile', 'into dumpfile', 'load_file', 'information_schema.user',
  'mysql.', 'sleep(', 'benchmark(',
];

export function assertReadOnlySql(raw: string): string {
  const sql = raw.trim().replace(/;$/, '');
  const head = sql.slice(0, 6).toLowerCase();
  if (head !== 'select') throw new BadRequestException('仅允许 SELECT 查询');
  const lower = sql.toLowerCase();
  for (const kw of FORBIDDEN) {
    if (lower.includes(kw)) throw new BadRequestException(`禁止的语句或关键词：${kw.trim()}`);
  }
  // 已有 LIMIT 则取较小值，否则追加
  const m = sql.match(/\blimit\s+(\d+)(?:\s*,\s*(\d+))?/i);
  if (m) {
    const n = m[2] ? Number(m[2]) : Number(m[1]);
    if (n > MAX_ROWS) return sql.replace(/\blimit\s+[\d\s,]+$/i, `LIMIT ${MAX_ROWS}`);
    return sql;
  }
  return `${sql} LIMIT ${MAX_ROWS}`;
}
```

> 注：`INFORMATION_SCHEMA` 本身允许查（表列表功能需要），但屏蔽 `mysql.` 系统库与 `information_schema.user`。

**敏感字段脱敏规则**

| 级别 | 匹配（字段名小写包含） | 处理 |
|---|---|---|
| `hidden` | `password` `secret` `token` `api_key` `apikey` `private_key` `session_key` `salt` `credential` | 返回 `***`，永不返回原值 |
| `masked` | `phone` `mobile` `id_card` `idcard` `openid` `unionid` `email` | 打码：`138****8888` / `a***@b.com`；`database:query` 权限者可看点开明文（走 `reveal` 接口 + 审计） |

**敏感表名单**（环境变量可配，默认空）
```bash
DB_SENSITIVE_TABLES=   # 逗号分隔，命中则仅 super_admin 可见
```

### 2.5 审计

仅 `POST /query` 与 `POST /reveal` 写 `operation_logs`（浏览类操作不记，避免噪音）：
```
type: 'database_query' | 'database_reveal'
operator: 用户名
detail: { sql, rowCount, elapsedMs, truncated } 或 { table, column, rowId }
```

### 2.6 只读账号创建（一次性）

本地 MySQL 未装 CLI，走 docker 或 node 脚本执行：
```sql
CREATE USER IF NOT EXISTS 'web_system_ro'@'%' IDENTIFIED BY '<强密码>';
GRANT SELECT ON web_system.* TO 'web_system_ro'@'%';
FLUSH PRIVILEGES;
```
写入 `.env`：
```bash
DB_READONLY_USER=web_system_ro
DB_READONLY_PASSWORD=<强密码>
```
> 若 `DB_READONLY_USER` 未配置，服务启动时打 `Logger.warn` 明确告警"正在使用可写账号运行数据浏览器"。

---

## 3. 前端设计

### 3.1 组件树

```
views/Database/DataBrowser.vue          ← 页面容器
├── .db-page
│   ├── .page-header            h1「数据浏览」+ caption 副标题 + 右上「刷新」(default)
│   ├── a-tabs                  [数据浏览] [SQL 控制台(v-if hasPermission('database:query'))]
│   ├── Tab1 · BrowsePane       ← 内联，不拆组件（避免单文件过度拆分）
│   │   ├── a-layout
│   │   │   ├── a-layout-sider   表搜索 a-input-search + 表列表 a-menu
│   │   │   └── a-layout-content
│   │   │       ├── panel-head   表名(.ws-mono) + a-tabs size="small"
│   │   │       │                标签：「数据 (行数)」「表结构 (字段数)」
│   │   │       ├── Tab 数据     a-table（动态列）+ 分页   ← 默认选中
│   │   │       └── Tab 表结构   字段表格 + 索引表格
│   │   └── a-drawer            单元格全文
│   └── Tab2 · SqlPane          v-if 权限通过才渲染
│       ├── a-alert             规则说明（仅 SELECT / 自动 LIMIT 200 / 已审计）
│       ├── a-textarea          .ws-mono 等宽字体
│       ├── 执行按钮            :loading="executing" 防重复提交
│       └── a-table             结果表格 + 耗时/行数提示
```

> **Tab 层级区分**：外层「数据浏览 / SQL 控制台」= 页面级（默认 `size`）；右栏「数据 / 表结构」= 卡片级（`size="small"`，照 `ServiceManager.vue` 卡片内 tabs 范式）。两级用尺寸区分，避免视觉层级混淆。
> **切表行为**：切换左栏表时**保持右栏当前选中的 Tab**（正在看表结构则继续看表结构），仅刷新内容 —— 避免连续对比多张表结构时被反复重置。

### 3.2 API 层 `api/database.ts`

```ts
import request from './request';

export interface DbTable { name: string; comment: string | null; rows: number;
  sizeBytes: number; engine: string | null; createdAt: string | null; sensitive: boolean }
export interface DbColumn { name: string; type: string; nullable: boolean;
  defaultValue: string | null; key: string; comment: string | null;
  sensitive: 'none' | 'hidden' | 'masked' }
export interface RowsResult { tableName: string;
  columns: Array<{ name: string; sensitive: 'none' | 'hidden' | 'masked' }>;
  rows: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }
export interface SqlResult { columns: string[]; rows: Array<Record<string, unknown>>;
  rowCount: number; truncated: boolean; elapsedMs: number }

export const fetchTables = () => request.get<DbTable[]>('/admin/db/tables');
export const fetchSchema = (table: string) =>
  request.get<{ tableName: string; comment: string | null; columns: DbColumn[];
    indexes: Array<{ name: string; columns: string[]; unique: boolean }> }>(
    `/admin/db/tables/${encodeURIComponent(table)}/schema`);
export const fetchRows = (table: string, params: {
  page: number; pageSize: number; sortField?: string; sortOrder?: 'asc' | 'desc' }) =>
  request.get<RowsResult>(`/admin/db/tables/${encodeURIComponent(table)}/rows`, { params });
export const runSql = (sql: string) => request.post<SqlResult>('/admin/db/query', { sql });
```

### 3.3 路由与菜单（3 处接入点）

**① `router/index.ts`** — 在 `users` 后追加：
```ts
{
  path: 'database',
  name: 'Database',
  component: () => import('@/views/Database/DataBrowser.vue'),
  meta: { title: '数据浏览', permission: 'database:view' },
},
```

**② `layouts/BasicLayout.vue`** — 菜单项（图标 `DatabaseOutlined`，禁 emoji）：
```vue
<a-menu-item v-if="userStore.hasPermission('database:view')" key="database">
  <template #icon><DatabaseOutlined /></template>
  <span>数据浏览</span>
</a-menu-item>
```

**③ 同文件三处映射同步**
- `currentTitle` 的 `titles` 表加 `'/database': '数据浏览'`
- `watch(route.path)` 加 `else if (path.includes('/database')) selectedKeys.value = ['database'];`
- `handleMenuClick` 的 `routes` 表加 `database: '/database'`

### 3.4 表格渲染规则

| 规则 | 实现 |
|---|---|
| 动态列 | 由 `/schema` 返回的 `columns` 生成 `a-table` 的 `columns`，顺序原样 |
| 等宽字体 | 字段名为 `id` / 以 `_id` 结尾 / 含 `time` `date` `at` → 加 `.ws-mono` |
| 数字列 | `font-variant-numeric: tabular-nums` |
| NULL | 显示 `NULL`，色 `--ws-text-tertiary`，斜体 |
| 长文本 | > 40 字符截断 + `…`，点击开 `a-drawer` 看全文（mono + 可复制） |
| 敏感字段 | schema 返回 `sensitive` 后前端只做**标注**（表头加 tag），脱敏值由后端返回 |
| 滚动 | `:scroll="{ x: 'max-content' }"`，列多时横向滚动 |
| 行高/密度 | `size="small"`，对齐 ServiceManager 信息密度 |

### 3.5 状态矩阵实现

| 状态 | 实现 |
|---|---|
| 加载中 | `a-table :loading`；按钮 `:loading` |
| 空态 | `a-empty`，文案按规格书（原因 + 出路） |
| 失败 | `message.error` + 区块内「重试」按钮 |
| 破坏性 | 无（全只读），N/A |
| 禁用 | 无权限的 Tab 直接不渲染，非禁用态 |
| 防重复 | `executing` ref 锁 |

### 3.6 UI 约束（design.md 强制）

- 颜色/圆角/字号只引 `--ws-*`（`--ws-text-primary` / `--ws-bg-subtle` / `--ws-border` / `--ws-brand-700` / `--ws-radius-lg`），**禁裸 hex**
- 卡片用 `.ws-hairline`（`box-shadow: 0 0 0 1px var(--ws-border)`，照 ServiceManager 范式）
- 代码/表名用 `.ws-mono`
- **不新增 `!important`**
- 图标用 `@ant-design/icons-vue`，禁 emoji
- light / dark 双主题过目

---

## 4. 依赖与顺序

```
任务3 鉴权补齐 + 角色/权限码 ──┐
                              ├──► 任务5 前端页面 ──► 任务7 接入与发布验证
任务4 db-explorer B ──────────┤
任务5 SQL 控制台 A ───────────┘
```

任务 3 是**硬前置**：无鉴权则本功能等同于公开整库。

---

## 5. 影响面清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `packages/types/src/index.ts` | 新增角色 + 权限码 | 所有端共享，需重新 build shared/types |
| `servers/system-service/src/main.ts` | 注册全局 Guard | — |
| `servers/system-service/src/app.module.ts` | 第二个只读连接 + Guard provider | 连接失败会导致服务起不来，需 allow-none 降级 |
| `servers/system-service/src/{settings,operation-logs,bianbian-admin}/*` | 补权限码装饰器 | 中：可能引起既有页面 403 回归 |
| `apps/admin/src/router/index.ts` | 加路由 | 低 |
| `apps/admin/src/layouts/BasicLayout.vue` | 菜单 + 3 处映射 | 低 |
| `apps/admin/src/views/Database/DataBrowser.vue` | 新增 | — |
| `apps/admin/src/api/database.ts` | 新增 | — |
| `servers/system-service/.env` | 只读账号配置 | 低 |

---

## 6. 验证方式

1. **后端**：`curl -H "Authorization: Bearer <token>" localhost:6000/api/admin/db/tables`
2. **权限**：用 editor / admin / super_admin 三种 token 各打一次，验证 SQL 控制台与敏感表的可见性差异
3. **安全**：造一条 `SELECT 1; DROP TABLE x` 与一条 `UPDATE`，均应被拒且返回明确错误
4. **脱敏**：查 `users` 表，验证 `password` 列为 `***`、`phone` 列为打码值
5. **前端**：light / dark 双主题截图存档 `docs/ui/baselines/admin-database-browser-{light,dark}.png`
6. **发布**：微前端四步（构建 → 拷贝 → 更新版本表 → 等 12s 验证 manifest）
