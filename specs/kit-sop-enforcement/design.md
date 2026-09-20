# 方案 · ai-agent-kit SOP 强制机制（kit-sop-enforcement）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 状态：**方案待确认（未落码）**
> 日期：2026-09-20
> 性质：**自包含方案** —— 接手者无需回看提出本方案的对话即可执行
> 上游规范：`.codebuddy/agent-kit/`（`AGENT.md`、`rules/general/01–05`、`references/fe-dev-common.md`）
> 相关技能：`skills/rd-plan`（§3.5 原型判定 + V1…Vn）、`skills/ux-prototype-designer`（+ `references/ux-review-checklist.md`）

---

## 0. 一页速览

**要解决的问题**：agent 会在"用户直接提 UI 微调"时跳过 agent-kit 的 SOP（典型：先改原型稿 → 用户确认 → 才落代码），直接编辑落地代码。

**根因判定**：不是"记性"问题，而是 4 个结构性断点（常驻层只做索引、规则真空、触发词失配、无机器检查）。**靠补充提示词不可能修好** —— kit 自身原则即「文本约定会退化，须降层为机器检查才稳定」（`agent-kit/README.md`「三层规则」+ 红线 05）。

**方案**：把 SOP 从"提示"降层为"拦截"，分五层落地，其中 **L3（CodeBuddy Hook 硬阻断）+ L4（CI 红线 R9）是真强制**，L1/L2 为文本第一道，L5 为上游回归。

**范围**：`web_system` 仓库（L1–L4）+ 上游 `ai-agent-kit` 仓库（L5，另仓另 PR）。

**成本**：L2+L3+L4 约 2–3 小时；L1 顺带 10 分钟；L5 半天+（需走上游 eval 门禁）。

**前置**：确认 §7 待确认项（尤其**豁免出口**的设计，否则摩擦会导致 hook 被关掉）。

---

## 1. 问题与根因（4 个断点，均带证据）

| # | 断点 | 证据（可自行核验） |
|---|---|---|
| 1 | **常驻层只做索引，不做动作门** | `.codebuddy/CODEBUDDY.md` 全文 4 节，第 2 节原文为「AI 技能继承 `.codebuddy/agent-kit/` —— **需要的技能从这里找**」——被动取用语义。而含「开工前置 · 不分级不变量」的 `agent-kit/AGENT.md` §43–52 **不是 IDE 常驻加载文件**；IDE 常驻加载的只有 `CODEBUDDY.md` |
| 2 | **规则真空（品牌端无覆盖）** | `.codebuddy/rules/ui-interface/RULE.mdc` 首行即写「适用：deploy-console / admin / mcp-admin / 内部工具端。**portal / kedou-ai-minigram 品牌端不适用（DR-5）**」→ 小程序前端改动无任何项目级规则兜底 |
| 3 | **触发词失配（最隐蔽）** | `skills/ux-prototype-designer/SKILL.md` frontmatter `description` 触发词为「原型稿生成 / 交互怎么设计 / 页面信息架构 / 做个可点击的稿看看 / 小程序…先看交互」；而用户真实措辞是「**输入框换行间距高了**」「**tabBar 得隐藏起来**」——零命中，技能不加载 |
| 4 | **无机器检查** | `scripts/redline/scan-rules.sh` 只管 R1~R8（代码红线）；`scripts/redline/check-kit-structure.sh` 只管 S1~S7（kit 结构漂移）。二者均不涉及「UI 改动是否走过原型」 |

**结论**：四个断点里，#3 说明"补触发词"路线不可靠（措辞空间无限），#1/#2 是软约束，#4 是缺失的硬约束。**必须补机器层。**

---

## 2. 现状基建盘点（可直接复用，勿另造）

| 资产 | 位置 | 可复用点 |
|---|---|---|
| 红线扫描 | `scripts/redline/scan-rules.sh` | 已实现 **R1~R8**（R1–R4 error / R5、R8 warning）、四模式（`cached` / `diff <ref>` / `files` / `tree`）、`--strict`、`--no-color`。**新增 R9 只需加判定函数，勿改调用方** |
| git hook 安装 | `scripts/redline/install-git-hooks.sh`、`check-commit.sh` | 本地 pre-commit 通道已存在 |
| kit 结构守护 | `scripts/redline/check-kit-structure.sh` + `.github/workflows/kit-gate.yml` | **S1~S7**（含 S7「运行源与能力源零漂移」）→ 决定了 L5 不能手改运行源 |
| PR 质量门 | `.github/workflows/quality-gate.yml` | job1 `redline-scan`（扫 PR diff）+ job2 `changed-packages`；master 分支保护要求其通过 → **R9 接进来即生效** |
| CodeBuddy Hooks | `.codebuddy/settings.json`（**当前不存在，需新建**） | 7 类事件；`PreToolUse` 可硬阻断（`continue:false` + `permissionDecision:"deny"`，或退出码 2） |
| 项目规则目录 | `.codebuddy/rules/`（现有 `coding-best-practices.md`、`ui-interface/RULE.mdc`） | L2 在此新增品牌端规则 |

**CodeBuddy Hook 的关键事实**（已核官方文档，实现时必读）：

- 配置位置：项目级 `<workspace>/.codebuddy/settings.json`（优先级高于用户级 `~/.codebuddy/settings.json`）
- 结构：`hooks.<事件名>` 为数组，元素 = `{ matcher, hooks: [{ type: "command", command, timeout }] }`
- `matcher` 对 `PreToolUse` / `PostToolUse` 匹配 **`tool_name`**，支持多值（如 `"Write|Edit"`）
- stdin 为 JSON，含 `session_id` / `cwd` / `hook_event_name` / `tool_name` / `tool_input`
- stdout 为 JSON：`continue`、`stopReason`、`hookSpecificOutput.{hookEventName, permissionDecision, permissionDecisionReason, modifiedInput}`
- 退出码：**2 = 阻塞**（stderr 回传给模型）；1 及其他 = 非阻塞警告
- ⚠️ **最大坑：`tool_name` 双风格**。IDE（Craft Agent）为 `write_to_file` / `replace_in_file` / `execute_command` / `read_file`；CLI 为 `Write` / `Edit` / `Bash` / `Read`。**脚本内禁止硬编码单一风格**，且 `tool_input` 字段名可能是 `filePath` 或 `file_path`，须兼容
- 多个 hook 并行执行、**不保证顺序**；相同命令自动去重；`timeout` 默认 60s

---

## 3. 设计

### 3.1 核心原则：判据挂在「改动对象」，不挂在「用户措辞」

触发词空间无限（"间距高了 / 太丑 / 挪一下 / 隐藏 / 换个色"），而**改动对象的路径是有限且可靠的**。因此所有机器层（L3/L4）统一按 **"这次要写的是不是 UI 源码文件"** 判定，而非按用户说了什么。

**UI 源码（受门禁约束）**：

```
apps/*/pages/**             (wxml / wxss / ts / json)
apps/*/src/**/*.vue         (admin 系微前端)
apps/*/components/**
packages/ui/**
app.json                    (信息架构：pages / tabBar)
```

**原型与规格（通行证路径）**：

```
apps/*/prototype/**
docs/ui/prototypes/**
specs/**/page-spec*.md
```

### 3.2 L1 · 常驻动作门（软，但必须是第一道）

在 `.codebuddy/CODEBUDDY.md` 新增一节，**写成动作门而不是索引**：

```markdown
## 2.5 动作门（不可跳，且与用户措辞无关）

凡本次改动涉及下列任一路径 —— **无论用户如何表达（含「间距高了」「太丑」「隐藏掉」这类微调措辞）**：

- `apps/*/pages/**`、`apps/*/components/**`、`packages/ui/**`、`app.json`
- 任何 `*.wxml` / `*.wxss` / `*.vue` 的界面文件

必须按序执行，**不得跳步**：
1. 先改原型稿（`apps/*/prototype/index.html` 或 `docs/ui/prototypes/**`）+ 同步页面规格（`specs/**/page-spec*.md`）
2. 过 `ux-prototype-designer` 的独立交互质检（`references/ux-review-checklist.md`）
3. **用户确认原型** ← 人审节点，缺此步不得落码
4. 才编辑落地代码（WXML/WXSS/Vue）

例外：纯后端 / 非 UI 文件改动不受本门约束。
豁免：确属纯视觉微调（如仅调间距）时，在原型或 page-spec 中记一行「微调豁免」即可通行。
```

> 为什么写"无论用户如何表达"：断点 #3 的根因是措辞失配。把判定条件从措辞改成路径，才能堵住它。

### 3.3 L2 · 品牌端规则（半硬）

新建 `.codebuddy/rules/brand-interface/RULE.mdc`，把上节动作门固化为**项目规则**（IDE 会作为可请求规则加载），并显式声明补上 DR-5 留下的规则真空：

```markdown
# 品牌端 UI 实现规则（portal / kedou-ai-minigram）

> 与 `ui-interface/RULE.mdc` 并列：那条只管 admin 系（deploy-console / admin / mcp-admin）；
> 品牌端（portal / kedou-ai-minigram）由本规则覆盖 —— 补 DR-5 的规则真空。

## 动作门（顺序不可跳）
1. 原型优先：先改 `prototype/index.html`（或 `docs/ui/prototypes/**`）
2. 交互质检：过 `ux-prototype-designer/references/ux-review-checklist.md`
3. 用户确认 ← 缺此不得写落地代码
4. 落码

## 最小禁项
- 禁裸 hex（除原型 `:root` / `app.wxss` token 层）；色值走 `--brand-*` 等 token
- 禁 emoji 图标
- 平台原生能力（原生导航栏自绘、分享、支付）不得伪装已实现，须占位 + 标注真机语义
- 产品主色：品牌橙 `#F97316`；文本/选中态用深档 `#C2410C`（对比度 5.4:1）
```

### 3.4 L3 · Hook 硬阻断（真强制，本方案核心）

新建 `.codebuddy/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "write_to_file|replace_in_file|Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 $CODEBUDDY_PROJECT_DIR/scripts/redline/hook-ui-prototype-gate.py",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "write_to_file|replace_in_file|Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 $CODEBUDDY_PROJECT_DIR/scripts/redline/hook-mark-proto-touched.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**门禁脚本 `hook-ui-prototype-gate.py` 逻辑**：

1. 读 stdin JSON；取 `tool_name` 与 `tool_input`（`filePath` 或 `file_path`，二者兼容）
2. 路径不在 §3.1「UI 源码」集合内 → `exit 0`（零摩擦）
3. 命中豁免：
   - 标记文件 `.codebuddy/.state/proto-touched` 存在且未过期（如 8 小时）→ `exit 0`
   - 环境变量 `UI_GATE=off` → `exit 0`
4. 否则输出阻断并 `exit 0`（用 JSON 表达 deny，比退出码 2 更可控）：

```json
{
  "continue": false,
  "stopReason": "UI 改动须先过原型",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "本次会话尚未修改原型/页面规格。请先改 apps/<app>/prototype/index.html 或 specs/**/page-spec*.md，过 ux-review-checklist 并取得用户确认；纯视觉微调请在原型里记一行「微调豁免」。"
  }
}
```

**标记脚本 `hook-mark-proto-touched.py` 逻辑**：`tool_input` 路径命中 §3.1「原型与规格」集合 → 写 `.codebuddy/.state/proto-touched`（内容含 ISO 时间戳）。

**门禁判定用「会话内是否动过原型」，不用 git status**：理由 —— `git status` 会把上一次会话的残留改动算进来，导致门禁在第二次会话永久失效；标记文件可按会话/时效控制，语义更准。

**已知局限（必须接受）**：hook 只能验证"原型被改过"，**无法验证"用户已确认"**。它把「先原型」变成物理顺序约束；"确认"仍靠人审，可由 §3.3 规则与 L1 动作门补充约束。

### 3.5 L4 · CI 红线 R9（防绕过兜底）

在 `scripts/redline/scan-rules.sh` 内新增一个判定函数（该脚本已声明「白名单/阈值调整：改下方 R* 判定函数，勿改调用方」）：

| 项 | 内容 |
|---|---|
| 规则号 | **R9** |
| 级别 | **warning**（`--strict` 下升级为 error）—— 初期避免阻断正常 PR |
| 触发 | diff 中出现 ① `apps/*/pages/**` **新增文件**；或 ② `app.json` 的 `pages` / `tabBar` 段变化 |
| 判据 | 同一 diff 中**必须**同时出现通行证路径变化：`apps/*/prototype/**`、`docs/ui/prototypes/**` 或 `specs/**/page-spec*.md` |
| 不满足时 | 报 warning：「UI 结构变更未经原型/规格（见 specs/kit-sop-enforcement/design.md）」，`--strict` 下非零退出 |
| 接入点 | 已由 `.github/workflows/quality-gate.yml` job1 调用，**无需改 workflow** |

> 为什么只卡"新增页面 / 信息架构变化"而不卡所有 UI 改动：纯视觉微调（改间距、换色）不该强制走原型，否则误报率高到没人看。

### 3.6 L5 · 上游 ai-agent-kit（跑在另一仓库）

1. **补触发词**：`skills/ux-prototype-designer/SKILL.md` 的 `description` 增加用户真实措辞——`间距` / `太丑` / `隐藏` / `挪` / `颜色` / `字号` / `换行` / `视觉微调` / `交互调整`。
   - ⚠️ **不得修改本仓库的运行源** `.codebuddy/skills/ux-prototype-designer/SKILL.md` —— `kit-gate` 的 **S7 会拦运行源与能力源漂移**。必须改上游 `ai-agent-kit` 后走同步流程。
   - ⚠️ 上游改 `skills/` 需附评测报告（change to `skills/` requires eval report），或按规则加 `skip-eval` 标签并说明理由。
2. **加 L3 陷阱用例**：`evals/cases/` 增加一条——「用户直接反馈『输入框换行间距高了』『tabBar 隐藏起来』→ 期望 agent 先回到原型稿，不直接改 WXML」。使本次失误变成可回归的测试。

### 3.7 豁免出口（必须有，否则 hook 会被关掉）

| 出口 | 用法 | 适用 |
|---|---|---|
| 记一行「微调豁免」 | 在 prototype 或 page-spec 写：`<!-- 微调豁免 2026-09-20: 仅调输入框行距 -->` | 纯视觉微调 |
| `UI_GATE=off` | 环境变量 | 批量机械改动、紧急修复 |
| 标记过期 | `.codebuddy/.state/proto-touched` 超过时效自动失效 | 防止跨会话误放行 |

> 设计取舍：**宁可偶尔多一次豁免记录，也不要让 hook 变成日常噪音**——摩擦过大的 hook 最终会被关闭，等于没做（这是本方案最容易失败的地方）。

---

## 4. 落地清单（T1…T6）

| # | 任务 | 产出文件 | 依赖 |
|---|---|---|---|
| T1 | 常驻动作门 | 改 `.codebuddy/CODEBUDDY.md`（新增 §2.5） | 无 |
| T2 | 品牌端规则 | 新增 `.codebuddy/rules/brand-interface/RULE.mdc` | 无 |
| T3 | Hook 门禁 | 新增 `.codebuddy/settings.json`、`scripts/redline/hook-ui-prototype-gate.py`、`scripts/redline/hook-mark-proto-touched.py`、`.codebuddy/.state/`（gitignore） | 无 |
| T4 | CI 红线 R9 | 改 `scripts/redline/scan-rules.sh`（新增 R9 判定 + 调用） | 无 |
| T5 | 本地验证 | 按 §5 判据表逐条实跑 | T1–T4 |
| T6 | 上游 kit（另仓另 PR） | `ai-agent-kit`：description 触发词 + eval 陷阱用例 | 无（可并行） |

**实现约束**：

- 脚本语言用 Python 3（需解析 stdin JSON）；不得引入第三方依赖
- 路径判定必须兼容 `filePath` / `file_path`，`tool_name` 必须兼容 IDE 与 CLI 两种风格
- `.codebuddy/.state/` 加入 `.gitignore`（运行时产物，不入库）
- 不得新增 `!important`、不得改运行源 skills（S7 会拦）

---

## 5. 验证判据表 V1…Vn

> 四列缺一 = 判据未定义。实现完成后按**同一编号**逐条给证据（`rd-execute` 完成验证门）。

| 编号 | 判据（做成 = 一句话可验证） | 验证手段（可跑的命令） | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V1 | 未动原型时，写 UI 文件被 hook 拒绝 | `echo '{"hook_event_name":"PreToolUse","tool_name":"write_to_file","tool_input":{"filePath":"apps/kedou-ai-minigram/pages/chat/index/index.wxss"},"session_id":"t1"}' \| python3 scripts/redline/hook-ui-prototype-gate.py` | stdout 含 `"permissionDecision": "deny"` | 修判定逻辑；不得放行即算通过 |
| V2 | 已动原型后，同一次写被放行 | 先跑标记脚本（原型路径）→ 再执行 V1 命令 | 无 deny 输出，退出码 0 | 检查标记写入/时效逻辑 |
| V3 | 非 UI 文件零摩擦 | 同上命令，`filePath` 换为 `servers/ai-agent/src/agent/agent.controller.ts` | 无任何输出，退出码 0 | 收窄路径匹配规则 |
| V4 | 豁免出口有效 | 写「微调豁免」标记后执行 V1 命令 | 放行 | 修豁免判定 |
| V5 | R9 能识别"UI 结构变更无原型" | `bash scripts/redline/scan-rules.sh diff <base>`（构造含 pages 新增但无 prototype 变化的 diff） | 输出 R9 warning | 修 R9 判定 |
| V6 | R9 不误报纯微调 | 同上，diff 仅含既有 `.wxss` 修改 | 无 R9 输出 | 收窄触发条件（只卡新增页面 / 信息架构） |
| V7 | kit 结构守护未被破坏 | `bash scripts/redline/check-kit-structure.sh` | S1~S7 全通过 | 检查是否误改运行源 skills |
| V8 | 全仓红线扫描不回归 | `bash scripts/redline/scan-rules.sh tree` | 与改动前相比无**新增** error | 回退对应改动 |
| V9 | 端到端：真实会话中"先提 UI 微调"不直接落码 | 新开对话，说「把对话页输入框行距调大一点」，观察 agent 行为 | 第一步是改原型或要求确认，而非编辑 wxss | 回看 §1 断点，检查动作门是否生效 |

---

## 6. 风险与权衡

| 风险 | 等级 | 应对 |
|---|---|---|
| **摩擦导致 hook 被关掉**（本方案最大失败模式） | 高 | §3.7 三个豁免出口；先上 L3 跑一周看摩擦，再决定 L4 |
| hook 判定过宽，把后端/逻辑改动也拦了 | 中 | 路径白名单精确到 `pages/**` / `components/**` / `packages/ui/**`；V3 专项验证 |
| `tool_name` 双风格导致 IDE 环境失效 | 中 | 脚本内同时兼容；matcher 写双风格（`write_to_file\|replace_in_file\|Write\|Edit`） |
| 标记文件被跨会话复用，门禁形同虚设 | 中 | 设时效（8h）+ 开始新会话时清理；或纳入 `SessionStart` hook 重置 |
| R9 误报拖慢正常 PR | 中 | 先 warning 级；只卡新增页面 / `app.json` 信息架构变化 |
| 改上游 kit 触发 eval 门禁 | 低 | 走 `skip-eval` 或补评测报告；**不得绕过 S7** |

---

## 7. 待确认（动手前需用户拍板）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| Q1 | 门禁范围：是否包含 `apps/*/src/**/*.vue`（admin 系）？还是只做品牌端？ | L3/L4 判定集合 | 建议**两端都覆盖**，避免再出现规则真空 |
| Q2 | 豁免方式：选「记一行微调豁免」/ 环境变量 / 两者都要 | L3 实现 | 建议两者都要（前者留痕、后者应急） |
| Q3 | R9 级别：先 warning 还是一步到位 error | CI 体验 | 建议先 warning，跑两周无误报再升 error |
| Q4 | 是否同时上 L1+L2+L3+L4，还是先只上 L3 | 本次范围 | 建议 L2+L3+L4 一起（缺 L4 则 hook 可被 CLI 绕过） |
| Q5 | 标记时效（8 小时是否合适） | 误放行风险 | 建议 8h，或改为会话级 |

---

## 8. 接手须知（新对话怎么开工）

**Step 0 · 读这份文档 + 3 个上游文件**（不必读别的）：

1. `specs/kit-sop-enforcement/design.md`（本文）
2. `.codebuddy/agent-kit/AGENT.md` §43–52（开工前置 · 不分级不变量）
3. `.codebuddy/skills/rd-plan/SKILL.md` §验证判据表（V1…Vn 格式与同构规则）
4. `.codebuddy/rules/ui-interface/RULE.mdc`（规则文件写法范例）

**Step 1 · 先确认 §7 五个待确认项**，再动手（`rd-plan` 对复杂改动要求"用户拍板后再执行"）。

**Step 2 · 按 §4 落地清单执行**，每完成一项即按 §5 对应 V# 实跑取证。

**Step 3 · 注意三条硬约束**：

- 改 `scripts/redline/scan-rules.sh` 只加判定函数，**不动调用方契约**（脚本头部已声明）
- **不得改 `.codebuddy/skills/` 下的通用技能**（`kit-gate` S7 会拦运行源漂移），L5 一律走上游仓库
- 新增脚本不得引入第三方依赖；`.codebuddy/.state/` 必须 gitignore

**Step 4 · 交付时给证据**：按 V1…V9 逐条给实跑输出，不得以「应该没问题」替代（`AGENT.md` §产出纪律 + `rd-execute` 完成验证门）。
