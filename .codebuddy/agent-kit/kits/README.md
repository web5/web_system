# 一套 AI Native 方法论 · 三个组成部分

本目录**不是三套可选的 kit**，而是一套方法论的三个组成部分：Karpathy 的行为纪律、Superpowers 的工程技能集、Anthropic 的 AI Native 协作方法论，分别解决同一件事的三个侧面，合起来才完整。

结构 = **一条主干 + 两层纪律**：

```
协作主干 L3（阶段 / 判据 V1…Vn / 人审）   ← 唯一编排入口
   ├─ 调用 执行手段库 L2（TDD / 调试 / 验证 / 并行分派 / worktree / 评审）
   └─ 约束 所有代码产出 ← 行为准则 L1（简洁 / 精准 / 可验证）
```

| 组成 | 来源 | 回答的问题 | 实体 |
|---|---|---|---|
| `L1-karpathy` 行为准则 | Karpathy | 这一段代码怎么写才不跑偏 | `L1-karpathy/SKILL.md` |
| `L2-superpowers` 执行手段库 | Superpowers | 这个工程动作怎么做得不偷懒 | `L2-superpowers/SKILL.md` + `references/` |
| `L3-anthropic` 协作主干 | Anthropic | 整个任务怎么组织与交付 | `skills/rd-digital-agent`（L3 为指针） |

判据的**定义**归主干、**执行**归手段库、**可验证性**归行为准则——三者分工不重叠。

## 单独加载（按需）

三部分默认成套加载；确只需某一部分时：

| 场景 | 加载什么 |
|---|---|
| 只想让 AI 写代码更克制 | 只加载 `L1-karpathy` |
| 已有自己的流程，只要工程纪律 | 只加载 `L2-superpowers`（+ 其 references） |
| 完整人-AI 协作交付 | 加载 `L3-anthropic`（它自动调用 L2/L1） |

## 加载方式

把本目录作为技能目录之一加载（与 `skills/` 并列）：

- `kits/L1-karpathy/SKILL.md` → 常驻
- `kits/L2-superpowers/SKILL.md` → 常驻索引（`references/` 按需加载）
- `kits/L3-anthropic/SKILL.md` → 常驻指针（实体在 `skills/rd-digital-agent`）
- 各目录 `RATIONALE.md` → 人面，不加载

## 已知风险与解法

三部分本身不冲突；真实风险来自宿主环境与落地方式（如宿主另有第二套编排技能、同一纪律两个真相源、纪律堆叠导致仪式过重）。**首选解法是「补齐判据字段使其与主链同构」，而非整体卸载对方**。

详见 [`../references/three-kits-architecture.md`](../references/three-kits-architecture.md) §三。
