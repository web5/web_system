# 科豆 AI · 项目入口

> 本文是 CodeBuddy / AI 常驻加载的**项目总入口**（v2 五段式重构，2026-09-09）。
> 行文约定：**导航 + 一屏速查 + 关键铁律**，每个主题下方都给出「详细说明入口」指向单事实源文档 —— 落地执行前先打开权威文档，勿仅凭速查下结论。
> 结构：**① 技术栈与快速启动 → ② 项目架构 → ③ 开发规则与数字人技能体系 → ④ 发布部署 → ⑤ 门禁与质量**。文档地图见文末附录。

---

## 0 这是什么

科豆AI项目平台 —— 全栈 monorepo（Vue3 + NestJS + MySQL/PostgreSQL + 微信小程序）。一个仓库装三类资产：

| 类别 | 位置 | 说明 |
|---|---|---|
| 产品代码 | `apps/` `servers/` `packages/` | 前端应用 / 后端微服务 / 共享包 |
| 人读文档 | `docs/` | 架构、开发、UI、产品、发布手册（**项目自产**） |
| 知识库 | `raw/` `wiki/` | 外部素材（不可变）→ 编译知识文章 + 索引 + 日志（**AI 维护**，边界见 §3.3） |
| 数字人体系 | `.codebuddy/` | agent-kit 行为定义 + skills 技能 + rules 触发规则 + 本入口 |

**平台产品矩阵**（portal 端）：
| 产品 | 定位 | 路由 |
|---|---|---|
| 变变 | AI 拼贴变身 3D 角色 | `/create → /transform → /result` |
| 画板 | 自由绘画 + AI 文生图 | `/draw` |
| AI 学习助手 | 少儿 AI 对话 | `/chat` |

---

## 1 技术栈与快速启动

### 1.1 技术栈

| 层 | 技术 | 要点 |
|---|---|---|
| 前端 | Vue3 + Vite + Pinia + Ant Design Vue 4.x | 微前端化：shell 基座 + `shell-loader` 动态加载模块 |
| 后端 | NestJS 10 + TypeORM + MySQL（本地）/ PostgreSQL（生产） | 每个微服务独立数据库，全部 TS strict |
| 小程序 | 微信原生 + TS | `apps/mini-contract` |
| 共享包 | shared / types / shell-loader / ui / agent-core / kedou-agent | `packages/`，跨端配置一律收口到 `@web-system/shared` |
| 部署 | pm2 + Docker Compose + Nginx + 自研发布平台（deploy-console） | 发布见 §4 |

### 1.2 顶层目录速览

```
web_system/
├── apps/        # 前端：shell(基座) admin portal mini-contract(小程序,约定 mini-<业务>) deploy-console(独立 SPA)
├── servers/     # 后端微服务：gateway auth user ai ai-agent system todo mcp-gateway content-hub upload deploy-console
├── packages/    # 共享包：shared types shell-loader ui agent-core kedou-agent mcp-core
├── scripts/     # 构建/启动/验证/发布脚本（local-up.sh start-frontend.sh dev-verify.sh publish-*.sh …）
├── docs/        # 人读文档（分册地图见附录；项目自产）
├── raw/         # 知识库·外部素材原文快照（不可变，只增不改；karpathy-llm-wiki 维护）
├── wiki/        # 知识库·编译结论（文章 + index.md 全局索引 + log.md 操作日志）
├── .codebuddy/  # 数字人体系（能力源 agent-kit + 运行源 skills + rules + references + 本入口）
├── migrations/  # 数据库迁移 SQL
├── local.nginx.conf / micro-frontend.nginx.conf   # 本地 nginx 集成配置
└── ecosystem.config.cjs / docker-compose*.yml      # pm2 进程清单 / 容器编排
```

### 1.3 本地快速启动

> 权威教程（换机从零跑，含无 brew/sudo 装 MySQL+Redis）：`docs/development/local-dev-setup.md`
> 完整开发指南（服务/启动/验证/FAQ）：`docs/development-guide.md`

```bash
pnpm install                       # 首次装依赖（pnpm workspace）
bash scripts/local-db.sh           # 起本地 MySQL(3306) + Redis(6379)，建库 web_system
bash scripts/local-up.sh           # 构建共享包 + 全部后端 → pm2 启动(web-*) → 健康检查
bash scripts/local-up.sh --no-build    # 跳过构建仅重启（改 .env 后最快）
bash scripts/local-up.sh --seed        # 额外重置 admin 密码 admin123
bash scripts/start-frontend.sh     # portal(5173) + admin(5174) + docs(4173)
bash scripts/dev-e2e-start.sh      # 微前端端到端（构建 externals/shell/模块 + seed + gateway 前台）
```

前端单模块 standalone（快速排查样式/页面，不加载基座）：

```bash
cd apps/admin && npx vite --port 5175   # http://127.0.0.1:5175/admin/
cd apps/portal && npx vite --port 5173  # http://127.0.0.1:5173/portal/
```

> ⚠️ **admin 路由 base 是 `/admin/`**：页面 URL 必须带 `/admin/` 前缀（如 `/admin/agents`），不带会 404。portal 同理需 `/portal/` 前缀。
> 本地 nginx 集成（配 `local.nginx.conf`）：`sudo ~/local/nginx/sbin/nginx` 启动 / `-s reload` 重载，访问 `https://local.kedouai.com/admin/`。

### 1.4 验证脚本速查

| 命令 | 作用 |
|---|---|
| `bash scripts/dev-verify.sh` | 全量：DB + 单测 + 集成 + 健康 |
| `bash scripts/dev-verify.sh --unit/--integ/--health` | 分别跑单测 / 集成 / 健康自检 |
| `node scripts/_test-p0.mjs` / `_test-p1.mjs` | 发布系统集成测试（真实 DB） |
| `cd apps/* && pnpm dev` | 前端 dev server |
| `cd servers/<svc> && pnpm dev` | 后端 nest watch 热重载 |

### 1.5 详细说明入口

- `docs/development/local-dev-setup.md` — 新机器/换环境从零启动（含无 brew 装 DB）
- `docs/development-guide.md` — 研发平台开发与使用总指南（分层/服务清单/启动/发布系统/FAQ）
- `docs/development/admin-dev.md` — admin 微前端详细开发（依赖/路由/nginx 集成/微前端发布四步/提 PR）
- `docs/development/agent-capability-playbook.md` — **Agent 能力体验手册**（四层架构/8 个 UI 入口/权限码/推荐走查路线/维护约定）— 动手体验或回归验证 Agent 先看这篇
- `docs/development/whistle-local-dev.md` — whistle 本地代理
- `docs/development/cross-tool-agent-context-design.md` — **跨工具 Agent 上下文装配设计**（`AGENTS.md` 单一真相源 + Claude Code/Codex/Cursor 适配层；**设计方案，待评审，尚未实施**）

---

## 2 项目架构

### 2.1 分层架构（总图见 `docs/development-guide.md` §1）

```
前端 apps/（shell 基座 + portal/admin 模块 + mini-contract + deploy-console SPA）
        │  shell-loader + window.__SHARED__ 共享依赖，按 __MODULES_MANIFEST__ 加载版本
Gateway（6000）→ API 反代 /api/* → 各后端微服务；兼微前端基座 + 版本分发/灰度
后端 servers/（auth user ai ai-agent system todo mcp-gateway content-hub upload deploy-console）
基础设施：MySQL(web_system + web_system_deploy)  Redis  nginx  pm2
```

架构要点：
- **每服务独立数据库**；所有 API 走 gateway 代理，前端不直连后端
- **微前端**：shell 提供 `window.__SHARED__`（vue/router/pinia/antd 防重复打包）与版本 manifest；`packages/shell-loader` 按清单动态加载模块 `index.js/css`；CSS 用 `:where([data-module])` 前缀隔离；产物版本化存 `static/modules/<key>/<version>/`
- **灰度**：gateway `deploy_canary_rules`（header/percent/user-list 三种匹配）

### 2.2 服务与端口（pm2 进程名 `web-*`）

| 服务 | 目录 | 端口 | 进程 | 说明 |
|---|---|---|---|---|
| gateway | servers/gateway | 6000 | web-gateway | API 反代 + 微前端基座 + 版本分发/灰度 |
| auth-service | servers/auth-service | 6101 | web-auth | 认证（登录/JWT/微信） |
| user-service | servers/user-service | 6002 | web-user | 用户 |
| ai-service | servers/ai-service | 6003 | web-ai | AI（对话/生图/TTS） |
| ai-agent | servers/ai-agent | 6010 | web-ai-agent | AI Agent（运行时引擎服务） |
| system-service | servers/system-service | 6004 | web-system | 系统（配置/素材） |
| todo-service | servers/todo-service | 6005 | web-todo | 待办 |
| mcp-gateway | servers/mcp-gateway | 6006 | web-mcp-gateway | MCP 网关 |
| content-hub | servers/content-hub | 6007 | web-content-hub | 内容中枢（财经/AI 资讯） |
| upload-service | servers/upload-service | 6008 | web-upload | 上传 |
| deploy-console | servers/deploy-console | 6200 | web-deploy-console | 运维控制台（发布/环境/监控，控制台 /console/） |

### 2.3 前端应用

| 应用 | 目录 | 类型 | 本地访问 |
|---|---|---|---|
| shell | apps/shell | 微前端基座 | 构建产物走 gateway(6000/) |
| portal | apps/portal | 微前端模块 | http://localhost:5173/portal/ |
| admin | apps/admin | 微前端模块 | http://localhost:5174/admin/ |
| deploy-console | apps/deploy-console | 独立 SPA（运维） | deploy-console 后端 serve（6200/console/） |
| mini-contract | apps/mini-contract | 微信小程序 | 独立上传 |

### 2.4 共享包（packages/）

| 包 | 作用 |
|---|---|
| shared | 共享常量（API_TIMEOUT 分层）、SnakeNamingStrategy、UuidEntity 等 —— 跨端配置唯一收口 |
| types | 权限等 TS 类型 |
| shell-loader | 自研微前端加载器（register/mount/unmount，unmount 移除 CSS） |
| ui | 共享 UI 组件 + 设计 token（`packages/ui/src/tokens.ts`，admin 系数值唯一真相源） |
| agent-core | `@kedouai/agent-core`：Agent 核心库（纯 TS，ReAct 引擎/注册表/记忆压缩） |
| kedou-agent | Agent CLI（交互式，基于 agent-core） |
| mcp-core | MCP 核心 |

### 2.5 数据与静态资源

- **本地 DB**：`web_system`（业务）+ `web_system_deploy`（发布平台独立库，gateway 用独立数据源连它）—— ⚠️ 微前端版本表 `deploy_deployments` 在 **web_system_deploy** 库，勿写错库
- **静态资源路径**（gateway 直接提供）：
  - `/api/uploads/*` — 用户上传 + AI 生成图片统一路径；AI 图必须落盘此目录 + DB 存相对路径，不能只存远程 URL
  - `/materials/svg/*` — 系统素材 SVG

### 2.6 架构详细说明入口

- `docs/development-guide.md` §1 — 分层/服务/共享包/微前端机制
- `docs/architecture/技术架构.md` — 技术架构总述
- `docs/architecture/micro-frontend-technical-design.md` — 微前端设计（共享依赖/CSS 隔离/产物分发）
- `docs/architecture/网关URL规划.md` — 路由规划；`docs/architecture/MCP服务间鉴权.md` — 服务间鉴权；`docs/architecture/kedou-network-architecture.md` — 网络架构
- `docs/architecture/agent-definition-db-design.md` — 数字人 Agent 定义数据模型（与 §3 数字人体系呼应）
- `docs/development/agent-capability-playbook.md` — Agent 能力全景与体验入口（agent-core / ai-agent:6010 / ai-service:6003 / knowledge:6011 的能力清单与表结构，改 Agent 相关代码后须同步更新该手册）
- `docs/architecture/release-system-design.md` / `release-system-implementation-plan.md` — 发布平台设计
- `docs/architecture/micro-frontend-style-guide.md` — 微前端样式约束

---

## 3 开发规则与数字人技能体系（agent-kit）

> 本节把 `.codebuddy/agent-kit` 数字人定义**整体加载进工程**。它不是一个文件，而是「指南 → 技能/SOP → 红线」三层体系。
> **唯一能力源 = `.codebuddy/agent-kit/`**（ai-agent-kit 仓库 CI 同步而来，现为 v1.8「一循环 + 三类资产 + 一类能力」）；IDE 真正加载的**运行源**是 `.codebuddy/skills/`，其内容 = `agent-kit/skills` 全量镜像 + 项目专属 `be-developer`/`fe-developer` + 项目上下文文件。
> 两者一致性由 `scripts/redline/check-kit-structure.sh` S7 机器守护；同步用 `scripts/sync-agent-kit.sh --apply`。元仓库/方法论全文：`.codebuddy/agent-kit/README.md`。

### 3.1 AI 协作范式（怎么和 AI 一起工作）

- **定位**：把 AI 当数字同事 —— 人负责关键节点审核与决策，AI 负责产出与执行；工作瓶颈在流程设计，不在单点执行速度。
- **人审 3 节点**：意图确认 → 设计确认 → 交付前审查。审查顺序：逻辑 → 合规/红线 → 对照 spec。
- **版本化产物链**：意图(intent) → 设计(spec) → 执行 → 带审查记录的交付 → 复盘；产物落盘，不只在对话里。
- **上下文工程**：上下文是有限资源 —— 即时加载、定期压缩、结论落盘；复杂任务拆给独立上下文子代理，主线程只留摘要。
- **验证优先**：完成声明 = 验证证据，禁止「应该没问题」。小改动走简化档（thinking-checklist 3 问），大改动走完整链。

### 3.2 常驻指南与画像（先读这个）

| 文件 | 内容 |
|---|---|
| `.codebuddy/agent-kit/AGENT.md` | 智能体常驻操作总则（三层结构/工作流/人审节点/红线/加载方式） |
| `.codebuddy/agent-kit/references/digital-agent-profile.md` | 数字人画像（六维定义实例） |
| `.codebuddy/agent-kit/references/ai-methodology.md` | 完整方法论（8 节，可当分享 PPT） |
| `.codebuddy/agent-kit/references/agent-definition-*.md` | 智能体定义方法论 + 六维填空模板 |

### 3.3 技能地图（怎么干 —— Hub 路由）

> 入口技能 `.codebuddy/skills/rd-digital-agent/SKILL.md`（数字人 Hub v4.4，与能力源同版本）按任务类型/复杂度分派：

```
用户请求
  ├─ 模糊需求/需求澄清 ──────────→ requirement-translation（需求 spec）→ rd-brainstorm
  ├─ "怎么做"/设计方案 ──────────→ rd-brainstorm → rd-plan（选方案/确认后）→ rd-execute → rd-review
  ├─ "拆任务"/细化/已有方案 ──────→ rd-plan → rd-execute → rd-review
  ├─ 做个原型/交互怎么设计 ──────→ ux-prototype-designer（原型稿 + 独立交互质检）→ rd-plan → rd-execute
  ├─ 报错/测试失败 ──────────────→ systematic-debugging（四阶段根因）→ rd-execute 完成验证门
  ├─ 重构/清理 ─────────────────→ incremental-refactoring → rd-execute 完成验证门
  ├─ "X 在哪实现"/理解结构 ──────→ code-explore（只读探索）
  ├─ 小改动/修 bug/简单任务 ─────→ rd-execute（直连，仍须最小计划 + 验证判据）→ rd-review
  ├─ 架构/选型/安全/信息结构 ────→ tech-review（辅助审查）
  ├─ 交付前独立盲测 ────────────→ test-verification（第三方盲测，对开发/需求质疑）
  ├─ UI/页面/样式/交互（项目装配）→ fe-developer ＋ UI 铁律 §5.3 + `docs/ui/`
  ├─ 服务/接口/数据/安全横切/部署 ─→ be-developer
  └─ 任何交付前收尾 ────────────→ rd-execute 完成验证门（对照 V1…Vn，不分级）
```

| 技能（运行源 `.codebuddy/skills/`） | 用途 |
|---|---|
| `rd-digital-agent` | Hub：唯一编排入口，按类型/复杂度分派 |
| `requirement-translation` | 链首：模糊意图 → 可验证需求 spec（验收判据/反例/待确认） |
| `rd-brainstorm` / `rd-plan` | 探索方案选项（2-4 个对比）→ 细化为任务列表 + 验证判据表 V1…Vn |
| `rd-execute` | TDD 逐项实现（红→绿→重构）+ **收尾完成验证门**（完成声明 = 验证证据） |
| `rd-review` / `tech-review` | 实现者自查 / 方案·结构·数据·安全审查 |
| `ux-prototype-designer` | 需求 → 可点击交互 HTML 原型稿 + 独立交互质检 |
| `test-verification` | 独立第三方盲测（按需求判据构造反例，对开发/需求质疑） |
| `systematic-debugging` | 系统化调试（四阶段根因分析，遇 bug 先加载） |
| `incremental-refactoring` | 测试保护下的增量重构 |
| `code-explore` | 代码库探索（索引优先/影响面分析） |
| `user-memory` | 用户偏好与项目上下文记忆 |
| `be-developer` / `fe-developer` | **项目专属**：后端服务/接口/数据；admin 系前端页面/UI |
| `karpathy-llm-wiki` | **资产维护型能力**：`raw/`（不可变源）→ `wiki/`（编译结论）知识库的建与维护（Ingest / Query / Lint）；**协议来自能力源，数据落本项目** |

**知识库数据落点与边界**（本项目约定，2026-09-11 定）：

| 目录 | 内容 | 维护方式 |
|---|---|---|
| `raw/` | **外部**素材原文快照（文章 / 论文 / 推文 …） | AI 采集，**不可变**——只新增，不改写已落盘文件 |
| `wiki/` | 由 `raw/` 编译出的知识文章 + `index.md` 全局索引 + `log.md` 操作日志 | AI 维护，人读与提问 |
| `docs/` | **项目自产**文档（架构 / 开发 / UI / 产品 / 发布手册） | 人写，随代码演进 |

- **边界判据**（只此一条）：**外部输入的编译结论** → `wiki/`；**本项目自产的东西** → `docs/`。项目自产文档不进 `wiki/`，外部素材原文不进 `docs/`。
- 位置固定**在项目根**（`raw/` + `wiki/`）——技能默认即此布局，故**不改技能里的路径约定**；两个目录**随仓库入库**，知识库才能跨会话累积。

> 原 `karpathy-coding-guidelines` / `karpathy-coding-rules-dami` 两个本机符号链接技能**已退役**（2026-09-11）：其内容早已并入能力源的 `AGENT.md` §产出纪律 + `references/code-discipline.md`，保留即构成同一纪律的多重真相源。

> ⚠️ 技能名带「触发词」（description），任务描述命中即自动加载。
> 项目上下文（结构/端口/技术栈/品牌常量/硬约束）唯一落点：`.codebuddy/skills/rd-digital-agent/references/project-context.md`。

### 3.4 评测体系（怎么证明 kit 变好了）

- 本项目**不再自建评测报告库**：评测（五层过滤 L1 结构 → L2 路由 → L3 行为 → L4 端到端 → L5 实战 + 五维 rubric）在**上游 `ai-agent-kit` 仓库**运行，`agents/`、`evals/` 等落在源仓库。
- 本项目只做两件机器守护：① `check-kit-structure.sh` S1~S7 结构完备；② S7 运行源 ↔ 能力源零漂移。
- 评测方法论定稿：`.codebuddy/agent-kit/references/eval-framework.md`。

### 3.5 项目工程铁律（横切自查，必看）

> 这些规则源自真实踩坑，目标是提高 AI 编码「一次正确率」。完整版：`.codebuddy/references/coding-best-practices.md`

**① 同类修改必须扫全量（Monorepo）**：改横切关注点前先 `grep` 所有服务，不能只改遇到的：
```bash
grep -r enableCors servers/*/src        # CORS 全部从 env 读
grep -r useGlobalFilters servers/*/src  # 全局异常过滤器全注册
grep -r 'console\.' servers/*/src       # 无 console.log 残留
```

**② 跨端配置禁止拷贝，收口 `@web-system/shared`**：新建/追加到 `packages/shared/src/` → index.ts re-export → 删各端本地拷贝。

**③ 请求超时分三层，逐层排查**（前端 axios / gateway proxy / 后端 http client）：
- 三层超时独立配置，真实超时取**最短层**；`ERR_ABORTED`/504 从最内层往外查
- AI 类接口（`/api/ai/*`、`/api/bianbian/*`）必须用 `API_TIMEOUT.AI_TASK`（90s）+ gateway proxy `PROXY_TIMEOUT.AI_TASK`，否则被 30s 截断

**④ 新增魔法数字先全局搜索**，复用已有常量，避免各端不一致。

**⑤ 收口后清理冗余文件**：统一后删除旧配置，确认无旧 import 残留。

**⑥ 后端加 shared 依赖**：`package.json` 加 `file:../../packages/shared` 即可，**勿在 tsconfig 加 paths**（会让 nest build 把 shared 源码编进 dist）。

### 3.6 安全 / 质量 / 部署铁律速查

| 类别 | 规则 | 正确做法 | 错误做法 |
|---|---|---|---|
| 安全 | CORS | `configService.get('CORS_ORIGINS','')` | 硬编码 `*` 或无参 enableCors |
| 安全 | 异常消息 | 生产非 HttpException → `'服务器内部错误'` | 透出 `exception.message` |
| 安全 | 输入校验 | @Body/@Query 用 class-validator DTO | `Record<string,string>` 裸类型 |
| 安全 | 日志 | `new Logger('x').log()` | console.log |
| 安全 | JWT_SECRET | 服务启动时校验非空 | 空串不报错 |
| 质量 | JWT 校验 | 前端守卫校验 `exp` | 只查 token 存在 |
| 质量 | 401 拦截 | 竞态锁+60s 超时重置+refreshToken | 无锁/锁永不重置 |
| 质量 | 404/403 | 前端配置 404+403 页 | 权限失败跳 /dashboard |
| 部署 | PM2 | `pm2 restart xxx \|\| pm2 start ...` | `pm2 delete; pm2 start` |
| 部署 | 脚本路径 | `SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` | `dirname $0` 相对路径 |
| 通用 | TS | `strict: true`，禁止 `any` | 手选 subset / noImplicitAny:false |

**Icon/静态资源规范**：禁 emoji 图标，统一 SVG；`/api/uploads/*`、`/materials/svg/*` 由 gateway 直出（见 §2.5）。

### 3.7 技能/规则挂载关系（防混淆）

```
.codebuddy/agent-kit/   ← 唯一能力源（通用方法论，AI 同步自 ai-agent-kit：skills(14) + rules/general + references）
.codebuddy/skills/      ← 运行源（IDE 实际加载）= 能力源 skills 全量镜像 + be-developer/fe-developer + project-context.md
.codebuddy/rules/       ← 机器触发层（mdc 规则：ui-interface → docs/ui）
.codebuddy/references/  ← coding-best-practices.md（工程铁律完整版）
.codebuddy/CODEBUDDY.md ← 本总入口（AI 常驻加载，引导以上各层 + docs）
```

> 新增能力（如「日志排查」等专项技能）的路径：**先加到上游 ai-agent-kit → 经 CI 同步进能力源 → `sync-agent-kit.sh --apply` 落到运行源**；临时项目专属技能直接放 `.codebuddy/skills/<name>/SKILL.md` 并同步白名单（`check-kit-structure.sh` RUN_SKILLS）。

---

## 4 发布部署

> ⚠️ **核心认知（2026-09 迁移后）**：服务统一从**发布目录 `~/web_system_release`** 运行（pm2 `web-*`，dotenv 按 cwd 加载**发布目录**的 `.env`）。**发布 = 工作区 commit&push → 发布目录 git 拉取 → 构建部署**，不是基于当前工作区。
> 完整运维手册：`docs/development/local-release-runbook.md`；流水线设计：`docs/development/deploy-pipeline-dev.md` + `docs/architecture/release-system-design.md`。

### 4.1 三条发布通道（选对通道，别混用）

| 发布对象 | 通道 | 操作 |
|---|---|---|
| 后端服务 + admin/portal 前端 | **发布流水线** | `POST /api/pipelines`（deploy-console 6200，env=local，branch=feature/xxx）→ 轮询 jobId 至 succeeded |
| deploy-console 自身（6200） | **传统发布** | 仓库根 `./scripts/publish-deploy-console.sh`（release ff 同步→nest build→vite build→6200 孤儿进程清理→pm2 restart→save→健康复检）⚠️ 勿走流水线（会自杀式 restart 执行者） |
| admin/portal 前端微前端模块 | 传统（改完源码生效路径） | 见下方「微前端模块四步铁律」 |

**微前端模块更新四步铁律**（改 admin/portal 源码后必须执行，否则浏览器仍加载旧产物）：
```bash
cd apps/admin            # <module> 同理换 portal
V=$(git -C ../.. rev-parse --short HEAD)
P=default                # 产品线段（= 发布模板 key）；RELEASE_TAG 与部署路径必须一致，缺段会让 base 少一层
RELEASE_TAG=$P/$V MF_FORMAT=system npx vite build --mode mf
mkdir -p ../gateway/public/static/modules/admin/$P/$V && cp -r dist/* ../gateway/public/static/modules/admin/$P/$V/
# ⚠️ 版本表在 web_system_deploy.deploy_deployments（不是 web_system 库！）
#    UPDATE web_system_deploy.deploy_deployments SET current_version='$P/$V', status='deployed', deployed_at=NOW()
#    WHERE env_id='dev' AND module_key='admin';
sleep 12                                   # gateway TTL 10s 版本缓存；仍旧则 pm2 restart web-gateway
curl -s localhost:6000/__manifest__        # 确认 admin version=$P/$V
curl -s localhost:6000/static/modules/admin/$P/$V/index.js   # 确认 200
```
> 两个最易踩坑：① 版本表在 **web_system_deploy** 库；② gateway 有 **TTL 10s 缓存**（要等待或重启 gateway）。

### 4.2 发布相关脚本（scripts/）

| 脚本 | 作用 |
|---|---|
| `local-up.sh` | 构建 + pm2 启动全部后端（本地开发态） |
| `start-frontend.sh` | 起 portal/admin/docs 前端 |
| `publish-deploy-console.sh` | deploy-console 传统发布（§4.1，支持 --skip-sync/--skip-health、DRY_RUN=1） |
| `publish-ai-agent.sh` / `publish.sh` | ai-agent / 通用发布 |
| `sync-agent-kit.sh` | 同步 ai-agent-kit → `.codebuddy/agent-kit` |
| `build-module.mjs` | 微前端模块打包（vite build --mode mf） |
| `deploy.sh / rollback.sh` | SSH 远程部署 / 回滚 |

### 4.3 关键坑速查

- **后台批量删除 ≥500 文件**被 CodeBuddy 安全层拦截（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）→ 用发布 Hook 的 `mv 到 /tmp` 方案（content-hub/upload/ai-agent build、admin/portal build+upload+cleanup 已注册），勿改 IDE 阈值
- **pnpm install 中断**残留 `*_tmp_*` 目录 → tsc 报 `TS2688` → `mv` 到 /tmp 清理，缺失包从工作区 `cp -R` 补齐
- **pm2 --update-env 传播旧 env**（PORT 污染，dotenv 不覆盖）→ 干净 env `start` + `pm2 save`
- **6200 端口孤儿进程**：旧进程未释放端口 → 新进程 EADDRINUSE 崩溃、最终对外仍是旧孤儿 → `lsof -ti tcp:6200` kill 后 `pm2 restart web-deploy-console`，并确认占用 pid == pm2 当前 pid

### 4.4 详细说明入口

- `docs/development/local-release-runbook.md` — 本地发布运维手册（发布目录架构/Hook/坑位）
- `docs/development/deploy-pipeline-dev.md` — 发布流水线设计（阶段/回滚/探活）
- `docs/architecture/release-system-design.md` — 发布平台概念模型（模块/环境/服务器组/灰度）
- `docs/development/ai-native-sdlc-ci-deployment.md` — CI 门禁与红绿线（见 §5）
- `docs/development/admin-dev.md` §一·C — 微前端模块发布四步详解

---

## 5 门禁与质量

### 5.1 三道门禁（红线机器化）

| 门禁 | 时机 | 内容 | 违规后果 |
|---|---|---|---|
| 本地 pre-commit | commit | 扫 R1~R4（调试残留/敏感文件/占位/@ts-ignore/:any） | 阻断提交 |
| quality-gate | PR | 扫红线 R1~R5 + 改动包 lint(lint:ci 只读)/build/test | 无法 merge |
| kit-gate | PR（改数字人定义） | `check-kit-structure.sh` S1~S7：能力源必需文件齐全 / 无孤儿 skill / frontmatter 合规 / Hub 路由目标存在 / 红线有判定手段 / **运行源与能力源零漂移** | CI 拦截 |

- **红线脚本**：`pnpm redline:local`（staged 扫描）/ `pnpm redline:scan`（全量 staged）/ `pnpm redline:tree`（本地全仓巡检）
- **kit 结构自检**：`bash scripts/redline/check-kit-structure.sh`（本地=CI 同一份脚本）；改运行源前先 `bash scripts/sync-agent-kit.sh`（dry-run 预览差异）
- CI 文件：`.github/workflows/quality-gate.yml`、`kit-gate.yml`、`auto-pr.yml`（push feature/*/fix/* 自动提 PR 到 master，幂等）

### 5.2 提交 & 提 PR 规范（用户要求提交时执行）

- **只 add 本次工作文件**：精确 `git add <文件>`，勿混入 `known-issues.md`、`optimization-roadmap.md` 等无关文件
- **token**：GitHub PAT 在根 `.env` 的 `GITHUB_PR_TOKEN`（不进 git）：`export GH_TOKEN=$(grep '^GITHUB_PR_TOKEN=' .env | cut -d= -f2-)`
- **提 PR 到 master**：`gh` 可用 → `gh pr create --base master --head <分支> ...`；不可用 → GitHub API curl（临时 json 用完即删，token 不明文写入可提交文件）
- 详见 `docs/development/admin-dev.md` §五

### 5.3 UI 生成铁律（admin 系 · 每个 UI 任务强制）

> 细则本体在 `docs/ui/`（单事实源，**入口 = `docs/ui/README.md`** 读取地图），规则 `.codebuddy/rules/ui-interface/` 负责触发。收到 UI 任务（新页/改版/调样式/交互）按此执行：

1. 读 `docs/ui/README.md` → 新页面必读 `docs/ui/design.md`（判断层）
2. 按 `docs/ui/page-spec-template.md` 填**页面规格书**（新页 Full / 小改 Quick）
3. **规格书先给用户确认，确认后才写码**——禁止跳过直接实现
4. 改色/加色 → 读 `docs/ui/color-reference.md`；覆盖冲突/"改了不生效" → 读 `docs/ui/css-override-rules.md`
5. 完成自检（design.md §5：无裸色/无新增 !important/dark 过目/截图基线），修正记录追加 `docs/ui/geist-token-评审记录.md`（只追加）

**最小禁项**：禁裸 hex/rgba（只引 `--ws-*`）；禁新增 `!important`；禁 emoji 图标；互斥单选 ≤5 固定选项禁 `a-select`（用 tabs/radio）；主操作 primary ≤1；破坏性操作必二次确认。

### 5.4 设计常量与 Token

- **admin 系（deploy-console/admin/mcp-admin）UI 数值以 `packages/ui/src/tokens.ts` 为准**（DR-3 主橙 `#F97316`，平台段）
- 平台（暗色）：主色 `#f97316` / 暗底 `#0A0A0D` / 文字 `#F8FAFC`
- 变变产品（暖色）：主色 `#FF8C42` 魔法橙 / 底色 `#FFF8F0` / 文字 `#333333` —— 品牌色只用于 portal/mini-contract，不套用 admin UI 规范（DR-5）

### 5.5 详细说明入口

- `docs/development/ai-native-sdlc-ci-deployment.md` — SDLC + CI 门禁全解（R1~R5 定义/hooks/kit-gate）
- `docs/ui/README.md` — UI 规范读取地图

---

## 附录 A：docs 分册地图

| 分册 | 内容 |
|---|---|
| `docs/development/` | 开发流程/启动/发布手册/admin-dev/CI 门禁/local-dev-setup/跨工具 Agent 装配设计 |
| `docs/architecture/` | 技术架构/微前端/网关/MCP 鉴权/发布系统/Agent DB 设计 |
| `docs/ui/` | UI 规范**单事实源**（README 地图/design/color/规格书模板/原型/评审记录） |
| `docs/products/` | 产品设计素材 |
| `docs/api/`、`docs/miniprogram/` | API 文档、小程序设计 |
| `docs/plans/` `docs/intents/` `docs/analysis/` `docs/archive/` | 计划/意图/分析/归档（如 `docs/archive/todo-list/audit-report-2026-07-26.md`） |
| `docs/发布与运维手册.md` `docs/工程完善计划.md` | 仓库级手册 |

## 附录 B：.codebuddy 结构

```
.codebuddy/
├── CODEBUDDY.md          ← 本入口（v2 五段式）
├── agent-kit/            ← 唯一能力源：AGENT.md + kits/(L1/L2/L3) + skills/(13) + rules/general/(5 红线) + references/(10)
├── skills/               ← 运行源（IDE 加载）= agent-kit/skills 镜像 + be-developer/fe-developer
│   └── rd-digital-agent/references/project-context.md   ← 项目上下文（项目专属，同步时排除）
├── rules/                ← 触发规则：ui-interface/(RULE.mdc→docs/ui)
└── references/           ← coding-best-practices.md（工程铁律完整版）
```

---

## 维护约定

- 本入口文件保持「导航 + 速查 + 铁律」定位，**详细叙述一律下沉到 docs/ 与 .codebuddy/ 对应单事实源**；新增主题先在 §1~§5 挂位再补内容。
- 数字人能力收敛为**唯一能力源 `.codebuddy/agent-kit/`**：通用技能只在上游 `ai-agent-kit` 演进，经 CI 进能力源，再 `sync-agent-kit.sh --apply` 落运行源；运行源不得手工改通用技能（S7 会拦）。
- 项目专属内容只有两处：`.codebuddy/skills/be-developer|fe-developer` 与 `rd-digital-agent/references/project-context.md`；新增专项能力（如日志排查）走「上游加 skill → 同步」或「运行源加项目专属技能 + 同步白名单」。
