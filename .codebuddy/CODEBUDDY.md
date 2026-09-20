# 科豆 AI · 项目入口

> 本文是 **CodeBuddy / AI 常驻加载的项目总入口**，只说明入口：**① 工程（§1）② AI 协作（常驻指南 / 技能）（§2）③ AI 规则（§3）④ 维护约定（§4）**。

## 1 工程

**项目工程文档 → 读仓库根 `README.md`**（架构 / 服务与端口 / 目录与脚本 / 启动与验证 / 发布部署 / UI 规范 / 接口契约 / CI 门禁 / 产品路由，都在那里及其索引里）。

## 2 AI 协作（常驻指南 + 技能）

- **AI 协作资产继承上游 `https://github.com/web5/ai-agent-kit`** —— 常驻总则、红线、方法论都在上游仓库，本地不落副本。
- **技能实体** → 只保留一份在 `.codebuddy/skills/`（工具实际扫描的路径）；通用技能不得在本地改写，项目专属只放 `be-developer`/`fe-developer` 与 `rd-digital-agent/references/project-context.md`。
- **来源、取用方式与只读契约** → `.codebuddy/agent-kit/README.md`。
- **项目专属**规范与上下文 → `.codebuddy/references/`。

## 3 AI 规则（含 agent 安全）

- 只要与 agent 相关（含**工程的安全规则**）→ 放 **`.codebuddy/rules/`**（工具扫描加载）；通用红线在上游 `ai-agent-kit` 的 `rules/general/01–05`。

## 4 维护约定

- **本文承载**：工程入口说明 + AI 协作入口（常驻指南 / 技能 / 规则）说明；不复制工程事实，也不展开能力内容。
- **归属**：工程 → 仓库根 `README.md`；AI 协作资产 → 上游 `ai-agent-kit`（本地只留来源声明与技能实体）；技能实体 / 规则 / 项目上下文 → `.codebuddy/skills/`、`.codebuddy/rules/`、`.codebuddy/references/`。
- **能力源唯一**：通用技能只在上游 `ai-agent-kit` 演进；技能实体只有一份（`.codebuddy/skills/`），本地不得改写通用技能。
