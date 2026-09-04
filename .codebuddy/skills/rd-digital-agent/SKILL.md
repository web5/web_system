---
name: rd-digital-agent
description: 研发数字人 Hub — 根据任务复杂度自动路由到 4 个子 Agent（brainstorm → plan → execute → review）。TDD 开发、修复 Bug、添加功能、重构等场景的入口。
version: 3.1.0
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
  ├─ 小改动 / "修 bug" / 简单 CRUD ────→ .skills/rd-execute（直连，仍须最小计划+方案，原型稿按 rd-plan 判定可省）
  │                                         ↓
  │                                      .skills/rd-review
  │
  ├─ 架构 / 选型 / 安全 / 数据库设计 ──→ .skills/tech-review（辅助审查）
  │
  ├─ UI / 页面 / 样式 / 交互任务 ───────→ .skills/fe-developer（前端开发技能）
  │
  ├─ 服务 / 接口 / 数据 / 安全横切 / 部署 → .skills/be-developer（后端开发技能）
  │
  └─ 编码任务（所有）─────────────────→ 加载 Karpathy 编程准则
       （在 rd-execute 执行时自动参考）
```

## 六个 Agent（Superpowers + Karpathy）

| Agent | Skill 文件 | 职责 |
|-------|-----------|------|
| 🧠 Brainstorm | `rd-brainstorm/SKILL.md` | 探索方案选项 |
| 📋 Plan | `rd-plan/SKILL.md` | 细化为任务列表 |
| ⚡ Execute | `rd-execute/SKILL.md` | TDD 逐项实现 |
| 🔍 Review | `rd-review/SKILL.md` | 自检代码质量 |
| 🧭 Karpathy 准则 | `~/.codebuddy/skills/karpathy-coding-guidelines/SKILL.md` | 编码纪律（Think First / Simplicity / Surgical / Goal-Driven） |
| 📚 Karpathy Wiki | `~/.codebuddy/skills/karpathy-llm-wiki/SKILL.md` | 持久化知识库管理 |

## 交付门禁（写码前强制校验）

进入 `rd-execute` 前，主 Agent 必须确认「交付三件套」状态。三件套区分**强制**与**按需**：

| 产物 | 强制 | 是否产出由谁决定 | 内容由谁确认 |
|------|------|------------------|--------------|
| 计划（TODO 列表） | 每次 | — | 人 |
| 方案（design / 选型 / 接口契约） | 每次 | — | 人 |
| 原型稿（UI 规格 或 架构原型） | **按需** | **人**（rd-plan 末尾拍板） | 人 |

门禁逻辑（`rd-execute` 入口硬校验）：
- 计划 ✓ 且 方案 ✓
- 且（若判定「需要原型稿」 → 原型稿 ✓ 且人已确认）
- 否则**禁止进入实现**，强制回退到对应产出环节补齐。

要点：
- **原型稿的「是否产出」由人决策**（rd-plan 阶段末尾显式询问/确认），AI 仅给建议：UI 大改 / 新功能 / 跨模块 → 建议产出；小改动 / 简单 CRUD → 可省。
- 一旦人判定需要，原型稿内容仍须**人确认**后才进 execute。
- 确认权始终在人；AI 无权替自己确认任何一件。

## TDD 多 Agents 协作团队模式（Context 隔离）

### 为什么需要子 Agent

| 方式 | 问题 |
|------|------|
| 单 Agent 顺序执行 | 所有历史留在一个上下文，token 越积越多，回答质量下降 |
| 子 Agent 并行/接力 | 每个 Agent 独立上下文，完成任务后释放，主 Agent 只保留摘要 |

### 架构

```
用户请求
  │
  ├─ 主 Agent（rd-digital-agent）← 只维护"当前阶段 + 结果摘要"
  │     │                         上下文不会被子 Agent 的细节撑爆
  │     │
  │     ├── task(name="brainstorm-agent", team_name="superpowers-tdd")  ← 独立上下文
  │     │     返回: 方案摘要（2-3 句话）
  │     │
  │     ├── task(name="plan-agent", team_name="superpowers-tdd")        ← 独立上下文
  │     │     返回: TODO 列表摘要
  │     │
  │     ├── task(name="execute-agent", team_name="superpowers-tdd")     ← 独立上下文
  │     │     └─ 内部加载 Karpathy 准则（Think / Simplicity / Surgical / Goal-Driven）
  │     │     返回: 变更摘要 + 测试结果
  │     │
  │     └── task(name="review-agent", team_name="superpowers-tdd")      ← 独立上下文
  │           返回: 审查报告摘要
  │
  └─ 主 Agent 汇总 → 输出给用户
```

### 启动方式

团队 `superpowers-tdd` 已创建，只需用 `task(name="xxx", team_name="superpowers-tdd")` 启动子 Agent。

```javascript
// 示例：完整流水线
// 1. 主 Agent 收到需求后，spawn 子 Agent（每个独立上下文）
task(name="brainstorm-agent", team_name="superpowers-tdd", mode="plan",
  prompt="需求: xxx。请输出 2-3 个方案并推荐")

// 2. 用户选方案后，spawn plan-agent
task(name="plan-agent", team_name="superpowers-tdd", mode="plan",
  prompt="选定方案: xxx。请拆分为可执行的 TODO 列表")

// 3. 用户确认后，spawn execute-agent（加载 Karpathy 准则）
task(name="execute-agent", team_name="superpowers-tdd", mode="acceptEdits",
  prompt="TDD 实现: xxx。遵循 Karpathy 编程四原则。")

// 4. 执行完成后，spawn review-agent
task(name="review-agent", team_name="superpowers-tdd", mode="plan",
  prompt="审查代码变更: xxx")
```

**关键**：子 Agent 完成后上下文即释放，主 Agent 只保存结果摘要。这比单 Agent 积累全部历史要轻量得多。

## 项目上下文

```
web_system/
├── apps/          admin-web:5174 / portal:5173 / mini-app
├── servers/       gateway:3000 / auth:3001 / user:3002 / ai:3003 / system:3004
└── packages/      types, shared
```

主色 `#FF8C42` 魔法橙 / 底色 `#FFF8F0` 暖白 / 文字 `#333333` — 「变变」品牌设计系统。

## 共享参考文档

位于 `rd-digital-agent/references/`：

| 文档 | 何时加载 |
|------|---------|
| `project-structure.md` | 需要了解项目布局 |
| `coding-standards.md` | 需要确认命名/格式约定 |
| `tdd-workflow.md` | 需要 TDD 详细指南 |
| `spec-workflow.md` | 需要 spec 文档模板 |
| `karpathy-coding-guidelines` | 编码前自动加载（Think Before Coding / Simplicity / Surgical Changes / Goal-Driven） |
