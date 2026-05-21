# Web System

全栈 Web 应用系统 - 包含管理后台、少儿教育门户、小程序和后端服务

## 项目结构

```
web_system/
├── apps/                    # 前端应用
│   ├── admin-web/          # 管理后台 (Vue3 + Ant Design Vue)
│   ├── portal/             # 少儿教育门户 (Vue3 + Ant Design Vue)
│   └── mini-app/           # 微信小程序
├── servers/                 # 后端服务
│   ├── gateway/            # API 网关 (NestJS)
│   ├── auth-service/       # 认证服务 (NestJS)
│   └── user-service/       # 用户服务 (NestJS)
├── packages/                # 共享包
│   ├── types/              # TypeScript 类型定义
│   └── shared/             # 共享工具函数
└── common/                  # 公共配置
```

## 技术栈

### 前端
- Vue 3 + TypeScript
- Ant Design Vue
- Vite
- Pinia (状态管理)
- Vue Router

### 后端
- NestJS
- TypeORM
- PostgreSQL

### 工具
- pnpm (包管理)
- Rush (monorepo 管理)

## 快速开始

### 安装依赖
```bash
pnpm install
```

### Rush 命令

由于是 Rush monorepo 项目，请在各项目目录下使用 `rushx` 命令代替 `pnpm`：

| 原有命令 | Rush 命令 |
|---------|-----------|
| `pnpm dev` | `rushx dev` |
| `pnpm build` | `rushx build` |

### 启动命令

> **推荐方式**：使用一键启动脚本

```bash
# 一键启动所有服务
./start-dev.sh
```

#### 手动启动（按顺序）

##### 1. 后端服务

```bash
# 认证服务 (端口 3001)
cd servers/auth-service && rushx dev

# 用户服务 (端口 3002)
cd servers/user-service && rushx dev

# API 网关 (端口 3000)
cd servers/gateway && rushx dev
```

##### 2. 前端应用

```bash
# 管理后台 (端口 5173)
cd apps/admin-web && rushx dev

# 少儿教育门户 (端口 3003)
cd apps/portal && rushx dev
```

#### 一键停止

```bash
# 停止所有端口
lsof -ti:3000 -ti:3001 -ti:3002 -ti:3003 -ti:5173 | xargs kill -9 2>/dev/null || true
```

### 构建
```bash
# 构建所有项目
pnpm build

# 或在单个项目中
cd servers/gateway && rushx build
```

## 端口分配

| 应用/服务 | 端口 | 说明 |
|----------|------|------|
| admin-web | 5173 | 管理后台 |
| portal | 3003 | 少儿教育门户 |
| gateway | 3000 | API 网关 |
| auth-service | 3001 | 认证服务 |
| user-service | 3002 | 用户服务 |

## 功能模块

### 管理后台 (admin-web)
- 用户管理（列表、详情、增删改查）
- 工作台
- 系统设置

### 少儿教育门户 (portal)
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

### 小程序 (mini-app)
- 首页
- 画板功能

### 用户服务 (user-service)
- 用户 CRUD API
- 用户列表（分页）
- 用户详情
- 用户状态管理

## 部署

### Docker 部署
```bash
docker-compose up -d
```

### 服务器部署
目标服务器：106.52.176.246

## 域名配置

- portal.kedouai.com → 106.52.176.246 (通过 42.194.200.69 Nginx 转发)

## 开发规范

- 使用 TypeScript
- 遵循 ESLint 规则
- 提交前运行测试

## 已知问题与修复

### 1. Portal request.ts 变量命名冲突
**问题**：`apps/portal/src/api/request.ts` 中导入的 axios 与创建的实例变量命名冲突，导致 `request.create is not a function` 错误。

**修复**：将导入的 axios 重命名为 `axiosInstance`：
```typescript
// 修改前
import request from 'axios';
const request = request.create({...});

// 修改后
import axiosInstance from 'axios';
const request = axiosInstance.create({...});
```

### 2. Gateway 用户路由配置缺失
**问题**：`/api/users` 请求返回 404，请求被错误路由到 auth-service（端口 3001）而不是 user-service（端口 3002）。

**修复**：在 `servers/gateway/src/proxy/` 中添加 user-service 路由：
- `proxy.service.ts`：添加 `userServiceUrl` 配置和 `createUserProxy()` 方法
- `proxy.controller.ts`：添加 `/users/*` 和 `/users` 路由处理

### 3. 端口分配表错误
**问题**：README 中 admin-web 端口错误标记为 3001。

**修复**：已更正为 5173。

## License

MIT
