# Web System

基于 Rush + Vue3 + NestJS 的全栈管理系统

## 项目结构

```
web-system/
├── apps/
│   ├── gateway/          # API 网关 (NestJS)
│   ├── auth-service/     # 认证服务 (NestJS)
│   └── admin-web/        # 管理后台前端 (Vue3)
├── packages/
│   ├── types/            # 共享类型定义
│   └── shared/           # 共享工具函数
└── common/
    └── config/           # Rush 配置
```

## 技术栈

### 前端
- Vue 3.5+
- Ant Design Vue 4.2+
- Pinia (状态管理)
- Vue Router 4
- Vite 5
- TypeScript 5

### 后端
- NestJS 10
- TypeORM
- MySQL
- Redis
- Passport (JWT + Local)
- Swagger

### 工程化
- Rush (多包管理)
- pnpm
- ESLint
- TypeScript

## 快速开始

### 1. 安装 Rush (如果未安装)
```bash
npm install -g @microsoft/rush
```

### 2. 安装依赖
```bash
cd web-system
rush install
```

### 3. 配置环境变量

复制各应用的 `.env.example` 为 `.env.local`:

```bash
cp apps/gateway/.env.example apps/gateway/.env.local
cp apps/auth-service/.env.example apps/auth-service/.env.local
cp apps/admin-web/.env.example apps/admin-web/.env.local
```

编辑 `.env.local` 文件，配置数据库、Redis、微信等信息。

### 4. 启动服务

```bash
# 启动所有服务
rush build
rush start

# 或者分别启动
# 认证服务
cd apps/auth-service && npm run dev

# 网关
cd apps/gateway && npm run dev

# 前端
cd apps/admin-web && npm run dev
```

### 5. 访问

- 前端：http://localhost:5173
- 网关：http://localhost:3000
- 认证服务：http://localhost:3001
- Swagger 文档：http://localhost:3001/docs

## 功能特性

- ✅ 用户名密码登录
- ✅ 微信扫码登录
- ✅ JWT 鉴权
- ✅ Token 刷新
- ✅ 用户管理
- ✅ 角色权限
- ✅ API 网关
- ✅ 静态资源服务

## 开发规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 提交前运行 `rush lint`
- 重要变更需要更新类型定义

## License

MIT
