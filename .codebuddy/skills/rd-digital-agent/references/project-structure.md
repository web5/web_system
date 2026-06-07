# web_system 项目结构详解

## Monorepo 架构

此项目使用 **pnpm + Rush** 管理 monorepo 架构。

### 包管理命令对照表

| 原有命令 | Rush 命令 | 说明 |
|---------|-----------|------|
| `pnpm dev` | `rushx dev` | 启动开发服务器 |
| `pnpm build` | `rushx build` | 构建项目 |
| `pnpm test` | `rushx test` | 运行测试 |

## 子项目详情

### 1. admin-web（管理后台）

**路径：** `apps/admin-web/`

**技术栈：**
- Vue 3 + TypeScript
- Vite 构建工具
- Pinia（状态管理）
- Vue Router
- Ant Design Vue（UI 组件库）

**端口：** 5173

**功能模块：**
- 用户管理（列表、详情、增删改查）
- 工作台
- 系统设置

**启动命令：**
```bash
cd apps/admin-web && rushx dev
```

---

### 2. portal（少儿教育门户）

**路径：** `apps/portal/`

**技术栈：**
- Vue 3 + TypeScript
- Vite 构建工具
- Ant Design Vue（UI 组件库）
- Axios（HTTP 请求）

**端口：** 3003

**功能模块：**
- 首页（紫色渐变风格）
  - 导航栏
  - Hero 区域
  - 课程卡片展示
  - 特色功能
- 画笔页面（Canvas 画板）
  - 画笔/橡皮工具
  - 颜色选择
  - 画笔粗细调节
  - 撤销功能
  - 保存作品

**启动命令：**
```bash
cd apps/portal && rushx dev
```

**已知问题修复：**
- `request.ts` 变量命名冲突：将导入的 axios 重命名为 `axiosInstance`

---

### 3. mini-app（微信小程序）

**路径：** `apps/mini-app/`

**技术栈：**
- 微信小程序原生开发
- TypeScript
- Canvas API（画板功能）

**功能模块：**
- 首页
- 画板功能（draw 页面）
-  Records 页面（记录查看）

**开发命令：**
```bash
cd apps/mini-app && rushx dev      # 开发模式
cd apps/mini-app && rushx preview  # 预览
cd apps/mini-app && rushx upload   # 上传
```

**测试配置：**
- Jest + ts-jest
- jest-environment-jsdom
- 测试文件：`tests/*.test.ts` 或 `tests/*.test.js`

---

### 4. gateway（API 网关）

**路径：** `servers/gateway/`

**技术栈：**
- NestJS
- 反向代理（路由转发）

**端口：** 3000

**功能：**
- 统一 API 入口
- 路由转发到各微服务
- CORS 处理

**已知问题修复：**
- 用户路由配置缺失：需在 `proxy.service.ts` 和 `proxy.controller.ts` 中添加 user-service 路由

**启动命令：**
```bash
cd servers/gateway && rushx dev
```

---

### 5. auth-service（认证服务）

**路径：** `servers/auth-service/`

**技术栈：**
- NestJS
- JWT 认证
- bcrypt 密码加密

**端口：** 3001

**功能：**
- 用户注册
- 用户登录
- Token 验证
- 密码重置

**启动命令：**
```bash
cd servers/auth-service && rushx dev
```

---

### 6. user-service（用户服务）

**路径：** `servers/user-service/`

**技术栈：**
- NestJS
- TypeORM
- PostgreSQL

**端口：** 3002

**功能：**
- 用户 CRUD API
- 用户列表（分页）
- 用户详情
- 用户状态管理

**启动命令：**
```bash
cd servers/user-service && rushx dev
```

---

## 共享包

### packages/types

TypeScript 类型定义共享包。

### packages/shared

共享工具函数、常量、辅助方法。

---

## 端口分配总表

| 应用/服务 | 端口 | 说明 |
|----------|------|------|
| admin-web | 5173 | 管理后台 |
| portal | 3003 | 少儿教育门户 |
| gateway | 3000 | API 网关 |
| auth-service | 3001 | 认证服务 |
| user-service | 3002 | 用户服务 |

---

## 一键启动/停止

### 启动所有服务

```bash
./start-dev.sh
```

### 停止所有服务

```bash
lsof -ti:3000 -ti:3001 -ti:3002 -ti:3003 -ti:5173 | xargs kill -9 2>/dev/null || true
```

---

## 部署配置

### 服务器信息

- **服务器 IP：** 106.52.176.246
- **Nginx 转发：** 42.194.200.69

### 域名配置

- `portal.kedouai.com` → 106.52.176.246（通过 42.194.200.69 Nginx 转发）

### Docker 部署

```bash
docker-compose up -d
```

---

## 依赖关系

```
gateway (3000)
  ├── auth-service (3001)
  └── user-service (3002)

admin-web (5173) ──→ gateway (3000)
portal (3003) ──→ gateway (3000)
mini-app ──→ 云开发（微信小程序原生云服务）
```
