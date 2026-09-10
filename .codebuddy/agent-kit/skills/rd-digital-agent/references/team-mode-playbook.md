---
kind: reference
audience: dual
loads: on-trigger
version: 1.0.0
---

# 多 Agent 团队模式操作手册

> **何时加载**：需要搭建多 Agent 团队模式时（宿主平台提供 `Task` 工具、且任务需跨角色接力）。日常单 Agent 任务**不加载**本文件。
> 为什么需要子 Agent、以及它的代价（摘要质量）见 `../RATIONALE.md` §3。

## 前置

在宿主平台创建团队后，将下方占位符 `<your-team>` 替换为实际团队名，用 `task(name="xxx", team_name="<your-team>")` 启动子 Agent。

## 架构

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

## 启动方式（完整流水线示例）

```javascript
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

## 摘要纪律（团队模式的成败点）

子 Agent 完成后上下文即释放，主 Agent 只保存结果摘要。**摘要质量 = 协作质量的上限**，因此摘要必须含三项，缺一即视为信息丢失：

1. **结论**（做成了什么 / 没做成什么）
2. **依据**（关键判断的理由，不是过程流水）
3. **未决项**（待确认、被阻塞、需下一角色注意的点）

只回传「完成了」的摘要会导致后续阶段基于残缺输入决策——这是团队模式最主要的失效形态。

## 链首与链尾

- 需求转换（`requirement-translation`）作为链首 sub-agent，在 brainstorm 前 spawn，产出需求 spec；
- 测试验证（`test-verification`）作为链尾 sub-agent，在 review 后 spawn，独立盲测产物；
- 二者与流水线角色同为同本体分身、独立上下文，**不拆为独立 agent**（升为独立 agent 的条件见 `../RATIONALE.md` §2）。
