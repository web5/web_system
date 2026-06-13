# web_system 项目结构

## Monorepo 架构

pnpm workspace + Rush 管理。

```
web_system/
├── apps/
│   ├── admin-web:5174    (Vue3 + Vite + AntdV 4.x + Pinia)
│   ├── portal:5173       (Vue3 + Vite + AntdV 4.x + Pinia)
│   └── mini-app          (微信小程序 + TypeScript)
├── servers/
│   ├── gateway:3000       (NestJS - API 网关 + Swagger + 静态资源)
│   ├── auth-service:3001  (NestJS - 认证 + JWT + 微信登录 + 二维码)
│   ├── user-service:3002  (NestJS - 用户 CRUD)
│   ├── ai-service:3003    (NestJS - AI 对话)
│   └── system-service:3004 (NestJS - 系统配置 + 操作日志)
├── packages/
│   ├── types/             (共享 TypeScript 类型)
│   └── shared/            (共享工具函数)
├── common/                (公共配置)
└── docs/                  (产品文档 + 方案文档)
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue3 + Vite + Pinia + Ant Design Vue 4.x |
| 后端 | NestJS 10 + TypeORM 0.3 + PostgreSQL |
| 小程序 | 微信原生 + TypeScript |
| 认证 | JWT (access 7天 + refresh 30天) |
| 部署 | Docker Compose + Nginx |
| 包管理 | pnpm + Rush monorepo |

## 启动命令

```bash
# 前端
cd apps/portal && npx vite --port 5173
cd apps/admin-web && npx vite --port 5174

# 后端（需先 build）
cd servers/auth-service && node dist/main.js
cd servers/user-service && node dist/main.js
cd servers/ai-service && node dist/main.js
cd servers/system-service && node dist/main.js
cd servers/gateway && node dist/main.js
```

## 设计常量

- 主色 `#f97316` / 深色 `#ea580c` / 暗底 `#111`
- 禁用渐变，全部纯色
- 卡片圆角 12-18px，按钮 10-12px
- Logo：线框豆子 + AI 神经元节点
