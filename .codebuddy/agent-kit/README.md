# ai-agent-kit · 通用数字人智能体模板

一个**可移植、可加载到任意智能体**的「AI 协作工作方法论」仓库。把 AI 当数字同事：人负责关键节点审核与决策，AI 负责产出与执行。

> 本仓库**不含任何技术栈/业务专属规则**（如某团队的术语表、某产品的品牌规范、某部门的审批流程等），只沉淀**通用的 AI 写作/协作方法论** + 工作流型 skills，因此任何团队、任何项目都能直接套用。

## 目录结构

```
ai-agent-kit/
├── AGENT.md                    # 智能体常驻指南（始终加载的操作总则）
├── README.md                   # 本文件
├── kits/                       # 一套方法论的三个组成部分
│   ├── README.md               #   组成索引、单独加载、加载方式
│   ├── L1-karpathy/            #   行为准则：单次代码产出的纪律（简洁/精准/可验证）
│   ├── L2-superpowers/         #   执行手段库：TDD/调试/验证/并行分派等工程纪律
│   └── L3-anthropic/           #   协作主干：编排入口（实体在 skills/rd-digital-agent）
├── skills/                     # 工作流引擎（数字人的「怎么干」）
│   ├── rd-digital-agent/       #   Hub：唯一入口，按复杂度分派到下列子技能
│   ├── requirement-translation/ #  链首：模糊意图→可验证需求 spec（验收判据/反例/待确认）
│   ├── rd-brainstorm/          #   探索方案选项
│   ├── rd-plan/                #   细化为任务列表 + 必出「验证判据表 V1…Vn」
│   ├── rd-execute/             #   逐项实现（TDD）+ 收尾完成验证门（完成声明 = 验证证据）
│   ├── rd-review/              #   实现者自查产物质量（含 V# 编号同构核对）
│   ├── test-verification/      #   测试验证（独立第三方盲测，对开发/需求质疑）
│   ├── ux-prototype-designer/  #   UX 原型交互设计师（需求→可点击交互 HTML 原型稿 + 独立交互质检）
│   ├── tech-review/            #   方案/结构/数据/安全审查
│   ├── systematic-debugging/   #   系统化调试（四阶段根因分析）
│   ├── incremental-refactoring/  # 测试保护下的增量重构
│   ├── code-explore/           #   代码库探索（索引优先/影响面分析）
│   └── user-memory/            #   用户偏好与项目上下文记忆
├── rules/
│   └── general/                # 通用红线规则（5 条，方法论级）
│       ├── 01-loop-workflow.md
│       ├── 02-human-in-loop.md
│       ├── 03-versioned-artifacts.md
│       ├── 04-subagent-isolation.md
│       ├── 05-red-line-check.md
│       └── RATIONALE.md            #   五条红线的设计理由（人面，AI 不加载）
├── references/
│   ├── ai-methodology.md                   # 完整方法论（8 节，可当 PPT 大纲）
│   ├── eval-framework.md                   # 评测体系定稿（五层过滤 + 五维 rubric）
│   ├── agent-definition-methodology.md     # 智能体定义方法论（元层：如何快速定义一个新智能体，七维框架 + 统一辨证语言）
│   ├── agent-definition-template.md        # 智能体定义模板（七维填空 + 评测捆绑 + 数字人实填样例）
│   ├── digital-agent-profile.md            # 数字人画像（第 1 号实例：七维 + 底层思维 + 技能集 + 行为约束）
│   ├── anthropic-workflow-mapping.md       # Anthropic 工作方法论落点映射（每任务：交付物 + 验证判据先行）
│   ├── fe-dev-common.md                    # 前端开发通用技能与规则（业界通用能力包）
│   ├── be-dev-common.md                    # 后端开发通用技能与规则（业界通用能力包）
│   └── dual-audience-design.md             # 双面读者分层设计（AI 面 / 人面：三层加载 + 归属判据 + 防漂移）
├── docs/
│   └── development.md          #   开发与提交环境（贡献者：工具链 / 凭证 / 本地自检）
├── digital-agent-eval/         # 数字人技术产品型评测（定义维验收，独立于 evals/）
├── evals/                      # 回归评测体系（评估 kit 自身进化程度）
│   ├── README.md               # 运行手册（怎么跑）
│   ├── run-baseline.md         # 基线运行手册（干净上下文 + judge 隔离）
│   ├── cases/                  # L1 结构清单 + L2 路由用例 + L3 陷阱用例
│   ├── golden-tasks/           # L4 端到端任务卡 T1~T6 + 五维 RUBRIC
│   └── reports/                # 评测报告落盘（含模板）
├── scripts/
│   ├── sync-to-target.sh       # 同步到其他仓库的脚本（目标可配置）
│   ├── run-eval.sh             # 测评编排（AGENT_CMD 参数化，需被测 agent 无头调用）
│   ├── check-artifacts.sh      # 产物落盘核对（D1 机器可判定）
│   ├── check-structure.sh      # 结构检查 S1~S9（本地自检与 CI 的同一份脚本）
│   ├── gen-report.sh           # 评测报告骨架生成
│   ├── uninstall-superpowers.sh #  卸载全局 Superpowers 工作流 skill（可回滚）
│   └── restore-superpowers.sh   #  卸载回滚（按备份清单恢复 symlink）
└── .github/workflows/
    ├── sync-to-target.yml      # 推送 master 时自动开 PR 到目标仓库
    └── eval-gate.yml           # PR 门禁：结构检查 + 改 kit 必须附评测报告
```

## 方法论的三个组成部分（一条主干 + 两层纪律）

AI native 最佳实践持续演进（Karpathy 行为纪律 → Superpowers 工程技能集 → Anthropic AI Native 协作方法论）。三者不是三选一，而是**一套方法论的三个组成部分**：

| 组成 | 来源 | 回答的问题 | 实体 |
|---|---|---|---|
| `L1-karpathy` 行为准则 | Karpathy | 这一次代码产出怎么写才不跑偏 | `kits/L1-karpathy/` |
| `L2-superpowers` 执行手段库 | Superpowers | 这个工程动作怎么做得不偷懒 | `kits/L2-superpowers/` |
| `L3-anthropic` 协作主干 | Anthropic | 整个任务怎么和人协作交付 | `skills/rd-digital-agent`（本仓库主体） |

结构：`L3 协作主干（阶段 / 判据 V1…Vn / 人审）→ 调用 L2 执行手段库 → 所有代码产出受 L1 行为准则约束`。判据的定义归主干、执行归手段库、可验证性归行为准则，三者分工不重叠。

**唯一的是编排权**：`rd-*` 是唯一编排入口；L1/L2 属本套方法论的组成部分，不得禁用。宿主环境若存在第二套编排技能，首选解法是**补齐其模板的「交付物定义 + 验证判据」字段使其与主链同构**，而非整体卸载（风险与解法见设计文档 §三）。

- 组成索引与单独加载：[`kits/README.md`](kits/README.md)
- 设计论证、来源映射、风险与消解：[`references/three-kits-architecture.md`](references/three-kits-architecture.md)

## 核心方法论（每条主张 + 依据 + 落点）

**依据口径**：标注 `Anthropic` 的条目来自 *Best practices for Claude Code*（原句见「方法来源」节）；标注 `本地推导` 的是本团队从实践中收敛的纪律，不是 Anthropic 原文主张——分开标注，避免把推断当引用。

| 主张 | 依据 | 落点 |
|---|---|---|
| **瓶颈定位**：瓶颈在流程设计，而非单点执行速度 | 本地推导：单点加速不改变返工率，返工来自需求与验证口径不清 | `references/ai-methodology.md` §一 |
| **三层规则**：指南 → 技能/SOP → 红线机器化 | 本地推导：文本约定会被绕过，须降层为机器检查才稳定 | `rules/general/05-red-line-check.md` |
| **循环 Loop**：每个阶段落盘版本化产物，下一阶段以产物为输入 | Anthropic：Explore → Plan → Code → Commit 的工作流建议；落盘纪律为本地叠加 | `rules/general/01-loop-workflow.md` |
| **版本化产物链**：intent → spec → 执行 → 带审查记录的交付 → 复盘 | 本地推导（Anthropic 建议把 plan 写入文件、把约定沉淀进项目记忆） | `rules/general/03-versioned-artifacts.md` |
| **上下文工程**：上下文是有限资源——即时加载、定期压缩、结论落盘；复杂任务拆独立上下文，主线程只留摘要 | Anthropic：上下文管理与压缩、用 subagent 隔离上下文的要点 | `rules/general/04-subagent-isolation.md` |
| **人审节点**：意图 / 设计 / 交付前三处把关，顺序固定 逻辑 → 合规/红线 → 对照 spec | 本地推导（叠加 Anthropic「尽早纠偏」：人应在计划阶段而非收尾阶段介入） | `rules/general/02-human-in-loop.md` |
| **验证优先**：完成声明 = 验证证据，禁止「应该没问题」 | Anthropic："Have Claude show evidence rather than asserting success" / "If you can't verify it, don't ship it" | `skills/rd-execute/SKILL.md` §完成验证门 |
| **开工前置（不分级）**：任何任务动手前先定交付物定义与验证判据 | Anthropic：任务开工前讲清交付物与验收判据，给 agent 一个"能跑的检查" | `AGENT.md`「开工前置」+ `skills/rd-plan/references/thinking-checklist.md` 最小交付卡 |
| **设计与交付验证同构**：判据落盘为编号的「验证判据表 V1…Vn」，设计时写在 spec 收尾，交付时按同一编号逐条给证据 | Anthropic："The most useful specs are self-contained: … finish with an end-to-end verification step" | `skills/rd-plan/SKILL.md` §验证判据表；`skills/rd-execute/SKILL.md` §完成验证门 |
| **双面分层（AI 面 / 人面）**：定义资产分两层——AI 面是可执行指令（常驻、有体积上限），人面是设计理由 / 决策背景（外置 `RATIONALE.md`，按需加载）；只有判据类内容双面同源同编号 | 本地推导：两类读者失败模式不对称（人读不懂=不敢改，AI 读不懂=静默偏离；冗余对 AI 是 token 成本），统一内容必然双输 | `references/dual-audience-design.md`；`skills/*/RATIONALE.md`；`rules/general/RATIONALE.md` |

## 关键决策与理由（为什么这么定）

| 决策 | 理由 |
|---|---|
| 验证判据必须编号落盘为 V1…Vn，不能只口头回读 | 原形态（对话里的两件套）实测失效：判据不落盘时，设计侧与交付侧会各说一份清单；宿主项目的计划模板里甚至没有判据字段 → 表现为"执行过程中设计时看不到交付验证"。编号使「设计 ↔ 交付」同构变成可机器核对的事 |
| 删除独立的 `verification-before-completion` 技能，职责收编进 `rd-execute` | ① 与宿主环境同名的另一套 skill 冲突，加载哪份不确定；② 完成验证是执行环节的收尾动作，独立成技能反而可被跳过。收编后成为必经步骤，且对照同一份 V# |
| 主链唯一 = `rd-*`（编排权唯一） | 双编排入口 = 两个真相源。宿主项目实测：入口改走另一套工作流后，plan 产物的模板无交付物定义与判据字段，验证链被整体架空 |
| 交付准入项含判据表，缺失即禁止进入实现 | "边写边补判据"等于用结果倒推标准；只有判据先行，它才有资格当 stop condition |
| 红线机器化（`eval-gate` S1–S7） | 文本约定会退化。改 kit 的 PR 由 CI 强制：判据表 / 完成验证门 / 唯一方法论声明三处条文任一被删除即失败，防止验证链被悄悄摘除 |
| 人审固定三处，不随意增减 | 过多人不堪重负、过少则失控；顺序固定 逻辑 → 合规/红线 → 对照 spec，防止合规问题被逻辑讨论掩盖 |
| 定义资产分 AI 面与人面，不追求统一写法 | 两类读者失败模式不对称：给 AI 加解释会占常驻上下文并稀释指令，给人只留条款则无人维护。唯一双面同源的内容是判据（V1…Vn），其余按加载层分离 |
| 红线必须写出判定命令，写不出即未定义清楚 | 「靠自觉的红线不算红线」的文本约定会退化（人读一次、不会读第二次）；写不出判定命令，说明该条要么拆细、要么只是偏好而非红线 |
| 唯一性限定为「编排权」，第二套技能优先对齐而非卸载 | 冲突面只在「谁能决定任务怎么分阶段」；历史上为排除 4 个编排类技能而整体卸载 20 个，连 TDD/验证/并行分派一起丢掉。现行优先级：补齐判据字段使其与主链同构 → 同域同名以 `rd-*` 为准 → 整体卸载（最后手段）；编排仍只有一个入口、判据仍只有一份 |
| L2 中被 L3 已收编的技能只写指针不重写 | 同一纪律两个真相源会导致改一处漏一处（本 kit 反复防的退化形态） |

## 方法来源 · Anthropic 工作方法论引用

本 kit 的「AI 协作工作方法论」吸收了 Anthropic 团队对 agentic coding 的建议（*Best practices for Claude Code*）：**给 agent 的每个任务，在开始前就要讲清交付物长什么样、验收/测试怎么跑**——让验证判据成为 agent 决定「何时算完成」的依据（"Give Claude a way to verify its work" / "If you can't verify it, don't ship it"）。

上表标 `Anthropic` 的条目，其原句在本节逐条列出；标 `本地推导` 的条目无外部原句，属本团队纪律——两者不混标。

本地实现把它翻译成自己的语言并落到每一层：

| Anthropic 说法 | 本 kit 语言 | 落点 |
|---|---|---|
| 每个任务开工前明确交付物与验收判据 | 做成定义 + 交付物清单 + 验证判据（**开工前置 · 不分级**） | `AGENT.md`「开工前置」；`skills/rd-plan/references/thinking-checklist.md` 简化档 · 最小交付卡 |
| 测试用例写进任务再动手 | TDD RED（先写失败测试）→ GREEN | `skills/rd-execute/SKILL.md` |
| 展示证据而非口头宣称成功 | 完成声明 = 验证证据（按同一份 V1…Vn 逐条给证据） | `skills/rd-execute/SKILL.md` §完成验证门 |
| spec 以端到端验证步骤收尾 | **验证判据表 V1…Vn** 作为 spec / 计划的收尾章节 + EARS 验收标准入 `requirements.md`；评测任务卡 = 固定输入 + 期望产物 + 评分点 | `skills/rd-plan/SKILL.md` §验证判据表；`digital-agent-eval/golden-tasks/` |

**唯一方法论来源**：本 kit 的工作方式只有上表这一套——`rd-*` 流水线 + 验证判据表 V1…Vn + 完成验证门。宿主环境若同时存在同域或同名的其它工作流 skill，一律以本 kit 的 `rd-*` 为准，不以"环境里正好有"为选用理由。

> 脚注：宿主环境若存在第二套「计划 → 执行」类工作流模板，风险是其计划产物不含「交付物定义 + 验证判据先行」，走它会绕过验证链（实测表现为"执行过程中设计时看不到交付验证"）。解法优先级：① 补齐其模板的判据字段使其与主链同构（首选）→ ② 同域同名冲突以 `rd-*` 为准 → ③ 确需清理宿主环境时用 `scripts/uninstall-superpowers.sh`（幂等，可用 `scripts/restore-superpowers.sh` 回滚），代价是工程纪律一并丢失，故为最后手段。详见 `references/three-kits-architecture.md` §三 R1。

逐层落点审计（每条主张对应到文件与行、含已知缺口）见 [`references/anthropic-workflow-mapping.md`](references/anthropic-workflow-mapping.md)。

> 外部引用：Anthropic · *Best practices for Claude Code* — <https://www.anthropic.com/engineering/claude-code-best-practices>

## 怎么用

### 1. 作为智能体知识库加载
将本仓库根目录整体作为智能体的知识源加载：
- `AGENT.md` → 系统提示 / 项目入口
- `kits/L{1,2,3}-*/SKILL.md` → 三个组成部分入口（L1 行为准则 / L2 执行手段库索引 / L3 主干指针）；同目录 `RATIONALE.md` 是人面文档，**不加载**
- `skills/*/SKILL.md` → 各技能（入口 = `rd-digital-agent`，其余由它分派）；同目录 `RATIONALE.md` 是人面文档，**不加载**
- `rules/general/NN-*.md` → 红线规则（约束 + 判定手段）；同目录 `RATIONALE.md` 是人面文档，**不加载**
- `references/ai-methodology.md` → 完整参考（可当内部分享大纲）
- `references/anthropic-workflow-mapping.md` → 每条方法论主张的逐层落点与缺口审计，改 kit 前先看这里

### 2. 套用到具体项目
- 编辑 `skills/rd-digital-agent/SKILL.md` 里的「项目上下文」占位，换成你的团队领域、术语规范与写作/品牌风格等上下文（人格与语气由本体固定，见 AGENT.md）。
- 如需领域专属红线（如术语规范/引用标准/写作风格），在 `rules/` 下新增对应子目录，不影响通用层。

### 3. 分享给团队
`references/ai-methodology.md` 已是成稿的方法论分享材料，可直接当内部分享 PPT 大纲或 WIKI 首页。

### 4. 每个任务的标准动作（V1…Vn 贯穿设计与交付）

任何任务（含小改动）都走这条线——判据全程只有一份清单：

1. **动手前**：`rd-plan` 产出「验证判据表 V1…Vn」+ TODO（每项绑定 V#），回读用户确认。判据缺失不允许进 `rd-execute`。
2. **实现中**：`rd-execute` 按任务 TDD 实现；判据不允许实现完再倒补。
3. **交付前**：`rd-execute` 完成验证门按**同一编号**逐条实跑给证据 → `rd-review` 核对 V# 编号无遗漏、无漂移。

验证判据表模板（缺任一一列 = 判据未定义）：

| 编号 | 判据（做成 = 一句话可验证） | 验证手段（可跑的命令 / 测试名） | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V1 | <行为成立的表述> | `npm test -- <file>` | N/N 通过 | 明确告知用户，不静默降级 |
| V2 | <行为成立的表述> | `curl localhost:6000/__manifest__` | 返回 `version=$V` | 同上 |

> 伪判据（"看着对" / "改完看效果" / "review 一下"）一律退回重写。
> 非代码任务取类型化形态：文档 = 验收核点节；探索 = 收敛判据 + 质量评分点（见 `skills/rd-plan/references/thinking-checklist.md`）。
> 完整定义：`skills/rd-plan/SKILL.md` §验证判据表；完成侧：`skills/rd-execute/SKILL.md` §完成验证门。

## 评测与基线（怎么证明 kit 真的变好了）

评测体系证明每次变更后，加载 kit 的 Agent 行为真的变好了（而非「看起来变好」）。想跑测试，直接从这里进：

| 你要做什么 | 去哪 |
|-----------|------|
| **跑基线 / 执行测试**（含脚本化三步 + AGENT_CMD 规范） | [`evals/run-baseline.md`](evals/run-baseline.md) |
| 日常评测运行手册（六步 + 成熟度标尺） | [`evals/README.md`](evals/README.md) |
| 评测体系定稿（五层过滤 + 五维 rubric） | [`references/eval-framework.md`](references/eval-framework.md) |

被测 agent 就绪后的最快路径：打开 `evals/run-baseline.md`「脚本化执行」→ 填 `AGENT_CMD` → `bash scripts/run-eval.sh`。

## 改动 kit 的门禁（贡献者必读）

`.github/workflows/eval-gate.yml` 在 PR 时做两层检查（工具链 / 凭证 / 本地自检见 [`docs/development.md`](docs/development.md)）：

- **结构检查 S1–S9**（本地与 CI 同一份脚本：`bash scripts/check-structure.sh`）：必需文件齐全、无孤儿 skill、frontmatter `name` 与目录名一致、无占位符残留、路由目标存在、红线有执行手段；并强制 `rd-plan` 的**验证判据表**、`rd-execute` 的**完成验证门**、`AGENT.md` 的**唯一方法论来源声明**三处条文存在——任一被删除即 CI 失败（防止验证链被悄悄摘除）。
  - **S8 双面一致性**（规范见 `references/dual-audience-design.md`）：S8-1 `SKILL.md` 行数上限（普通 ≤150 / Hub ≤260）+ `version` 字段；S8-2 `RATIONALE.md` 的 `reviewed-at-version` 必须等于 `SKILL.md` 的 `version`（防人面与 AI 面漂移，确不影响可标 `stale: true`）；S8-3 每条红线必须含「判定手段」节；S8-4 `SKILL.md` 出现外部口径引用须指向外置文件（论证属人面，不得占常驻上下文）。
- **评测报告门禁**：改动 `AGENT.md` / `skills/` / `rules/` / `references/` 必须附评测报告（`evals/reports/`）；若改动不影响智能体行为（纯排版、错别字、纯新增文档），在 **PR 描述**加 `skip-eval` 标签并在 **commit message** 说明理由。

## 同步到其他仓库（可选）

可将本仓库推送到 `master` 时，自动把 `skills/`、`rules/`、`references/`、`kits/`、`AGENT.md` 拷贝到目标仓库的 `.codebuddy/agent-kit/` 并开 PR（幂等，无变更则跳过）。**支持一次同步到多个目标仓库**；单个目标失败不阻塞其余目标。

> 同步分支 `sync/agent-kit` 由脚本独占：每轮都从目标仓库基线重建（与远端同名分支构成「兄弟提交」而非快进），因此重跑时以 `git push --force` 覆盖。**不要在该分支上放手工提交，会被覆盖。**

前置条件（在 ai-agent-kit 仓库的 Settings → Secrets/Variables 配置）：
- **Secret** `SYNC_TOKEN`：对各目标仓库有 write 权限的 PAT。
- **Variable** `TARGET_REPOS`（可选）：逗号分隔的多个目标，如 `web5/web_system,web5/other`；单项可写 `owner/repo#分支` 单独指定基线分支。未设置时回退到旧的单目标 `TARGET_REPO`，再回退到默认值。
- **Variable** `TARGET_BASE`（可选，默认 `master`）：未用 `#分支` 指定时的基线分支。

也可本地手动触发（环境与凭证见 `docs/development.md` §6）：

```bash
SYNC_TOKEN=xxx TARGET_REPOS="owner/repo-a,owner/repo-b#main" bash scripts/sync-to-target.sh
```

> 默认目标即本模板的源项目（web_system），可按需改为任意仓库。

## 成熟度自评（任何团队可对照）

评测体系见 `references/eval-framework.md`（定稿）：五层过滤 L1 结构 → L2 路由 → L3 行为 → L4 端到端 → L5 实战 + 统一五维 Rubric 评分内核。

按融合后的 L1~L5 标尺自评：

- ✅ L1 结构完整：三层结构、13 个 skills、5 条红线（**每条均含判定手段**）、CI 结构检查（`eval-gate.yml` S1–S8）就绪；4 个核心 skill 已外置人面 `RATIONALE.md`
- ✅ L2/L3/L4 用例集已落盘：路由用例 21 条（`evals/cases/routing.md`）、陷阱用例 6 条（`evals/cases/behavior.md`）、端到端任务卡 6 张 + 五维 RUBRIC（`evals/golden-tasks/`）
- ✅ 运行手册就绪：日常评测（`evals/README.md`）+ 干净基线（`evals/run-baseline.md`，judge 隔离防自评污染）
- ✅ **首份基线已产出**：`evals/reports/6373b99-2026-09-10.md`（通过率 6/6，均分 13.2；judge 与被测分属独立会话）
- ❌ 待办：① 人工复检 ≥20%（本轮 0%，未达手册要求）② 修任务卡产物命名与技能实际命名不一致（基线最大发现，导致机器落盘率失真至 14%）③ 固定被测模型/温度、每任务 ≥2 次重跑（本轮 1 次，D3/D5 受无人值守限制偏低）④ L5 实战验证需积累真实人审打回率数据 ⑤ 红线示例需按项目实例化

## 与你的主项目的关系

本模板从某个具体项目抽象而来：保留 workflow 型 skills 与三层结构，剔除工程/业务专属规则，使数字人能力可被任意项目复用。同步机制把本仓库的演进持续回流到目标项目的 `.codebuddy/agent-kit/`，互不覆盖。

## 版本演进

| 版本 | 日期 | 变更要点 |
|---|---|---|
| v1.5 | 2026-09-10 | **方法论融合为一套**：新增 `kits/`，一套方法论由三部分组成——L1 Karpathy 行为准则 / L2 Superpowers 执行手段库 / L3 Anthropic 协作主干（一条主干 + 两层纪律）；唯一性限定为「编排权」，第二套编排技能优先「补齐判据字段对齐」而非整体卸载；风险与解法见 `references/three-kits-architecture.md` §三 |
| v1.4 | 2026-09-10 | **双面分层（AI 面 / 人面）**：定义资产分离 AI 常驻面与人面（`RATIONALE.md` 外置按需加载），红线五条补齐「判定手段」节，`eval-gate` 新增 S8 一致性检查；规范见 `references/dual-audience-design.md` |
| v1.3 | 2026-09-10 | **设计与交付验证同构**：验证判据表 V1…Vn 成为 spec / 计划的收尾章节，交付时按同一编号勾核；删除独立 `verification-before-completion` 技能、职责收编进 `rd-execute`；新增唯一方法论来源声明；`eval-gate` 新增 S7 机器检查 |
| v1.2 | 2026-09-04 | 六处逃逸口统一挂「分级不压缩交付物 + 验证判据」不变量；非代码任务的判据先行最小形态（验收核点节）固化 |
| v1.1 | 2026-09-04 | 数字人画像口径同步；数字人产品评测换基线判定 |
| v1.0 | 2026-09 上旬 | 简化档升级为「最小交付卡」（4 行必答 + 类型化验证判据） |

> 各版本的逐层落点与待同步点闭合状态见 `references/anthropic-workflow-mapping.md` §六。
