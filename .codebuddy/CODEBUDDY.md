# 科豆 AI · 项目入口

> 本文是 **CodeBuddy / AI 常驻加载的项目总入口**，只说明入口：**① 工程（§1）② AI 技能与规则（§2、§2.5、§3）③ 维护约定（§4）**。
> 本文**只承载规则与入口说明，不承载工程事实**：架构、服务与端口、目录、模块、脚本、部署等具体工程信息，一律去工程文档检索（入口见 §1），不在本文复制、不在本文展开。

> ⚠️ **动手前先看 §2.5 动作门**：改 UI 源码前必须先过原型（有机器强制）。

## 1 工程

**项目工程文档 → 读仓库根 `README.md`**（架构 / 服务与端口 / 目录与脚本 / 启动与验证 / 发布部署 / UI 规范 / 接口契约 / CI 门禁 / 产品路由，都在那里及其索引里）。

- **工程信息检索原则**：需要任何工程事实（某服务端口 / 某模块结构 / 某文档位置 / 某脚本用法）→ 从 `README.md`（含 §9 文档地图）出发检索，或直接用检索工具查；**不要凭记忆或本文猜测**。
- 本引用块之下的 §2~§4 均为 AI 协作规范，不含工程事实。

## 2 AI 技能

- **AI 技能继承 `.codebuddy/agent-kit/`** —— 需要的技能从这里找。
- 技能文件：能力源 `.codebuddy/agent-kit/skills/<name>/SKILL.md` → 运行源 `.codebuddy/skills/<name>/SKILL.md`（IDE 实际加载的是运行源，它是能力源的镜像；`be-developer` / `fe-developer` 是项目专属，只在运行源）。
- 技能涉及的**规范与项目上下文** → `.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。

## 2.5 动作门（不可跳，且与用户措辞无关）

凡本次改动是 **UI 源码**（品牌端小程序页面/组件/界面文件、admin 系 Vue 界面）——**无论用户如何表达（含「间距高了」「太丑」「隐藏掉」这类微调措辞）**：

必须按序执行，**不得跳步**：

1. **原型先行**：先改原型稿 + 同步页面规格；原型必须**整合进该产品模块既有的整体原型稿**（先识别模块归属，不另起孤立 HTML）——细则见 `@brand-interface`「原型整合约定」，admin 系见 `@ui-interface`
2. 过 `ux-prototype-designer` 技能的**独立交互质检**
3. **设计评审（D2）**：交 `design-reviewer` 盲审（判据源 `docs/ui/design-system.md`），报告落盘 `docs/ui/reviews/*.md`，**阻塞项清零** ← 交人确认前
4. **用户确认原型** ← 人审节点，缺此步不得落码
5. 原型/规格**单独 commit**（不得与 UI 源码混在同一 commit），记下其 sha ← 用户已确认的机器凭证
6. 才落码；该 UI commit 的 message 必须带一行 `Proto: <sha>`，并带 `Design: pass`（CI R11 error 兜底）
7. **实现一致性评审（D3）**：落码后比对原型锚点 `data-dr` 与截图并置，报告落盘

- **机器强制与应急出口**：本门有 hook 强制与 CI 红线兜底（设计与实现见 `specs/kit-sop-enforcement/design.md`）；应急出口 `UI_GATE=off`。
- 例外：除 §2.5.1 另有约束外，纯后端 / 非 UI 文件改动不受**本门**约束；豁免：确属纯视觉微调（如仅调间距）在原型或规格记一行「微调豁免」即可通行。
- 本节只规定**顺序与语义**；触发路径清单、原型/规格/质检清单的文件位置、hook 配置等细节一律在对应规则与设计文档中检索，不在本文复制。

### 2.5.1 交付环节动作门（发布 / 环境 / 数据变更 · 与 UI 无关）

凡改动命中发布面或数据面 —— **即使是纯后端改动、即使只有一行**：

- `ecosystem.config.cjs` / `servers/*/.env*` / 流水线与发布脚本 / `scripts/migrations/**` / `.github/workflows/**`

按 `.codebuddy/rules/release-interface/RULE.mdc` 的动作门执行：过判据清单 → 出评审报告 → **阻塞项清零** → commit 带 `Release: pass`（CI R14 拦截）。

- 判据源：`docs/development/release-review-checklist.md`（A 运行面 / B 配置面 / C 数据面 / D 前端面 / E 特殊通道）
- 承担角色：`release-reviewer`（交付环节独立第三方，**不执行发布、不改码**，只出报告并回流）
- 纯配置值微调走 `Micro-exempt: <理由>`

> 为什么与 UI 门并列：**测试通过不等于能上线**。部署阶段的高频故障（改的不在被加载的目录、配置源被会话污染、旧进程占端口、迁移落到默认库）全部无报错，且不属任何现有评审的覆盖范围。

### 2.5.2 契约变更动作门（改一处会不会让消费方静默失效 · 与 UI 无关）

凡改动命中契约面 —— **即使是纯后端改动、即使只有一行**：

- `packages/types/**`（权限码 / 共享常量 / 枚举）
- `packages/agent-core/src/interfaces/**`（协议：`StreamEventType` / `RunInput`）
- `scripts/migrations/**`（数据 / 结构迁移）
- `servers/mcp-gateway/src/*/tools/**`（MCP 工具注册）
- `servers/*/src/*/*.controller.ts`（对外接口）

按契约纪律执行：过 `docs/api/contracts.md` 判据 → 出评审报告（**破坏性变更须附消费方清单**）→ **阻塞项清零** → commit 带 `Contract: pass`（或报告路径；CI R13 拦截）。

- 判据源：`docs/api/contracts.md`（C1 接口 / C2 SSE 事件 / C3 MCP 工具 / C4 权限码与常量 / C5 网关路由）
- 承担角色：`contract-reviewer`（**不代改、不代登记**，只出报告并回流）
- 一致性机检：**R16** —— 以 agent-core 的 `StreamEventType` 为真相源，比对各端手写联合 + import 型消费方的 `switch case`
- 纯微调走 `Micro-exempt: <理由>`

> 为什么与 UI 门并列：契约的破坏是**静默的**。`'card'` 未登记 → 小程序漏分支、音乐卡片实时不下发；删掉一个「以为没人用」的类型 → import 型消费方的 `switch case` 直接编译失败。两者都编译能过 / 测试能过，**只有专门查消费方才会暴露**。
> **硬步骤**：删契约前必须查 **import 型**消费方（grep `from '<包名>'` 后看其 `switch case` / `=== 'xxx'`）——只看手写型会漏（2026-09-24 实测踩过）。

## 3 AI 规则（含 agent 安全）

- 只要与 agent 相关（含**工程的安全规则**）→ 放 **`.codebuddy/rules/`**（工具扫描加载）；通用红线在上游 `ai-agent-kit` 的 `rules/general/01–05`。

## 4 维护约定

- **本文承载**：工程入口说明 + AI agent / skills / rules 的入口说明；不复制工程事实，也不展开能力内容。
- **工程信息一律外置**：工程事实变更（端口 / 目录 / 模块 / 脚本）只改工程文档（`README.md` 及 `docs/**`），本文不跟随更新——避免双份事实漂移；本文出现工程细节视为违规，应改为指向工程文档的入口。
- **归属**：工程 → 仓库根 `README.md`；AI 技能 / 规则 / 上下文 → `.codebuddy/agent-kit/`、`.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。
- **能力源唯一**：通用技能只在上游 `ai-agent-kit` 演进 → CI 进能力源 → `sync-agent-kit.sh --apply` 落运行源，运行源不得手改通用技能（S7 会拦）。
