---
kind: reference
audience: human
loads: on-demand
version: 2.1.0
source: 本 kit 自演进（第 0 号实例 · 数字人）
---

# 方法论设计 · 一循环 + 三类资产（人面）

> 本文是**唯一的设计论证**：取代 `three-kits-architecture.md`（随 `kits/` 删除）。改 kit 前读本文。
> AI 面入口是 `AGENT.md`（常驻）与 `skills/*/SKILL.md`（命中加载）——**本文不加载**，任何「三部分组成关系」的复述只允许出现在这里。

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-11 | v2.1 | 资产模型补第四类「资产维护型能力」：`karpathy-llm-wiki` 纳入（承载持久知识资产的 schema 与流程）；技能类型改由 frontmatter `kind` 显式声明（取代 S8-1 按目录名硬编码） |
| 2026-09-10 | v2.0 | 再设计：废除 L1/L2/L3 编号与 `kits/` 三个常驻 kit，改为「一循环 + 三类资产」；产出纪律常驻 `AGENT.md`、工程纪律并入既有技能、来源论证降为人面（本文） |
| 2026-09-10 | v1.2 | （前身 `three-kits-architecture.md`）移除「整体卸载」应急手段，解法收敛为「补齐字段 → 统一入口」两级 |
| 2026-09-10 | v1.1 | （前身）三套并列 → 一套方法论的三个组成部分 |

## 一、结论：一个循环 + 三类资产 + 一类能力

```
循环：意图 → 判据(V1…Vn) → 执行 → 证据 → 人审 → 复盘

三类资产（正交，不重叠）：
  协作主干（流程层）── 决定阶段与判据 ──→ 调用 工程纪律（能力层）
        └────────────────────────────────约束 所有代码产出 ← 产出纪律（约束层）
```

| 资产 | 来源 | 回答什么 | 载体 | 加载 |
|---|---|---|---|---|
| **产出纪律** | Karpathy | 这一笔代码怎么写才不跑偏 | `AGENT.md` §产出纪律（祈使句）+ `references/code-discipline.md`（反例/判定） | 常驻 / 长版按需 |
| **工程纪律** | Superpowers | 这个工程动作怎么做才对 | `skills/` 内实体（清单见 §四） | 命中即调用 |
| **协作主干** | Anthropic | 任务怎么组织、判据怎么定、人在哪审 | `skills/rd-digital-agent` + 12 子技能 + `rules/general/01–05` | 入口常驻 |
| **资产维护型能力** | Karpathy（llm-wiki） | 一类**持久资产**（知识库 / 记忆）怎么建与维护 | `skills/karpathy-llm-wiki`（知识库）、`skills/user-memory`（记忆） | 触发词命中即调用 |

咬合规则：**判据的「定义」归主干，判据的「执行」归工程纪律，判据的「可验证性」归产出纪律。** 三者不竞争、不互相复述。

> **资产维护型能力与上述三者正交**：它不产出判据、不编排阶段，只在被触发时维护自己的持久资产（`raw/` + `wiki/` 知识库、用户记忆）；它产出的内容仍受产出纪律约束。前三类是**规范 / 纪律**，这一类是**可调用的技能**——故本 kit 表述为「三类资产 + 一类能力」。

> **与七维的关系（防隔阂）**：本文回答"这套工作方式怎么组织"；`agent-definition-methodology.md`（七维）回答"定义一个智能体要填哪些格"。逐维的**答案来源映射**见该方法论 §二 的「答案来源」列与 §三·补——注意其中**产出纪律是贯穿约束（产出姿态）**，施于所有维度，不与另两类并列成一层。

## 二、为什么废除 L1/L2/L3 与 `kits/`

原设计把「来源标注」做成了三个常驻 skill 目录，代价可量化：

| 问题 | 事实 |
|---|---|
| 同一概念多处定义 | 「编排权唯一」出现在 9 个文件；「验证判据表」12+ 处；「开工前置」「三部分组成表」各 4–10 处 |
| 符号碰撞 | `L1/L2/L3` 一套符号三种含义（方法论三部分 / 评测五层 / 成熟度标尺）。**已消歧**：方法论三部分随 `kits/` 撤销；成熟度改用 `M0–M5`，评测五层保留 `L1–L5` |
| 平行注册体系 | kits 自带 `version` / `RATIONALE` 同步 / 150 行上限 → 逼出 `check-structure.sh` S9、`evals/cases/structure.md` S9 节、`eval-gate.yml` 的 `kits/` 路径规则、`sync-to-target.sh` 的 kits 拷贝、routing R24–R28 的期望分派 |
| 违反自家规范 | `dual-audience-design.md` §三 规定「不能变成检查项/触发条件的 → 人面」，而 `kits/L3-anthropic/SKILL.md` 全文是「我是唯一入口」的元陈述 |
| 漂移已实际发生 | 9 处计数/编号口径不一致、4 处已删技能 `verification-before-completion` 残留、`dual-audience-design.md` 文本损坏、`anthropic-workflow-mapping.md` 单行自相矛盾 |

结论：三部分关系是**人面知识**（为什么这么分、来源映射），此前被误置于常驻层；本次把它降级为本文，并让常驻层只保留可执行指令。

## 三、三类资产怎么咬合

| 阶段 | 协作主干（定义阶段与判据） | 工程纪律（执行手段） | 产出纪律（介入点） |
|---|---|---|---|
| 需求转换 | `requirement-translation`（EARS 判据 / 反例 / 待确认） | — | — |
| 方案探索 | `rd-brainstorm` | — | — |
| 计划 | `rd-plan`：TODO + **验证判据表 V1…Vn** | — | 判据须可验证（能跑出 PASS/FAIL） |
| 执行 | `rd-execute` | TDD（RED→GREEN→REFACTOR）、`systematic-debugging`、并行分派、worktree | 简洁至上、精准改动、先想后做 |
| 收尾 | `rd-execute` 完成验证门按 V1…Vn 勾核 | 完成前验证（先跑后说） | 汇报四段式（Assumption / Changed / Verified / Risk） |
| 审查 | `rd-review` → `test-verification` 盲测 | 请审 / 接审纪律 | 不顺手改无关代码 |
| 复盘 | 反馈回灌为下一轮 intent | — | — |

## 四、工程纪律清单（原 L2 的落地）

调用纪律：**命中即调用**（有 1% 可能适用就先调用再看）。**Rigid 三条**：TDD、系统化调试、完成前验证——不得以适应当前 context 为由跳过。

### A 类 · 实体在主干，此处不重写（单一真相源）

| 纪律 | 触发 | 刚性 | 实体 |
|---|---|---|---|
| TDD | 任何行为变更 / 修 bug | Rigid | `skills/rd-execute/SKILL.md` |
| 系统化调试 | 报错 / 测试失败 / 意外行为 | Rigid | `skills/systematic-debugging/SKILL.md` |
| 完成前验证 | 任何完成声明前 | Rigid | `skills/rd-execute/SKILL.md` §完成验证门 |
| 增量重构 | 重构 / 清理 / 消除重复 | Flexible | `skills/incremental-refactoring/SKILL.md` |

### B 类 · 并入既有技能（不新增目录）

| 能力 | 落地位置 | 铁律 |
|---|---|---|
| 并行分派 | `skills/rd-digital-agent` §多 Agent 协作团队模式 + `references/team-mode-playbook.md` | 子任务间无共享文件、无顺序依赖才可分派；回收摘要须含「结论 + 依据 + 未决项」 |
| 隔离工作区（worktree） | `skills/rd-execute` 隔离约定 | 改动前建 worktree，不污染主工作区 |
| 请审 / 接审 | `skills/rd-review` | 请审须附变更范围 + 验证证据；接审先复现再改，不认同须给反证 |
| 写技能 / 改定义资产 | `references/dual-audience-design.md` | 技能须写清「何时用 / 何时不用」，防触发漂移 |

## 五、旧 → 新映射

| 原 | 新落点 | 状态 |
|---|---|---|
| `kits/L1-karpathy/SKILL.md`（71 行） | `AGENT.md` §产出纪律（祈使句）+ `references/code-discipline.md` | ✅ 已完成 |
| `kits/L1-karpathy/RATIONALE.md` | 本文 §一/§二 | ✅ 已完成 |
| `kits/L2-superpowers/SKILL.md`（57 行） | 调用纪律 → `AGENT.md` §工程纪律；A/B 类 → §四 | ✅ 已完成 |
| `kits/L2-superpowers/references/rigid-disciplines.md` | §四 B 类各行 + 目标技能内 | ✅ 已完成 |
| `kits/L2-superpowers/RATIONALE.md` | 本文 §一/§四 | ✅ 已完成 |
| `kits/L3-anthropic/SKILL.md`（纯指针） | 删除（实体已在 `skills/rd-digital-agent`） | ✅ 已完成 |
| `kits/L3-anthropic/RATIONALE.md` | 删除 | ✅ 已完成 |
| `kits/README.md` | 本文 §一 | ✅ 已完成 |
| `references/three-kits-architecture.md` | 本文（旧文件删除） | ✅ 已完成 |

## 六、不变量（再设计不得触碰）

1. **开工前置**：任何任务动手前定「交付物定义 + 验证判据」，不因任务小而豁免（分级只压缩过程仪式）。
2. **设计与交付验证同构**：`V1…Vn` 落盘（判据 / 验证手段 / PASS 条件 / 不通过怎么办），交付时按**同一编号**给证据，全程只有这一份清单。
3. **人审三节点**：意图确认 / 设计确认 / 交付前审查，顺序固定 逻辑 → 合规红线 → 对照 spec。
4. **红线必须机器可判定**：无判定手段者不得进 `rules/`。
5. **双面分层**：AI 面祈使句、人面承载 why；判据双面同源同编号。
6. **编排权唯一**：`rd-*` 是唯一编排入口。
7. **机器检查字面串**（`check-structure.sh` S7）：`验证判据表`（`rd-plan`）、`完成验证门`（`rd-execute`）、`唯一方法论来源`（`AGENT.md`）——不得删除或改写。

## 七、接入约定（宿主存在第二套编排技能）

只有两级：

1. **补齐字段（首选）**：在宿主那套流程的 plan/spec 模板中补「交付物定义 + 验证判据表 V1…Vn」两节，使其与主链同构。不删除任何技能，工程纪律全部保留——冲突消解于「同构」而非「排除」。
2. **统一入口（次选）**：无法改宿主模板时，同域/同名冲突一律以 `rd-*` 为准；工程纪律类技能照常启用。

> 已废弃：整体卸载（会连工程纪律一起丢掉）。判定：检查宿主 plan 模板是否含「验证判据」字段——含走 1，不含走 2。

## 八、落地状态与分期

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 本文 + `references/code-discipline.md` + `AGENT.md`/`README.md` 结构叙述 | ✅ 已完成 |
| 2 | 删 `kits/` 与 `three-kits-architecture.md`；改门禁（`check-structure.sh` S9、`evals/cases/structure.md` S9 节、`sync-to-target.sh`、`eval-gate.yml` 与 `docs/development.md` 的 `kits/` 路径） | ✅ 已完成 |
| 3a | 改 `evals/cases/routing.md` R24–R28 期望分派（输入冻结、仅改期望输出 = 换基线） | ✅ 已完成 |
| 3b | 重跑基线 + 出评测报告（换基线声明） | ⛔ 待补：需可无头调用被测 agent（`AGENT_CMD`）。机器层（S1–S8 + 产物核对）已核验；行为层（28 条路由 + 7 条陷阱 + 6 张任务卡）未跑 |
| 4 | 修盘点缺陷（文本损坏、路径写法、计数口径、已删技能残留、加载层编号改名） | 待办 |

## 九、维护约定

| 你改了什么 | 必须同步 |
|---|---|
| 产出纪律条目 | `AGENT.md` §产出纪律 + `references/code-discipline.md` |
| 工程纪律清单 | `AGENT.md` §工程纪律 + §四 + 对应技能实体 |
| 主干流水线 / 红线 | `skills/`、`rules/` 原位改 |
| 三类资产的咬合关系 | 本文 §一、§三 |
| 新增一类资产 | 本文 + `AGENT.md` §资产分层 |

**禁止**：在 `AGENT.md`、`README.md` 或任何常驻文件里复述「三部分组成关系」——那属于本文。

## 十、换基线欠账（3b 未完成项）

本次改动是**行为层改动**（`AGENT.md` 增两节、`kits/` 撤销、能力落点位移、`evals/cases/routing.md` R24–R28 期望变更），按 `evals/README.md` §怎么跑必须重跑并落盘报告。当前状态：

- ✅ 已核验（机器判定）：`scripts/check-structure.sh` S1–S8；全仓旧概念零残留；引用路径可达；S7 三处 must-keep 字面串在位。
- ⛔ 未跑（需被测 agent 无头调用）：L2 路由 28 条、L3 陷阱 7 条、L4 任务卡 6 张 + 五维 rubric。
- 处置：换基线声明已落盘 `evals/reports/baseline-reset-2026-09-10.md`（声明旧基线作废、冻结新定义、分数未采集），满足「改 kit 须附报告」门禁；**新基线分数产出前，不得以「已评测」名义合并后续行为层改动**。
- 补跑方式：设置 `AGENT_CMD` 后按 `evals/run-baseline.md`「脚本化执行」采集，报告写入 `evals/reports/<commit短hash>-<日期>.md`（头部注明「换基线后首跑」）。

### 欠账登记（同一笔账，多批共用一次采集）

| # | 批次 | 行为层改动 | 处置 | 状态 |
|---|---|---|---|---|
| 1 | 资产模型再设计（`ec87f1c`） | `AGENT.md` 增两节；`kits/` 撤销；能力落点位移；`routing.md` R24–R28 期望变更 | 换基线声明已落盘 `evals/reports/baseline-reset-2026-09-10.md` | 待采集 |
| 2 | 定义落地（`57c9689`） | 6 个 `SKILL.md` 增「不做什么」边界节 + 版本 bump ×6 | `skip-eval` 并在本表登记：未新增行为逻辑，仅把既有隐含边界显式化 | 待采集 |
| 3 | llm-wiki 纳管 + `kind` 迁移（本次） | 新增 `skills/karpathy-llm-wiki/`（含 `scripts/`、`examples/`）；`AGENT.md` 资产分层加一类；技能类型改由 frontmatter `kind` 声明（`rd-digital-agent` 补 `kind: hub`）；S2 增资产类型校验；S8-1 改读 `kind` | `skip-eval` 并在本表登记：不改变既有链路行为；**新能力尚无已采集的回归数据**（任务卡随本批新增，待采集时一并跑） | 待采集 |

**共用关系**：三批属同一次换基线窗口，**新基线一旦产出即一并覆盖**，不各跑一次。
