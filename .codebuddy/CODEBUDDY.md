# 科豆 AI · 项目入口

> 本文是 **CodeBuddy / AI 常驻加载的项目总入口**，只说明入口：**① 工程（§1）② AI 技能与规则（§2、§3）③ 维护约定（§4）**。

## 1 工程

**项目工程文档 → 读仓库根 `README.md`**（架构 / 服务与端口 / 目录与脚本 / 启动与验证 / 发布部署 / UI 规范 / 接口契约 / CI 门禁 / 产品路由，都在那里及其索引里）。

## 2 AI 技能

- **AI 技能继承 `.codebuddy/agent-kit/`** —— 需要的技能从这里找。
- 技能文件：能力源 `.codebuddy/agent-kit/skills/<name>/SKILL.md` → 运行源 `.codebuddy/skills/<name>/SKILL.md`（IDE 实际加载的是运行源，它是能力源的镜像；`be-developer` / `fe-developer` 是项目专属，只在运行源）。
- 技能涉及的**规范与项目上下文** → `.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。

## 3 agent 安全

- 只要与 agent 相关（含**工程的安全规则**）→ 放 **`.codebuddy/rules/`**，由 `.codebuddy/agent-kit/` 引用。

## 4 维护约定

- **本文承载**：工程入口说明 + AI agent / skills / rules 的入口说明；不复制工程事实，也不展开能力内容。
- **归属**：工程 → 仓库根 `README.md`；AI 技能 / 规则 / 上下文 → `.codebuddy/agent-kit/`、`.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。
- **能力源唯一**：通用技能只在上游 `ai-agent-kit` 演进 → CI 进能力源 → `sync-agent-kit.sh --apply` 落运行源，运行源不得手改通用技能（S7 会拦）。
