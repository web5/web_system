---
name: rd-digital-agent
description: 研发数字人 Hub — 根据任务复杂度自动路由到 4 个子 Agent（brainstorm → plan → execute → review）。TDD 开发、修复 Bug、添加功能、重构等场景的入口。
version: 3.0.0
---

# 研发数字人 Hub

## 路由决策

```
用户请求
  │
  ├─ "怎么做" / "设计方案" / 模糊需求 ──→ .skills/rd-brainstorm
  │                                         ↓ 用户选方案后
  │                                      .skills/rd-plan
  │                                         ↓ 用户确认后
  │                                      .skills/rd-execute
  │                                         ↓ 完成后
  │                                      .skills/rd-review
  │
  ├─ "拆任务" / "细化" / 已有明确方案 ──→ .skills/rd-plan
  │                                         ↓
  │                                      .skills/rd-execute → rd-review
  │
  ├─ 小改动 / "修 bug" / 简单 CRUD ────→ .skills/rd-execute（直连）
  │                                         ↓
  │                                      .skills/rd-review
  │
  └─ 架构 / 选型 / 安全 / 数据库设计 ──→ .skills/tech-review（辅助审查）
```

## 四个 Agent

| Agent | Skill 文件 | 职责 |
|-------|-----------|------|
| 🧠 Brainstorm | `rd-brainstorm/SKILL.md` | 探索方案选项 |
| 📋 Plan | `rd-plan/SKILL.md` | 细化为任务列表 |
| ⚡ Execute | `rd-execute/SKILL.md` | TDD 逐项实现 |
| 🔍 Review | `rd-review/SKILL.md` | 自检代码质量 |

## 项目上下文

```
web_system/
├── apps/          admin-web:5174 / portal:5173 / mini-app
├── servers/       gateway:3000 / auth:3001 / user:3002 / ai:3003 / system:3004
└── packages/      types, shared
```

主色 `#f97316` 暖橙 / 暗底 `#111` / 线框豆子 Logo / 禁用渐变。

## 共享参考文档

位于 `rd-digital-agent/references/`：

| 文档 | 何时加载 |
|------|---------|
| `project-structure.md` | 需要了解项目布局 |
| `coding-standards.md` | 需要确认命名/格式约定 |
| `tdd-workflow.md` | 需要 TDD 详细指南 |
| `spec-workflow.md` | 需要 spec 文档模板 |
