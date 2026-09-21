# 科豆 AI · 项目入口

> 本文是 **CodeBuddy / AI 常驻加载的项目总入口**，只说明入口：**① 工程（§1）② AI 技能与规则（§2、§2.5、§3）③ 维护约定（§4）**。

> ⚠️ **动手前先看 §2.5 动作门**：改 UI 源码前必须先过原型（有机器强制）。

## 1 工程

**项目工程文档 → 读仓库根 `README.md`**（架构 / 服务与端口 / 目录与脚本 / 启动与验证 / 发布部署 / UI 规范 / 接口契约 / CI 门禁 / 产品路由，都在那里及其索引里）。

## 2 AI 技能

- **AI 技能继承 `.codebuddy/agent-kit/`** —— 需要的技能从这里找。
- 技能文件：能力源 `.codebuddy/agent-kit/skills/<name>/SKILL.md` → 运行源 `.codebuddy/skills/<name>/SKILL.md`（IDE 实际加载的是运行源，它是能力源的镜像；`be-developer` / `fe-developer` 是项目专属，只在运行源）。
- 技能涉及的**规范与项目上下文** → `.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。

## 2.5 动作门（不可跳，且与用户措辞无关）

> 设计：`specs/kit-sop-enforcement/design.md` §3.2。本门有机器强制（`.codebuddy/settings.json` PreToolUse hook，L3）；应急出口 `UI_GATE=off`，豁免记「微调豁免」一行即可。

凡本次改动涉及下列任一路径 —— **无论用户如何表达（含「间距高了」「太丑」「隐藏掉」这类微调措辞）**：

- `apps/*/pages/**`、`apps/*/components/**`、`packages/ui/**`、`app.json`
- 任何 `*.wxml` / `*.wxss` / `*.vue` 的界面文件

必须按序执行，**不得跳步**：

1. 先改原型稿（`apps/*/prototype/index.html` 或 `docs/ui/prototypes/**`）+ 同步页面规格（`specs/**/page-spec*.md`）
   - **原型稿必须整合进该产品模块既有的整体原型稿**（先识别模块归属，不另起孤立 HTML；对比稿拍板后收敛回整体原型，细则见 `@brand-interface` 规则「原型整合约定」）
2. 过 `ux-prototype-designer` 的独立交互质检（`references/ux-review-checklist.md`）
3. **用户确认原型** ← 人审节点，缺此步不得落码
4. 把原型/规格**单独 commit**（不得与 UI 源码混在同一 commit），记下其 sha ← 用户已确认的机器凭证
5. 才编辑落地代码（WXML/WXSS/Vue）；该 UI commit 的 message 必须带一行 `Proto: <sha>`

> 第 4/5 步由 `.githooks/commit-msg` 强制，CI 红线 R10 兜底（详见 `specs/kit-sop-enforcement/design.md` §3.8）。

例外：纯后端 / 非 UI 文件改动不受本门约束。
豁免：确属纯视觉微调（如仅调间距）时，在原型或 page-spec 中记一行「微调豁免」即可通行；批量机械改动/紧急修复用 `UI_GATE=off`。

## 3 agent 安全

- 只要与 agent 相关（含**工程的安全规则**）→ 放 **`.codebuddy/rules/`**，由 `.codebuddy/agent-kit/` 引用。

## 4 维护约定

- **本文承载**：工程入口说明 + AI agent / skills / rules 的入口说明；不复制工程事实，也不展开能力内容。
- **归属**：工程 → 仓库根 `README.md`；AI 技能 / 规则 / 上下文 → `.codebuddy/agent-kit/`、`.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。
- **能力源唯一**：通用技能只在上游 `ai-agent-kit` 演进 → CI 进能力源 → `sync-agent-kit.sh --apply` 落运行源，运行源不得手改通用技能（S7 会拦）。
