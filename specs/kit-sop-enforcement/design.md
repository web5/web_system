# 方案 · ai-agent-kit SOP 强制机制（kit-sop-enforcement）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 状态：**v1.0 已落码（L1/L2/L3/L4）· v1.1 方案已拍板、待落码**
> 日期：2026-09-20（v1.0）· 2026-09-21（v1.1 增量）
> v1.1 范围：**L3 补强（§3.4.1）+ L3.5 方案 B（§3.8）+ CI R9b/R10（§3.5）** —— 针对 v1.0 上线后 agent 仍能绕过防线的四类漏口（见 §1.1）
> 性质：**自包含方案** —— 接手者无需回看提出本方案的对话即可执行
> 上游规范：`.codebuddy/agent-kit/`（`AGENT.md`、`rules/general/01–05`、`references/fe-dev-common.md`）
> 相关技能：`skills/rd-plan`（§3.5 原型判定 + V1…Vn）、`skills/ux-prototype-designer`（+ `references/ux-review-checklist.md`）

---

## 0. 一页速览

**要解决的问题**：agent 会在"用户直接提 UI 微调"时跳过 agent-kit 的 SOP（典型：先改原型稿 → 用户确认 → 才落代码），直接编辑落地代码。

**根因判定**：不是"记性"问题，而是 4 个结构性断点（常驻层只做索引、规则真空、触发词失配、无机器检查）。**靠补充提示词不可能修好** —— kit 自身原则即「文本约定会退化，须降层为机器检查才稳定」（`agent-kit/README.md`「三层规则」+ 红线 05）。

**方案**：把 SOP 从"提示"降层为"拦截"，分五层落地，其中 **L3（CodeBuddy Hook 硬阻断）+ L4（CI 红线 R9）是真强制**，L1/L2 为文本第一道，L5 为上游回归。

**v1.1 增量（2026-09-21 拍板）**：L3 仍有四类漏口（§1.1），其中"无法证明用户已确认"是语义缺口。为此新增 **L3.5 方案 B —— git 凭证**：原型先单独落 commit，UI commit 必须携带 `Proto: <sha>` trailer（§3.8）；同时把 shell 写通道纳入硬阻断（§3.4.1 ①，直接 deny）、通行证细粒度化（②）、放行时输出提醒（③）、补审计与自检（④）。

**范围**：`web_system` 仓库（L1–L4 + L3.5）+ 上游 `ai-agent-kit` 仓库（L5，另仓另 PR）。

**成本**：v1.0（L2+L3+L4）约 2–3 小时，已完成；**v1.1（T7–T12）约 3–4 小时**（T7 白名单调优 + T10 git hook 是大头）；L5 半天+（需走上游 eval 门禁）。

**前置**：§7.1 已拍板；T11 开工前需答复 §7.2 的 Q6/Q7。豁免出口设计见 §3.7 —— 摩擦过大时 hook 会被直接关掉，等于没做。

---

## 1. 问题与根因（4 个断点，均带证据）

| # | 断点 | 证据（可自行核验） |
|---|---|---|
| 1 | **常驻层只做索引，不做动作门** | `.codebuddy/CODEBUDDY.md` 全文 4 节，第 2 节原文为「AI 技能继承 `.codebuddy/agent-kit/` —— **需要的技能从这里找**」——被动取用语义。而含「开工前置 · 不分级不变量」的 `agent-kit/AGENT.md` §43–52 **不是 IDE 常驻加载文件**；IDE 常驻加载的只有 `CODEBUDDY.md` |
| 2 | **规则真空（品牌端无覆盖）** | `.codebuddy/rules/ui-interface/RULE.mdc` 首行即写「适用：deploy-console / admin / mcp-admin / 内部工具端。**portal / kedou-ai-minigram 品牌端不适用（DR-5）**」→ 小程序前端改动无任何项目级规则兜底 |
| 3 | **触发词失配（最隐蔽）** | `skills/ux-prototype-designer/SKILL.md` frontmatter `description` 触发词为「原型稿生成 / 交互怎么设计 / 页面信息架构 / 做个可点击的稿看看 / 小程序…先看交互」；而用户真实措辞是「**输入框换行间距高了**」「**tabBar 得隐藏起来**」——零命中，技能不加载 |
| 4 | **无机器检查** | `scripts/redline/scan-rules.sh` 只管 R1~R8（代码红线）；`scripts/redline/check-kit-structure.sh` 只管 S1~S7（kit 结构漂移）。二者均不涉及「UI 改动是否走过原型」 |

**结论**：四个断点里，#3 说明"补触发词"路线不可靠（措辞空间无限），#1/#2 是软约束，#4 是缺失的硬约束。**必须补机器层。**

### 1.1 残余漏口（v1.0 上线后实测 · v1.1 要治的对象）

v1.0 的 L3/L4 上线后，agent 仍能绕过。四个残余漏口均已定位到代码行：

| # | 漏口 | 证据 | 级别 |
|---|---|---|---|
| P0 | **hook 只拦 IDE 编辑工具，不拦 shell 写文件** | `.codebuddy/settings.json` matcher 仅 `write_to_file\|replace_in_file\|Write\|Edit\|MultiEdit`；`execute_command`/`Bash` 不在列 → `sed -i` / `cat >` / `git apply` / `cp → apps/*` 全部绕行 | P0 |
| P1 | **通行证是全局 8 小时，不区分端/页面** | `hook-mark-proto-touched.py` 命中任一原型路径即写标记 → 之后 8h 内任意 app、任意页面的 UI 源码都可写；且无 `SessionStart` 重置 | P0 |
| P2 | **无"用户确认"信号，且 CI 兜底覆盖面窄** | hook 只证明"原型被改过"（§3.4 已知局限）；`scan-rules.sh` `check_r9` 触发条件只有「新增 pages 文件」与「`app.json` pages/tabBar 变化」→ 改既有 `.wxss`/`.vue` 一行不报 | P1 |
| P3 | **fail-open 且无审计** | 两个 hook 异常一律 `exit 0`；放行时无输出、无日志 → 静默失效无法发现，摩擦也无法度量 | P2 |

> 对应关系：P0 → §3.4.1 ①（V10/V11）；P1 → §3.4.1 ②（V12/V13）；P2 → §3.8 + §3.5.1（V15–V19）；P3 → §3.4.1 ④（V14/V20）。

---

## 2. 现状基建盘点（可直接复用，勿另造）

| 资产 | 位置 | 可复用点 |
|---|---|---|
| 红线扫描 | `scripts/redline/scan-rules.sh` | 已实现 **R1~R8**（R1–R4 error / R5、R8 warning）、四模式（`cached` / `diff <ref>` / `files` / `tree`）、`--strict`、`--no-color`。**新增 R9 只需加判定函数，勿改调用方** |
| git hook 安装 | `scripts/redline/install-git-hooks.sh`、`check-commit.sh` | 本地 pre-commit 通道已存在 |
| kit 同源守护 | `scripts/redline/scan-rules.sh` 的 **R12** | 守「能力源 ↔ 运行源零漂移」；原 S1–S7 结构守护与其 CI（`kit-gate.yml`）未随本次机制回归，**S7 语义由 R12 承接** → 仍决定 L5 不能手改运行源 |
| PR 质量门 | `.github/workflows/quality-gate.yml` | `redline-scan`（扫 PR diff，2026-09-24 恢复）+ `changed-packages`；master 分支保护要求其通过 → **R9 接进来即生效** |
| CodeBuddy Hooks | `.codebuddy/settings.json`（v1.0 已建，v1.1 追加 matcher） | 7 类事件；`PreToolUse` 可硬阻断（`continue:false` + `permissionDecision:"deny"`，或退出码 2）；现已挂 `PreToolUse`（gate / mark）与 `PostToolUse`（mark） |
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

### 3.4.1 v1.1 增量（2026-09-21 拍板 · 待落码）

> 背景：v1.0 上线后仍出现"agent 直接改代码"。诊断见 **§1.1 残余漏口**——四条均已在 v1.0 设计里留下缝隙，非"记性问题"。本小节是这四条的补丁，与 §3.8 方案 B 配套。

**① shell 通道纳入硬阻断**（治 §1.1-P0）

`.codebuddy/settings.json` 的 `PreToolUse` 数组追加一条：

```json
{
  "matcher": "execute_command|Bash",
  "hooks": [
    { "type": "command",
      "command": "python3 \"${CODEBUDDY_PROJECT_DIR:-.}/scripts/redline/hook-shell-ui-gate.py\"",
      "timeout": 10 }
  ]
}
```

`scripts/redline/hook-shell-ui-gate.py` 取 `tool_input.command`（兼容 `command` / `cmd`），做**双命中**检测：

- UI 路径特征：`apps/*/pages/`、`apps/*/components/`、`packages/ui/`、`<name>.wxss|.wxml|.vue`、`app.json`、`apps/*/app.json`
- 写操作符特征：`sed -i`、`perl -i`、`tee `、`cat >`、`>`(重定向到上述路径)、`python -c`+`open(`、`node -e`+`writeFile`、`git apply`、`git checkout --`、`patch `、`cp `、`mv `
- 白名单（命中即放行，防误伤构建/发布）：`scripts/redline/`、`scripts/*.sh`、`pnpm `、`npm `、`npx `、`vite`、`nest build`、`pm2`、`git status|diff|log|rev-parse`、`curl`、`ls `、`cd `
- 双命中且不在白名单 → `permissionDecision: "deny"`，`stopReason: "UI 源码须经原型改动通道"`

> **已拍板（2026-09-21）：shell 通道直接 deny，不先跑 warning 观察期。** 误报只能靠白名单兜住，因此**白名单的任何扩充必须同步补 V11 用例**。

**实测补 1 · 双命中还须「落在仓库内」**：命中路径需按 `cwd` 归一后判断是否位于项目根下（`within_repo`），否则放行。必要性——首次实跑时，在 `/tmp` 临时仓库里 init 一个 demo repo 的脚手架命令被误拦（`echo a > apps/demo/pages/index/index.wxss`）。这类误伤是"摩擦导致 hook 被关掉"的典型诱因，因此临时目录 / 示例仓库一律零摩擦放行（V11 已覆盖）。
**实测补 2 · 判定顺序**：**UI 路径命中 → 再看写语义 → 白名单最后兜底**，而不是白名单前置。否则 `echo x > a.wxss` 会因 `echo ` 属白名单而被放过（实测确认过这个漏，已修）。

**② 通行证细粒度化 + 会话隔离**（治 §1.1-P1）

标记文件改为 per-session：`.codebuddy/.state/<session_id>-proto.json`，内容 `{ts, session_id, apps:[...], proto_files:[...], sha256:{<file>:<hash>}}`；取不到 `session_id` 时回退全局 `proto-touched`（兼容旧行为）。

gate 判定在原有"标记新鲜"之外加一条：本次 UI 文件所属 app（路径 `apps/<app>/...`）必须 ∈ 标记里的 `apps` 集合，否则 deny —— 杜绝"改 A 端原型 → 改 B 端代码"。TTL 由 8h 收紧到 4h。

**③ `SessionStart` 注入 + 放行时也说话**（治 §1.1-P3）

- 新增 `scripts/redline/hook-session-start.py`：`SessionStart` 事件输出 §2.5 动作门摘要 + §3.8 两条铁律（原型先落 commit / UI commit 带 `Proto:` trailer）。
- `hook-ui-prototype-gate.py` 放行分支由静默改为输出 `hookSpecificOutput.additionalContext`：「你在改 UI 源码 `<path>`，对应原型 `apps/<app>/prototype/index.html`；原型未同步请先同步，纯视觉微调请在原型里记一行「微调豁免」」。不 deny，零摩擦——约束的是下一步意图，不是工具调用。

**④ 审计与自检**（治 §1.1-P4）

- `.codebuddy/.state/ui-gate.log` 追加 `{ts, session_id, tool_name, path, decision}`（gitignore）。
- 新增 `scripts/redline/selfcheck-ui-gate.sh`：把 V1–V4 与 V10–V13 断言脚本化一键跑，防止 hook 静默失效。

> ①–④ 仍只证明"原型被改过"，不证明"人确认过"。该语义缺口由 §3.8 方案 B 在 git 层补齐。

### 3.5 L4 · CI 红线 R9（防绕过兜底）

在 `scripts/redline/scan-rules.sh` 内新增一个判定函数（该脚本已声明「白名单/阈值调整：改下方 R* 判定函数，勿改调用方」）：

| 项 | 内容 |
|---|---|
| 规则号 | **R9** |
| 级别 | **warning**（`--strict` 下升级为 error）—— 初期避免阻断正常 PR |
| 触发 | diff 中出现 ① `apps/*/pages/**` **新增文件**；或 ② `app.json` 的 `pages` / `tabBar` 段变化 |
| 判据 | 同一 diff 中**必须**同时出现通行证路径变化：`apps/*/prototype/**`、`docs/ui/prototypes/**` 或 `specs/**/page-spec*.md` |
| 不满足时 | 报 warning：「UI 结构变更未经原型/规格（见 specs/kit-sop-enforcement/design.md）」，`--strict` 下非零退出 |
| 接入点 | 已由 `.github/workflows/quality-gate.yml` 的 `redline-scan` job 调用（2026-09-24 恢复），**无需改 workflow** |

> 为什么只卡"新增页面 / 信息架构变化"而不卡所有 UI 改动：纯视觉微调（改间距、换色）不该强制走原型，否则误报率高到没人看。

#### 3.5.1 v1.1 增补：R9b 与 R10

> R9 的这条覆盖缺口是 P2 漏口的成因之一：**只卡新增页面，改既有 `.wxss`/`.vue` 一行不报**，而"改交互 / 改样式"恰是最高频的 UI 改动。

| 规则号 | 级别 | 触发 | 判据 | 不满足时 |
|---|---|---|---|---|
| **R9b** | warning（`--strict` 下 error） | diff 中**既有** UI 源码（`.wxss`/`.wxml`/`.vue`/`apps/*/pages/**`）改动行数 ≥ 阈值（默认 5 行，或含结构标签 `<view`/`<template`） | 同一 diff 含原型/规格路径，或该 commit message 带 `Micro-exempt: <理由>` | 报「既有 UI 改动无同行原型/豁免」 |
| **R10** | warning（`--strict` 下 error） | diff 中含 UI 源码改动的 commit | 该 commit message 带 `Proto: <sha>`，且 sha 在同一 range 内或为其祖先（详见 §3.8） | 报「UI commit 缺 Proto 凭证」 |

接入点：`scan-rules.sh` 追加 `check_r9b` / `check_r10` 两个判定函数（该脚本头部已声明"改判定函数、勿改调用方"），由 `diff` 模式主流程调用；由 `.github/workflows/quality-gate.yml` 的 `redline-scan` job 覆盖（2026-09-24 恢复），**无需改 workflow**。

**R9b 已按 Q6 决议实装**（warning 级）。`Micro-exempt: <理由>` **同时豁免 R9b 与 R10** —— 同一个「微调豁免」语义必须在 CI 两条规则里口径一致，否则"记了豁免还是报错"会成为新的摩擦源（2026-09-21 实测后统一）。
阈值 `R9B_LINE_THRESHOLD` 默认 5 行；diff 含结构标签（`<view` / `<template` / `<block`）时不受行数限制。

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
| 标记过期 | per-session 标记 4h 失效 + `SessionStart` 重置（§3.4.1 ②） | 防止跨会话误放行 |
| `Proto: <sha>` trailer | UI commit 指向已确认并落库的原型 commit（§3.8） | **正常通道**（非豁免）：原型已确认后走这条，而非绕过 |

> 设计取舍：**宁可偶尔多一次豁免记录，也不要让 hook 变成日常噪音**——摩擦过大的 hook 最终会被关闭，等于没做（这是本方案最容易失败的地方）。

---

### 3.8 L3.5 · 方案 B：用 git 凭证代替会话标记（2026-09-21 拍板 · 待落码）

**为什么选它**：机器无法读取"用户是否点头"。方案 B 不试图读取它，而是把点头物化成**一条 git 记录**（原型 commit），再要求 UI commit 携带指向它的凭证 trailer——不可抵赖、落在既有 review 面上（PR diff）、不引入外部系统。

**三候选对比（拍板依据）**：

| 方案 | 做法 | 验证力 | 伪造成本 | 摩擦 |
|---|---|---|---|---|
| A 人签通行证 | 人跑 `proto-approve.sh` 写 `.state/proto-approved{file,sha256}` | 中（可验与原型的哈希一致） | **低**：agent 也能调用该脚本 | 低 |
| **B git 凭证（选此）** | 原型先落 commit；UI commit 带 `Proto: <sha>`，`commit-msg` + CI 校验 sha 存在且为祖先 | 高：凭证进 git 历史，可回到任意 PR 复验 | 高：需伪造 commit 历史或 `--no-verify`（后者由 R10 兜底） | 中（两 commit 纪律） |
| C B + 人签 + PR 模板勾选 | 三重凭证 | 最高 | 最高 | **高**：易触发"把 hook 关掉"这一最大失败模式 |

**流程（两条铁律）**：

```
① 改原型/规格（apps/*/prototype/** | docs/ui/prototypes/** | specs/**/page-spec*.md）
   → 过 ux-review-checklist → 用户确认
   → 单独 commit（不得与 UI 源码混入同一 commit）→ 记下 <sha>
② 改 UI 源码
   → 该 commit 的 message 必须带一行 trailer：Proto: <sha>
```

**强制点必须在 `commit-msg` hook，不在 pre-commit**：`pre-commit` 拿不到 commit message。现有 `install-git-hooks.sh` 只安装 `.githooks/pre-commit`，需改为"chmod + 安装目录下全部 hook 脚本"，并新增 `.githooks/commit-msg` → `scripts/redline/check-commit-msg.sh <msgfile>`。

| staged 变更构成 | 判定 | 结果 |
|---|---|---|
| 不含 §3.1 UI 源码 | 与本门无关 | `exit 0` |
| 含 UI 源码 **且** 含原型/规格路径（混合提交） | 违规：同一 commit 内"改原型 + 落码"，绕过用户确认节点 | **error**，提示拆成两个 commit |
| 只含原型/规格路径 | 这是 Proto 起点 commit | `exit 0`（放行） |
| 含 UI 源码 | 须同时满足：① msg 含 `Proto: <sha>`；② `git cat-file -e <sha>^{commit}` 存在；③ `git merge-base --is-ancestor <sha> HEAD`；④ `git show --name-only --format= <sha>` 的变更文件含 §3.1 原型/规格路径 | 四条全过 → `exit 0`；否则 **error** |

**为什么必须指向祖先的原型 commit，而不是任意 sha**：工作区改过的原型没有经过 commit → 没有进入 review 面。这一点是方案 B 与旧标记机制（只看工作区有无改过）的本质差异。

**CI 兜底 R10**（新增到 `scan-rules.sh`，已由 `quality-gate.yml` 的 `redline-scan` job 调用，**无需改 workflow**）：遍历 PR range 内每个 commit，凡改动含 UI 源码的 commit 必须带 `Proto: <sha>`，且该 sha 位于同一 PR range 内或为其祖先。缺凭证 → warning，`--strict` 下 error。用途：本地 `--no-verify` 绕过时兜底。

**代价（必须接受）**：原型与 UI 不能图省事一起提交，需两条 commit 的纪律。

---

## 4. 落地清单（T1…T12）

| # | 任务 | 产出文件 | 依赖 |
|---|---|---|---|
| T1 | 常驻动作门 | 改 `.codebuddy/CODEBUDDY.md`（新增 §2.5） | 无 |
| T2 | 品牌端规则 | 新增 `.codebuddy/rules/brand-interface/RULE.mdc` | 无 |
| T3 | Hook 门禁 | 新增 `.codebuddy/settings.json`、`scripts/redline/hook-ui-prototype-gate.py`、`scripts/redline/hook-mark-proto-touched.py`、`.codebuddy/.state/`（gitignore） | 无 |
| T4 | CI 红线 R9 | 改 `scripts/redline/scan-rules.sh`（新增 R9 判定 + 调用） | 无 |
| T5 | 本地验证 | 按 §5 判据表逐条实跑 | T1–T4 |
| T6 | 上游 kit（另仓另 PR） | `ai-agent-kit`：description 触发词 + eval 陷阱用例 | 无（可并行） |

**v1.1 增量清单（T7…T12 · 依赖 T1–T4 已落码）**

> 状态：**T7–T11 已落码（2026-09-21）**，T12 取证见 §5 末「取证结果」。
> ⚠️ T10 生效需本人执行 `bash scripts/redline/install-git-hooks.sh`（写 `core.hooksPath`，AI 不得代改 git config）。
> 未安装前：只有 IDE hook（T7–T9）生效，`commit-msg`（方案 B）不拦。

| # | 任务 | 产出文件 | 治哪条漏口 | 依赖 |
|---|---|---|---|---|
| T7 | shell 通道硬阻断 | 新增 `scripts/redline/hook-shell-ui-gate.py`；改 `.codebuddy/settings.json`（追加 `execute_command\|Bash` matcher） | P0 | 无 |
| T8 | 通行证细粒度化 | 改 `hook-mark-proto-touched.py`（per-session 标记 + apps 集合 + sha256）；改 `hook-ui-prototype-gate.py`（按 app 判定、放行输出 additionalContext、TTL 8h→4h） | P1 | 无 |
| T9 | 会话注入 + 审计 + 自检 | 新增 `hook-session-start.py`（SessionStart）、`selfcheck-ui-gate.sh`；追加写 `.codebuddy/.state/ui-gate.log` | P3 | 无 |
| T10 | 方案 B · 本地强制 | 新增 `scripts/redline/check-commit-msg.sh` + `.githooks/commit-msg`；改 `install-git-hooks.sh`（安装目录下全部 hook，而非仅 pre-commit） | P2 | 无 |
| T11 | 方案 B · CI 兜底 | 改 `scripts/redline/scan-rules.sh`：新增 `check_r10`（必做）+ `check_r9b`（Q6 拍板后做） | P2 | Q6 |
| T12 | 取证 | 逐条实跑 V1–V4、V10–V20，输出贴回 §5 | 全部 | T7–T11 |

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

**v1.1 增量判据（V10…V20）**

| 编号 | 判据（做成 = 一句话可验证） | 验证手段（可跑的命令） | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V10 | shell 写 UI 文件被拒 | `echo '{"hook_event_name":"PreToolUse","tool_name":"execute_command","tool_input":{"command":"sed -i \"\" s/12px/16px/g apps/kedou-ai-minigram/pages/chat/index/index.wxss"},"session_id":"t2"}' \| python3 scripts/redline/hook-shell-ui-gate.py` | stdout 含 `"permissionDecision": "deny"` | 修双命中判定；不得放行即算通过 |
| V11 | shell 白名单零摩擦 | 同 V10，`command` 换为 `bash scripts/publish-deploy-console.sh`、`pnpm i`、`npx vite build`、`git diff` | 无输出，退出码 0 | 补白名单，并同步补该用例 |
| V12 | 跨端改代码被拒 | 先用原型路径跑标记脚本（minigram），再以 `apps/admin/src/views/x.vue` 跑 `hook-ui-prototype-gate.py` | stdout 含 deny（reason 指明 app 不匹配） | 修 apps 集合判定 |
| V13 | 放行时也输出提醒 | 先用同 app 原型路径跑标记脚本，再以该 app 的 UI 路径跑 gate | stdout `additionalContext` 含原型路径与「微调豁免」提示 | 修放行分支输出 |
| V14 | 放行/拒绝都留痕 | `tail -n 5 .codebuddy/.state/ui-gate.log` | 含 V10–V13 对应的 `{tool_name, path, decision}` 行 | 修日志写入 |
| V15 | 混合提交被拒 | 构造 staged 同时含 `apps/*/prototype/index.html` 与 `pages/**/*.wxss`，跑 `bash scripts/redline/check-commit-msg.sh <msgfile>`（msg 无 `Proto:`） | 非零退出 + 提示"不得混合提交" | 修第四档判定 |
| V16 | 合法 Proto 凭证通过 | 先 commit 原型取得 `S`，staged 只含 UI 源码，msg 带 `Proto: S` → 跑同一脚本 | 退出码 0 | 修 sha 与祖先校验顺序 |
| V17 | 缺凭证被拒 | 同 V16，msg 不带 `Proto:` | 非零退出，提示缺 Proto trailer | 修判定 |
| V18 | 伪造/失效凭证被拒 | 同 V16，msg 带 `Proto: <不存在的 sha>`；再试「非祖先的 sha」 | 两次均非零退出 | 修 `cat-file` / `merge-base` 校验 |
| V19 | CI R10 可识别无凭证 UI commit | `bash scripts/redline/scan-rules.sh diff <base>`（构造：UI 改动 commit 无 `Proto:`） | 输出 R10 warning | 修 `check_r10` |
| V20 | 自检脚本能发现 hook 失效 | 临时把 `.codebuddy/settings.json` 挪开 → `bash scripts/redline/selfcheck-ui-gate.sh`；恢复后再跑 | 前者报 FAIL、后者全绿 | 修自检断言 |

### 5.1 取证结果（2026-09-21 实跑）

> 入口：`bash scripts/redline/selfcheck-ui-gate.sh`（把 V1–V4、V10–V13、V20 断言脚本化，随时可复跑）。

| 编号 | 结果 | 证据要点 |
|---|---|---|
| V1 | PASS | 无标记时写 `.../chat/index/index.wxss` → `permissionDecision: deny` |
| V2 | PASS | 先动 `apps/kedou-ai-minigram/prototype/index.html` 后，同 app UI 写放行 |
| V3 | PASS | `servers/ai-agent/src/agent/agent.controller.ts` → 零输出 |
| V4 | PASS | `UI_GATE=off` 时放行 |
| V10 | PASS | `sed -i ... index.wxss` → deny；`echo x > index.wxss` → deny |
| V11 | PASS | `bash scripts/publish-deploy-console.sh` / `pnpm i` / `npx vite build` / `git diff` / `cat <UI 文件>` 全部零输出 |
| V12 | PASS | 通行证属 kedou-ai-minigram → 写 `apps/admin/src/views/Demo.vue` 被拒（reason: cross-app） |
| V13 | PASS | 放行分支输出 `additionalContext`（含原型路径 + 「微调豁免」提示） |
| V14 | PASS | `.codebuddy/.state/ui-gate.log` 逐条记 `{ts, session_id, tool_name, path, decision}` |
| V15 | PASS | 混合提交（原型 + UI 同 staged）→ exit 1，提示拆分两 commit |
| V16 | PASS | UI commit 带 `Proto: <原型 sha>` → exit 0 |
| V17 | PASS | 缺 `Proto:` trailer → exit 1 |
| V18 | PASS | 伪造 sha（不存在）→ exit 1；非祖先 sha（另一分支）→ exit 1 |
| V19 | PASS | 真实仓库 `scan-rules.sh diff HEAD~6..HEAD` 报出 4 条历史 UI commit 缺 Proto；场景对照（同行改原型 / 带 Micro-exempt）不报 |
| V20 | PASS | settings.json 三处接线（gate / mark / shell）齐全；挪开即 FAIL |
| V7 | PASS | `check-kit-structure.sh` → S1~S7 全通过 |
| V8 | PASS | 本批改动文件定点扫描 0 error / 0 warning；bash/py 语法检查全绿 |

**实跑中暴露并修掉的两个缺陷**（已写回 §3.4.1）：① 白名单前置导致 `echo x > a.wxss` 绕过 → 改为"命中 UI 路径优先看写语义，白名单最后兜底"；② `/tmp` 临时仓库的脚手架命令被误拦 → 增加"路径须落在仓库内"判定。

---

## 6. 风险与权衡

| 风险 | 等级 | 应对 |
|---|---|---|
| **摩擦导致 hook 被关掉**（本方案最大失败模式） | 高 | §3.7 豁免出口 + 「微调豁免」留痕；每次放行都说明理由（V13）而非静默，让摩擦可被度量 |
| hook 判定过宽，把后端/逻辑改动也拦了 | 中 | 路径白名单精确到 `pages/**` / `components/**` / `packages/ui/**`；V3 专项验证 |
| `tool_name` 双风格导致 IDE 环境失效 | 中 | 脚本内同时兼容；matcher 写双风格（`write_to_file\|replace_in_file\|Write\|Edit`、`execute_command\|Bash`） |
| 标记文件被跨会话复用，门禁形同虚设 | 中 | v1.1 已治：per-session 标记 + TTL 4h + `SessionStart` 重置（T8/T9，V12 验证） |
| R9 误报拖慢正常 PR | 中 | 先 warning 级；R9b/R10 同策略（Q6 拍板前不默认开 R9b） |
| **shell 门禁误伤构建/发布命令**（v1.1 新增，deny 直生效故风险上升） | 中 | 白名单 + V11 专项覆盖构建/发布/发布脚本；**白名单任何扩充必须同时补 V11 用例** |
| **`commit-msg` 摩擦**（v1.1 新增） | 中 | 原型与 UI 两 commit 的纪律要写进 §2.5 动作门；混合提交给出明确的"请先提交原型"提示而非生硬报错 |
| `--no-verify` 绕过本地 hook | 中 | CI R10 兜底（§3.8）；本地 hook 是防呆不是防线 |
| IDE 是否触发 `SessionStart` 事件未验证 | 低 | T9 实装时先验 sample payload；不支持则降级为"gate 首次命中时清过期标记" |
| `ui-gate.log` 无限膨胀 | 低 | 只 append 决策摘要，按大小滚动（>1MB 截断），已在 gitignore |
| 改上游 kit 触发 eval 门禁 | 低 | 走 `skip-eval` 或补评测报告；**不得绕过 S7** |

---

## 7. 决议与待确认

### 7.1 已决议（2026-09-21 用户拍板，直接执行）

| 项 | 决议 |
|---|---|
| 门禁范围 | 两端都覆盖（admin `.vue` + 品牌端 `.wxml`/`.wxss`），含 `app.json`（含 Q1） |
| 豁免方式 | 两者都要：「微调豁免」留痕 + `UI_GATE=off` 应急（原 Q2） |
| CI 级别 | R9/R10 先 warning，`--strict` 下 error（原 Q3） |
| 落地范围 | v1.0 已落 L2+L3+L4；v1.1 补 L3 漏口 + 新增 L3.5（原 Q4） |
| 标记时效 | 4h + **per-session 隔离**（原 Q5 收严） |
| **"用户确认"的机器替身** | **方案 B** —— git 凭证：原型先单独落 commit，UI commit 携带 `Proto: <sha>` trailer（§3.8） |
| **shell 门禁强度** | **直接 deny**，不设 warning 观察期；误报由白名单兜 + V11 判据守护 |

### 7.2 已拍板（2026-09-21，原待确认项 Q6/Q7）

| # | 问题 | 决议 |
|---|---|---|
| Q6 | R9b 是否实装 | **装**。既有 UI 源码（`.wxss`/`.wxml`/`.vue`/`apps/*/pages/**`）改动 ≥5 行或含结构标签时，须同行原型/规格 diff 或 `Micro-exempt` trailer；warning 级，`--strict` 下 error |
| Q7 | 「原型 + UI 混合提交」是否一律 error | **一律 error**（混合提交正是绕过形态），不再放行；豁免只走 `UI_GATE=off` |

> T7–T12 已可全量开工，无阻塞项。

---

## 8. 接手须知（新对话怎么开工）

**Step 0 · 读这份文档 + 3 个上游文件**（不必读别的）：

1. `specs/kit-sop-enforcement/design.md`（本文）
2. `.codebuddy/agent-kit/AGENT.md` §43–52（开工前置 · 不分级不变量）
3. `.codebuddy/skills/rd-plan/SKILL.md` §验证判据表（V1…Vn 格式与同构规则）
4. `.codebuddy/rules/ui-interface/RULE.mdc`（规则文件写法范例）

**Step 1 · 核对 §7**：§7.1 已决议项（v1.1 已用户拍板）直接执行；**§7.2 的 Q6/Q7 是否已有答复**必须确认后再动 T11（`rd-plan` 对复杂改动要求"用户拍板后再执行"）。T1–T6（v1.0）已落码，v1.1 从 **T7** 开工。

**Step 2 · 按 §4 落地清单执行**，每完成一项即按 §5 对应 V# 实跑取证。

**Step 3 · 注意三条硬约束**：

- 改 `scripts/redline/scan-rules.sh` 只加判定函数，**不动调用方契约**（脚本头部已声明）
- **不得改 `.codebuddy/skills/` 下的通用技能**（`kit-gate` S7 会拦运行源漂移），L5 一律走上游仓库
- 新增脚本不得引入第三方依赖；`.codebuddy/.state/` 必须 gitignore

**Step 4 · 交付时给证据**：v1.0 按 V1…V9、v1.1 按 V10…V20 逐条给实跑输出，不得以「应该没问题」替代（`AGENT.md` §产出纪律 + `rd-execute` 完成验证门）。
