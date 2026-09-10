# 项目上下文 · web_system

> 本文件把通用数字人模板对齐到本仓库真实信息。**属于项目专属文件**：`scripts/sync-agent-kit.sh` 同步时排除，勿被上游覆盖。
> 权威文件是 `.codebuddy/CODEBUDDY.md`（项目总入口）与 `docs/development-guide.md`；本文件只保留「数字人开工时最需要的那几屏」。

## 资料/项目结构

```
web_system/
├── apps/        前端：shell(基座) / admin / portal / deploy-console(独立 SPA) / mini-contract(小程序)
├── servers/     后端微服务：gateway auth user ai ai-agent system todo mcp-gateway content-hub upload deploy-console
├── packages/    共享包：shared types shell-loader ui agent-core kedou-agent mcp-core
├── docs/        人读文档（架构 / 开发 / UI / 产品 / 发布）
├── scripts/     构建 / 启动 / 验证 / 发布脚本
└── .codebuddy/  数字人体系（agent-kit 能力源 + skills 运行源 + rules 触发 + 本入口 CODEBUDDY.md）
```

## 领域与工具栈

| 层 | 说明 |
|----|------|
| 领域 | 全栈 AI 产品平台（微信小程序 + Web 管理端 + AI Agent 运行时） |
| 前端 | Vue3 + Vite + Pinia + Ant Design Vue 4.x；微前端：shell 基座 + `shell-loader` 动态加载模块 |
| 后端 | NestJS 10 + TypeORM + MySQL（本地）/ PostgreSQL（生产）；每服务独立数据库，TS strict |
| 小程序 | 微信原生 + TypeScript（`apps/mini-contract`） |
| 数据库 | `web_system`（业务）、`web_system_deploy`（发布平台，含微前端版本表 `deploy_deployments`） |
| 部署 | pm2（进程名 `web-*`）+ Nginx + 自研发布平台 deploy-console |
| 包管理 | pnpm workspace |

**服务端口（真实值，勿用旧文档）**：gateway 6000 / auth 6101 / user 6002 / ai 6003 / system 6004 / todo 6005 / mcp-gateway 6006 / content-hub 6007 / upload 6008 / ai-agent 6010 / deploy-console 6200。

## 风格与品牌常量

> 数字人本体人格与语气固定（技术型产品经理底色：专业、克制、结论先行，见 `AGENT.md`）。本节只是产出物背景。

- admin 系（admin / deploy-console / mcp-admin）主橙 `#F97316`；色值只引 `--ws-*` CSS 变量或 `packages/ui/src/tokens.ts` 的 `uiTokens`，禁裸 hex/rgba。
- portal「变变」品牌端：主色 `#FF8C42` / 底色 `#FFF8F0` / 文字 `#333333`；禁渐变，全部纯色。
- 图标统一 SVG（tabler/antd icons），**禁 emoji**；字重只用 400/500/600。
- 对外写作语气：专业、克制、结论先行。

## 生成与校验命令

```bash
pnpm install                      # 依赖
bash scripts/local-up.sh          # 构建共享包 + 全部后端 → pm2 启动 → 健康检查
bash scripts/start-frontend.sh    # portal(5173) / admin(5174) / docs(4173)
bash scripts/dev-verify.sh        # 全量验证：DB + 单测 + 集成 + 健康
# 发布：后端与 admin/portal → 发布流水线 POST /api/pipelines（env=local）
#       deploy-console 自身  → ./scripts/publish-deploy-console.sh（勿走流水线）
```

## 项目硬约束（详见 `.codebuddy/CODEBUDDY.md`）

- 功能改动顺序：**先文档 → 设计 → 确认 → 实现**；UI 改动先出页面规格书 + 可点击原型并过目。
- 批量整改（≥2 文件 / 跨页面 / 跨端）先出《影响清单》确认后再动。
- 同类修改必须扫全量（`grep -r enableCors servers/*/src` 式）；跨端配置收口 `@web-system/shared`，禁各端拷贝。
- 三层超时逐层核对；AI 类接口必须用 `API_TIMEOUT.AI_TASK`(90s) + gateway `PROXY_TIMEOUT.AI_TASK`。
- 微前端改动必须走「构建 → 拷贝产物 → 更新版本表 → 验证 manifest」四步，否则浏览器仍加载旧产物。
- 工程铁律完整版：`.codebuddy/references/coding-best-practices.md`。

## 通用原则（适用于任何项目）

- 同类修改必须扫全量，不只在手头文件改。
- 横切关注点（校验 / 日志 / 配置）统一收口，禁止各端拷贝。
- 对外交付物变更需同步更新 spec 与版本记录。
