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

### 开发模式

#### 管理后台
```bash
cd apps/admin-web
pnpm dev
```

#### 少儿教育门户
```bash
cd apps/portal
pnpm dev
```

#### 用户服务
```bash
cd servers/user-service
pnpm start:dev
```

### 构建
```bash
pnpm build
```

## 端口分配

| 应用/服务 | 端口 | 说明 |
|----------|------|------|
| admin-web | 3001 | 管理后台 |
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

## License

MIT
