---
kind: reference
audience: dual
loads: on-demand
version: 1.0.0
source: 本 kit 自演进（第 0 号实例 · 写作习惯团聚）
---

# 双面读者分层设计（AI 面 / 人面）

> **解决什么问题**：`rules/` `skills/` `references/` 三类定义资产，同一份内容既要给 AI 执行、又要给人评审维护，统一写法必然双输。
>
> **本文地位**：本 kit 所有定义资产的写作与布局规范，向上约束 `AGENT.md` / `skills/` / `rules/` / `references/` 四处。
> 关联：`references/agent-definition-methodology.md`（七维定义）、`references/eval-framework.md`（评测）；机器检查落点 `.github/workflows/eval-gate.yml` **S8**。

## 一、做成 / 不算做成

- **做成** = 任一定义资产的每个段落都能唯一归入 AI 面或人面；AI 常驻层里找不到一句说服性文字；人与 AI 共用的内容只有「判据」一类，且编号同源。
- **不算做成** = 出现下列任一（这四条即 S8 的检查项）：
  1. `SKILL.md` 正文出现「为什么 / 依据是 / 某某认为」等说服性内容；
  2. 某条 rules 只有约束文本、没有可执行的判定手段；
  3. `RATIONALE.md` 是 `SKILL.md` 的复制粘贴（重复 ≠ 分层）；
  4. 同一约束在两份文件各自表述、且无单向引用（出现第二个维护源）。

## 二、为什么不统一内容

两类读者的**失败模式不对称**，因此不存在同时最优的写法：

| | 读不懂的后果 | 冗余的代价 | 缺失的代价 |
|---|---|---|---|
| **人** | 不遵守 / 不敢改 / 曲解意图 | 低（可扫读跳过） | 高（改错方向） |
| **AI** | 静默偏离，事后不可见 | 高（占常驻 token、稀释指令权重） | 高（执行走样） |

推论：给 AI 加解释 = 常驻上下文膨胀 + 指令被淹没；给人只留条款 = 变成没人维护的天书。**任何折中写法同时踩两边的坑。**

## 三、不变量：只有判据必须双面同源

`V1…Vn 验证判据表` 是已验证的样板：**设计时写的那张表 = 交付时逐条勾核的那张表**。它的两面呈现不同——人看「要满足什么」，AI 看「跑什么命令」——但**编号、PASS 条件唯一且同源**，不存在第二份清单。

把这条经验泛化为通用规则：**不要问「这段给谁看」，问「这段是不是判据」。**

归属三问（对每个段落依次问）：

1. **能否变成「检查项 / 触发条件 / 可执行断言」？** 能 → AI 面。
2. **是不是显而易见的步骤复述？** 是 → 两面都不要，删。
3. **是不是双方赖以对齐的契约（判据 / 编号 / 接口字段）？** 是 → 判据区，双面同源同编号，**禁止复制**。

## 四、三层加载结构

| 层 | 内容 | 主要读者 | 预算 |
|---|---|---|---|
| **契约层** | frontmatter：`name` / `description`（含触发词）/ `version` / `checks` / `loads` / `rationale` | 机器路由 | 数十 token，常驻 |
| **指令层** | `SKILL.md` 正文：纯祈使句步骤 | AI 命中后加载 | 硬上限（见 §七） |
| **外置层** | `RATIONALE.md`（why / 决策 / 反例 / 演进）+ `references/*` | 人为主；AI 按需跟随 | 不限 |

关键：**人面内容不是删掉，是降级到 L2**。这与 `rules/04` 的上下文工程原则同构——此前只是没把它用在「给人读的内容」上。

## 五、文件布局规范

### 5.1 skills（过程约束，步骤为主）

```
skills/<name>/SKILL.md       # L1 AI 面
skills/<name>/RATIONALE.md   # L2 人面（可选，存在即受版本同步约束）
skills/<name>/references/*   # L2，双用按需
```

frontmatter 扩展字段（向后兼容，缺 `checks`/`loads`/`rationale` 不报错，缺 `version` 报错）：

```yaml
---
name: rd-plan
description: 方案设计 Agent — …触发：就按这个做、细化方案、拆任务。
version: 1.2.0
rationale: RATIONALE.md          # 缺省同目录；inline = 显式声明暂无外置人面
checks: .github/workflows/eval-gate.yml   # 与之绑定的机器检查
loads: references/thinking-checklist.md   # 按需加载清单，禁止预载
---
```

新增 / 改名技能的同步清单（缺一即出现孤儿或门禁失败）：

1. `scripts/check-structure.sh` 的 S2 白名单与 S5 路由目标；
2. `skills/rd-digital-agent/SKILL.md` 分派决策树与子技能矩阵；
3. `evals/cases/routing.md` 路由用例（输入冻结，只追加）；
4. `README.md` 目录结构。

### 5.2 rules（红线，必须可判定）

一条 rule = 一个文件，五段固定结构：

1. **约束**——祈使句，一屏可读；
2. **判定手段**——可跑的命令或 CI 检查项编号（**没有这段就不配叫红线**，见 `rules/05` 迁移路径）；
3. **违反后**——谁拦、在哪拦、拦不住怎么兜底；
4. **为什么**——一句话 + 指向 `rules/general/RATIONALE.md` 的链接（人面集中承载；逐条自带 why 会让 AI 面膨胀）；
5. **不适用**——明确列出 exempt 场景，避免执行侧自行判断。

### 5.3 references（知识库）

知识库**不按人的章节结构组织，按检索单元切**：一条 = 一个可独立引用的事实或约定，带元数据 frontmatter。

```yaml
---
kind: reference          # rule | skill | reference
audience: dual           # ai | human | dual
loads: on-demand         # always | on-trigger | on-demand
version: 1.0.0
source: <事实来源或推导标记>   # 外部引用标出处；本地推导标记"本地推导"
---
```

人只读索引，AI 只取命中的那一块。**通读型长文进 `references/` 时必须在 frontmatter 标 `loads: on-demand`**，防止被全量预载。

## 六、三类资产的最佳配比

| 资产 | AI 面 | 人面 | 判据区 | 备注 |
|---|---|---|---|---|
| **rules 红线** | 主：约束 + 判定命令 | 1 句 why + 链接 | 必须 | 无判定手段者应降级出 rules（`rules/05` 口径） |
| **skills SOP** | 主：执行步骤 | **最重** | 必要 | 人评审时靠它判断「这次能否绕过」 |
| **知识库** | 主：检索单元 | 近零（索引即可） | 不适用 | 元数据质量 > 正文质量 |

## 七、版本同步规则（防漂移的核心手段）

1. `SKILL.md` 内容变更 → bump `version`；
2. 同目录存在 `RATIONALE.md` → 其 frontmatter `reviewed-at-version` 必须等于 `SKILL.md` 的 `version`；
3. 不等 → CI 失败（S8-2）。确因改动不影响设计理由而不同步的，须在 `RATIONALE.md` 标 `stale: true` 并写明原因，CI 放行。

行数上限：**普通 skill ≤ 150 行；Hub（`rd-digital-agent`，含完整分派决策树）≤ 260 行**。超出 → 抽 `references/`，不准靠压缩措辞硬塞。

## 八、机器检查 S8（`eval-gate.yml`）

| 编号 | 检查项 | 判定 |
|---|---|---|
| S8-1 | `SKILL.md` 行数 ≤ 上限，且 frontmatter 含 `version` | 行数、`grep` |
| S8-2 | 存在 `RATIONALE.md` 时，其 `reviewed-at-version` == `SKILL.md` 的 `version`（或标 `stale: true`） | 比对 |
| S8-3 | `rules/general/NN-*.md` 每条必须含「判定手段」节 | `grep` |
| S8-4 | `SKILL.md` 正文禁出现说服性标记（「Anthropic 认为」「依据是」等）在指令行内 | `grep` 白名单排除引用区 |

> S8 是**结构不变量**检查，不替代评测；改 kit 仍受 `README.md` §改动 kit 的门禁 约束。

## 九、迁移路径（渐进，禁止一次性重写）

- **阶段 0（当前）**：所有 skill 在 frontmatter 显式声明 `rationale: inline`，承认现状；
- **阶段 1**：逐个把 `SKILL.md` 的人面段落搬到 `RATIONALE.md`，搬一个改一个并 bump 版本——**优先做被驳回或反复返工的 skill**（人面缺失的证据就是返工史）；
- **阶段 2**：`references/` 存量长文补 frontmatter 元数据并按检索单元拆分。

一次性给 13 个 skill 补写 RATIONALE 会产出无人维护的僵尸文档，不在此列。

## 十、反例集（写作者最常犯）

| 反例 | 为什么不合格 | 改写方向 |
|---|---|---|
| 在 `SKILL.md` 里解释「为什么要用 TDD」 | 说服性内容占常驻上下文 | 搬 `RATIONALE.md`，正文只留一条链接 |
| `RATIONALE.md` 把步骤重抄一遍 | 重复 ≠ 分层，双份维护必然漂移 | 只写「为什么是这个顺序、试过什么、反例」 |
| rules 里写「须产出spec」但不给判定命令 | 靠自觉，违反 `rules/05` | 补 `check-artifacts.sh` 或 CI grep 行号 |
| 把长篇背景写在 `references/` 长文开头 500 字 | AI 全文加载时白付 token | 首屏给结论 + 元数据，背景放文末「背景」节 |

## 十一、自检（改完任一定义资产，逐条回答）

1. 这段属于 AI 面还是人面？说不出 → 未按 §三 归属三问判定。
2. AI 面上还有没有说服性文字？有 → 搬走。
3. 判据是不是只有一份、有没有编号？没有编号 → 会漂移。
4. bump 了 `version` 吗？同目录 `RATIONALE.md` 的 `reviewed-at-version` 跟上了吗？
