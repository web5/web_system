---
name: web-system-wechat-mp
description: web_system 公众号发布 MCP——将 HTML 富文本文章排版发布到微信公众号。提供创建图文草稿（不发布，可后台确认排版）与一键发布（建草稿→freepublish 提交）两个工具，正文图片自动转微信 CDN。当用户需要把文章发布到微信公众号、创建公众号图文草稿、推送文章到公众号时调用本技能。
version: 1.0.0
agent_created: true
---

# web_system 公众号发布 MCP Skill

> 单 MCP Server（`/mcp/wechat_mp`），2 个工具，覆盖「创建图文草稿 / 一键发布」。本文件是 AI 调用本 Server 的唯一行为守则，涵盖三个模块：**工作流、工具介绍、错误处理**。

## 1. 工作流

### 1.1 角色与定位

你是 web_system 公众号发布助手。当用户需要把文章发布到微信公众号，或先把文章做成图文草稿确认排版时，调用本 Server 对应工具。

| 维度   | 说明                                           |
|------|----------------------------------------------|
| 协议   | MCP（Model Context Protocol），单 Server         |
| 端点   | `/mcp/wechat_mp`（生产 `https://kedouai.com/mcp/wechat_mp`，本地 `http://localhost:6006/mcp/wechat_mp`） |
| 鉴权   | Bearer Token（每用户 API Key 或 MCP_CLIENT_KEY）  |
| 内容格式 | 文章正文须为 HTML 富文本，图片自动转微信 CDN  |
| 后台依赖 | content-hub 服务执行实际微信 API 调用（需已配置 WECHAT_MP_APP_ID / WECHAT_MP_APP_SECRET） |
| 发布限制 | **由 content-hub `content_accounts.account_type` 决定**：`enterprise`（认证服务号 / 订阅号）才可 freepublish；`personal`（未认证个人号）没有 freepublish 权限，**草稿就是终点**（详见 §1.4） |

### 1.2 不可协商门禁（5 条）

按顺序执行，任一门禁不满足只修当前门禁，不得跳到后续步骤：

| # | 门禁    | 核心约束                                                                      |
|---|-------|---------------------------------------------------------------------------|
| 1 | 发布前确认 | **默认先走 `create_wechat_draft` 建草稿**，让用户确认排版后再 `publish_to_wechat`；用户明确要求「直接发布」时才可跳过草稿步骤。🔴 前置硬条件：`account_type` 必须为 `enterprise`（见 §1.4）——个人号即使用户要求直接发布也**不得**调发布接口 |
| 2 | 标题    | 标题为必填且唯一标识文章；不得编造标题，须来自用户提供或生成后向用户确认         |
| 3 | 内容    | `html` 必填，须为合法富文本 HTML（含 <html>/<body> 包裹的完整文档也可）；不得传 Markdown 原文 |
| 4 | 封面 | **草稿必须有封面**，但服务端已有兜底：优先级 `thumb_media_id` → 正文首图（自动转微信 CDN）→ `WECHAT_MP_DEFAULT_THUMB_MEDIA_ID` → 内置「大橙子社区」通用封面常量。正文无图不会报错，但会落到通用栏目封面（画面文字是「AI 资讯日报」），**非资讯类文章请显式传专属 `thumb_media_id`**。换已有草稿的封面走微信 `draft/update`（先 `draft/get` 取回完整 article，只改 `thumb_media_id`），不要新建第二篇草稿 |
| 5 | 回答    | 只报告工具返回值与必要限制；发布成功给出 publish_id，草稿成功给出 media_id，不夸大结果 |

### 1.3 工作流（5 步）

| 步骤 | 动作         | 关键约束                                              |
|----|------------|---------------------------------------------------|
| 1  | 获取内容       | 确认文章标题与 HTML 正文来源（用户提供 / 从文件读取 / 由 Markdown 转换） |
| 2  | 确认目标       | 用户未明确要求发布时，默认走「建草稿」路径                          |
| 3  | 构造入参       | title、html 必填；thumb_media_id / digest / source_url 按需传入 |
| 4  | 调用工具       | `create_wechat_draft` 或 `publish_to_wechat`，按门禁 1 决策 |
| 5  | 处理结果       | 成功→返回 media_id / publish_id 并说明下一步；失败→按「错误处理」处理 |

### 1.4 决策前提 · 发布能力看账号类型，不看当次措辞（2026-11-04 订正）

🔴 **能否正式发布是账号资质决定的系统约束，不是用户每轮下的一条指令。** 用户说「只发草稿 / 不正式发布」只是当次说明；**不要**把「这轮没说」反推成「可以发布」，也不要把「正式环境不用发」读成「不部署 / 不 commit」——这里「正式」指**正式发布**，与 dev/prod 部署无关。

| 项 | 结论 |
|---|---|
| 判定字段 | `content_accounts.account_type`（`personal` 个人主体 / `enterprise` 企业主体） |
| 当前登记（2026-11-04 实查 dev 库） | `code=default` · `name=大橙子社区` · `account_type=personal` · `enabled=1` |
| 本账号允许 | `create_wechat_draft` / `POST /api/content/wechat/draft`（`mode:'draft'`）→ 落 `status=drafted` |
| 本账号禁止 | `publish_to_wechat` / `--publish` / `POST /api/content/wechat/publish` / 微信 `freepublish` |
| 失败语义 | 个人号调发布接口必得微信 48001，**不是临时故障**，禁止重试或改代码绕过；草稿箱里的文章是正常结果 |
| 人工出口 | 「草稿就是终点」指**自动化链路**的终点，不是内容终点：用户可到公众号后台手动群发。AI 只交付 media_id，不代发、不代点 |

**代码真源**：`servers/content-hub/src/content/entities/content-account.entity.ts`（类型定义与状态分流注释）、`.../publishers/publisher.interface.ts`（`mode: 'draft' | 'publish'` 与 `publicationStatus` 里 drafted 优先）、`.../services/content.service.ts`（发布时把 `account_type` **快照**进 `content_publications`，改登记不影响历史语义）。

**只读复核**（不打印任何凭据）：dev 上查 `content_accounts` 的 `code/name/account_type/enabled`；`/api/content/accounts` 走用户 JWT，用 `CONTENT_HUB_SERVICE_KEY` 会返回 401，别拿它当账号判定入口。

---

## 2. 工具介绍

### 2.0 调用路径与稳定性（重要）

- **规范调用路径**：优先使用网关 Server `/mcp/wechat_mp` 提供的 `create_wechat_draft` / `publish_to_wechat`。
- **等价传输**：`wechat-mp-publisher` 连接器指向同一后端（content-hub `/api/content/wechat/*`），效果一致；两者任选其一，**不要在同一次任务中混用**，避免重复建稿。
- **已内置重试与统一错误**：网关 `callApi` 对网络错误 / 超时 / 5xx 自动重试 2 次（4xx 不重试）；失败返回统一结构 `{ "error": { "type": "network"|"timeout"|"http", "status"?, "message": "..." } }`。AI 只需判断返回文本中是否含 `error.type` 即可判定失败，并按 `type` 区分处理，**无需在 skill 层手动重试**。

### 2.1 工具总表

| 工具名              | 场景            | 关键入参            |
|-------------------|---------------|------------------|
| `create_wechat_draft` | 创建图文草稿（不发布，可后台确认排版） | title / html / thumb_media_id? / digest? / source_url? |
| `publish_to_wechat`  | 一键发布（HTML → 建草稿 → freepublish 提交） | title / html / thumb_media_id? / digest? / source_url? / item_id? |

### 2.2 各工具说明

- **create_wechat_draft**：创建图文草稿，**不发布**。返回 `media_id`（草稿 ID），可在公众号后台确认排版后再手动发布或后续调用发布。适合「先排版确认」的诉求。
  - `title`（必填）：文章标题
  - `html`（必填）：文章正文 HTML（富文本，图片自动转微信 CDN）
  - `thumb_media_id`（选填）：封面素材 media_id，不传则用正文首图作封面
  - `digest`（选填）：摘要，默认取正文开头
  - `source_url`（选填）：原文链接
- **publish_to_wechat**：一键发布——HTML 富文本 → 建草稿 → freepublish 提交发布。返回 `publish_id` 用于查询发布状态。适合「直接推送文章」的诉求。
  - `title`（必填）：文章标题
  - `html`（必填）：文章正文 HTML（富文本，图片自动转微信 CDN）
  - `thumb_media_id`（选填）：封面素材 media_id，不传则用正文首图作封面
  - `digest`（选填）：摘要
  - `source_url`（选填）：原文链接
  - `item_id`（选填）：关联内容条目 ID（写发布记录用）

---

## 3. 错误处理

| 现象                | 处理                                                        |
|-------------------|-----------------------------------------------------------|
| HTTP 401          | 鉴权失败：提示用户 API Key 无效/过期/未配置；引导其到连接器中心重新配置 key |
| 未配置公众号凭证        | content-hub 未配置 WECHAT_MP_APP_ID / WECHAT_MP_APP_SECRET 时如实告知用户去后台配置 |
| 未认证订阅号无法发布     | 明确告知该公众号类型不支持发布、只能建草稿；**这是资质约束不是临时故障**，不得重试或换接口绕过。按 §1.4 判定，`status=drafted` 即正常终点，回报 media_id 而非报失败 |
| 返回为空 / 无数据        | 如实说明「发布失败 / 草稿创建失败」，不编造 media_id 或 publish_id          |
| 工具调用超时 / 5xx / 网络错误 | 网关已自动重试 2 次；最终仍失败则如实告知用户稍后重试（不要再在 skill 层重复重试） |
| 发布（建草稿/群发） | **统一走 dev 机器 content-hub 直连 POST**（见第 4 节），不再经 MCP；业务错误仍按本表其他行处理 |
| 跨场景诉求（群发/菜单/素材管理） | 明确告知本服务仅覆盖草稿与发布，其他公众号能力需走微信公众平台后台               |

---

## 4. 发布链路（dev 机器 content-hub 直连 POST，标准方式）

发布统一走 dev 机器 content-hub 的 REST 接口直连建稿/发布。这是标准发布路径。

### 4.1 方式说明

发布默认就走本直连链路，不依赖 MCP 在线：
- 入参与 MCP 工具一致：`title` / `html` / `thumb_media_id?` / `digest?` / `source_url?`。
- 业务错误（如「缺少封面」「未配置凭证」）按第 3 节处理。

### 4.2 直连脚本

脚本路径：`{{WORKSPACE_DIR}}/scripts/mcp-fallback/wechat-fallback-publish.sh`

| 参数 | 说明 |
|------|------|
| （无）| 建草稿（默认，安全） |
| `--publish` | 建草稿 + 一键发布 |
| `--title "标题"` | 自定义标题（默认「{日期}财经日报（直连通道）」） |
| `--dry-run` | 只打印不执行 |

行为：SSH 到 dev 机器（`ubuntu@{{DEV_HOST}}`）→ 探测 content-hub（:6007）→ 拉取财经数据（`/api/market-pulse`、`/api/topics`）→ 生成带封面图的 HTML → 调 `/api/content/wechat/draft`（或 `/publish`）。

> 🔴 content-hub 业务接口已强制服务间鉴权：调 `/api/market-pulse`、`/api/topics`、`/api/content/wechat/*` 必须带 `Authorization: Bearer <CONTENT_HUB_SERVICE_KEY>`。
> **key 的单一真源（2026-11-04 实测修正）**：`/data/web_system/servers/content-hub/.env`。content-hub 的 `ConfigModule.forRoot` 里 `envFilePath` 是 `../.env.generated` + `../.env`（相对 `dist/`），**不是**仓库根 `/data/web_system/.env.production`（那份只有 `FINNEWS_SERVICE_KEY` / `INTERNAL_API_KEY`）。`InternalKeyGuard` 虽兼容旧名 `FINNEWS_SERVICE_KEY`，但取 key 必须读进程实际加载的 `.env`；按旧路径取会得到 `FAIL: 未取到 CONTENT_HUB_SERVICE_KEY`。
> 🔴 自定义文章（非财经日报）**不要**用 `wechat-fallback-publish.sh`：该脚本会拉财经数据并覆盖正文。应自己构造 `{title, html, digest, mode:'draft'}` 直接 `POST /api/content/wechat/draft`；探测存活用 `/health`（免鉴权）。

### 4.3 直连执行约束

| # | 约束 |
|---|------|
| 1 | 默认只建草稿（与门禁 1 一致），用户明确要求发布才加 `--publish`；🔴 加 `--publish` 前必须先过 §1.4 账号类型判定，`personal` 一律不加 |
| 2 | 发布成功如实汇报 media_id / publish_id，并注明走 dev 直连链路 |
| 3 | 直连链路要求本机可 SSH 到 dev 机器（密钥已配置），失败时如实告知用户直连链路也不可用 |
| 4 | 自定义文章走 `POST /api/content/wechat/draft` 时显式带 `mode:'draft'`；**不要**因当轮没有「不正式发布」这句话就改用 `/publish` |

### 4.4 与 web-system-finnews 的配合

`web-system-finnews` 技能同样走本直连链路：
- 内容来源：直接调用 dev 机器 content-hub 的 `/api/market-pulse`、`/api/topics`（脚本已内置）
- 两个技能共用一个直连脚本，一次执行完成「取数 + 生成 + 建稿」

### 4.5 自定义文章与换封面（2026-11-04 实测）

| 场景 | 做法 |
|---|---|
| 自定义文章建草稿 | 本地把 .md 转成 **inline-style** HTML（微信过滤 `<style>`/class），构造 `{title, html, digest, mode:'draft'}` → `POST /api/content/wechat/draft`。**不要**走财经日报降级脚本 |
| 换已有草稿封面 | ① `material/add_material type=image` 上传封面拿 `thumb_media_id` → ② `draft/get` 取回完整 article → ③ `draft/update`（`media_id` + `index:0` + `articles`，只改 `thumb_media_id`，其余字段原样回传）→ ④ `draft/get` 回读确认 `thumb_url` 变化 |
| 只换封面不新建 | 严禁重新建稿：草稿箱会出现两篇。也无需 `draft/delete` |

⚠️ `draft/update` 后微信会把正文规范化成 `<section><span leaf="">…` 包裹，`content_len` 变化十几~几百字符属正常。验收按 `h2` / `table` 数量与关键句计数，**不按字符数**判「内容没丢」。

🔴 公众号 `APP_ID` / `APP_SECRET` 与 access_token 只在 dev 机器的 `.env` 内读取，不落本地、不进日志、不贴进回答。

---
