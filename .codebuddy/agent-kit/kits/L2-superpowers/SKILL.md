---
name: L2-superpowers
description: 执行手段库 — TDD 铁律、系统化调试、完成前验证、并行子 agent 分派、git worktree、代码评审请求与接收、技能编写。由协作主干（L3）调用；不产出计划、不定义验证判据表（那是主干职责）。修 bug、改多处、隔离工作区、请审/接审、编写技能时适用。
version: 1.0.0
rationale: RATIONALE.md
loads: references/rigid-disciplines.md
---

> 设计理由与来源见 [`RATIONALE.md`](RATIONALE.md)（人面）；组成关系与风险消解见 `../../references/three-kits-architecture.md` §一 / §三。

# L2 · 工程纪律（Superpowers 层）

## 定位

提供**具体工程动作的执行纪律**，由协作主干（L3）按需调用。本层**不是工作流**：不产出计划、不定义验证判据表（判据来自主干的 `V1…Vn`）、不决定阶段顺序。

## 调用纪律

- **命中即调用**：判断某工程技能有哪怕 1% 可能适用，就必须先调用再看；调用后发现不适用可退出，但「先做这一步再说」不成立。
- **流程技能优先**：决定「怎么做」的技能（调试、验证）优先于「怎么实现」的技能（具体编码技巧）。
- **刚性分级**：
  - **Rigid（不可变通）**：TDD、系统化调试、完成前验证——不得以适应当前 context 为由跳过步骤。
  - **Flexible（可适配）**：并行分派、worktree、评审请求——按场景取舍。

## 技能清单

### A. 主干已收编的部分（单一真相源：本层只声明刚性，实体在主干，不重写一份）

| 技能 | 何时触发 | 刚性 | 实体 |
|---|---|---|---|
| `test-driven-development` | 任何行为变更 / 修 bug | Rigid（RED → GREEN → REFACTOR，先实现后补测试 = 违规） | `skills/rd-execute/SKILL.md` |
| `systematic-debugging` | 报错 / 测试失败 / 意外行为 | Rigid（复现 → 定位根因 → 最小修复 → 回归，禁止报错即改） | `skills/systematic-debugging/SKILL.md` |
| `verification-before-completion` | 任何完成声明前 | Rigid（先跑验证再看结果；判据取 L3 的 `V1…Vn`） | `skills/rd-execute/SKILL.md` §完成验证门 |
| `incremental-refactoring` | 重构 / 清理 / 消除重复 | Flexible（测试保护下小步重构） | `skills/incremental-refactoring/SKILL.md` |

### B. 主干未覆盖的工程能力（本层提供完整步骤，详见 `references/rigid-disciplines.md`）

| 技能 | 何时触发 | 刚性 | 铁律 |
|---|---|---|---|
| `dispatching-parallel-agents` | 多个子任务可并行 | Flexible | 子任务间无共享文件、无顺序依赖才可分派；结果回收须含「结论 + 依据 + 未决项」 |
| `using-git-worktrees` | 需隔离工作区 / 并行改多处 | Flexible | 改动前建 worktree，不污染主工作区 |
| `requesting-code-review` | 提交前请审 | Flexible | 请审须附变更范围 + 验证证据 |
| `receiving-code-review` | 收到评审意见 | Flexible | 先复现再改，不辩解；不认同须给出反证 |
| `writing-skills` | 新增/修改本 kit 的技能 | Flexible | 技能须写清「何时用 / 何时不用」，防触发漂移 |

## 与 L3 的边界（防越权）

| 事项 | 归属 |
|---|---|
| 任务怎么分阶段、要不要出方案/原型 | L3（`rd-plan`） |
| 验证判据表 `V1…Vn` 的定义与编号 | L3（`rd-plan` 产出，`rd-execute` 勾核） |
| 判据怎么**执行**（测试怎么写、bug 怎么定位） | L2（本层） |
| 代码产出是否克制、是否精准改动 | L1（`L1-karpathy`） |

## 与 L1 的关系

本层所有代码产出受 L1 约束（简洁、精准改动、先想后做）。本层负责「动作做对」，L1 负责「产出克制」。
