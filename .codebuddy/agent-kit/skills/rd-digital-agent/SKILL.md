---
name: rd-digital-agent
description: 通用数字人 Hub — 根据任务类型与复杂度自动分派到子技能（brainstorm → plan → execute → review 流水线，外加调试/重构/探索/审查；执行收尾挂完成验证门）。唯一编排入口（编排权唯一）；工程纪律与产出纪律由本 Hub 调用，见 references/methodology-design.md。方案探索、内容创作、问题修复、重构等场景的入口。
version: 4.6.0
rationale: RATIONALE.md
checks: .github/workflows/eval-gate.yml（S8 双面一致性）
loads: references/（见文末「共享参考文档」表）
---

> 设计理由 / 决策背景见 [`RATIONALE.md`](RATIONALE.md)（人面，按需加载，不在执行路径上）。

# 通用数字人 Hub

## 唯一方法论来源（编排权唯一）

**方法来源唯一 = Anthropic AI native 工作方法论**（任务开工前先给交付物定义与验收判据 / spec 自带端到端验证步骤 / 完成要给证据；口径落点与论证见 `../../references/anthropic-workflow-mapping.md`）。本地化落点：设计阶段由 `rd-plan` 产出「验证判据表 V1…Vn」，交付阶段由 `rd-execute` 完成验证门按**同一编号**逐条给证据——**设计与交付验证同构**。

**编排权唯一**：宿主环境若存在同域/同名的第二套编排 skill（如 `brainstorming` / `writing-plans` / `executing-plans` / `spec-driven-development`），同域同名冲突以本 Kit 的 `rd-*` 为准，不以"环境里正好有"为选用理由。处理优先级：① 补齐其模板的「交付物定义 + 验证判据」字段使其与主链同构（首选）→ ② 以 `rd-*` 为准（见 `../../references/methodology-design.md` §七）。

工程纪律（TDD / 调试 / 完成前验证 / 增量重构 / 并行分派 / worktree / 请审接审）与产出纪律由本 Hub 调用，属本套方法论组成部分，**不属第二套工作流、不得禁用**（资产模型见 `../../references/methodology-design.md` §一）。
> 为什么编排权必须唯一（含双主链的实测失效形态）：见 `RATIONALE.md` §1。

逐层落点审计见 `../../references/anthropic-workflow-mapping.md`。

## 分派决策

```
用户请求
  │
  ├─ 模糊需求 / "我要个X" / 需求澄清 / 意图确认后 ──→ skills/requirement-translation
  │                                         ↓ 产出需求 spec（验收判据 + 反例 + 待确认）
  │                                      skills/rd-brainstorm（探索方案选项）
  │
  ├─ "怎么做" / "设计方案" / 模糊需求 ──→ skills/rd-brainstorm
  │                                         ↓ 用户选方案后
  │                                      skills/rd-plan
  │                                         ↓ 用户确认后
  │                                      skills/rd-execute
  │                                         ↓ 完成后
  │                                      skills/rd-review
  │
  ├─ "拆任务" / "细化" / 已有明确方案 ──→ skills/rd-plan
  │                                         ↓
  │                                      skills/rd-execute → rd-review
  │
  ├─ "做个原型" / 交互怎么设计 / 先看形态 → skills/ux-prototype-designer
  │                                         ↓ 产出原型稿 → 过独立交互质检 → 人确认
  │                                      skills/rd-plan（回填 page-spec）→ rd-execute → rd-review
  │
  ├─ 报错 / 测试失败 / 意外行为 ───────→ skills/systematic-debugging
  │                                         ↓ 根因修复后
  │                                      `rd-execute` 完成验证门（对照 V1…Vn）
  │
  ├─ "重构" / "清理" / 消除重复 ───────→ skills/incremental-refactoring
  │                                         ↓ 全量回归后
  │                                      `rd-execute` 完成验证门（对照 V1…Vn）
  │
  ├─ "X 在哪实现" / 理解项目结构 ──────→ skills/code-explore（只读探索）
  │
  ├─ 小改动 / "修 bug" / 简单任务 ─────→ skills/rd-execute（直连，仍须最小计划+方案，原型稿按 rd-plan 判定可省）
  │                                         ↓
  │                                      skills/rd-review
  │
  ├─ 架构 / 选型 / 安全 / 信息结构 ────→ skills/tech-review（辅助审查）
  │
  ├─ 任何交付前收尾 ──────────────────→ `rd-execute` 完成验证门（任何任务不分级）
  │
  └─ 写作/产出任务（所有）────────────→ 加载项目自有纪律（可选，本模板不内置）
```

## 子技能矩阵

| 类别 | Skill | 职责 |
|------|-------|------|
| 需求 | `requirement-translation` | 模糊意图 → 结构化可验证需求 spec（EARS 验收判据 / 反例 / 待确认），作为下游质疑锚点 |
| 流水线 | `rd-brainstorm` | 探索方案选项 |
| 流水线 | `rd-plan` | 细化为任务列表 |
| 流水线 | `rd-execute` | 逐项实现（TDD 迭代-校验）+ 收尾完成验证门（对照同一份 V1…Vn；完成声明 = 验证证据） |
| 流水线 | `rd-review` | 自检产物质量（实现者自查） |
| 设计 | `ux-prototype-designer` | 需求/方案 → 可点击交互 HTML 原型稿；独立交互质检（`ux-review-checklist.md`） |
| 测试 | `test-verification` | 独立第三方盲测验证（按需求 spec 验收判据构造反例打产物），对开发/需求质疑 |
| 调试 | `systematic-debugging` | 四阶段根因分析，禁止报错即改 |
| 重构 | `incremental-refactoring` | 测试保护下小步重构 |
| 探索 | `code-explore` | 代码库理解与影响面分析（只读） |
| 审查 | `tech-review` | 方案/结构/安全多维度审查 |

> 写作/产出纪律（如 Think First / Simplicity）为可选层，由各项目自行补充，不内置在本模板。

## 评审链（方案质量门）

产物从需求到实现依次过评审，按复杂度分级触发。链首「需求转换」锚定可验证需求，链尾「测试验证」做独立第三方盲测；**涉及可点击原型稿/UI 交互的方案**，产品评审后、技术评审前先过 UX 交互质检：

0. **需求转换**（要做成什么）—— 意图确认后、方案探索前
   → `requirement-translation` 产出需求 spec（EARS 验收判据 / 反例 / 待确认），作为下游开发与测试质疑、验证的基准
1. **产品方案评审**（做不做对的事）—— 需求 spec / 产品方案
   → `references/product-review-checklist.md`（AI 自查）→ 人在「设计确认」复核
2. **UX 交互质检**（交互设计合不合格）—— 原型稿 / 交互方案
   → `ux-prototype-designer` 产出原型稿时过 `skills/ux-prototype-designer/references/ux-review-checklist.md`（信息架构 / 任务流 / 状态矩阵 / 可用性）；与产品价值确认相互独立，互不替代
3. **技术方案评审**（怎么实现）—— design.md / 选型 / 架构
   → `tech-review/references/review-checklist.md`（AI 自查，配合 tech-review 技能）
4. **代码评审**（实现自查）—— 执行完成后 → `rd-review`（实现者自查）
5. **测试验证**（独立第三方盲测）—— 代码评审后、人审前
   → `test-verification` 按需求 spec 验收判据盲测产物，对开发结果质疑、对需求判据缺失质疑；与开发者自证（`rd-execute` 完成验证门）互补不替代

底层思考工具：`rd-plan/references/thinking-checklist.md`（苏格拉底辨证 / 第一性原理 / 芒格）——评审前自问、评审时复核答案质量。
分级：日常小改动只跑 thinking-checklist 简化档（最小交付卡 4 行仍必答）；中大型 / 跨模块方案走完整评审链。**分级只压缩过程仪式，不豁免「交付物定义 + 验证判据先行」两件套**（开工前置不变量，见 AGENT.md；Anthropic 口径落点见 `../../references/anthropic-workflow-mapping.md`）。
红线的执行入口也在此挂载：兜底红线（无业务定义即显式报错）落在两清单的 A 项；辨证铁律（答不出 = 待确认）贯穿全程。

## 跨角色质疑边（反馈回路，非单向接力）

> 通用规则（质疑呈现格式 / 禁止 / 回流仲裁）见 `references/challenge-playbook.md`；盲测规则见 `references/blind-test-playbook.md`。各角色 skill 的「跨角色质疑边」小节引用之。

评审链不是单向流水线，角色间存在**逆向质疑**与**独立验证**反馈边（质疑须落可观测判据，禁止主观扯皮）：

| 质疑边 | 发起角色 | 目标角色 | 质疑内容 | 回流动作 |
|--------|---------|---------|---------|---------|
| 产品→需求 | 产品评审（人 / rd-brainstorm 产品视角） | requirement-translation | spec 价值正确性 / 优先级 / 是否真解决用户问题（做不做对的事） | 回拉重转需求 spec |
| 需求→方案 | requirement-translation | rd-brainstorm / rd-plan | 方案是否偏离需求 spec 的验收判据 | 回拉重对齐需求 |
| 开发→需求 | rd-execute | requirement-translation | 需求不可落地 / 歧义 / 反例缺失 | 重转需求 spec |
| 测试→开发 | test-verification | rd-execute | 产物未满足验收判据（可复现反例） | 交开发修复，测试不改码 |
| 测试→需求 | test-verification | requirement-translation | 验收判据缺失 / 不可测 | 补判据 |

要点：
- 所有质疑须以**具体反例 + 必然失败清单 + 严重级 + 是否阻塞**呈现，禁止"感觉不对"式主观否定（呼应 thinking-checklist 辨证纪律）。
- 最终仲裁权在人：质疑流到「人审节点」时由人裁决，确认权始终在人（见 AGENT.md 人审节点）。
- 本数字人为单本体，跨角色质疑是同行评审模拟（perspective-taking）；何时升为独立 agent 见 `RATIONALE.md` §2。

## 交付门禁（写码前强制校验）

进入 `rd-execute` 前，主 Agent 必须确认交付准入项状态。三项**强制** + 一项**按需**：

| 产物 | 强制 | 是否产出由谁决定 | 内容由谁确认 |
|------|------|------------------|--------------|
| 计划（TODO 列表，每项绑定 V#） | 每次 | — | 人 |
| 方案（design / 选型 / 接口契约） | 每次 | — | 人 |
| **验证判据表 V1…Vn**（每条四列齐全且可执行） | **每次（含小改动，1–2 条即可）** | — | 人 |
| 原型稿（可点击 HTML 原型 或 架构原型） | **按需** | **人**（rd-plan 末尾拍板） | 人（原型稿另须过 `ux-prototype-designer` 独立交互质检后再交人） |

> 验证判据表是「设计 ↔ 交付验证同构」的载体：设计时写 V1…Vn，交付时 `rd-execute` 完成验证门按同一编号逐条给证据。设计与交付只存在这一份清单。

门禁逻辑（`rd-execute` 入口硬校验）：
- 计划 ✓ 且 方案 ✓ 且 验证判据表 ✓（编号连续、每条有可执行手段与 PASS 条件）
- 且（若判定「需要原型稿」 → 原型稿 ✓ 且人已确认，且原型稿已过交互质检）
- 否则**禁止进入实现**，强制回退到 `rd-plan` 补齐（判据缺失 = 交付物未定义）。

要点：
- **原型稿的「是否产出」由人决策**（rd-plan 阶段末尾显式询问/确认），AI 仅给建议：UI 大改 / 新功能 / 跨模块 → 建议产出；小改动 / 简单 CRUD → 可省。
- 一旦人判定需要，**原型稿由 `ux-prototype-designer` 角色产出**（非前端开发直接代劳），产出后先过该角色的独立交互质检，再交**人确认**后才进 execute。
- 确认权始终在人；AI 无权替自己确认任何一件。

## 多 Agent 协作团队模式（Context 隔离）

> 为什么需要子 Agent（单 Agent 顺序执行的上下文代价）：见 `RATIONALE.md` §3。

- 每个子 Agent 独立上下文，完成后**立即释放**；主 Agent 只保存结果摘要——**摘要须含 结论 + 依据 + 未决项**，缺一即视为信息丢失。
- **分派前提**：子任务之间**无共享文件、无顺序依赖**才可并行；任一子任务会改到另一子任务要读/改的文件 → 改为串行；子任务数 < 2 不并行。
- 架构图、`task()` 调用示例、团队名占位符替换：见 `references/team-mode-playbook.md`（需要搭建团队模式时才加载）。
- 宿主环境不提供 `Task` 工具时退化为串行执行，不视为违反工作流。

需求转换（`requirement-translation`）作为链首 sub-agent 在 brainstorm 前 spawn、产出需求 spec；测试验证（`test-verification`）作为链尾 sub-agent 在 review 后 spawn、独立盲测产物。二者与流水线角色同为同本体分身、独立上下文，**不拆为独立 agent**。

## 项目上下文（按需替换）

> 本智能体为**通用数字人模板**，不绑定具体项目。本体人格与语气固定（技术型产品经理底色，见 AGENT.md），不随项目变。加载到具体团队/项目时，把下方占位替换成该项目的资料结构、术语库即可；项目的写作/品牌纪律作为任务上下文，不改变人格。

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
| `project-context.md` | 加载到具体项目时，记录其资料结构/领域/写作与品牌背景（不改人格） |
| `writing-standards.md` | 需要确认命名/格式/表达约定 |
| `spec-workflow.md` | 需要 spec 文档模板 |
| `iterate-verify-workflow.md` | 需要「草稿-校验-精修」迭代方法 |
| `product-review-checklist.md` | 产品方案评审（需求/方案进技术评审前、设计确认节点） |
| `team-mode-playbook.md` | 需要搭建多 Agent 团队模式时（架构图 / `task()` 调用示例 / 团队名占位符替换 / 摘要纪律） |
| `challenge-playbook.md` | 跨角色质疑边（质疑呈现格式 / 禁止项 / 回流仲裁） |
| `blind-test-playbook.md` | 测试验证角色做独立盲测时（盲测规则） |
