# 设计稿 · 小程序研发管理平台（mp-platform）

> 状态：**设计确认稿（2026-09-17）**。6 项待拍板已由用户拍板，见 §0.2。
> 上游方案：《小程序研发管理平台 · 工程落地技术方案》v2.0（2026-09-17）—— 本稿把它的「待定项」按本仓库现状固化，并记录 7 处偏差。
> 关联：`specs/release-platform/`（deploy-console）、`specs/iam-multi-system/`、`docs/architecture/网关URL规划.md`、`specs/deploy-console/`
> 接口契约：见同目录 `api-design.md`
> 变更日志：
> - 2026-09-17 初稿：6 项决策固化（D1–D7）；澄清「微信提审 ≠ 平台审批」；`tenant_id` 本期不引入并说明取舍与回退路径；修正 deploy-console `DEFAULT_BUILD_TEMPLATE['mini-app']` 错值。

---

## 0. 一页速览

### 0.1 定位与边界（继承上游，新增一条显式边界）

- **定位**：小程序代开发 / 代发布 —— 「小程序的 Vercel + 服务编排层」。主链路 = **授权模式**（第三方平台 `template_id` + `ext_json`），**密钥模式**（`miniprogram-ci`）按需。
- **不做**：流量代理 / 代码托管 / 云资源代管 / 渠道 SDK 聚合。
- **本次新增边界（重要）**：**内部业务线平台，不对外提供 SaaS 多租户**（决策 D3）。前端与文档需显式标注，避免运营把它当成"能卖给外部客户"的平台。

### 0.2 关键决策（用户 2026-09-17 拍板）

| # | 决策项 | 结论 | 主要影响 |
|---|---|---|---|
| **D1** | 代码落点 | **并入本 monorepo**：后端 `servers/mp-platform`，前端 `apps/mp-admin` | 上游的「独立进程 6100 + 独立库」保留，只改交付形态 |
| **D2** | 审计/告警/审核/通知 | **复用，不建第二套** | 复用方式见 §0.4；「微信提审 ≠ 平台审批」需澄清 |
| **D3** | 多租户 | **不引入 `tenant_id`** | 定位内部平台；归属改用 `mp_app.owner`；见 §1 |
| **D4** | 权限 | **不新增 `mp:*` 权限域** | 复用统一 IAM 的 `system` 粒度（`deploy`），不加权限码；见 §3.1 |
| **D5** | 密钥管理 | **服务运行配置统一为各服务 `.env`**；`~/env_config/` 继续承担**跨服务凭据仓**，两者职责不同、不混用 | 上游「统一 `~/env_config/`」指的是密钥集中存放；本仓库口径：运行配置进 `servers/<svc>/.env`，机器/账号/第三方凭据留 `~/env_config/*.env` |
| **D6** | 前端形态 | **admin 系微前端子模块**（非独立 SPA） | 走 shell + `packages/ui` tokens；路由 `/mp-admin/` |
| **D7** | 自有小程序发布通道 | **复用 mp-platform 的 M4（密钥模式）** | deploy-console 侧不重复实现；仅保留模块登记现状 |

### 0.3 目录、进程与端口

```
servers/mp-platform/    后端 NestJS 10 + TypeORM 0.3.31  端口 6100（现网空闲）
apps/mp-admin/          前端微前端子模块 Vue3 + AntD + @web-system/ui
库                      mp_platform（独立库，同一云 MySQL 8.0.30-txsql 实例）
网关路由                /api/mp/*           → gateway(6000) 反代 → 6100（前端不直连后端）
微信回调                /wx/component/event → nginx 直出 6100（无 /api 前缀、无 JWT，靠签名校验）
样式                    复用 packages/ui（admin 主橙 #F97316）、docs/ui 规范
```

### 0.4 复用边界（D2 展开 —— 逐能力说清"复用/不复用"）

| 能力 | 现有实现（deploy-console） | mp-platform 的复用方式 | 明确不做 |
|---|---|---|---|
| **审计** | `AuditService.log()`（进程内注入）；表在 `web_system_deploy` | 抽 `packages/platform-kit` 提供同构 `AuditWriter`，**各写各库**（mp 写自己的 `mp_audit_log`，上游 M0 已建该表） | ❌ 跨库直写、❌ 跨进程 HTTP 写审计（console 侧 `audit` 只有 `GET /audit/list`，无写入接口） |
| **通知** | `NotificationService` + `notifications` 渠道配置 | 复用 `platform-kit` 的 Notifier；**渠道配置沿用 console 已配的一套** | ❌ 第二套渠道配置 |
| **审批** | `approval/*`（发布审批：`pending-approval` 状态门禁） | **仅可选复用**：若需要"人工放行提审"就用它做关口 | ❌ 把微信侧"审核中/审核驳回"塞进平台审批流 |
| **告警** | `monitor/*` + 通知通道 | mp 的告警项（ticket 间隔 >15min 等 P0）→ 同一通知通道 | ❌ 第二套告警通道 |
| **模块/版本登记** | `deploy_modules` / `deploy_versions`（自研服务与微前端模块） | **不复用** | ❌ 把客户小程序塞进 `deploy_modules`（两个域，别混） |

> ⚠️ **必须澄清的一条**：上游 §7 的「提审」是**微信侧审核**（`submitAudit → 轮询 → audit_approved/rejected`），与 deploy-console 的「平台审批」（谁能放行这次发布）是**两件事**。复用审批能力指的是后者，且本期非必需。

**D7 落地说明**：`servers/deploy-console` 侧对自有小程序**只保留「模块登记 + 停用」现状，不新增发布通道** —— 其 `build → upload(静态产物) → restart → verify` 模型天然不适用于小程序（无 dist、无静态投递、无 pm2 进程）。本次已修正的只有两处错值：`DEFAULT_BUILD_TEMPLATE['mini-app']` 由 `npx vite build` 改为 `node scripts/upload.js`；模块 `type` 由 `frontend` 改为 `mini-app`（见 `scripts/modules.json` + `migrations/0006`）。真正的发布能力（密钥模式）由 mp-platform 的 M4 提供。

### 0.5 与上游 v2.0 的 7 处偏差（需知会方案作者）

| # | 上游写法 | 本稿口径 | 原因 |
|---|---|---|---|
| 1 | 前端为独立 Vue3 SPA | `apps/mp-admin` 微前端子模块 | 决策 D6 |
| 2 | 密钥统一 `~/env_config/` | 运行配置进 `servers/mp-platform/.env`；跨服务凭据仍留 `~/env_config/*.env` | 决策 D5；`ENV_CONFIG_DIR`（服务器 `/data/env_config`）是既有约定，两处职责不同 |
| 3 | 未提 API 鉴权 | 复用统一 IAM JWT + `system` 粒度（不加权限码） | 决策 D4 |
| 4 | M3 含「`tenant_id` 全链路」 | 本期不做，改 `mp_app.owner` | 决策 D3，见 §1 |
| 5 | API 直接暴露 `/api/*` | `/api/mp/*` 经 gateway 反代 | 仓库铁律：前端不直连后端 |
| 6 | 独立进程 6100 + 独立库 | **保留** | 与 D1/D2 不冲突 |
| 7 | M0 骨架在 `/workspace/mp-platform` | 需并入 `servers/mp-platform` 并接 CI | 该目录不在本仓库、本机也不存在（**影子资产**） |

---

## 1. `tenant_id` 是什么、这次为什么不要（D3 说明）

**是什么**：租户标识。一张表里同时存多家客户（客户 A / B / C 各一个小程序）的数据时，靠它区分归属 —— 客户 A 登录后只能看到自己的小程序，运营也按租户分权。它是"多租户 SaaS"的地基字段。

**上游为什么要它**：上游目标含「多租户隔离」+「批量同质化交付（一次模板发布，N 个小程序秒级 commit）」，场景是**对外接客户**；其 M3 任务表里就有「多租户隔离收尾（tenant_id 全链路）」。

**本期不要的判据**：**是否要接外部客户**。

- 本期只服务**自有业务线**（我们自己的小程序，含将来 `少儿机器人编程` 那类内部产品），数据归属靠 `mp_app` 自身即可（`appid` 唯一 + 负责人 `owner`）。
- 引入 `tenant_id` 的代价不只是加一列：**所有查询要带过滤、所有表要加列、前端要加租户上下文**，且它与现有 IAM（系统清单 admin / deploy-console / portal，无租户概念）要对齐 —— 为一个不存在的需求付这笔钱不划算。

**代价与回退路径（可接受）**：将来若真的要对外，需要 ① 10 张表加列 ② 所有查询补过滤 ③ 前端加租户切换 ④ IAM 加租户维度，估算 3–5 人日，属可控范围。因此本期**预留扩展位而不实现**：`mp_app.owner`（负责人，字符串）+ 不做租户维表。

**必须落到文档/前端的约束**：`mp-admin` 概览页与对外材料要显式写明「**内部业务线平台，不含租户级数据隔离**」，避免被当成 SaaS 承诺。

---

## 2. 数据模型与库

### 2.1 表清单（沿用上游 §4.2，共 10 张）

| 表 | 职责 | 上游状态 |
|---|---|---|
| `wx_component_config` | 第三方平台凭证 + verify_ticket | ✅ 已建（M0） |
| `mp_app` | 小程序资产（双轨：授权/密钥） | ✅ 已建（M0） |
| `mp_audit_log` | 审计日志（**本仓库口径：各写各库**） | ✅ 已建（M0） |
| `mp_code_template` | 代码模板（含 `ext_schema`、`is_standard`） | ✅ 已建（M0） |
| `mp_ext_config` | `ext_json` 配置（人工覆盖层） | ✅ 已建（M0） |
| `mp_release_order` | 发布单 | ✅ 已建（M0） |
| `mp_release_step` | 发布步骤流水（含 request/response 原文） | ✅ 已建（M0） |
| `mp_service_connector` | 服务连接器 | ⬜ M2 |
| `mp_app_service_binding` | 小程序↔服务↔环境绑定 | ⬜ M2 |
| `mp_domain` | 域名白名单（含同步状态） | ⬜ M2 |

**本稿调整**：`mp_app` 增 `owner varchar(64)`（负责人，替代 tenant 归属）；**不建** tenant 维表/字段。

### 2.2 库与兼容性（与仓库现状对齐后确认可行）

| 项 | 口径 | 依据 |
|---|---|---|
| 数据库 | `mp_platform` 独立库，与 `web_system` / `web_system_deploy` / `web_system_knowledge` 同实例 | 每服务独立库的仓库惯例 |
| 库命名建议 | 建议考虑 `web_system_mp`（与 `web_system_deploy`/`web_system_knowledge` 同族）；M0 已用 `mp_platform` 则该不动 | 待确认 §7-Q4 |
| 版本 | TypeORM **0.3.31**（1.x 的 `@CreateDateColumn` 强制 `CURRENT_TIMESTAMP(6)` 与 `datetime(0)` 冲突） | 上游 §3 已知坑 |
| 时间列 | 实体显式 `precision: 3`，DDL 统一 `DATETIME(3)` | 同上 |
| 命名策略 | 必须复用 `@web-system/shared` 的 `SnakeNamingStrategy` | 仓库铁律②（跨端配置收口） |
| 字符集 | DDL **不显式指定 COLLATE**，用库默认（我们库是 8.0.30-txsql，默认 `utf8mb4_0900_ai_ci`） | 上游 §4.3，恰好适配现状 |
| Redis | 复用现网实例，key 前缀 `mp:` | ticket/token 强依赖 |

---

## 3. 鉴权与安全

### 3.1 鉴权（D4 落地口径）

现状（已核）：deploy-console 已接入**统一 IAM** —— 登录代理给 auth-service（`system: 'deploy'`），JWT 策略校验**同一个 `JWT_SECRET`**，并强制 `systems` 含 `deploy` 才放行；控制台自身**没有权限码体系**（全仓无 `@RequirePermission`）。

因此：

| 项 | 口径 |
|---|---|
| 令牌 | 复用统一 JWT（同 `JWT_SECRET`），禁止 mp-platform 自签或自建用户表 |
| 准入 | 要求 `systems` 含 **`deploy`**（复用现有系统粒度）→ 即「能进 console 的人就能进 mp-admin」 |
| 权限码 | **不新增 `mp:*`**（与用户决策一致，也与 console 现状一致） |
| 高危动作 | 授权 / 提审 / 发布 / 回滚 / 解绑 —— **强制写入审计**（谁、何时、目标小程序、请求与响应原文） |
| 演进 | 将来若需细分，**正确做法是新增 IAM 系统 `mp`**（比自造 `mp:*` 权限码更贴合现有机制），属可选演进，本期不做 |

> ⚠️ 记录代价：不设权限码时，**任何有 `deploy` 系统权限的账号都能提审/发布客户小程序**。当前 ops 团队规模下可接受，但必须靠审计留痕兜底；一旦有外部协作方接入，先做系统拆分而不是补权限码。

### 3.2 密钥与字段加密（D5 落地口径）

- 所有配置进 `servers/mp-platform/.env`（已由根 `.gitignore` 的 `**/.env*` 覆盖）；`.env.example` 可提交。
- `FIELD_ENCRYPT_KEY`：用于**字段级加密**（`component_verify_ticket`、`authorizer_refresh_token` 等落库值）。生成：`openssl rand -hex 32`。
- ⚠️ 仓库**目前没有字段级加密实现**（全仓 grep 零命中）→ 这是新增的安全横切，需一并定义：① 加解密工具位置（建议 `packages/platform-kit` 或 shared）② 轮换流程 ③ **丢失即不可恢复**的运维预案（密钥丢了所有授权需要重新扫码授权）。
- 接口**绝不返回**私钥/refresh_token 原文（字段白名单）。

> ⚠️ **待补凭据（A/B 两条路都绕不开）**：M0 需要第三方平台的 `component_appid` / `component_appsecret` / `EncodingAESKey` / `verify_token` 四项。本机凭据仓 `~/env_config/wechat-mp.env` 目前只有**公众号/小程序**的 `WECHAT_MP_{APPID,APPSECRET}` 与 `WECHAT_MP_MINI_{APPID,AppSecret}`，**第三方平台这四项缺失** → 建议新增 `~/env_config/wechat-thirdparty.env`（从微信开放平台第三方平台后台取），再由 `servers/mp-platform/.env` 引用。

### 3.3 微信回调 `/wx/component/event`

- **不经 gateway 的 `/api`**（微信要求固定 URL），由 nginx 直出 6100；**不挂 JWT**。
- 安全边界：① 必须校验 `msg_signature` / `signature`；② 处理**失败也返回 `success`**（防微信无限重试雪崩），错误仅记日志；③ 建议 nginx 层限频 + 可选 IP 白名单。
- 部署顺序（上游 §12.1 的坑）：**先起服务并确认公网可达，再去第三方平台后台填「授权事件接收 URL」** —— 配置时微信会发 GET 校验。

---

## 4. 前端 `apps/mp-admin`（D6 落地口径）

### 4.1 交付形态

| 项 | 口径 |
|---|---|
| 类型 | **微前端子模块**（`scripts/modules.json`：`key=mp-admin`、`type=micro-frontend`、`publicPath=mp-admin`） |
| 加载 | 由 shell 基座按 `__MODULES_MANIFEST__` 版本加载；产物落 `static/modules/mp-admin/<version>/` |
| 版本登记 | 更新版本表 `deploy_deployments`（`env_id` + `module_key='mp-admin'`）—— ⚠️ 该表在 **`web_system_deploy`** 库 |
| 路由 | `/mp-admin/`（微前端模块 base，URL 必须带前缀） |
| 样式 | `packages/ui` tokens（admin 主橙 `#F97316`）+ `docs/ui/` 规范；**不套用**品牌端 Claymorphism |
| 与 console 的关系 | 两个前端入口（`/console/` 与 `/mp-admin/`），**同一登录态**（同 JWT） |

> 备选（若想更省事）：把页面并入现有 `apps/admin` 作为一个菜单组（mcp-admin 曾如此合入）。本期按 D6 走独立子模块；若要改，改动面只在 modules.json + 一个目录。

### 4.2 页面结构（沿用上游 §11.1）

```
概览（发布中/待提审/已上线 + 7 日趋势）
小程序资产（列表 / 详情 / 授权引导）
模板管理（草稿箱 / 模板库 + 标准模板标记 + schema）
配置中心（ext_json 可视化编辑器：表单/JSON 双模式 + diff + 前置校验）
发布流水线（发布单列表 / 详情：步骤时间线 + 微信原始返回 + 体验版二维码）
服务连接器（CRUD + 连通性测试）
域名管理（列表 + 同步状态 + 一键同步）
系统（配额看板 / 审计日志）
```

**关键交互（继承上游 §11.2）**：授权引导页轮询识别新授权；`ext_json` 编辑器保存前必过白名单校验；发布单详情**必须展示微信原始返回**（微信报错模糊，无原文无法排障）。

---

## 5. 里程碑与前置

| 阶段 | 内容 | 估时 | 前置 |
|---|---|---|---|
| **P0 前置** | M0 骨架并入 `servers/mp-platform` + 接 CI（lint/build/test）+ `.env.example` + 库/端口登记（6100、`mp_platform`） | 0.5–1 人日 | 需拿到 `/workspace/mp-platform` 源码 |
| M0（已完成） | 微信适配层：ticket/token 三级、加解密、授权事件接收 | — | 并入后需**重验**（文档自称已完成，未见代码） |
| M1 | 模板与发布闭环（2 周） | 10 人日 | P0 |
| M2 | 服务编排：连接器/binding/域名（1.5 周） | 7 人日 | M1 |
| M3 | 治理：配额看板 / 违规 / 体验成员 / 审计前端 + `owner` 字段（1 周） | 5 人日 | M2 |
| M4 | 密钥模式（按需）—— **同时承载自有小程序的发布**（D7） | — | M1 |

> 与小程序应用侧（`apps/kedou-ai-minigram` 的 M0–M4）**无强依赖**，两条线可并行；唯一交叉点是 D7（自有小程序走 M4）。

---

## 6. 门禁红线（必须写进 CI）

| 红线 | 原因 |
|---|---|
| **自动化测试禁止触发 `submitAudit` / `release` / `grayRelease`** | 提审配额是稀缺资源（上游 §14）；自动化跑一轮就烧掉额度 |
| 微信回调接口的测试必须 mock，不真调微信 | 同上 + 避免被限流 |
| `mp-platform` 合并前必须过 `pnpm -w` 类型检查与 lint | 与仓库质量门一致 |

---

## 7. 待确认（4 条）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| Q1 | M0 源码如何并入？（搬目录 / 重新初始化 / cherry-pick）谁能提供 | P0 前置 | 建议整目录搬入 + 代码审查一遍（M0 自称已完成但未 review） |
| Q2 | 字段级加密工具落在哪：`packages/platform-kit`（与审计/通知同处）还是 `packages/shared` | 安全横切 | 建议随 `platform-kit` 一起抽，避免 shared 膨胀 |
| Q3 | 是否需要「人工放行提审」的审批关卡（复用 console `approval`） | 运营流程 | 一期不设；有外部协作方时再加 |
| Q4 | 库名用 `mp_platform` 还是 `web_system_mp` | 运维一致性 | M0 已建库则保持不动，否则建议同族命名 |
