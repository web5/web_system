# 跨工具 Agent 上下文装配设计（CodeBuddy / Claude Code / Codex / Cursor）

> 定位：把「项目总入口 + 技能体系」从 CodeBuddy 专属路径解耦为**单一真相源 + 各工具薄适配层**，使同一套 `.codebuddy/agent-kit/` 能力在 Claude Code / Codex / Cursor 等工具下同样可加载。
> 本文是**设计方案 spec**：先评审、后实施；评审通过前**不改动现有结构**。
> 配套：`.codebuddy/CODEBUDDY.md` §3.7（挂载关系）、`docs/development/agent-capability-playbook.md`（Agent 能力手册）、`scripts/redline/check-kit-structure.sh`（结构守护）。
>
> 变更日志：
> - 2026-09-11：初稿。现状基线 + 各工具加载机制事实核对 + 三方案对比 + 目标态装配 + 影响清单 + 验证判据表 V1…Vn。
> - 2026-09-11：挂位落地（B1~B3 完成，见附录 B）。**未实施 §4 目标态结构改动**（待评审）。

---

## 0. 问题与结论（TL;DR）

**问题**：`.codebuddy/agent-kit/` 的内容本身是**纯 Markdown、与工具无关**（任何 AI 工具都能读），但**所有入口路径都写死在 `.codebuddy/` 下** —— 只有 CodeBuddy 会主动去读该目录 → 其他工具"看不见"这套能力。

**结论三条**：

1. `CODEBUDDY.md` 的**官方规范位置就是项目根目录**，所以「放外面」完全可行；但它是 CodeBuddy **专属文件名**，单纯换位置**不解决通用性**（Claude / Codex / Cursor 依然不读）。
2. CodeBuddy **已内置 `AGENTS.md` 兼容通道**：项目根存在 `AGENTS.md` 且不存在 `CODEBUDDY.md` 时，自动加载 `AGENTS.md` 全文 → **无需为 CodeBuddy 做任何适配**（见 §2 事实 F1/F2）。
3. 推荐落地方案：**单一真相源 `AGENTS.md` + 各工具薄适配层（软链 / `@` 导入）**，内容零复制、零漂移。

---

## 1. 现状基线（2026-09-11 实测）

| 项 | 现状 | 影响 |
|---|---|---|
| 工具专属入口 | `.codebuddy/CODEBUDDY.md`（448 行 / ~30 KB，v2 五段式） | 仅 CodeBuddy 加载；其他工具无入口 |
| 能力源 | `.codebuddy/agent-kit/`（AGENT.md + skills 14 + rules/general 5 + references 11） | **纯 Markdown，本身与工具无关**，是可直接复用的资产 |
| 运行源 | `.codebuddy/skills/`（19 个 SKILL.md = 镜像 14 + 项目专属 be/fe-developer） | 同上；frontmatter 字段：`name/description/version/rationale/checks/loads` |
| 触发规则 | `.codebuddy/rules/ui-interface/RULE.mdc`（frontmatter：`description/alwaysApply/enabled/updatedAt`） | 与 Cursor `.mdc` 字段同源，具备直接搬运条件 |
| 根目录现状 | **无** `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `.cursor/` / `.claude/` | 三家工具当前都读不到本项目上下文 |
| 已有易混项 | 根目录存在 `agents/`（复数、无点，含 wechat-insight / wechat-voice 技能）与 `.workbuddy/`（已 gitignore） | `agents/` 是技能目录，与 `AGENTS.md` 不冲突但易混淆，文档需显式说明 |
| git symlink | `core.symlinks` 未显式设置（macOS 默认 true） | 软链方案在本项目可用；跨平台需注意 |
| 结构守护 | `scripts/redline/check-kit-structure.sh` S1~S7（含 S7 运行源↔能力源零漂移） | 新增入口层需扩一条同类守护，否则装配会静默漂移 |

---

## 2. 各工具加载机制（事实核对）

> 可信度标注：**A = 官方文档原文确认**；**B = 社区二手资料，需实测**。A 类可直接依赖，B 类落地前必须逐条验证。

| # | 工具 | 事实 | 可信度 | 来源 |
|---|---|---|---|---|
| F1 | CodeBuddy | `CODEBUDDY.md` 位于**项目根目录**，全文进上下文；无元数据、无复杂配置 | A | CodeBuddy 文档 · Rules |
| F2 | CodeBuddy | 根目录存在 `AGENTS.md` **且不存在** `CODEBUDDY.md` 时，自动加载 `AGENTS.md` 全文；**两者并存以 `CODEBUDDY.md` 为准** | A | CodeBuddy 文档 · Rules |
| F3 | CodeBuddy | 项目规则在 `.codebuddy/rules/<name>/RULE.mdc`，frontmatter 支持 `alwaysApply/description/enabled`；规则**只在会话开头加载**，改完必须新建会话 | A | CodeBuddy 文档 · Rules |
| F4 | CodeBuddy | 项目级技能在 `.codebuddy/skills/`，`SKILL.md` 带 `name/description` frontmatter 的目录式技能 | A | CodeBuddy 文档 · Overview |
| F5 | Claude Code | 项目记忆文件 `CLAUDE.md`，支持 `@path` 子规则导入语法 | B | 社区资料（Anthropic 文档提及"子规则导入"） |
| F6 | Claude Code | 技能目录 `.claude/skills/`，`SKILL.md` + `name/description` frontmatter（Agent Skills 开放格式） | A（目录存在）/ B（与本项目字段兼容性） | Anthropic · Claude Code Skills |
| F7 | Codex CLI | 只认 `AGENTS.md` 系列（不读 `CLAUDE.md`）；同目录 `AGENTS.override.md` > `AGENTS.md`；**就近目录优先**，支持子目录嵌套与逐级向上查找 | B | 社区资料 |
| F8 | Cursor | 原生读取根 `AGENTS.md`；规则目录 `.cursor/rules/*.mdc`，frontmatter：`description/globs/alwaysApply` | B | 社区资料 |
| F9 | Gemini CLI | 记忆文件 `GEMINI.md`，可用 `contextFileName` 配置改路径 | B | 社区资料 |
| F10 | GitHub Copilot | `.github/copilot-instructions.md` | B | 社区资料 |

**由 F1~F3 推出的关键设计约束**：

- 若根目录放 `AGENTS.md`、同时保留 `.codebuddy/CODEBUDDY.md` 原文，则 CodeBuddy 走 F2 后半句（以 CODEBUDDY.md 为准）→ **两份内容并存 = 两个真相源**，必然漂移。故 `.codebuddy/CODEBUDDY.md` 必须降级为**软链**（物理同一份）或**纯指针**。
- AI 上下文入口**只在会话开头加载**（F3）→ 任何入口层改动**必须新开会话**才能验证，无法在本会话内自证。

---

## 3. 候选方案对比

| 方案 | 做法 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A. 软链（推荐）** | 内容源放根 `AGENTS.md`；`CLAUDE.md` / `.codebuddy/CODEBUDDY.md` / `GEMINI.md` 全部 `ln -s` 指向它 | 内容物理唯一，**不可能漂移**；零维护；git 只存链接记录 | Windows 需开发者模式 + `core.symlinks=true`；部分工具是否**跟随软链**需实测 | ✅ 首选 |
| **B. 指针文本** | `CLAUDE.md` 写 `@AGENTS.md`；CODEBUDDY.md 写"见 ../AGENTS.md" | 跨平台稳；符合各工具原生语法 | 依赖 AI **主动执行**指针（CodeBuddy rules 无 import 语法，只能靠 always 规则引导）；多一跳读取 | ⚠️ 备选 / 与 A 组合 |
| **C. 生成器 + CI 校验** | 单一源 + 脚本生成各工具入口副本 + CI 校验一致性 | 完全跨平台；不依赖软链跟随行为 | 引入生成器与校验脚本；副本存在"构建产物"语义；比 A 重 | ⚠️ 退路（当 A 的软链不被某工具跟随） |

**推荐：A 为主 + B 补充**（Claude Code 用官方 `@` 导入，其余用软链），**C 作为 A 失效时的退路**。

> 选择 C 的触发条件：实测发现某工具**不跟随软链**（典型是递归扫描目录类机制，如 skills 目录扫描）。此时对**该工具单独**降级为"镜像 + CI 漂移校验"——本项目已有同类成熟模式（S7 运行源↔能力源零漂移），团队认知成本最低。

---

## 4. 目标态装配

```
项目根/
├── AGENTS.md                        ★ 唯一真相源（内容 = 现 .codebuddy/CODEBUDDY.md 全文）
│                                       Codex / Cursor 原生自动读；Copilot 需软链
├── CLAUDE.md                        ← `@AGENTS.md`（Claude Code 官方导入语法）
├── GEMINI.md                        ← 软链 → AGENTS.md（可选，P2）
├── .github/copilot-instructions.md  ← 软链 → ../AGENTS.md（可选，P2）
│
├── .codebuddy/                      ← 结构不动，仅入口文件降级
│   ├── CODEBUDDY.md                 ← 软链 → ../AGENTS.md（F2：两条通道命中同一份）
│   ├── agent-kit/                   ← 能力源，完全不动
│   ├── skills/                      ← 运行源 19 技能，完全不动
│   └── rules/ui-interface/RULE.mdc  ← 完全不动
│
├── .cursor/rules/
│   ├── 000-project.mdc              ← alwaysApply: true，引导读 AGENTS.md + 技能路由
│   └── ui-interface.mdc             ← 软链 → ../../.codebuddy/rules/ui-interface/RULE.mdc
│
└── .claude/
    └── skills                       ← 软链 → ../.codebuddy/skills（19 技能复用）
```

**设计要点**：

1. **`AGENTS.md` 是唯一内容源**。任何项目上下文/铁律的修改只改它一处。
2. **技能层不复制**。运行源 `.codebuddy/skills/` 原样保留（S7 守护的既有契约不变），他用工具通过软链或指针访问。
3. **`.codebuddy/rules/RULE.mdc` 与 Cursor `.mdc` 字段同源**，UI 规则可零改写搬运。
4. **不引入第二套技能**。Codex / Cursor 无正式 skills 机制，策略是"由 `AGENTS.md` / `.cursor/rules` 里的路由表引导 AI 按需读 `.codebuddy/skills/rd-digital-agent/SKILL.md`"，**不为其另造一份技能树**（否则违反自身的"唯一编排权"原则）。

---

## 5. 各工具覆盖矩阵（目标态）

| 工具 | 指南层（项目总入口） | 技能层（19 技能） | 规则层（UI 等触发规则） |
|---|---|---|---|
| CodeBuddy | ✅ `.codebuddy/CODEBUDDY.md`（软链） | ✅ `.codebuddy/skills/` 原生 | ✅ `.codebuddy/rules/` 原生 |
| Claude Code | ✅ `CLAUDE.md` `@AGENTS.md` | ✅ `.claude/skills` 软链（**待实测跟随**） | ⚠️ 无 `.mdc` 机制，转为 `CLAUDE.md` 内一节或 `.claude/rules`（P2） |
| Codex CLI | ✅ 原生读 `AGENTS.md` | ⚠️ 无 skills 机制 → 路由表引导按需读 | ⚠️ 无 → 同上 |
| Cursor | ✅ 原生读 `AGENTS.md` | ⚠️ 无 → `.cursor/rules` 路由引导 | ✅ `.cursor/rules/ui-interface.mdc` |
| Gemini CLI | ✅ `GEMINI.md` 软链（P2） | ⚠️ 同上 | ⚠️ 同上 |
| Copilot | ✅ `.github/copilot-instructions.md` 软链（P2） | ⚠️ 同上 | ⚠️ 同上 |

> 图例：✅ 原生或直接可用；⚠️ 需适配/降级可用。

---

## 6. 实施步骤（分期）

**P0 · 指南层打通（最小可用，覆盖三家）**

1. 新建根 `AGENTS.md`，内容 = 现 `.codebuddy/CODEBUDDY.md` 全文（v2 五段式）。
2. `.codebuddy/CODEBUDDY.md` → 删除原文，改为软链 `ln -s ../AGENTS.md .codebuddy/CODEBUDDY.md`。
3. 新建 `CLAUDE.md`：首行 `@AGENTS.md`，下附 Claude 专属覆盖位（留空）。
4. 新建 `.cursor/rules/000-project.mdc`：`alwaysApply: true`，内容为"项目总入口在 `AGENTS.md`，先读它；技能路由见 §3.3"。
5. 实测验证 V1~V5（见 §11）。

**P1 · 技能层打通**

6. `ln -s ../.codebuddy/skills .claude/skills`（注意：`.claude/` 目录需先建）。
7. `ln -s ../../.codebuddy/rules/ui-interface/RULE.mdc .cursor/rules/ui-interface.mdc`。
8. 实测验证 V6~V8：软链是否被各工具跟随；若不跟随，按 §3 方案 C 对该工具改镜像 + CI 校验。

**P2 · 守护与外围**

9. `check-kit-structure.sh` 新增 **S9 入口一致性**：断言根 `AGENTS.md` 存在、`.codebuddy/CODEBUDDY.md` 与之一致（软链指向或内容 `cmp` 相等）、`CLAUDE.md` 含 `@AGENTS.md`。
10. `.gitignore` 补：`CLAUDE.local.md`、`.agents/memories/`、`.cursor/mcp.json`（个人/本地配置）。
11. 文档同步（见 §7 第 6~8 项）。
12. 可选：`GEMINI.md`、`.github/copilot-instructions.md` 软链。

---

## 7. 影响清单

| # | 动作 | 文件 | 类型 | 风险 |
|---|---|---|---|---|
| 1 | 内容源迁移 | `AGENTS.md` | 新增 | 与旧入口漂移 → **必须同批删除旧原文、改软链**，不可两轮做 |
| 2 | 入口降级 | `.codebuddy/CODEBUDDY.md` | 改（内容→软链） | CodeBuddy 加载行为变化，**需新会话实测**；回滚 = 还原文件 |
| 3 | Claude 入口 | `CLAUDE.md` | 新增 | 无 |
| 4 | Cursor 入口 | `.cursor/rules/000-project.mdc` | 新增 | Cursor 对 `alwaysApply: true` 数量敏感，只保留 1 条总入口 |
| 5 | Cursor UI 规则 | `.cursor/rules/ui-interface.mdc` | 软链 | 无 |
| 6 | Claude 技能 | `.claude/skills` | 软链 | **待实测**：目录扫描是否跟随软链；不跟随则改 C 方案 |
| 7 | 结构守护 | `scripts/redline/check-kit-structure.sh` | 改（+S9） | CI 行为变化，需同步 `.github/workflows/kit-gate.yml` 触发路径 |
| 8 | 入口索引 | `.codebuddy/CODEBUDDY.md`（→AGENTS.md）附录 B + 维护约定 | 改 | 不改则文档失真（与本方案 §4 目标态对齐） |
| 9 | 能力手册 | `docs/development/agent-capability-playbook.md` | 改 | 项目要求：Agent 能力变更必须同步该手册（§8 维护约定） |
| 10 | 挂载关系图 | `.codebuddy/CODEBUDDY.md` §3.7 | 改 | 与第 8 项同批 |
| 11 | 忽略规则 | `.gitignore` | 改 | 防个人配置误入库 |
| 12 | 文档挂位 | 本文档 | — | 评审通过后需挂入 `.codebuddy/CODEBUDDY.md` 附录 A 文档地图（否则将被遗忘） |

**不动的东西（明确边界）**：`.codebuddy/agent-kit/`（能力源）、`.codebuddy/skills/`（运行源）、`.codebuddy/rules/`、`scripts/sync-agent-kit.sh` 的同步契约、S1~S7 守护语义。

---

## 8. 守护与防漂移

本方案最大的失败模式是**入口层静默漂移**（改了 `AGENTS.md`，某份副本没跟）。防线三道：

1. **物理防线**：软链让"多份"在文件系统层不存在（方案 A 的核心价值）。
2. **机器防线**：`S9 入口一致性`（P2-9），断言入口文件的指向与内容一致；与既有 S7（运行源↔能力源零漂移）同一模式。
3. **文档防线**：`.codebuddy/CODEBUDDY.md` 维护约定新增一条 —— "**项目上下文只改根 `AGENTS.md`**，其余入口一律为软链/指针"。

---

## 9. 待确认项（实施前必须实测）

| # | 待确认 | 验证方式 | 不通过时的退路 |
|---|---|---|---|
| Q1 | CodeBuddy 在 `.codebuddy/CODEBUDDY.md` 为软链时，是否正常加载（软链跟随） | 新会话问 AI"项目入口讲了哪五段" | 改为**薄指针**保留原文（方案 B），或保留真文件 + `AGENTS.md` 用生成器同步（方案 C） |
| Q2 | CodeBuddy 是否**因 `.codebuddy/CODEBUDDY.md` 存在**而压制 AGENTS.md（F2 后半句的"存在"是否含该路径） | 临时重命名该文件，新会话观察是否仍加载到项目上下文 | 保留软链即可（内容一致，无论走哪条通道） |
| Q3 | Claude Code `CLAUDE.md` 的 `@AGENTS.md` 是否解析到根目录相对路径 | 新会话问 AI 项目端口表 | 写绝对相对路径 `@./AGENTS.md`，或改用软链 `ln -s AGENTS.md CLAUDE.md` |
| Q4 | `.claude/skills` 软链是否被 Claude Code 的目录扫描跟随 | 新会话 `/skills` 或问"有哪些技能" | 方案 C：镜像技能目录 + S9 校验（**注意会造成 19 技能双份，需评估**） |
| Q5 | 本项目 SKILL.md 的自定义 frontmatter（`rationale/checks/loads`）是否被 Claude 判为非法 | 观察是否报解析错误 | 移除/下沉自定义字段，或仅对 `.claude/` 侧做字段裁剪（成本高，优先级低） |
| Q6 | Cursor 与 Codex 当前版本是否真读根 `AGENTS.md`（F7/F8 为二手信息） | 各自新会话问项目架构 | 分别退到 `.cursor/rules` 与 `.codex/` 或额外指针文件 |
| Q7 | 用户级全局配置（`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md`）是否与本项目入口冲突 | 检查本机是否存在 | 冲突内容下沉/上提，避免双份 |

---

## 10. 风险与回滚

| 风险 | 等级 | 回滚方式 |
|---|---|---|
| CodeBuddy 无法加载软链 → 入口失效，AI 失去项目上下文 | 高 | `git checkout .codebuddy/CODEBUDDY.md` 还原真文件（`AGENTS.md` 可保留，成为纯增量） |
| 三家工具上下文叠加导致 token 膨胀（同一份内容被多处加载） | 中 | 软链下内容物理唯一，仅"读取"可能重复；`AGENTS.md` 已控制在 ~30 KB，可接受；必要时下沉细节到 docs |
| 与用户级全局 `AGENTS.md`（F7 的 `~/.codex/AGENTS.md`）叠加冲突 | 中 | 本项目入口只写项目专属内容，通用偏好留在用户级 |
| Cursor `alwaysApply: true` 过多导致规则被稀释 | 低 | 只保留 1 条总入口规则 |

**整体回滚成本**：极低。全部改动集中在 4 个新增入口文件 + 1 个软链替换 + 2 处脚本/文档，`git revert` 即可回到现状。

---

## 11. 验证判据表（V1…Vn）

> 按项目规范：判据必须编号、可验证；「完成声明 = 验证证据」。标注 🤖 的可机器判定，标注 👤 的需新会话人工确认（AI 上下文入口只在会话开头加载，机器无法自证）。

| 编号 | 判据（做成 = 一句话可验证） | 验证手段（可跑的命令 / 操作） | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V1 | 🤖 根 `AGENTS.md` 存在且为唯一内容源 | `test -f AGENTS.md && wc -l AGENTS.md` | 文件存在，行数 ≈ 原 CODEBUDDY.md（448 行） | 先补内容源，不做后续步骤 |
| V2 | 🤖 `.codebuddy/CODEBUDDY.md` 与 `AGENTS.md` 内容一致（软链或 `cmp` 相等） | `[ -L .codebuddy/CODEBUDDY.md ] \|\| cmp -s AGENTS.md .codebuddy/CODEBUDDY.md` | 退出码 0 | 说明仍有两份真文件 → 立即改软链 |
| V3 | 🤖 `CLAUDE.md` 首行含 `@AGENTS.md` | `head -1 CLAUDE.md \| grep -q '@AGENTS.md'` | 匹配成功 | 修正导入行 |
| V4 | 🤖 Cursor 总入口规则存在且 `alwaysApply: true` | `grep -q 'alwaysApply: true' .cursor/rules/000-project.mdc` | 匹配成功 | 修正 frontmatter |
| V5 | 👤 CodeBuddy 新会话能复述项目上下文 | 新开会话提问："本项目 gateway/ai-agent 端口分别是多少" | 回答含 6000 / 6010 且引用 AGENTS.md 内容 | 触发 Q1/Q2 退路 |
| V6 | 👤 Claude Code 新会话能复述项目上下文 | 新开会话提问同上 | 回答含 6000 / 6010 | 触发 Q3 退路（改软链） |
| V7 | 👤 Claude Code 能列出技能 | 新会话问："有哪些 rd-* 技能" | 列出 rd-plan/rd-execute/rd-review 等 | 触发 Q4 退路（方案 C） |
| V8 | 👤 Cursor 新会话能复述项目上下文 | 新开会话提问同上 | 回答含 6000 / 6010 | 触发 Q6 退路 |
| V9 | 👤 Codex 新会话能复述项目上下文 | 新开会话提问同上 | 回答含 6000 / 6010 | 触发 Q6 退路 |
| V10 | 🤖 S9 守护生效 | `bash scripts/redline/check-kit-structure.sh` | 通过（0 error） | 修守护脚本或入口一致性 |
| V11 | 🤖 既有守护未退化 | 同上，检查 S1~S7 全通过 | 0 error / 0 新增 warning | 回滚第 7 项改动 |

**交付门槛**：V1~V4 + V10 + V11 必须机器通过；V5~V9 由人工在新会话逐家确认并记录结果（哪家过、哪家走了退路）。

---

## 附录 A：引用来源

| 来源 | 用途 | 可信度 |
|---|---|---|
| CodeBuddy 官方文档 · Rules — <https://www.codebuddy.ai/docs/zh/ide/User-guide/Rules> | F1 / F2 / F3（CODEBUDDY.md 位置、AGENTS.md 兼容、RULE.mdc 与加载时机） | A |
| CodeBuddy 官方文档 · Overview — <https://www.codebuddy.ai/docs/zh/ide/User-guide/Overview> | F4（`.codebuddy/skills/` 与 `.codebuddy/rules/`） | A |
| Anthropic · Claude Code Skills — <https://docs.anthropic.com/en/docs/claude-code/skills> | F6（`.claude/skills/` 存在与格式） | A（目录）/ B（字段兼容） |
| 社区文章 · 搞懂 AI 编程配置：.agents / .claude / .codex — <https://juejin.cn/post/7645206291103203370> | F5 / F7 / F8 及优先级归纳 | B |
| 社区文章 · AGENTS.md 跨工具标准实战 — <https://developer.aliyun.com/article/1758831> | 软链/导入两种兼容手法、各工具原生文件名 | B |
| `AGENTS.md` 开放标准（社区托管于 Agentic AI Foundation） | 命名与就近优先约定的背景 | B（未直接访问规范全文） |

> 二手信息的版本时效性风险：AI 工具迭代快，F5/F7/F8/F9/F10 在实施前按 §9 Q3~Q7 逐条实测，**不以上表为最终依据**。

## 附录 B：本文档的挂位与状态

| # | 动作 | 状态 | 说明 |
|---|---|---|---|
| B1 | `.codebuddy/CODEBUDDY.md` **§1.5 详细说明入口**追加本文档 | ✅ 已完成（2026-09-11） | 标注「设计方案，待评审，尚未实施」 |
| B2 | `.codebuddy/CODEBUDDY.md` **附录 A 文档地图** `docs/development/` 行追加 | ✅ 已完成（2026-09-11） | — |
| B3 | `docs/development/agent-capability-playbook.md`「附：相关文档索引」追加本文档 | ✅ 已完成（2026-09-11） | — |
| B4 | `.codebuddy/CODEBUDDY.md` **§3.7 技能/规则挂载关系**补跨工具入口层 | ⏳ 待 **P0 实施后**执行 | §3.7 描述**现状**装配；本文档尚未实施，提前改会造成文档失真 |
| B5 | `docs/development/agent-capability-playbook.md` §8.1 对照表新增「改入口装配 / 新增工具适配 → 更新本文档」 | ⏳ 待 **P1 实施后**执行 | 与 B4 同理，属实施后的维护约定 |
| B6 | `.codebuddy/CODEBUDDY.md` **附录 B（.codebuddy 结构图）**补根目录入口文件（`AGENTS.md` / `CLAUDE.md` / `.cursor/`） | ⏳ 待 **P0 实施后**执行 | 同上 |
