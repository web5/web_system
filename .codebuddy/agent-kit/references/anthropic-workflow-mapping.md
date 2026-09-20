# Anthropic 工作方法论落点映射

> 回答一个问题：**Anthropic 团队建议「给 agent 的每个任务，在开始前就要明确交付物定义与验收/测试判据」——本 kit（第 0 号实例）与数字人 agent（第 1 号实例）的智能体方法论体现了吗？体现在哪？缺口在哪？**
>
> 本文 = 落点审计的沉淀。配套内容不变量条文已落：`AGENT.md`「开工前置」+ `skills/rd-plan/references/thinking-checklist.md` 简化档 · 最小交付卡。
>
> 版本：2026-09-10 v1.3（v1 = 简化档升级同批落地；v1.1 = profile 口径同步 + 数字人评测换基线判定；v1.2 = §六 待同步点 2/3 闭合——逃逸口统一不变量声明 + 非代码任务判据先行最小形态固化；**v1.3 = 设计与交付验证同构**：验证判据从"对话中的两件套"升级为编号落盘的「验证判据表 V1…Vn」（spec 收尾章节），交付侧按同一编号勾核；`verification-before-completion` 技能删除、职责收编进 `rd-execute` 完成验证门；新增唯一方法论来源声明——不并行 Superpowers 等第二套工作流）；**v1.4 = 双面分层（AI 面 / 人面）**：定义资产分离 AI 常驻面与人面（人面外置 `RATIONALE.md`，不占常驻上下文），红线五条补齐「判定手段」节，`eval-gate` 新增 S8 双面一致性检查，规范见 `references/dual-audience-design.md`；**v1.5 = 方法论融合为一套**：新增 `kits/`（L1 行为准则 / L2 执行手段库 / L3 协作主干），唯一性收敛为「编排权」，第二套编排技能的处理优先级为 补齐判据字段 → 同域同名以 `rd-*` 为准 → 整体卸载，规范见 `references/methodology-design.md`；**v1.6 = 移除「整体卸载」应急手段**（`scripts/uninstall-superpowers.sh` 已删除），处理优先级收敛为 补齐判据字段 → 同域同名以 `rd-*` 为准；**v1.7 = 资产模型再设计**（撤销 `kits/` 与 L1/L2/L3 编号：产出纪律常驻 `AGENT.md`、工程纪律并入技能实体、设计论证迁至 `references/methodology-design.md`）。文件行号以该日期快照为准，后续以节名定位。

## 〇、一句话结论

骨架完整、分布不均；曾有一个真实缺口（v1 已闭合）：

- **已普适**：完成侧验证门（`rd-execute` 完成验证门挂任何收尾，不分级）；全量链验收标准先行（EARS + 做成定义）。
- **设计与交付验证同构（v1.3 起）**：判据不再是「对话里的两件套」，而是**编号落盘的验证判据表 V1…Vn**——设计阶段写进 spec / 计划收尾，交付阶段按同一编号逐条勾核（见 §二行 12、`rd-plan` §验证判据表）。这补齐了原先最后一个缺口：此前判据先行默认口头回读，位置不固定，设计与交付可能各说一份。
- **体现最强**：评测层——每个 golden-task 卡 = 固定输入 + 期望产物清单 + 质量评分点，逐任务就是 Anthropic 说的那个形态。
- **缺口（原，v1 已闭合）**：简化档只强制「做成定义一句话」，未显式强制交付物清单 + 验证手段两件套，也无强制落盘/回读位 → 已升级为「简化档 · 最小交付卡」（4 行必答 + 类型化验证判据 + 验收核点节，见 §四与 §六）。

## 一、Anthropic 原始主张与措辞对照

外部引用：Anthropic · *Best practices for Claude Code* — <https://www.anthropic.com/engineering/claude-code-best-practices>（官方 Claude Code Docs，持续更新）

**注意**：Anthropic 原文用词是 `verification / check / acceptance`，并未使用「deliverable（交付物）」一词；它强调的是把「验收判据（verification criteria）」内建进任务描述与计划，让判据成为 agent 决定「何时算完成」（stop condition）的依据。核心句：

- "Give Claude a way to verify its work … It's the difference between a session you watch and one you walk away from."
- "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only signal available."
- "Have Claude show evidence rather than asserting success."
- "The most useful specs are self-contained: … and end with an end-to-end verification step that proves the feature works."
- "If you can't verify it, don't ship it."

本 kit 的本地化措辞对照（下文全部使用本地语言）：

| Anthropic 原文概念 | 本 kit 语言 | 权威位置 |
|---|---|---|
| verification criteria / a check it can run | 做成定义 + EARS 验收标准 + 验证手段 | thinking-checklist S1；rd-plan |
| 测试用例写进任务/计划再实现 | TDD RED（先写失败测试） | rd-execute |
| show evidence rather than asserting success | 完成声明 = 验证证据 | `rd-execute` 完成验证门 |
| spec 以端到端验证步骤收尾 | requirements 验收标准；任务卡「期望产物 + 评分点」 | rd-plan；golden-tasks |
| 判据成为 stop condition | 不算做成 = 边界/反例；完成对照判据逐条标 ✅/❌ | thinking-checklist S1；`rd-execute` 完成验证门 |

## 二、逐层落点映射（体现在哪）

| # | Anthropic 要素 | 本 kit 落点 | 位置 | 覆盖 |
|---|---|---|---|---|
| 1 | 任务意图含成功标准 | intent = 目标、受众、范围边界、**成功标准** | `references/ai-methodology.md` §一；`evals/golden-tasks/T1` 期望产物 | 全任务（意图层） |
| 2 | 交付物拆到可独立验证粒度 | 每个 TODO = 一个**可独立验证**的功能模块 | `skills/rd-plan/SKILL.md` §工作流 | plan 层 |
| 3 | 复杂改动规格化交付物 | specs 三件套 requirements/design/tasks | `skills/rd-plan/SKILL.md` §输出格式 | 复杂改动 |
| 4 | 测试判据先于实现（规格化） | EARS 验收标准写入 `requirements.md`（用户故事后） | `skills/rd-plan/SKILL.md` §验收标准模板 | 复杂改动 |
| 5 | 所有需求/方案的做成判据 | 核心档 S1：做成一句话可验证 + 不算做成的边界 | `skills/rd-plan/references/thinking-checklist.md` 核心 7 问 | 全需求/方案 |
| 6 | 小改动的判据 | 简化档 · 最小交付卡 S1a/S1b：交付物定义（做成/不算做成 + 改动点清单，可机器核对）＋ 验证判据先行（代码=测试 / 文档=核点 / 探索=收敛判据+评分点），4 行必答 | `skills/rd-plan/references/thinking-checklist.md` 简化档 · 最小交付卡 | 日常小改动 ✅ |
| 7 | 测试先于实现（代码） | TDD：RED（先写失败测试）→ GREEN → REFACTOR | `skills/rd-execute/SKILL.md` §工作流 | 代码执行 |
| 8 | 证据而非口头宣称 | 完成声明 = 验证证据；**同一份 V1…Vn** 逐条标 ✅/❌ + 证据 | `skills/rd-execute/SKILL.md` §完成验证门 | **任何收尾（不分级）** |
| 12 | spec 自带端到端验证步骤（验证内建于设计产物） | 验证判据表 V1…Vn 作为 spec / 计划的**收尾章节**：判据 + 验证手段 + PASS 条件 + 不通过怎么办 | `skills/rd-plan/SKILL.md` §验证判据表（V1…Vn） | **任何任务（含小改动）** |
| 9 | 元层：任务卡先行定义交付物+评分 | golden-task = 固定输入 + 期望产物（文件系统核对）+ 质量评分点 | `evals/golden-tasks/T3`、`digital-agent-eval/golden-tasks/T1~T6` | 评测资产 |
| 10 | 判据先于人审 | 意图确认人审节点（审的就是成功标准是否可验证） | `AGENT.md` §人审节点；`rules/general/02-human-in-loop.md` | 全链档 |
| 11 | 机器化保障判据不被口头跳过 | 红线 03 产物落盘；完成门进 skill 与 eval-gate | `rules/general/03-versioned-artifacts.md`；`.github/workflows/eval-gate.yml` | 元层 |
| 13 | **本地推导**：判据要起作用须留在注意力中心 | 双面分层——AI 面（指令）有体积上限，人面（论证 / why / 演进）外置 `RATIONALE.md` 按需加载，不挤占常驻上下文；判据类内容是唯一双面同源的内容 | `references/dual-audience-design.md`；`skills/*/RATIONALE.md`；`rules/general/RATIONALE.md` | 全部定义资产 |

## 三、缺口与成因（诚实结论）

1. **简化档缺口（v1 已闭合，见 §四）**：小改动没有强制「交付物清单 + 验证手段」两半落盘，完成门对照退化为「对照对话记忆」。这是六层里唯一让 Anthropic 那条原则失效的地方，也正好是覆盖任务数量最大的地方。
2. **测试先行只对代码任务强制（v1.2 已补最小形态）**：文档/方案/探索类没有对等的「动笔前先写判据」形式——`rd-review`/review checklist 是完成后的自检，不是先行定义。→ 判据先行已扩展为类型化形态：代码类 = TDD 测试；写作/文档类 = 验收核点节；探索/发散类 = 收敛判据 + 评分点（`thinking-checklist` 简化档 · 最小交付卡 Q2 及「验收核点节」模板）。
3. **措辞逃逸口（v1.1–v1.2 已逐处锚定）**：六处「小改动不走全链/可省/可直接执行」若不被「不变量」声明约束，日后会被读成「小任务可豁免定义」。现逐处挂「分级不压缩交付物+验证判据」不变量：
   - `AGENT.md` §人审节点 /「开工前置」——已携带（v1）
   - `rules/general/02-human-in-loop.md`——已锚定（v1.2）
   - `skills/rd-digital-agent/SKILL.md`（触发条件分级行）——已锚定（v1.2）
   - `skills/rd-execute/SKILL.md`（触发条件）——已锚定（v1.2）
   - `references/digital-agent-profile.md`（简化档摘要行与分级表述）——已同步（v1.1）
   - `skills/rd-plan/SKILL.md`（原型稿"可省"判定——此项仅豁免中间交付物，属过程仪式，可保留）

## 四、统一口径（已落条文）

**分级压缩的是过程仪式，不压缩定义必需性。** 三根可分级轴：辨证问数（简化档/核心/强化）、spec 文档体量、评审链与原型稿是否产出。不可分级的两个内容不变量：

1. **任何任务动手前**：交付物定义（做成 = 一句话可验证 + 改动点/产物清单可机器核对）+ 验证判据先行（怎么证明做成）——见 `skills/rd-plan/references/thinking-checklist.md` 简化档 · 最小交付卡，须回读用户作最小意图确认；**判据须编号落盘为 V1…Vn**（`skills/rd-plan/SKILL.md` §验证判据表），不只停留在对话里。
2. **任何任务完成时**：按先行判据逐条给验证证据（`rd-execute` 完成验证门），禁止「应该没问题」。
3. **两处共用同一清单（同构）**：设计端产出 V1…Vn 并落盘，交付端按同一编号勾核；交付端不得另起清单，设计端不得给无执行手段的伪判据。

**探索/发散型任务不豁免**：验证判据取类型化形态（收敛判据 + 质量评分点），判据先定、结论节点可后收敛。对应句见 `skills/rd-brainstorm/SKILL.md` 需求辨证。

## 五、评测锚点（这条原则靠什么回归）

- **方法论评测**：`evals/golden-tasks/T1~T6` 每张卡自带期望产物清单 + 质量评分点；D1 机器核对产物落盘（`scripts/check-artifacts.sh`）。
- **数字人产品评测**：`digital-agent-eval/golden-tasks/T1~T6`；其中 `T6-verification-gate.md` 直接测「完成声明 = 验证证据」与「无业务定义不发明兜底」。
- **陷阱用例**：`evals/cases/behavior.md`、`digital-agent-eval/cases/behavior.md` 注入「不附验证就宣称完成 / 模糊需求直接开工」诱惑场景。
- 判据先行是否真被执行 → 回灌简化档条文修订（闭环入口）。

## 六、变更门禁与本文件维护

- 本文属 `references/`，改动 = 改 kit：PR 须附评测报告（`.github/workflows/eval-gate.yml`），或按门禁说明用 skip-eval 并注明理由。
- **已完成（2026-09-10 · v1.4 双面分层）**：
  0. ① 新增 `references/dual-audience-design.md`：归属三问、L0/L1/L2 三层预算、三类资产（rules/skills/知识库）配比、版本同步规则、迁移路径与反例集。② `rd-plan` / `rd-execute` / `rd-digital-agent` / `ux-prototype-designer` 的人面外置为 `RATIONALE.md`（此前只存在于对话里的决策背景落盘）。③ `rules/general` 五条补齐「判定手段」节——此前 01–04 只有约束文本、无检查命令，与 05「靠自觉的不算红线」自相矛盾；设计理由集中到 `rules/general/RATIONALE.md`。④ Hub 团队模式架构图与 `task()` 调用示例外置为 `references/team-mode-playbook.md`（`SKILL.md` 229 → 187 行），摘要纪律补为「结论 + 依据 + 未决项」。⑤ `eval-gate` 新增 S8：行数上限 + `version` 字段 / `RATIONALE` 版本同步 / 红线必须有判定手段 / 说服性引用必须外置。
     **未完成动作 = 重跑评测**（与 v1.3 同一笔债，仍未执行）：判据形态与技能集变更后 digital-agent-eval 应换基线重跑，需 `AGENT_CMD`（被测 agent 无头调用命令）与 judge 隔离环境。
- **已完成（2026-09-10 · v1.3 设计与交付验证同构）**：
  0. ① 同构载体落地：`skills/rd-plan/SKILL.md` 新增必填章节「验证判据表（V1…Vn）」（四列：判据 / 验证手段 / PASS 条件 / 不通过怎么办），TODO 每项绑 V#，`tasks.md` 每项绑 V#；交付准入项升级为「计划 + 方案 + 验证判据表（强制）+ 原型稿（按需）」，判据缺失禁入 `rd-execute`。② 完成侧：`verification-before-completion` 技能删除，职责收编进 `skills/rd-execute/SKILL.md` §完成验证门，输出按同一份 V# 勾核；`rd-review` 增加 V# 编号同构核对。③ 唯一方法论来源声明（`AGENT.md` / `README.md` / `skills/rd-digital-agent/SKILL.md`）：不并行 Superpowers 等第二套工作流，理由是其计划模板无「交付物定义 + 验证判据先行」——这正是宿主项目出现「执行时看不到交付验证」的根因。④ 受影响引用已同步：`thinking-checklist`、`test-verification`、`blind-test-playbook`、`systematic-debugging`、`incremental-refactoring`、`eval-framework`、`agent-definition-template`、`digital-agent-profile`、`evals/*`、`digital-agent-eval/*`。
     **未完成动作 = 重跑评测**：技能集与判据形态变更属「画像/口径变更」→ digital-agent-eval 换基线（重跑 routing/behavior/persona + T1~T6，新报告落盘 `reports/<新hash>-<日期>.md`）；evals 侧 L1 结构与 L2 路由期望已同步更新。
- **已完成（2026-09-04）**：
  1. 待同步点 1（v1.1）：`references/digital-agent-profile.md` 口径同步（header 快照、§二 简化档行、统一辨证语法、§四 分级纪律）。因 profile/AGENT.md/skills/references 齐变 → 数字人产品评测判定「画像/口径变更」→ **digital-agent-eval 换基线**：按该目录 README 重跑 routing/behavior/persona 全集 + T1~T6 任务卡，新报告落盘 `reports/<新hash>-<实跑日期>.md`（旧构建版基线 `1b6fa62` 报告存档不改写）。**唯一未执行动作 = 实跑**（需真实评测环境 + judge 隔离，本仓库只负责资产与条文）。
  2. 待同步点 2（v1.2）：§三.3 逃逸口文件统一挂「分级不压缩交付物+验证判据」不变量声明——`rules/general/02-human-in-loop.md`、`skills/rd-digital-agent/SKILL.md`、`skills/rd-execute/SKILL.md` 已锚定（AGENT.md「开工前置」与 profile §二/§四随 v1/v1.1 已携带；rd-plan「原型稿可省」属过程仪式豁免，保留）。
  3. 待同步点 3（v1.2）：非代码任务「判据先行」最小形态固化——`thinking-checklist` 简化档 · 最小交付卡新增「验收核点节」模板（写作/文档/方案/报告类四类核点：内容出处 / 覆盖 / 边界 / 形式）；`evals/golden-tasks`（写作/文档型 T3/T5/T6）与 `digital-agent-eval` README 均挂引用。
- **闭环**：§〇、§二表行 6、§三 1–3 所列缺口均已闭合到对应条文，本文落点不再有 ❌ 弱 项。
