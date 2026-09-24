# 方案 · 视觉交互设计专家（design-reviewer）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 版本：v1.0（草案，待批注）｜日期：2026-09-22｜状态：**待用户确认，确认前不落码**
> 定位：在需求 → 原型 → 落码全流程中，设置**设计侧的独立第三方评审角色**，把关设计输出与产品设计/交互质量。
> 关联：`specs/kit-sop-enforcement/design.md`（动作门与机器强制基建，本方案在其上增量）、`docs/ui/design.md`（admin 系判断层）、`.codebuddy/rules/brand-interface/RULE.mdc`（品牌端）。

---

## 0. 一页速览

| 项 | 内容 |
|---|---|
| 要解决的问题 | 设计侧只有"出稿的人"、没有"审稿的人"；出稿者自审、视觉把关极薄、实现与原型漂移无人拦 |
| 做法 | 新增独立评审角色 `design-reviewer`（盲审，不出稿不改码）+ 补单一评审依据 `docs/ui/design-system.md` + 三关口（D1 设计输入 / D2 原型规格 / D3 实现一致性）+ 机器强制（Design 凭证 + CI R11） |
| 覆盖范围 | admin 系（deploy-console / admin / mcp-admin）**与** 品牌端（portal / kedou-ai-minigram）两端 |
| 独立性来源 | 盲审隔离（不采信生产者自辩）+ 独立 sub-agent 上下文 + 判据先于被审物 |
| 不替代 | 用户拍板（人审节点）、`ux-prototype-designer` 出稿、产品价值判断 |
| 分期 | P0 角色与依据（本期，软约束）→ P1 机器强制（hook/CI + 锚点）→ P2 视觉并置自动化 |

---

## 1. 问题与根因

### 1.1 现状盘点（2026-09-22 实查）

| 环节 | 现有承担者 | 缺口 |
|---|---|---|
| 需求 → 交互方案 | `ux-prototype-designer` | 只覆盖"出稿"，无"这个需求该不该长这样"的评审 |
| 原型自检 | `ux-prototype-designer` 自过 `references/ux-review-checklist.md` | **生产 + 自审同体**，等价于开发自证 |
| 方案评审 | `tech-review` | 只审结构/选型/安全/信息结构，不含视觉与交互 |
| 代码评审 | `rd-review` | 实现者自查，不含"是否忠于已确认设计" |
| 独立验证 | `test-verification`（盲测） | **测试侧有独立第三方，设计侧没有**——体系不对称 |
| 落码后 | 无 | 原型与实现两张皮，无一致性回归关 |

### 1.2 四个断点（均带证据）

- **B1 · 自审**：`ux-prototype-designer/SKILL.md` §独立交互质检 要求"产出后逐条过 `ux-review-checklist.md`"——清单由本角色自己过，无第二视角。
- **B2 · 视觉把关太薄**：`ux-review-checklist.md` §E「视觉与 Token 一致性」仅 4 条（token 化 / 主色 / emoji+8 倍数间距 / 字号三级），无：层级、信息密度、对齐与间距节奏、对比度实测、文案语气、品牌一致性。
- **B3 · 评审无依据**：admin 系判断层 `docs/ui/design.md` 仅 6 节（视觉约束占 1 节）；品牌端规范散在 `rules/brand-interface/RULE.mdc` 与 `docs/ui/ui-design-spec.html`；token 在 `packages/ui/src/tokens.ts`。**无单一真相源 → 评审必然退化为主观判断**，而 `rd-digital-agent/references/challenge-playbook.md` 明文禁止"感觉不对"式否定。
- **B4 · 只查有无、不查好坏**：`specs/kit-sop-enforcement` 的 L3 hook 与 CI R9/R9b/R10 只强制"原型被改过 + `Proto: <sha>` 凭证"，不强制设计质量；D3（实现 vs 设计一致性）完全空缺。

---

## 2. 目标与非目标

### 做成（可验证）

1. 任何交付给用户的原型稿/页面规格，交出前**都有一份独立视角的设计评审报告**（含分级 + 反例）。
2. 评审结论**基于单一真相源**（`docs/ui/design-system.md` + 端规范 + tokens），每条问题可指向具体判据条目。
3. UI 落码后有一次**实现一致性评审**（D3），拦截"原型与落地两张皮"。
4. 评审是否发生**可机检**：报告落盘进 git + commit trailer + CI R11 校验，不靠自觉。

### 不算做成（边界 / 反例）

- 不代替用户拍板：报告只给「阻塞 / 重要 / 建议 + 反例」，裁决权在人（沿用 challenge-playbook「最终仲裁权在人」）。
- 不产出原型稿、不改代码、不改被审物（只回流给原角色重做）。
- 不因"产品已确认方向"放行（沿用 `ux-review-checklist.md` 反模式第 1 条）。
- 不评审纯后端 / 非 UI 产物。
- 不追求一次到位：目标是**偏差可预期、可快速修正**（对齐 `docs/ui/design.md` §0 机制目标）。

### 为什么现在做

项目处在高速 UI 变更期（portal 换血、deploy-console 拆分、小程序端并行），原型已由 hook 强制产出但**质量无人把关**——强制"有"而不强制"好"，长期会把评审成本全部压到用户一个人身上。

---

## 3. 设计

### 3.1 角色定位与独立性机制

**定位**：设计侧独立第三方评审者。人格底色 = 挑刺的设计总监，不是帮忙画图的人。
与 `test-verification` 对称：那是用验收判据打产物，本角色用设计判据打设计产物与实现。

**独立性机制（决定成败，三条）**

| 机制 | 做法 | 防的是什么 |
|---|---|---|
| ① 盲审隔离 | 评审时**先读判据源**（design-system / 端规范 / tokens / page-spec / 需求 spec）形成"应该长什么样"，**再看被审物**；**禁止读** `ux-prototype-designer` 产出中的「设计决策记录·为什么这么设计」自辩段 | 被生产者思路带偏（与 `test-verification` 盲测同源） |
| ② 独立上下文 | 以 sub-agent 分派执行评审（`Task` 工具 / 团队模式），主 Agent 只回收报告摘要（结论 + 依据 + 未决项，缺一视为信息丢失） | 主 Agent 上下文里已存在的出稿意图污染评审 |
| ③ 判据外部化 | 每条结论必须能指到判据编号（`design-system.md` §x.y 或端规则条目）；指不到的一律归入「建议」级并标注"无判据，属个人偏好" | 主观否定（challenge-playbook 禁止项） |

**与 `ux-prototype-designer` 的分工（不重叠）**

| | `ux-prototype-designer` | `design-reviewer` |
|---|---|---|
| 动作 | 生产（出稿） | 评审（不出稿） |
| 产物 | 原型 HTML + 设计决策记录 | 设计评审报告 |
| 质检 | 自过 `ux-review-checklist.md`（保留，作为出稿下限） | 独立过 `design-review-checklist.md`（更高水位） |
| 关系 | 被审方 | 可退回重出，但不代改 |

### 3.2 三个关口（"过程中把关"的落点）

| 关口 | 时机 | 审什么 | 触发 | 强制级别 |
|---|---|---|---|---|
| **D1** 设计输入评审 | 需求 spec / 方案定稿后、原型开画前 | 信息架构、任务模型、形态选型（这个需求该不该长这样） | 涉及 UI 的中大型方案 | 软（Hub 分派 + 规则动作门） |
| **D2** 原型/规格评审 | 原型产出后、**交用户确认之前** | 交互闭环 + 视觉质量 + 与规格/需求一致性 | 任何交付原型稿 / page-spec | 软 + **报告落盘硬**（P1 起 CI R11 校验） |
| **D3** 实现一致性评审 | 落码后、人审前 | 实现是否漂移已确认原型/规格 | 任何 UI 源码改动 | 软 + **机检硬**（P1：锚点比对 + 可机检条目扫） |

> D2 与现有「独立交互质检」的关系：质检是**出稿下限**（生产者自过，保留），D2 是**独立复审**（第三方）。两者不互相替代——正如 `rd-execute` 完成验证门与 `test-verification` 的关系。

### 3.3 评审依据：补单一真相源 `docs/ui/design-system.md`

评审凭什么判？——必须先有一份**跨端设计基线**。本期新建，定位为「评审判据源 + 出稿依据」，**不复制数值**（数值仍以 `packages/ui/src/tokens.ts` / `tokens.css` 与品牌端 token 为唯一事实源，沿用 `docs/ui/README.md` §3 防漂移责任）。

建议目录（落码时按此填）：

```
docs/ui/design-system.md
├── 0. 适用边界与读法（admin 系 / 品牌端双栏，勿混用）
├── 1. 设计原则（4–6 条，可判真伪的一句一条）
├── 2. 视觉基线
│   ├── 2.1 层级：字阶 / 字重 / 颜色语义如何表达层级（禁靠加粗堆叠）
│   ├── 2.2 信息密度：同屏操作数、表头与行高、留白基准（对齐参照页）
│   ├── 2.3 间距与对齐：8 倍数基准、间距阶梯、对齐规则（左/右/基线）
│   ├── 2.4 色彩语义：语义色用途、状态色、禁"类型/枚举配色"、对比度下限（AA）
│   └── 2.5 圆角 / 描边 / 阴影：hairline 优先、禁随意抬升
├── 3. 交互模式库（在 prototype-scaffold 交互库基础上补"何时用/何时禁用"）
├── 4. 状态矩阵（加载/空/错/无权限/禁用/进行中/成功 + 破坏性二次确认）
├── 5. 文案与语气（动词开头按钮、禁冗余敬语、错误文案要给出路）
├── 6. 端差异对照表（admin 系 ↔ 品牌端：主色 / 密度 / 圆角 / 字阶 / 图标源 / 语气）
└── 7. 反模式清单（评审可直接引用编号）
```

**防漂移责任（追加到 `docs/ui/README.md` §3 表）**：`design-system.md`（判据）↔ 两条 rules 精要 ↔ `design.md` 判断条目，改判据必同步三处；数值一律不进本文档。

### 3.4 评审维度与清单

清单落 `.codebuddy/skills/design-reviewer/references/design-review-checklist.md`，分维度、每条可勾选且**标注判据来源**：

| # | 维度 | 来源 | 备注 |
|---|---|---|---|
| A | 信息架构 | 现有 checklist §A | 沿用 |
| B | 任务流闭环 | 现有 §B | 沿用 |
| C | 状态矩阵 | 现有 §C + design-system §4 | 加"无权限" |
| D | 操作与确认 | 现有 §D | 沿用 |
| E | **视觉层级与密度** ⭐ | design-system §2.1/§2.2 | 新增（补 B2） |
| F | **间距与对齐节奏** ⭐ | §2.3 | 新增 |
| G | **色彩语义与对比度** ⭐ | §2.4 | 新增，含对比度实测（AA 4.5:1 / 大字 3:1） |
| H | **排版与文案语气** ⭐ | §2.1/§5 | 新增 |
| I | **品牌与端一致性** ⭐ | §6 对照表 + 端规则 | 新增，判"串端" |
| J | 可访问性基线 | 现有 §F | 沿用 |
| K | 与规格/需求一致性 | 现有 §G + page-spec | 沿用 |
| L | 目标端一致性 | 现有 §H | 沿用 |
| M | 未定义项显式标注 | 现有 §I | 沿用 |
| N | **实现一致性（D3 专用）** | 原型 + page-spec | 新增，见 §3.6 |

⭐ = 相对现有 `ux-review-checklist.md` 的补强项（即本次真实增量）。

### 3.5 产出格式（设计评审报告）

报告落盘路径：`docs/ui/reviews/<topic>-<YYYYMMDD>.md`（与原型/规格同 commit 或紧邻 commit）。

**机器可读头（固定两行，供 CI 解析）**：

```
阻塞: N
重要: N
```

正文：

```markdown
## 设计评审报告（D2 · 原型评审）

对象：<原型路径 / page-spec 路径> ｜ 目标端：<桌面 Web / H5 / 小程序 / …> ｜ 判据源：<design-system 章节>

### 阻塞（必须解决，未清零不得交人确认）
- [ ] [E2.1] <问题> — 反例：<情形 → 实际 vs 期望> — 判据：design-system §2.1 — 阻塞：是

### 重要（建议解决）
- [ ] [H5] <问题> — 反例：… — 判据：…

### 建议（无判据的个人偏好，可驳回）
- <项>

### 通过项
- <维度>：理由

### 结论
✅ 通过 / ⚠️ 有条件通过（N 项重要待定）/ ❌ 阻塞（未清零，退回 ux-prototype-designer 重出）

### 质疑回流
- → ux-prototype-designer：<退回重出 / 补标注>
- → requirement-translation：<需求未定义交互却要求脑补>
- → rd-execute（D3 时）：<实现漂移项>
```

格式纪律：每条须带**反例 + 判据编号 + 严重级 + 是否阻塞**（challenge-playbook 强制格式）；无判据的一律降级为"建议"并显式标注。

### 3.6 D3 实现一致性评审（分层：机检 + AI 判）

D3 是最贵的一关，分两层，避免整关沦为不可回归的主观比对：

**D3-a 机检层（可回归，P1 落）**

| 检查 | 手段 |
|---|---|
| 可机检视觉条目 | 裸 hex/rgba、emoji 图标、新增 `!important`、字重越界（非 400/500/600）、间距非 8 倍数 → 扫 diff |
| **锚点集合比对** | 原型稿中关键元素打 `data-dr="<key>"`，实现中同位置打同名锚点；CI 比对两侧锚点集合差异（缺 / 新增 / 改名）→ 结构化漂移即刻可见 |

> 锚点约定写入 `design-system.md` §3 与 `prototype-scaffold.html`，只对**关键结构元素**打（页头、主操作、状态区、列表容器等），不逐元素打，避免噪音。
> **存量页面也补**（用户 2026-09-22 拍板）：回填按 §3.7.1 分批推进，清单驱动；比对开关 `DESIGN_ANCHOR_MODE` 随批次从 `off` 推进到 `strict`。

**D3-b 视觉并置层（AI 判，软）**

实现后截图存 `docs/ui/baselines/{app}-{page}-{proto|impl}.png`（沿用 `design.md` §5 第 5 条既有约定），原型截图与实现截图并置，按 E/F/G/H/I 维度出差异表，结论入报告。

### 3.7 机器强制（把"评审过了吗"物化，与 §3.8 方案 B 同构）

核心思路沿用 `specs/kit-sop-enforcement/design.md` §3.8：**机器读不到"评审质量"，但能读"报告落盘并进 git"**。故把评审物化成 git 凭证。

| 层 | 内容 | 级别 |
|---|---|---|
| L1 常驻动作门 | `CODEBUDDY.md` §2.5 与两条端规则动作门增述：原型交人前过 D2、落码后过 D3 | 软 |
| L3.5 commit trailer | 原型/规格 commit 带 `Design: <report-path>`；UI commit 在现有 `Proto: <sha>` 之外带 `Design: pass` | `commit-msg` 校验（warning） |
| L4 CI **R11** | ① UI commit 缺 `Design:` trailer → 报「UI 改动未经设计评审」；② 报告头部 `阻塞: N` 且 N>0 → 报「设计评审阻塞项未清零」 | **error**（用户 2026-09-22 拍板，不设 warning 观察期）；接入 `scripts/redline/scan-rules.sh`（新增 `check_r11` 判定函数，不改调用方），由 `quality-gate.yml` 的 `redline-scan` job 覆盖（2026-09-24 恢复） |
| L5 自检 | `scripts/redline/selfcheck-ui-gate.sh` 补本方案 V 断言 | 防静默失效 |

**作用域（防误伤）**：R11 仅在 diff **含 UI 源码**（沿用 §3.1 路径集合）时触发；纯后端 / 文档 / 脚本 PR 不受影响，零摩擦放行。

**摩擦控制（R11=error 下的必要补偿）**：
- `Micro-exempt: <理由>` **同步豁免 R11**，与 R9b / R10 口径一致（否则"记了豁免还报错"成为新摩擦源）。
- hook 侧**不新增 deny**（现有 UI gate 已 deny 一次，再加一次会显著推高摩擦）；设计评审只走 trailer + CI，不走 PreToolUse 阻断。
- 存量页面锚点未回填前不报 error —— 见 §3.7.1，这是 R11 能直接 error 的前提。

### 3.7.1 存量过渡策略（R11=error 的必然配套）

> 冲突：R11 直接 error + 存量页面也要补锚点（用户 2026-09-22 拍板）——存量回填是大工程（admin 系 + portal + 小程序三端上百个界面文件），**在回填完成前就让锚点比对达到 error 级，会让存量页面的任何 UI 改动全线红**，这正是 `kit-sop-enforcement` §3.7 警告的"摩擦过大 → 门禁被关"。故拆成两条判据、两种节奏。

| 判据 | 生效时机 | 级别 |
|---|---|---|
| **R11-a** trailer 与阻塞清零 | **P1 落码即生效**，对存量与新增一视同仁 | **error** |
| **R11-b** 锚点集合比对（`DESIGN_ANCHOR_MODE`） | 三档开关：`off`（回填前）→ `warn`（回填中）→ `strict`（回填完成后） | 初始 `off`，随回填批次推进 |

**锚点比对前提（防误报）**：仅当**原型侧与实现侧都声明了锚点清单**时才比对；任一侧无锚点 → 该页面跳过比对，不报 error。这样"尚未回填"≠"已漂移"。

**存量回填分批（P1，T9b，清单驱动）**：先出《存量界面清单》（`docs/ui/anchor-backlog.md`：文件 / 端 / 是否关键结构 / 批次），按批次推进，每批完成把该批路径加入 `strict` 白名单。批次顺序建议：① admin 系主流程页（列表/详情/表单）→ ② portal 主流程页 → ③ 小程序主包页面 → ④ 分包与低频页。

### 3.8 端覆盖

| 端 | 判据源 | 评审要点 |
|---|---|---|
| admin 系（deploy-console / admin / mcp-admin） | `docs/ui/design-system.md` + `docs/ui/design.md` + `packages/ui/src/tokens.ts` | 密度对齐 ServiceManager、tabular-nums、hairline、dark 双主题 |
| 品牌端（portal / kedou-ai-minigram） | `docs/ui/design-system.md` §6 + `rules/brand-interface/RULE.mdc` + `ui-design-spec.html` | 品牌橙 #F97316 / 深档 #C2410C、Claymorphism、小程序胶囊 TabBar、原生能力占位标注 |

I 维度（品牌与端一致性）专门判"串端"——admin 稿冒品牌色、H5 稿冒充原生能力等。

### 3.9 质疑边

新增到 Hub 质疑边总表（格式沿用 `challenge-playbook.md`）：

| 边 | 发起 | 目标 | 内容 | 回流 |
|---|---|---|---|---|
| 设计 → 原型 | `design-reviewer` | `ux-prototype-designer` | 阻塞项反例 | 退回重出，**不代改** |
| 设计 → 需求 | `design-reviewer` | `requirement-translation` | 需求未定义交互却要求脑补 / 判据不可审 | 补判据 |
| 设计 → 开发 | `design-reviewer` | `rd-execute` | D3 实现漂移项 | 交开发修复 |
| 原型 → 设计 | `ux-prototype-designer` | `design-reviewer` | 判据不可实现 / 与目标端平台冲突 | 复核判据 |
| 人 → 设计 | 用户 | `design-reviewer` | 驳回为"个人偏好"的建议项 | 降级采纳 |

最终仲裁权在人（challenge-playbook 总则）。

---

## 4. 落地清单（分两期）

### P0 · 角色与判据（本期，软约束，立即可用）

| # | 任务 | 产出文件 | 依赖 |
|---|---|---|---|
| T1 | 评审依据 | 新增 `docs/ui/design-system.md`（§3.3 目录） | 无 |
| T2 | 角色 | 新增 `.codebuddy/skills/design-reviewer/SKILL.md` | T1 |
| T3 | 清单 | 新增 `.codebuddy/skills/design-reviewer/references/design-review-checklist.md`（A–N） | T1 |
| T4 | 报告模板 | 新增 `.codebuddy/skills/design-reviewer/references/review-report-template.md`（含机器可读头） | 无 |
| T5 | Hub 接入 | 改 `.codebuddy/skills/rd-digital-agent/SKILL.md`：子技能矩阵加行 + 分派决策树加分支 + 评审链插 D1/D2/D3 | T2 · **转上游待办**（见下） |
| T6 | 质疑边 | 改 Hub「跨角色质疑边」表（§3.9 五条） | T5 · **转上游待办**（见下） |
| T7 | 动作门 | 改 `rules/ui-interface/RULE.mdc`、`rules/brand-interface/RULE.mdc`：动作门增 D2（交人前）/ D3（落码后） | T1 |
| T8 | 索引 | 改 `docs/ui/README.md`（文档表 + 任务×文档集 + §3 防漂移责任）、`.codebuddy/CODEBUDDY.md` §2.5 | T1 |

> T2 说明：本技能为**项目专属新建**（类比 `fe-developer` / `be-developer` 只在运行源），不与上游 `ai-agent-kit` 同名技能冲突，不触发 kit-gate S7 漂移校验。

### T5 / T6 转上游待办（2026-09-22 实查结论）

`rd-digital-agent` 是**上游通用技能**（本地 `.codebuddy/agent-kit/skills/` 未纳入它，无 `sync-agent-kit.sh`，本地 CI 亦无 S7 校验）。依 `kit-sop-enforcement` §3.6 纪律「运行源不得手改通用技能」，**本轮不直接改其运行源**，避免下次上游同步覆盖。

| 待办 | 路径 |
|---|---|
| Hub 分派决策树加 `design-reviewer` 分支 | 改上游 `ai-agent-kit` 的 `skills/rd-digital-agent/SKILL.md` → 走同步流程（另仓另 PR） |
| 子技能矩阵加行、评审链插 D1/D2/D3 | 同上 |
| 质疑边表增 §3.9 五条 | 同上 |

**本轮等效接入（已落）**：T7 两条端规则动作门（覆盖 admin 系 + 品牌端全部 UI 路径）+ T8 索引（`CODEBUDDY.md` §2.5 动作门 + `docs/ui/README.md` 读取地图）。即：改 UI 时经端规则触发 D2/D3，无需 Hub 分派亦生效；D1（设计输入评审）因属软约束，暂由 `@design-reviewer` 手动引用。

### P1 · 机器强制（P0 验证有效后）

| # | 任务 | 产出文件 | 依赖 |
|---|---|---|---|
| T9 | 锚点约定 | `docs/ui/design-system.md` §3 + `docs/ui/prototype-scaffold.html` 增 `data-dr` 约定 | T1 |
| T9b | **存量回填清单** | 新增 `docs/ui/anchor-backlog.md`（文件 / 端 / 是否关键结构 / 批次）+ 按 §3.7.1 顺序分批回填 | T9 |
| T10 | CI R11（**error**） | 改 `scripts/redline/scan-rules.sh`（新增 `check_r11`：R11-a trailer+阻塞清零 = error；R11-b 锚点比对受 `DESIGN_ANCHOR_MODE` 控制；不改调用方） | T4 |
| T11 | commit-msg | 改 `scripts/redline/check-commit-msg.sh`（校验 `Design:` trailer，口径与 `Proto:` 一致） | T4 |
| T12 | 机检脚本 | 新增 `scripts/redline/scan-design-drift.py`（锚点比对 + 裸色/emoji/!important/字重/间距巡检；锚点级别由 `scan-rules.sh` 的 `check_r11b` 按 `DESIGN_ANCHOR_MODE=off\|warn\|scoped\|strict` 定） | T9 |
| T13 | 自检 | 改 `scripts/redline/selfcheck-ui-gate.sh` 补 V1–V10 断言 | T10–T12 |

### P2 · 自动化视觉并置（可选）

| # | 任务 | 说明 |
|---|---|---|
| T14 | 截图并置 | 原型/实现截图自动并置生成差异页，供 D3-b 与人工复核 |

---

## 5. 验证判据表 V1…Vn

| # | 判据 | 验证手段 | PASS 条件 |
|---|---|---|---|
| V1 | 判据源单一 | 抽查 3 条评审结论，逐条追到 `design-system.md` 条目 | 3/3 可追到判据编号 |
| V2 | 独立性 | 让 `design-reviewer` 评审一份**已知含 5 处缺陷**的原型（缺陷由人预埋） | 报告中命中 ≥4 处，且未把"生产者自辩"当理由采信 |
| V3 | 反模式拦截 | 送一份只画主路径、异常分支全缺的原型 | 出阻塞项，结论为 ❌，不因"方向对"放行 |
| V4 | 分级与格式 | 任意一次评审报告 | 每条含 反例 + 判据编号 + 严重级 + 是否阻塞；无判据项已降级为"建议" |
| V5 | 两端覆盖 | 分别送 admin 系与品牌端原型各一份 | 报告判据源按端切换，I 维度能识别串端（admin 稿用品牌色 → 报阻塞） |
| V6 | D3 机检 | 原型删掉一个已打 `data-dr` 的关键元素后落实现 | 锚点比对报"缺失"，给出元素 key |
| V7 | D3 视觉 | 实现与原型间距/主色被人为改掉 | D3-b 差异表命中该两项 |
| V8 | CI R11（**error**） | 造一个 UI commit：① 不带 `Design:` trailer；② 带 trailer 但报告头部 `阻塞: 1` | 两种情形**均直接 error** 非零退出；纯后端 PR 不受影响（零摩擦） |
| V9 | 豁免口径一致 | 带 `Micro-exempt:` 的 UI 微调 commit | R9b / R10 / R11 三条口径一致，不出现"记了豁免还报错" |
| V10 | 零摩擦边界 | 纯文案修改、单文件 ≤5 行微调、纯后端改动各一次 | 不触发设计评审流程（不产生噪音） |

---

## 6. 风险与权衡

| 风险 | 缓释 |
|---|---|
| **评审沦为形式**（AI 自己出稿自己换个角色名再审） | 三条独立性机制（§3.1）+ V2 预埋缺陷回归；独立性失效时优先修机制而非加清单条目 |
| **摩擦过大导致门禁被关**（kit-sop-enforcement §3.7 头号失败模式；R11=error 使此风险升为首位） | 三重补偿：① R11 仅对含 UI 源码的 diff 生效，纯后端 PR 零摩擦；② `Micro-exempt` 同步豁免；③ 锚点比对走 `DESIGN_ANCHOR_MODE` 三档，存量回填完成前不 error（§3.7.1）。hook 侧不新增 deny；V10 守零摩擦边界 |
| **存量回填拖长、门禁长期半开** | T9b 清单驱动分 4 批，每批完成即把该批路径升到 `strict`，不等全量完成 |
| **判据不足 → 主观评审** | 先落 T1 判据源再落角色（T2 依赖 T1）；无判据项强制降级为"建议"并标注 |
| **评审依据与 tokens/rules 漂移** | `docs/ui/README.md` §3 追加同步责任行；`design-system.md` 不抄数值（沿用既有防漂移约定） |
| **D3 成本过高**（锚点打得过细变成负担） | 只对关键结构元素打锚点；D3-b 为软层；P2 才做自动化 |
| **拖慢交付节奏** | 小改动不触发（V10）；D1 仅中大型方案触发 |

---

## 7. 决议记录

### 7.1 已拍板（2026-09-22 用户拍板，直接执行）

| # | 议题 | 决议 | 影响 |
|---|---|---|---|
| Q1 | `design-system.md` 颗粒度 | **条目级**（7 节全填） | T1 一次到位，E–I 五个新维度均有判据可依 |
| Q2 | 锚点存量回填 | **存量也补** | 新增 T9b（清单驱动、分 4 批）；比对开关三档推进 |
| Q3 | R11 级别 | **直接 error**，不设 warning 观察期 | 摩擦风险升为首位 → 派生 §3.7.1 存量过渡三重补偿 |

### 7.2 派生项已拍板（2026-09-22）

| # | 议题 | 决议 |
|---|---|---|
| Q4 | 回填批次顺序 | 按建议序：**admin 主流程 → portal 主流程 → 小程序主包 → 分包低频** |
| Q5 | 单批次 warn 观察 | 允许：批次内先 `DESIGN_ANCHOR_MODE=warn` 观察一轮，再升 `strict` |
| Q6 | R11=error 上线值守 | 首周专人值守（用户已安排） |
| Q7 | 品牌端深档漂移 | 以代码 `--brand-txt: #EA580C` 为准，已订正 `rules/brand-interface/RULE.mdc`（原写 #C2410C） |

---

## 8. 接手须知（新对话怎么开工）

1. 先确认本文档已批注定稿（§7 待确认已拍板）。
2. 按 §4 的 P0（T1→T8）顺序落，**T1 未定稿不落 T2**。
3. 落完用 §5 的 V1–V5、V10 自测；P1 落完补 V6–V9。
4. 判据有增删时，同步改三处：`docs/ui/design-system.md`、两条端 rules 精要、`docs/ui/design.md`（防漂移）。
