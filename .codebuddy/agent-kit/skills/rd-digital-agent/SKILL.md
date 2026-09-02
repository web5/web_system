---
name: rd-digital-agent
description: 通用数字人 Hub — 根据任务类型与复杂度自动分派到子技能（brainstorm → plan → execute → review 流水线，外加调试/重构/探索/验证门/审查）。方案探索、内容创作、问题修复、重构等场景的入口。
version: 4.0.0
---

# 通用数字人 Hub

## 分派决策

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
  ├─ 报错 / 测试失败 / 意外行为 ───────→ .skills/systematic-debugging
  │                                         ↓ 根因修复后
  │                                      .skills/verification-before-completion
  │
  ├─ "重构" / "清理" / 消除重复 ───────→ .skills/incremental-refactoring
  │                                         ↓ 全量回归后
  │                                      .skills/verification-before-completion
  │
  ├─ "X 在哪实现" / 理解项目结构 ──────→ .skills/code-explore（只读探索）
  │
  ├─ 小改动 / "修 bug" / 简单任务 ─────→ .skills/rd-execute（直连）
  │                                         ↓
  │                                      .skills/rd-review
  │
  ├─ 架构 / 选型 / 安全 / 信息结构 ────→ .skills/tech-review（辅助审查）
  │
  ├─ 任何交付前收尾 ──────────────────→ .skills/verification-before-completion
  │
  └─ 写作/产出任务（所有）────────────→ 加载项目自有纪律（可选，本模板不内置）
```

## 子技能矩阵

| 类别 | Skill | 职责 |
|------|-------|------|
| 流水线 | `rd-brainstorm` | 探索方案选项 |
| 流水线 | `rd-plan` | 细化为任务列表 |
| 流水线 | `rd-execute` | 逐项实现（TDD 迭代-校验） |
| 流水线 | `rd-review` | 自检产物质量 |
| 质量门 | `verification-before-completion` | 完成前强制验证（一切交付的收尾门） |
| 调试 | `systematic-debugging` | 四阶段根因分析，禁止报错即改 |
| 重构 | `incremental-refactoring` | 测试保护下小步重构 |
| 探索 | `code-explore` | 代码库理解与影响面分析（只读） |
| 审查 | `tech-review` | 方案/结构/安全多维度审查 |

> 写作/产出纪律（如 Think First / Simplicity）为可选层，由各项目自行补充，不内置在本模板。

## 评审链（方案质量门）

产物从需求到实现依次过三道评审，按复杂度分级触发：

1. **产品方案评审**（做不做对的事）—— 需求/产品方案
   → `references/product-review-checklist.md`（AI 自查）→ 人在「设计确认」复核
2. **技术方案评审**（怎么实现）—— design.md / 选型 / 架构
   → `tech-review/references/review-checklist.md`（AI 自查，配合 tech-review 技能）
3. **代码评审**（实现好不好）—— 执行完成后 → `rd-review`

底层思考工具：`rd-plan/references/thinking-checklist.md`（苏格拉底辨证 / 第一性原理 / 芒格）——评审前自问、评审时复核答案质量。
分级：日常小改动只跑 thinking-checklist 简化档；中大型 / 跨模块方案走完整评审链。
红线的执行入口也在此挂载：兜底红线（无业务定义即显式报错）落在两清单的 A 项；辨证铁律（答不出 = 待确认）贯穿全程。

## 多 Agent 协作团队模式（Context 隔离）

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
  │     ├── task(name="brainstorm-agent", team_name="<your-team>")  ← 独立上下文
  │     │     返回: 方案摘要（2-3 句话）
  │     │
  │     ├── task(name="plan-agent", team_name="<your-team>")        ← 独立上下文
  │     │     返回: TODO 列表摘要
  │     │
  │     ├── task(name="execute-agent", team_name="<your-team>")     ← 独立上下文
  │     │     └─ 内部加载项目自有写作/产出纪律（可选）
  │     │     返回: 变更摘要 + 自检结果
  │     │
  │     └── task(name="review-agent", team_name="<your-team>")      ← 独立上下文
  │           返回: 审查报告摘要
  │
  └─ 主 Agent 汇总 → 输出给用户
```

### 启动方式

在宿主平台创建团队后，将下方占位符 `<your-team>` 替换为实际团队名，用 `task(name="xxx", team_name="<your-team>")` 启动子 Agent。

```javascript
// 示例：完整流水线
// 1. 主 Agent 收到需求后，spawn 子 Agent（每个独立上下文）
task(name="brainstorm-agent", team_name="<your-team>", mode="plan",
  prompt="需求: xxx。请输出 2-3 个方案并推荐")

// 2. 用户选方案后，spawn plan-agent
task(name="plan-agent", team_name="<your-team>", mode="plan",
  prompt="选定方案: xxx。请拆分为可执行的 TODO 列表")

// 3. 用户确认后，spawn execute-agent（加载项目自有纪律，可选）
task(name="execute-agent", team_name="<your-team>", mode="acceptEdits",
  prompt="实现: xxx。遵循迭代-校验工作流。")

// 4. 执行完成后，spawn review-agent
task(name="review-agent", team_name="<your-team>", mode="plan",
  prompt="审查变更: xxx")
```

**关键**：子 Agent 完成后上下文即释放，主 Agent 只保存结果摘要。这比单 Agent 积累全部历史要轻量得多。

## 项目上下文（按需替换）

> 本智能体为**通用数字人模板**，不绑定具体项目。加载到具体团队/项目时，把下方占位替换成该项目的资料结构、术语库、品牌语气即可。

```
<your-project>/
├── <模块A>
├── <模块B>
└── <共享包/配置>
```

通用原则（适用于任何项目）：
- 同类修改必须扫全量，不只在手头文件改；
- 校验 / 格式 / 命名等横切约定，统一收口到共享文档，禁止各处拷贝。

## 共享参考文档

位于 `rd-digital-agent/references/`：

| 文档 | 何时加载 |
|------|---------|
| `project-context.md` | 加载到具体项目时，记录其资料结构/领域/品牌语气 |
| `writing-standards.md` | 需要确认命名/格式/表达约定 |
| `spec-workflow.md` | 需要 spec 文档模板 |
| `iterate-verify-workflow.md` | 需要「草稿-校验-精修」迭代方法 |
| `product-review-checklist.md` | 产品方案评审（需求/方案进技术评审前、设计确认节点） |
