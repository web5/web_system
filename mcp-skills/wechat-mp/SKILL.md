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

脚本路径：`/Users/geekwen/workspace/web_system/scripts/mcp-fallback/wechat-fallback-publish.sh`

| 参数 | 说明 |
|------|------|
| （无）| 建草稿（默认，安全） |
| `--publish` | 建草稿 + 一键发布 |
| `--title "标题"` | 自定义标题（默认「{日期}财经日报（直连通道）」） |
| `--dry-run` | 只打印不执行 |

行为：SSH 到 dev 机器（`ubuntu@175.27.189.123`）→ 探测 content-hub（:6007）→ 拉取财经数据（`/api/market-pulse`、`/api/topics`）→ 生成带封面图的 HTML → 调 `/api/content/wechat/draft`（或 `/publish`）。

### 4.3 直连执行约束

| # | 约束 |
|---|------|
| 1 | 默认只建草稿（与门禁 1 一致），用户明确要求发布才加 `--publish` |
| 2 | 发布成功如实汇报 media_id / publish_id，并注明走 dev 直连链路 |
| 3 | 直连链路要求本机可 SSH 到 dev 机器（密钥已配置），失败时如实告知用户直连链路也不可用 |

### 4.4 与 web-system-finnews 的配合

`web-system-finnews` 技能同样走本直连链路：
- 内容来源：直接调用 dev 机器 content-hub 的 `/api/market-pulse`、`/api/topics`（脚本已内置）
- 两个技能共用一个直连脚本，一次执行完成「取数 + 生成 + 建稿」

---
