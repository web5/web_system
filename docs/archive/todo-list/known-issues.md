# 已知问题 & 待办

> 最后更新：2026-08-28

---

## ♻️ packages/shared 与 packages/types 类型职责重复（UserInfo/User 同名冲突）

- **状态**：⏳ 待处理（回头安排时间修改）
- **优先级**：中
- **背景**：`@web-system/shared`（共享工具函数 + 常量 + 实体）与 `@web-system/types`（纯 TS 类型定义）在「类型定义」职责上存在重复，核心是 `UserInfo` 同名不同类型冲突
- **重复点**：
  1. **`User` 类型**：`packages/types/src/index.ts` 定义纯接口 `User`；`packages/shared/src/entities/user.entity.ts` 定义 TypeORM 实体 `class User`（字段更多：password/nickname/mpOpenid/oaOpenid/dailyTransformLimit）。两处描述同一业务对象但字段不同步
  2. **`UserInfo` 类型**：`packages/types` 定义完整版（含 roles/gender/role/enabled/dailyTransformLimit）；`packages/shared/src/micro-frontend.ts` 定义精简版（仅 id/username/avatar + `[k: string]: any`）。同名不同类型，互不引用
  3. **`LoginResponse.user` 引用错位**：`types` 的 `LoginResponse.user` 引用 types 自己的 `UserInfo`，与 shared 的 `UserInfo` 不一致
- **涉及文件**：
  - `packages/types/src/index.ts`（User/UserInfo/LoginResponse 等）
  - `packages/shared/src/micro-frontend.ts`（精简版 UserInfo）
  - `packages/shared/src/entities/user.entity.ts`（User 实体）
  - `packages/shared/src/index.ts`（re-export）
- **选定方案（最小改动）**：统一 `UserInfo`，让 `shared` 的 `UserInfo` 复用 `@web-system/types` 的类型，保留两个包各自定位（types=纯类型，shared=工具函数+实体+常量），消除同名冲突，不合并包
- **验证方式**：全仓 `grep UserInfo` 确认引用一致；两端 login/用户信息接口返回值字段对齐；`pnpm build` 通过
- **注意**：`micro-frontend.ts` 的 `UserInfo` 被 `shell-loader`、各业务模块 bootstrap 引用，改动需同步验证微前端模块契约

---

## 🧹 apps/admin/.env.production 冗余，可考虑删除

- **状态**：⏳ 待处理（回头安排时间）
- **优先级**：低
- **现象**：`apps/admin/.env.production` 声明的 `VITE_API_BASE_URL`、`VITE_GATEWAY_URL` 在 admin 源码中**无任何消费**
- **调查证据**：
  - `apps/admin` 全目录搜 `import.meta.env` 为 0 结果
  - API 地址为硬编码 `baseURL: '/api'`（`apps/admin/src/api/request.ts:91`、`upload.ts:15`），不读 env
  - `VITE_GATEWAY_URL` 全仓只在 `.env.example`/`.env.production` 出现，代码未引用
  - dev proxy 目标硬编码 `http://localhost:6000`（`vite.config.ts:48`），不读 env
  - `.env.example` 的 `VITE_USE_MOCK` 在源码也无引用（request.ts 无 mock 逻辑）
- **结论**：`.env.production` 可删除，不影响 admin 构建与运行；`.env.example` 中 `VITE_API_BASE_URL`/`VITE_GATEWAY_URL`/`VITE_USE_MOCK` 三个变量声明可一并清理
- **风险提示**：删除前需确认未来没有 PR 引入 env 读取（admin 通过 gateway 反代 `/api` 走同域相对路径，理论上不需要绝对网关地址）
- **验证方式**：删除后 `pnpm build` 通过，dev/prod 环境 admin 登录与接口请求正常

---

## 🐛 MCP 管理后台模块开关状态显示错误

- **状态**：⏳ 待修复（计划下周）
- **优先级**：中
- **现象**：MCP 网关管理后台（`/admin/mcp`）列表中，所有模块的开关均为关闭状态（灰色），但服务实际已启用；顶部同时出现两个绿色的“已启用”状态标签
- **根因**：`apps/admin/src/views/McpAdminPanel.vue` 中开关的 `checked` 绑定写成了 `record.enabled === 1`，而后端 `servers/mcp-gateway/src/mcp/entities/mcp-module.entity.ts` 的 `enabled` 字段类型为 `boolean`，返回的是 `true/false`，因此判断恒为 `false`，开关永远显示关闭。顶部“已启用”标签来源还需进一步确认，可能与同一判断逻辑有关
- **涉及文件**：
  - `apps/admin/src/views/McpAdminPanel.vue` 第 264-266 行
  - `apps/admin/src/api/mcp.ts` 第 47 行 `enabled: number` 类型声明错误
- **修复方向**：
  - 前端 switch 绑定改为 `:checked="!!record.enabled"` 或 `:checked="record.enabled"`
  - `apps/admin/src/api/mcp.ts` 中 `McpModule.enabled` 类型改为 `boolean`
  - 检查顶部“已启用”标签的渲染逻辑，确保与实际启用状态一致
- **验证方式**：在 MCP 管理后台创建/启用模块后，开关应正确显示为开启（橙色），刷新页面后状态保持一致

---

## 🐛 Admin-Web `localhost` 访问异常

- **状态**：⏳ 待排查
- **优先级**：中
- **现象**：`http://localhost:5174/admin/` 白屏或无法连接，`http://127.0.0.1:5174/admin/` 正常
- **根因**：macOS 上 `localhost` 默认解析为 IPv6 `::1`，浏览器通过 IPv6 连接时出现 Vite dev server 兼容问题。已在 `vite.config.ts` 中将 `host` 改为 `'0.0.0.0'`（仅 IPv4），但 Node.js 在 macOS 上仍可能使用 IPv6 双栈 socket
- **影响范围**：仅 admin-web 开发环境（5174），portal（5173）无此问题
- **临时方案**：开发期间使用 `http://127.0.0.1:5174/admin/`
- **排查方向**：
  - Vite 5 `host` 选项在 macOS IPv6 双栈上的实际行为
  - 浏览器 IPv6 缓存（可能缓存了旧配置的 404 或空白页）
  - Node.js 启动参数 `--ipv6` / `--no-ipv6`

---

## 🗂 前端路径收口（2026-07-26 已完成）

- **状态**：✅ 已完成
- **改动**：

| 前端 | 路径 | 开发地址 |
|------|------|------|
| Portal (变变) | `/portal/` | http://localhost:5173/portal/ |
| Admin (管理后台) | `/admin/` | http://localhost:5174/admin/ |

- **涉及文件**：
  - `apps/portal/vite.config.ts`：`base: '/portal/'` + SPA 回退中间件
  - `apps/portal/src/router/index.ts`：`createWebHistory('/portal/')`
  - `apps/admin-web/vite.config.ts`：SPA 回退中间件 + proxy rewrite
  - `servers/gateway/src/main.ts`：SPA 回退路由更新，根 `/` 301 → `/portal/`
  - `scripts/deploy.sh`：Portal 构建目标 `public/` → `public/portal/`
  - `DEPLOYMENT.md`：构建路径同步
- **素材路径已统一为 `/materials/svg/`**（独立静态资源路径，与页面路由分离）：
  - 生成脚本 → 同时输出到 `apps/portal/public/materials/svg/` 和 `servers/gateway/public/materials/svg/`
  - 数据库 seed ↔ 前端配置 `materials.ts` 统一使用 `/materials/svg/`
  - 生产部署脚本自动将 `public/portal/materials/` 复制到 `public/materials/`
  - ⚠️ 生产部署后需要重新执行 seed 更新旧数据库素材路径

---

## 🔧 待优化

- [ ] Admin-Web `localhost` IPv6 访问修复
- [ ] 生产环境数据库素材路径迁移（seed 或 SQL UPDATE）
