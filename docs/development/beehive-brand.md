# Beehive · 智能研发平台 品牌说明

> 本文档定义部署/研发平台（原「发布管理控制台」，内部代号 `deploy-console`）的产品品牌：**Beehive（蜂箱）**。
> 用于统一产品命名、UI 文案、视觉调性，并记录「产品名」与「内部技术代号」的边界及后续迁移任务清单。

## 一、品牌定位

| 项 | 内容 |
|---|---|
| 产品名 | **Beehive**（英文优先，页面标题/logo 使用） |
| 中文语境 | 智能研发蜂箱 / 自运转的智能研发蜂巢 |
| 定位 | **智能研发平台**：覆盖需求 → 规划 → 编码 → 审查 → 发布的 AI 研发全流程提效，而非单纯的发布工具 |
| 页面副标 | `Beehive · 智能研发平台`（登录页副标：`自运转的智能研发蜂巢`） |
| 用户比喻 | 团队是**养蜂人**——只收成，不干预每只蜂怎么飞 |

## 二、品牌世界观（蜂箱隐喻）

平台 = 一个自运转的智能蜂巢，AI 调度分工，每只「蜜蜂」对应一个研发环节：

| 蜜蜂 | 职责 | 映射（与 rd-digital-agent 阶段对应） |
|---|---|---|
| 侦察蜂 | 出去找花田，跳摇摆舞汇报 | brainstorm（探索方案） |
| 内勤蜂 | 把蜜规划进正确的蜂房 | plan（拆任务） |
| 采蜜蜂 | 主力外出采集、酿造 | execute（编码实现） |
| 守卫蜂 | 守门，不合格的蜜不进 | review（审查/质量门禁） |
| 工蜂队列 | 建蜂房、清垃圾 | 构建/部署流水线 worker |

## 三、命名边界（重要）

**产品名只作用于「用户可见层」**；以下**内部技术代号刻意保留**，不随品牌改名，改动会牵连 gateway/nginx/pm2/发布链路：

| 层 | 保留项 |
|---|---|
| 代码目录 | `servers/deploy-console`、`apps/deploy-console` |
| 服务标识 | pm2 进程 `web-deploy-console`、端口 `6200` |
| 路由/前缀 | 前端 `base: /console/`、路由 `createWebHistory('/console/')`、API `baseURL: '/console/api'` |
| 发布链路 | 流水线自注册 `module_key: 'deploy-console'`、`EnvironmentManager` 端口表 |
| 数据/文档 | DB 库表、MCP 工具名、技术文档标题（本文档引用） |

> 如需彻底对外迁移（如 `/console/` → `/beehive/`），见 §六 迁移任务清单，作为独立迁移任务执行，禁止边开发边改。

## 四、视觉规范

| token | 值 | 用途 |
|---|---|---|
| 蜜金 `honey` | `#F5A623` | 主品牌色：logo 内六边形、状态高亮、装饰线 |
| 蜂巢深蓝 `hive-navy` | `#001529` | 侧栏底、favicon 底、深色强调 |
| 登录渐变 | `#1a1a2e → #16213e → #0f3460` | 登录页背景 |
| 警告黄 | `#fa8c16` | running 状态（沿用 antd 语义色） |

- **Logo**：蜂巢 cell（外六边形描边 + 内实心六边形，金色），深底版本用于侧栏/favicon
- **图标规范**：沿用项目规则——禁止 emoji，统一 SVG icon
- **favicon**：`apps/deploy-console/public/favicon.svg`（深蓝圆角底 + 金色蜂巢）
- **UI 方向（规划）**：hex-grid 蜂房网格做 Dashboard/模块状态仪表盘，蜜色填充度表达状态

## 五、UI 文案状态暗语（规划中，未全量落地）

| 场景 | 暗语 | 说明 |
|---|---|---|
| 构建中 | `gathering nectar` 采蜜中 | |
| 构建成功 | `honey ready` | |
| 部署/发布 | `return to hive` 归巢 | |
| 健康检查报告 | `waggle dance` 摇摆舞 | 蜜蜂用舞蹈上报花田位置 |
| 回滚 | `requeen` 换王 | |
| 线上稳定 | `thriving hive` | |

> 落地原则：**状态标签/提示文案**可替换为暗语；**功能菜单与页面标题**（发布中心、发布流水线等）保留中文功能名，不做品牌替换。

## 六、迁移遗留任务清单

以下为「产品化 Beehive」的待办，逐项开独立迁移任务解决（M-编号）：

| # | 任务 | 影响面 | 状态 |
|---|---|---|---|
| M-1 | 路由前缀 `/console/` → `/beehive/` | `vite base`、`router`、`api baseURL`、NestJS `ServeStaticModule` 路径、nginx/gateway 代理 location | 待迁移 |
| M-2 | pm2 进程名 `web-deploy-console` → `web-beehive` | 发布目录脚本、PipelineService 自重启逻辑、runbook、端口守卫（6200） | 待评估（风险高，倾向保留） |
| M-3 | 发布链路 `module_key: 'deploy-console'` / 端口表展示名 | PipelineService 自注册、`EnvironmentManager.vue:71` | 待评估 |
| M-4 | 技术文档与代码注释术语替换 | `docs/development/deploy-pipeline-dev.md`、`local-release-runbook.md` 等标题/术语 | 待迁移 |
| M-5 | 状态暗语 UI 替换（§五） | Dashboard/PipelineCenter 等状态标签、toast、日志行 | 待迁移 |
| M-6 | hex-grid 蜂房仪表盘（Dashboard/模块管理视觉重构） | Dashboard.vue、ServiceManager.vue 等 | 待迁移（大项） |
| M-7 | 品牌色 token 化并收口（当前独立 scss 硬编码） | `style.scss` 及全局主题；评估是否收口 `@web-system/shared` 设计常量 | 待迁移 |

## 七、UI 落地现状（已改，2026-09）

| 文件 | 内容 |
|---|---|
| `apps/deploy-console/index.html` | 页签 title：`Beehive · 智能研发平台`；挂载 favicon |
| `apps/deploy-console/src/layouts/MainLayout.vue` | 侧栏 logo：蜂巢 SVG + `Beehive`；折叠态仅图标；顶栏回退标题 |
| `apps/deploy-console/src/views/Login.vue` | 标题 `Beehive` + 副标；背景嵌套六边形装饰；卡片顶部 favicon 图标 |
| `apps/deploy-console/public/favicon.svg` | 深蓝底 + 金色蜂巢 favicon |
| `apps/deploy-console/src/style.scss` | logo/登录页样式，蜜金 `#F5A623` 引入 |

> 生效方式：deploy-console 走**传统发布**（发布目录构建 dist + `pm2 restart web-deploy-console`），见 `local-release-runbook.md`。
