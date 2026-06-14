# 科豆 AI · 项目入口

## 是什么

科豆 AI 儿童创造力平台 — 全栈 monorepo（Vue3 + NestJS + PostgreSQL + 微信小程序）。

**平台产品矩阵**：
| 产品 | 定位 | 路由 |
|------|------|------|
| 变变 | AI 拼贴变身 3D 角色 | /create → /transform → /result |
| 画板 | 自由绘画 + AI 文生图 | /draw |
| AI 学习助手 | 少儿 AI 对话 | /chat |

## 技术栈速查

| 层 | 技术 |
|----|------|
| 前端 | Vue3 + Vite + Pinia + Ant Design Vue 4.x |
| 后端 | NestJS 10 + TypeORM 0.3 + PostgreSQL |
| 小程序 | 微信原生 + TypeScript |
| 部署 | Docker Compose + Nginx |

## 端口

| 服务 | 端口 |
|------|------|
| gateway | 3000 |
| auth-service | 3001 |
| user-service | 3002 |
| ai-service | 3003 |
| system-service | 3004 |
| portal (dev) | 5173 |
| admin-web (dev) | 5174 |
| docs (static) | 4173 |

## 设计常量

**平台（暗色）**：主色 `#f97316` 暖橙 / 暗底 `#0A0A0D` / 文字 `#F8FAFC`
**变变产品（暖色）**：主色 `#FF8C42` 魔法橙 / 底色 `#FFF8F0` 暖白 / 文字 `#333333`

## 开发规则

1. 大改动走 Superpowers 工作流：brainstorm → plan → execute → review
2. 架构决策前加载 `tech-review` 审查
3. 不主动 git commit
4. TypeScript 严格模式，禁止 `any`
5. 每个微服务独立数据库
6. 所有 API 通过 gateway 代理

## Skills

| Skill | 何时用 |
|-------|--------|
| `rd-digital-agent` | 入口 Hub，自动路由 |
| `rd-brainstorm` | 模糊需求，出方案选项 |
| `rd-plan` | 细化方案，拆任务 |
| `rd-execute` | TDD 逐项实现 |
| `rd-review` | 完成后自检 |
| `tech-review` | 架构/安全/数据方案审查 |
| `user-memory` | 用户偏好自动加载 |
