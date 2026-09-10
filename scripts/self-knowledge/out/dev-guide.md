# web_system 研发指南（UI / 部署 / 契约 / 评测）

> 自动生成 + 约定索引。


## UI 规范地图（docs/ui）

# 科豆 AI · UI 规范读取地图（docs/ui 总览）

> 版本：v0.1（草稿）｜ 日期：2026-09-03
> **给 AI**：接到任何 admin 系 UI 任务，先读本文件 → 按 §2「任务 × 最小文档集」定位该读哪几份，**不要全目录翻读**。
> **给人**：docs/ui 规范族谱总览。细则分散在各文档，本文件只负责"导航 + 同步责任"，不复制细则。

## 1. 文档分档

| 档 | 文档 | 职责 | 何时读 |
|---|---|---|---|
| ★ 必读（总纲） | `design.md` | 判断层：页面类型模板 / 布局铁律 / 交互矩阵 / 视觉约束 / 生成后自检 | 任何 UI 任务 |
| 必读（生成前） | `page-spec-template.md` | 页面规格书模板（Full / Quick） | 新页面 / 大改 / 小改，写码前填 |
| 必读（原型生成） | `prototype-scaffold.html` | 原型稿基础骨架：移动端 `.phone` + 桌面端 `.desktop` 双形态、`:root` Token、交互模式库（go/modal/toast/toggle…） | 生成可点击交互稿时复制骨架 |
| 按需 | `color-reference.md` | 颜色定义点地图（8 类位置 + hover 阶梯 + 例外登记） | 改色 / 加色 / hover |
| 按需 | `css-override-rules.md` | 覆盖优先级 + 四问 + 排查五步 + 现状登记 | 覆盖 antd / 改了不生效 |
| 活跃写入 | `geist-token-评审记录.md` | 评审回流（只追加不覆盖） | 完成 UI 后追加修正记录 |
| 归档（日常不读） | `archive/geist-token-需求文档.md` | Token 改造需求 + **DR 决策表（§9）** | 改 Token 体系 / 查裁决时 |
| 归档（日常不读） | `archive/geist-token-实现文档.md` | 改造实现细节（含 §5.4 回流模板） | 溯源 / 体系改造时 |
| 决策参考 | `rag-evaluation.md` | AI 文档读取是否建 RAG 的决策记录 | 讨论文档读取架构时 |
| 参考（C 端品牌，勿套 admin） | `ui-design-spec.html` | 变变品牌视觉规范（Claymorphism） | 只做 portal/mini-contract 时 |

> ⚠️ `ui-design-spec.html`（#FF8C42 暖橙）是**品牌端**规范；admin 系数值以 `packages/ui/src/tokens.ts` 为准（DR-3 #F97316）。两套并行，勿混用。

## 2. 任务 × 最小文档集

| 任务类型 | 读什么（最小集） |
|---|---|
| 新页面 / 布局级大改 | README → `design.md` + `page-spec-template.md`（Full）→ 用户确认 → 写码 |
| 小改样式 / 调色 / hover | `design.md` 相关条目 + `color-reference.md` §2/§3 |
| 覆盖 antd / 改了不生效 | `css-override-rules.md`（§2 四问 + 排查五步） |
| 暗色适配 | `design.md` §4 + `packages/ui/src/tokens.css` dark 块 |
| **生成原型稿（可点击交互稿）** | 通用方法：ai-agent-kit `references/fe-prototype-common.md`（分层/触发/Token 方法/评审清单）→ 工程装配：复制 `prototype-scaffold.html` 骨架 + 主色/目录/命名按 fe-developer「原型稿生成」→ 评审过 → 回填 `page-spec-template.md` |
| 加新 Token / 改数值 | `packages/ui/src/tokens.ts`（代码事实源）→ 同步 `tokens.css`；裁决查 `archive/geist-token-需求文档.md` §9 DR |
| 评审规则溯源 | `geist-token-评审记录.md`（R1/R2/R3…） |
| 完成一个 UI 任务后 | `design.md` §5 自检 + 修正记录追加到 `geist-token-评审记录.md` |

## 3. 事实源与防漂移同步责任

| 事实源 | 同步对象 | 责任规则 |
|---|---|---|
... (截断)

## 设计 Token（--ws-*）

- --ws-gray-
- --ws-brand-
- --ws-radius-
- --ws-space-
- --ws-shadow-
- --ws-font-
- --ws-brand-50
- --ws-brand-100
- --ws-brand-200
- --ws-brand-300
- --ws-brand-400
- --ws-brand-500
- --ws-brand-600
- --ws-brand-700
- --ws-brand-800
- --ws-brand-900
- --ws-brand-accent
- --ws-gray-100
- --ws-gray-200
- --ws-gray-300
- --ws-gray-400
- --ws-gray-500
- --ws-gray-600
- --ws-gray-700
- --ws-gray-800
- --ws-gray-900
- --ws-gray-1000
- --ws-success-100
- --ws-success-500
- --ws-warning-100
- --ws-warning-500
- --ws-error-100
- --ws-error-500
- --ws-info-100
- --ws-info-500
- --ws-bg-page
- --ws-bg-surface
- --ws-bg-elevated
- --ws-bg-subtle
- --ws-bg-hover
- --ws-bg-active
- --ws-text-primary
- --ws-text-secondary
- --ws-text-tertiary
- --ws-text-disabled
- --ws-border
- --ws-border-subtle
- --ws-input-bg
- --ws-input-border
- --ws-input-placeholder
- --ws-overlay
- --ws-login-gradient
- --ws-login-box-bg
- --ws-login-title
- --ws-radius-sm
- --ws-radius-md
- --ws-radius-lg
- --ws-radius-pill
- --ws-space-4
- --ws-space-8
- --ws-space-12
- --ws-space-16
- --ws-space-24
- --ws-space-32
- --ws-space-48
- --ws-shadow-card
- --ws-shadow-popover
- --ws-shadow-avatar
- --ws-font-sans
- --ws-font-mono
- --ws-font-size-h1
- --ws-font-size-h2
- --ws-font-size-h3
- --ws-font-size-h4
- --ws-font-size-base
- --ws-font-size-caption
- --ws-font-weight-regular
- --ws-font-weight-medium
- --ws-font-weight-semibold

## admin 微前端交付铁律

- 改完 admin 须走「构建 → 拷贝 gateway static/modules/admin/<hash> → 更新 web_system_deploy 版本表 → 验证 __manifest__」四步，否则浏览器仍加载旧产物。

## 数字人/Agent 契约（.codebuddy/agent-kit）

- 产物链：intent → spec(requirements/design/tasks) → execute → 验收复盘；版本化产物必须落盘不只在对话中。

## 评测口径

- Agent 平台 eval：程序化断言 + LLM-as-judge rubric（publish 前 smoke 门禁，Ragas 三指标用于 RAG 检索）。
- 引擎侧遥测对齐 OTel GenAI SemConv（不引 SDK，schema 对齐），TelemetryPort 可换 OTLP 导出。

## 后端服务关键环境变量（.env.example 键）

- ai-agent: TOKENHUB_API_KEY, TOKENHUB_BASE_URL, TOKENHUB_MODELS, TENCENT_SECRET_ID, TENCENT_SECRET_KEY, PORT, NODE_ENV, AUTH_SERVICE_URL, AI_SERVICE_URL, INTERNAL_API_KEY, USER_SERVICE_URL, MCP_GATEWAY_URL, MCP_CLIENT_KEY, CORS_ORIGINS, DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
- ai-service: HY3_API_KEY, HY3_BASE_URL, PORT, NODE_ENV, DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, REDIS_HOST, REDIS_PORT, TENCENT_SECRET_ID, TENCENT_SECRET_KEY, AI_SERVICE_URL, AGENT_DEF_POLL_MS, INTERNAL_API_KEY, USER_SERVICE_URL
- auth-service: PORT, NODE_ENV, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS, DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, REDIS_URL, MINI_PROGRAM_APP_ID, MINI_PROGRAM_SECRET, OFFICIAL_ACCOUNT_APP_ID, OFFICIAL_ACCOUNT_SECRET, WECHAT_OAUTH_REDIRECT_URI, LOG_LEVEL
- content-hub: DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, PORT, CORS_ORIGINS, WECHAT_MP_APP_ID, WECHAT_MP_APP_SECRET, NODE_ENV
- deploy-console: PORT, ENV_CONFIG_DIR, WEB_SYSTEM_DIR, ADMIN_USER, ADMIN_PASS, JWT_SECRET, DEV_SERVER, DEV_USER, DEV_KEY, PROD_SERVER, PROD_USER, GATEWAY_SERVER, GATEWAY_USER, AUDIT_LOG_PATH, USER_SERVICE_URL, INTERNAL_API_KEY, GATEWAY_INTERNAL_URL, PIPELINE_UPLOAD_TARGET, CONFIG_MASTER_KEY, RELEASE_HOOK_SECRET
- gateway: PORT, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS, AUTH_SERVICE_URL, USER_SERVICE_URL, AI_SERVICE_URL, SYSTEM_SERVICE_URL, TODO_SERVICE_URL, UPLOAD_SERVICE_URL, MCP_GATEWAY_URL, CONTENT_HUB_SERVICE_URL, FINNEWS_SERVICE_KEY, KNOWLEDGE_SERVICE_URL, STATIC_ROOT, LOG_LEVEL
- knowledge-service: DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, PORT, CORS_ORIGINS, NODE_ENV, AUTH_SERVICE_URL, INTERNAL_API_KEY, TOKENHUB_BASE_URL, TOKENHUB_API_KEY, EMBEDDING_MODEL, EVAL_LLM_MODEL
- mcp-gateway: DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, PORT, CORS_ORIGINS, NODE_ENV, FINNEWS_SERVICE_URL, FINNEWS_SERVICE_AUTH_TYPE, FINNEWS_SERVICE_AUTH_CONFIG, CONTENT_HUB_SERVICE_URL, CONTENT_HUB_SERVICE_AUTH_TYPE, CONTENT_HUB_SERVICE_AUTH_CONFIG, KNOWLEDGE_SERVICE_URL, KNOWLEDGE_SERVICE_AUTH_TYPE, KNOWLEDGE_SERVICE_AUTH_CONFIG, MCP_CLIENT_KEY, MCP_ADMIN_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
- upload-service: PORT, UPLOAD_DIR