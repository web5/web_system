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
| 发布限制 | 公众号类型须支持发布：服务号 / 认证订阅号可发布；未认证订阅号仅能建草稿不能发布 |

### 1.2 不可协商门禁（5 条）

按顺序执行，任一门禁不满足只修当前门禁，不得跳到后续步骤：

| # | 门禁    | 核心约束                                                                      |
|---|-------|---------------------------------------------------------------------------|
| 1 | 发布前确认 | **默认先走 `create_wechat_draft` 建草稿**，让用户确认排版后再 `publish_to_wechat`；用户明确要求「直接发布」时才可跳过草稿步骤 |
| 2 | 标题    | 标题为必填且唯一标识文章；不得编造标题，须来自用户提供或生成后向用户确认         |
| 3 | 内容    | `html` 必填，须为合法富文本 HTML（含 <html>/<body> 包裹的完整文档也可）；不得传 Markdown 原文 |
| 4 | 封面    | **服务端强制要求封面**：正文 `html` 首段必须包含一张公网可访问的图片 `<img src="https://...">`（自动转微信 CDN 作封面），或显式传 `thumb_media_id`；两者都没有会报「缺少封面」错误 |
| 5 | 回答    | 只报告工具返回值与必要限制；发布成功给出 publish_id，草稿成功给出 media_id，不夸大结果 |

### 1.3 工作流（5 步）

| 步骤 | 动作         | 关键约束                                              |
|----|------------|---------------------------------------------------|
| 1  | 获取内容       | 确认文章标题与 HTML 正文来源（用户提供 / 从文件读取 / 由 Markdown 转换） |
| 2  | 确认目标       | 用户未明确要求发布时，默认走「建草稿」路径                          |
| 3  | 构造入参       | title、html 必填；thumb_media_id / digest / source_url 按需传入 |
| 4  | 调用工具       | `create_wechat_draft` 或 `publish_to_wechat`，按门禁 1 决策 |
| 5  | 处理结果       | 成功→返回 media_id / publish_id 并说明下一步；失败→按「错误处理」处理 |

---

## 2. 工具介绍

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
| 未认证订阅号无法发布     | 明确告知该公众号类型不支持发布，只能建草稿                            |
| 返回为空 / 无数据        | 如实说明「发布失败 / 草稿创建失败」，不编造 media_id 或 publish_id          |
| 工具调用超时            | 单次重试 1 次；仍失败则告知用户稍后重试                                  |
| MCP 调用失败（连接不通/超时/500） | **进入降级链路**：执行 `web_system/scripts/mcp-fallback/wechat-fallback-publish.sh`（见下方「4. MCP 降级兜底」），完成后如实汇报降级结果 |
| 跨场景诉求（群发/菜单/素材管理） | 明确告知本服务仅覆盖草稿与发布，其他公众号能力需走微信公众平台后台               |

---

## 4. MCP 降级兜底（MCP 不可用时）

当 MCP 调用失败（连接不通 / 超时 / 服务端 5xx / HTTP 401 之外的异常）时，使用工程内降级脚本，通过 SSH 到 dev 机器直连 content-hub REST 接口完成建稿/发布。

### 4.1 触发条件

满足任一即触发降级：
- `create_wechat_draft` / `publish_to_wechat` 返回连接错误、超时、500，而非业务错误（如「缺少封面」）
- MCP 工具根本不可用（tools/list 失败 / 连接器未授权）

> 「缺少封面」「未配置凭证」等**业务错误不属于降级场景**，按第 3 节处理，不要走降级。

### 4.2 降级脚本

脚本路径：`/Users/geekwen/workspace/web_system/scripts/mcp-fallback/wechat-fallback-publish.sh`

| 参数 | 说明 |
|------|------|
| （无）| 建草稿（默认，安全） |
| `--publish` | 建草稿 + 一键发布 |
| `--title "标题"` | 自定义标题（默认「{日期}财经日报（降级通道）」） |
| `--dry-run` | 只打印不执行 |

行为：SSH 到 dev 机器（`ubuntu@175.27.189.123`）→ 探测 content-hub（:6007）→ 拉取财经数据（`/api/market-pulse`、`/api/topics`）→ 生成带封面图的 HTML → 调 `/api/content/wechat/draft`（或 `/publish`）。

### 4.3 降级执行约束

| # | 约束 |
|---|------|
| 1 | 默认只建草稿（与门禁 1 一致），用户明确要求发布才加 `--publish` |
| 2 | 降级成功要如实汇报 media_id / publish_id 与「已走降级链路」说明 |
| 3 | 降级脚本要求本机可 SSH 到 dev 机器（密钥已配置），失败时如实告知用户降级链路也不可用 |

### 4.4 与 web-system-finnews 的配合

若降级原因是 MCP 整体不可用，`web-system-finnews` 技能同样应走降级：
- 内容来源降级：直接调用 dev 机器 content-hub 的 `/api/market-pulse`、`/api/topics`（脚本已内置）
- 即两个技能共用一个降级脚本，一次执行完成「取数 + 生成 + 建稿」

---
