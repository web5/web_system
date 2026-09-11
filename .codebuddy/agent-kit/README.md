# ai-agent-kit · 通用数字人智能体模板

一个**可移植、可加载到任意智能体**的「AI 协作工作方法论」仓库。把 AI 当数字同事：人负责关键节点审核与决策，AI 负责产出与执行。

> 本仓库**不含任何技术栈/业务专属规则**（如某团队的术语表、某产品的品牌规范、某部门的审批流程等），只沉淀**通用的 AI 写作/协作方法论** + 工作流型 skills，因此任何团队、任何项目都能直接套用。

## 目录结构

```
ai-agent-kit/
├── AGENT.md                    # 智能体常驻指南（始终加载的操作总则）
├── README.md                   # 本文件
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
│   ├── user-memory/            #   用户偏好与项目上下文记忆
│   └── karpathy-llm-wiki/      #   资产维护型能力：raw/→wiki/ 知识库的建与维护（Ingest/Query/Lint）
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
│   ├── dual-audience-design.md             # 双面读者分层设计（AI 面 / 人面：三层加载 + 归属判据 + 防漂移）
│   ├── code-discipline.md                  # 产出纪律长版（五条纪律的反例 + 判定方式）
│   └── methodology-design.md               # 方法论设计论证（一循环 + 三类资产；人面，不加载）
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
│   ├── check-structure.sh      # 结构检查 S1~S8（本地自检与 CI 的同一份脚本）
│   └── gen-report.sh           # 评测报告骨架生成
└── .github/workflows/
    ├── sync-to-target.yml      # 推送 master 时自动开 PR 到目标仓库
    └── eval-gate.yml           # PR 门禁：结构检查 + 改 kit 必须附评测报告
```

## 资产模型：一个循环 + 三类资产 + 一类能力

一套 AI native 工作方式 = **一个循环**（意图 → 判据 V1…Vn → 执行 → 证据 → 人审 → 复盘）+ **三类正交资产** + **一类可调用能力**：

| 资产 | 来源 | 回答什么 | 载体 |
|---|---|---|---|
| **产出纪律** | Karpathy | 这一笔代码怎么写才不跑偏 | [`AGENT.md`](AGENT.md) §产出纪律 + [`references/code-discipline.md`](references/code-discipline.md) |
| **工程纪律** | Superpowers | 这个工程动作怎么做才对 | `skills/` 内实体（TDD / 调试 / 完成验证门 / 增量重构 / 并行分派 / worktree / 请审接审） |
| **协作主干** | Anthropic | 任务怎么组织、判据怎么定、人在哪审 | `skills/rd-digital-agent` + 12 子技能 + `rules/general/01–05` |
| **资产维护型能力** | Karpathy（llm-wiki） | 一类**持久资产**（知识库 / 记忆）怎么建与维护 | [`skills/karpathy-llm-wiki`](skills/karpathy-llm-wiki/SKILL.md)（`raw/`→`wiki/` 知识库）、`skills/user-memory` |

结构：`协作主干（阶段 / 判据 V1…Vn / 人审）→ 命中工程纪律 → 所有代码产出受产出纪律约束`。判据的定义归主干、执行归工程纪律、可验证性归产出纪律，三者分工不重叠。

第四项与前三个**正交**：它是**能力**（被触发时执行自己的流程、维护持久资产），不是**纪律**（不约束别人的产出）。它自己不产出判据，但其产物仍受产出纪律约束。

**唯一的是编排权**：`rd-*` 是唯一编排入口；工程纪律与产出纪律属本套方法论的组成部分，不得禁用。宿主环境若存在第二套编排技能，首选解法是**补齐其模板的「交付物定义 + 验证判据」字段使其与主链同构**，其次同域同名以 `rd-*` 为准。

> 设计论证、来源映射、旧→新映射与分期：[`references/methodology-design.md`](references/methodology-design.md)（人面，不进 AI 常驻层）。

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
| 红线机器化（`eval-gate` S1–S8） | 文本约定会退化。改 kit 的 PR 由 CI 强制：判据表 / 完成验证门 / 唯一方法论声明三处条文任一被删除即失败，防止验证链被悄悄摘除 |
| 人审固定三处，不随意增减 | 过多人不堪重负、过少则失控；顺序固定 逻辑 → 合规/红线 → 对照 spec，防止合规问题被逻辑讨论掩盖 |
| 定义资产分 AI 面与人面，不追求统一写法 | 两类读者失败模式不对称：给 AI 加解释会占常驻上下文并稀释指令，给人只留条款则无人维护。唯一双面同源的内容是判据（V1…Vn），其余按加载层分离 |
| 红线必须写出判定命令，写不出即未定义清楚 | 「靠自觉的红线不算红线」的文本约定会退化（人读一次、不会读第二次）；写不出判定命令，说明该条要么拆细、要么只是偏好而非红线 |
| 唯一性限定为「编排权」 | 冲突面只在「谁能决定任务怎么分阶段」；解法：补齐判据字段使其与主链同构（首选）→ 同域同名以 `rd-*` 为准。编排只有一个入口、判据只有一份 |
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

> 脚注：宿主环境若存在第二套「计划 → 执行」类工作流模板，风险是其计划产物不含「交付物定义 + 验证判据先行」，走它会绕过验证链（实测表现为"执行过程中设计时看不到交付验证"）。解法优先级：① 补齐其模板的判据字段使其与主链同构（首选）→ ② 同域同名冲突以 `rd-*` 为准。详见 `references/methodology-design.md` §七。

逐层落点审计（每条主张对应到文件与行、含已知缺口）见 [`references/anthropic-workflow-mapping.md`](references/anthropic-workflow-mapping.md)。

> 外部引用：Anthropic · *Best practices for Claude Code* — <https://www.anthropic.com/engineering/claude-code-best-practices>

## 怎么用

### 1. 作为智能体知识库加载
将本仓库根目录整体作为智能体的知识源加载：
- `AGENT.md` → 系统提示 / 项目入口
- `skills/*/SKILL.md` → 各技能（入口 = `rd-digital-agent`，其余由它分派）；同目录 `RATIONALE.md` 是人面文档，**不加载**
- `references/code-discipline.md` → 产出纪律长版（反例与判定方式，按需）
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

- **结构检查 S1–S8**（本地与 CI 同一份脚本：`bash scripts/check-structure.sh`）：必需文件齐全、无孤儿 skill、技能目录的**资产类型受控**（只允许 `references` / `scripts` / `examples` 三种子目录）、frontmatter `name` 与目录名一致、无占位符残留、路由目标存在、红线有执行手段；并强制 `rd-plan` 的**验证判据表**、`rd-execute` 的**完成验证门**、`AGENT.md` 的**唯一方法论来源声明**三处条文存在——任一被删除即 CI 失败（防止验证链被悄悄摘除）。
  - **S8 双面一致性**（规范见 `references/dual-audience-design.md`）：S8-1 `SKILL.md` 行数上限**按 frontmatter `kind` 取**（`discipline` 缺省 ≤150；`hub` / `capability` ≤260）+ `version` 字段 + `kind` 取值合法；S8-2 `RATIONALE.md` 的 `reviewed-at-version` 必须等于 `SKILL.md` 的 `version`（防人面与 AI 面漂移，确不影响可标 `stale: true`）；S8-3 每条红线必须含「判定手段」节；S8-4 `SKILL.md` 出现外部口径引用须指向外置文件（论证属人面，不得占常驻上下文）。
- **评测报告门禁**：改动 `AGENT.md` / `skills/` / `rules/` / `references/` 必须附评测报告（`evals/reports/`）；若改动不影响智能体行为（纯排版、错别字、纯新增文档），在 **PR 描述**加 `skip-eval` 标签并在 **commit message** 说明理由。

## 同步到其他仓库（可选）

可将本仓库推送到 `master` 时，自动把 `skills/`、`rules/`、`references/`、`AGENT.md` 拷贝到目标仓库的 `.codebuddy/agent-kit/` 并开 PR（幂等，无变更则跳过）。**支持一次同步到多个目标仓库**；单个目标失败不阻塞其余目标。

> 同步是**逐文件写入 + 保护清单**（不是整目录覆盖）：下游定制的 `skills/rd-digital-agent/references/project-context.md`、自建的 `rules/<domain>/**`、`*.local.md` 永不覆盖、永不删除。详见 `docs/design/kit-contract-design.md` §7.2。

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

评测体系见 `references/eval-framework.md`（定稿）：五层过滤 **L1 结构 → L2 路由 → L3 行为 → L4 端到端 → L5 实战**（评测层）+ 统一五维 Rubric 评分内核；能力里程碑用**成熟度 M0–M5**（判据见 `evals/README.md` §成熟度分级）。两套编号分列，不再混用。

按成熟度标尺自评：

- ✅ **M1 有指南层**：`AGENT.md` 常驻加载（资产分层 + 开工前置 + 产出纪律 + 工程纪律）
- ✅ **M2 有 SOP + 产物链**：14 个技能（Hub + 12 子技能 + 1 项资产维护型能力）就位、产物链落盘；⚠️ 落盘率的机器口径待修（见待办②），该级判据目前不可靠测量
- ✅ **M3 红线机器化**：5 条红线**每条均含判定手段**，结构检查 S1–S8 进 CI；4 个核心技能已外置人面 `RATIONALE.md`
- ⚠️ **M4 回归评测闭环**：机制齐备（评测 L2 路由 28 条、L3 陷阱 7 条、L4 任务卡 6 张 + 五维 RUBRIC + 报告门禁），但**当前基线为空 → 闭环断点**
- ❌ **M5 实战验证**：未采集（需真实项目人审打回率 / 红线拦截次数 / 复盘回灌）
- ✅ 运行手册就绪：日常评测（`evals/README.md`）+ 干净基线（`evals/run-baseline.md`，judge 隔离防自评污染）
- ✅ **基线已重置**（2026-09-10，资产模型再设计触发换基线）：旧基线 `evals/reports/6373b99-2026-09-10.md`（通过率 6/6，均分 13.2）仅在旧定义下有效；新定义与采集状态见 `evals/reports/baseline-reset-2026-09-10.md`
- ❌ 待办：① 补新基线（恢复 M4 闭环）② 修任务卡产物命名不一致（机器落盘率失真至 14%，导致 M2 判据不可测）③ 固定被测模型/温度、每任务 ≥2 次重跑、人工复检 ≥20% ④ M5 需积累真实项目数据 ⑤ 红线示例需按项目实例化

## 与你的主项目的关系

本模板从某个具体项目抽象而来：保留 workflow 型 skills 与资产分层结构，剔除工程/业务专属规则，使数字人能力可被任意项目复用。同步机制把本仓库的演进持续回流到目标项目的 `.codebuddy/agent-kit/`，互不覆盖。

## 版本演进

| 版本 | 日期 | 变更要点 |
|---|---|---|
| v1.8 | 2026-09-11 | **纳入 Karpathy 第三件 `karpathy-llm-wiki`**：资产模型补第四项「资产维护型能力」（与三类资产正交，承载持久知识资产的 schema 与流程）；技能类型改由 frontmatter `kind` 显式声明，S8-1 据此取行数上限（取代按目录名硬编码）；S2 增技能资产类型校验；确立「技能可带可执行脚本」；`references/code-discipline.md` 补「适用边界」（来源 `karpathy-coding-rules-dami`）；`sync-to-target.sh` 去 `rm -rf`，改逐文件同步 + 保护清单 |
| v1.7 | 2026-09-10 | **再设计为「一循环 + 三类资产」**：废除 `L1/L2/L3` 编号与 `kits/` 三个常驻 kit——产出纪律常驻 `AGENT.md`、工程纪律并入既有技能、来源论证降为人面（`references/methodology-design.md`）；设计论证不再出现在常驻层 |
| v1.6 | 2026-09-10 | **移除「整体卸载」应急手段**：删除 `scripts/uninstall-superpowers.sh` 及回滚脚本，第二套编排技能的处理优先级收敛为 补齐判据字段 → 同域同名以 `rd-*` 为准 |
| v1.5 | 2026-09-10 | **方法论融合为一套**：新增 `kits/`，一套方法论由三部分组成——L1 Karpathy 行为准则 / L2 Superpowers 执行手段库 / L3 Anthropic 协作主干（一条主干 + 两层纪律）；唯一性限定为「编排权」，第二套编排技能优先「补齐判据字段对齐」而非整体卸载；风险与解法见 `references/methodology-design.md`（该版结构已由 v1.7 取代） |
| v1.4 | 2026-09-10 | **双面分层（AI 面 / 人面）**：定义资产分离 AI 常驻面与人面（`RATIONALE.md` 外置按需加载），红线五条补齐「判定手段」节，`eval-gate` 新增 S8 一致性检查；规范见 `references/dual-audience-design.md` |
| v1.3 | 2026-09-10 | **设计与交付验证同构**：验证判据表 V1…Vn 成为 spec / 计划的收尾章节，交付时按同一编号勾核；删除独立 `verification-before-completion` 技能、职责收编进 `rd-execute`；新增唯一方法论来源声明；`eval-gate` 新增 S7 机器检查 |
| v1.2 | 2026-09-04 | 六处逃逸口统一挂「分级不压缩交付物 + 验证判据」不变量；非代码任务的判据先行最小形态（验收核点节）固化 |
| v1.1 | 2026-09-04 | 数字人画像口径同步；数字人产品评测换基线判定 |
| v1.0 | 2026-09 上旬 | 简化档升级为「最小交付卡」（4 行必答 + 类型化验证判据） |

> 各版本的逐层落点与待同步点闭合状态见 `references/anthropic-workflow-mapping.md` §六。
