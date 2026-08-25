---
name: web-system-paper
description: web_system 论文学习 MCP——从 arXiv 拉取最新 AI/ML 方向论文，生成中英双语日报并发布到微信公众号。覆盖分类 cs.AI/CL/CV/LG 等，支持按分类与条数筛选。当用户需要每日 arXiv 论文速览、AI/ML 领域最新研究动态、生成论文学习日报时调用本技能。
version: 1.0.0
agent_created: true
---

# web_system 论文学习 MCP Skill

> 单 MCP Server（`/mcp/paper`，如已部署），2 个工具，覆盖「拉取论文 / 发布论文日报」。本文件是 AI 调用本 Server 的唯一行为守则，涵盖三个模块：**工作流、工具介绍、错误处理、降级兜底**。

## 1. 工作流

### 1.1 角色与定位

你是 web_system 论文学习助手。当用户需要每日 arXiv AI/ML 论文速览、最新研究动态、生成论文日报，或订阅特定分类论文时，调用本 Server。

| 维度   | 说明                                           |
|------|----------------------------------------------|
| 协议   | MCP（Model Context Protocol），单 Server         |
| 端点   | `/mcp/paper`（生产 `https://kedouai.com/mcp/paper`，本地 `http://localhost:6006/mcp/paper`） |
| 鉴权   | Bearer Token（每用户 API Key 或 MCP_CLIENT_KEY）  |
| 数据来源 | arXiv 官方 API（`export.arxiv.org/api/query`），无需密钥     |
| 分类   | 默认 cs.AI / cs.CL / cs.CV / cs.LG（AI/ML 主流） |
| 返回格式 | 正常响应由服务端返回结构化 JSON / 文本             |
| 不覆盖  | 非 arXiv 论文源（semantic scholar / 会议文集等），需其他方案 |

### 1.2 不可协商门禁（4 条）

按顺序执行，任一门禁不满足只修当前门禁，不得跳到后续步骤：

| # | 门禁    | 核心约束                                                                      |
|---|-------|---------------------------------------------------------------------------|
| 1 | 真实来源 | 论文必须来自 arXiv 实际抓取，不得编造标题/作者/摘要；不存在的论文不得写入日报 |
| 2 | 分类合法 | 分类须为 arXiv 支持的 cs.* / stat.* / math.* 等代码，不在白名单的分类直接拒绝；默认白名单 = AI/ML/CL/CV/LG |
| 3 | 摘要呈现 | **中英双语**：英文保留 arXiv 原文摘要（截断 600 字），中文部分可用模板化导读或 LLM 翻译（dev 机器若未配 LLM 则用模板） |
| 4 | 回答    | 只报告工具返回值与必要限制；发布成功给出 publish_id，草稿成功给出 media_id；arXiv 无结果时如实告知「今日指定分类下无新论文」 |

### 1.3 工作流（5 步）

| 步骤 | 动作         | 关键约束                                              |
|----|------------|---------------------------------------------------|
| 1  | 确认诉求       | 判定：按分类订阅 / 拉取最新 N 篇 / 生成今日日报 / 搜索关键词 |
| 2  | 选分类与条数      | 默认 cs.AI+cs.CL+cs.CV+cs.LG；条数默认 5（最大 20）       |
| 3  | 抓取论文       | 调 arXiv API 拉取，按 submittedDate 降序             |
| 4  | 生成日报 HTML | 中英双语结构（英文摘要+中文导读+arxiv 链接），首段嵌封面图 |
| 5  | 投递公众号      | 默认建草稿；用户明确要求发布时改 publish；标题含日期便于追溯 |

---

## 2. 工具介绍

### 2.1 工具总表

| 工具名              | 场景            | 关键入参            |
|-------------------|---------------|------------------|
| `fetch_papers`    | 拉取 arXiv 论文（按分类） | categories / max_results? |
| `publish_paper_digest` | 生成并发布论文日报到公众号 | categories / max_results? / title? / publish? / thumb_media_id? |

### 2.2 各工具说明

- **fetch_papers**：从 arXiv 拉取最新论文列表（仅查询，不发布）。返回每篇论文的 title / summary / arxiv_id / abs_url / published / authors / categories。
  - `categories`（选填）：arXiv 分类代码，默认 `cs.AI+cs.CL+cs.CV+cs.LG`
  - `max_results`（选填）：返回论文数，默认 5，最大 20
- **publish_paper_digest**：生成中英双语论文日报 HTML 并投递到公众号（默认建草稿）。
  - `categories`（选填）：同上
  - `max_results`（选填）：默认 5
  - `title`（选填）：日报标题，默认「{日期} arXiv 论文日报」
  - `publish`（选填）：true=一键发布，false=仅建草稿
  - `thumb_media_id`（选填）：封面素材，不传则用正文首图（日报内置的占位封面）

---

## 3. 错误处理

| 现象                | 处理                                                        |
|-------------------|-----------------------------------------------------------|
| HTTP 401          | 鉴权失败：提示用户 API Key 无效/过期/未配置；引导其到连接器中心重新配置 key |
| arXiv 无新论文     | 如实告知「指定分类下今日无新论文」，不编造内容                            |
| arXiv API 失败/超时 | 单次重试 1 次；仍失败则告知用户稍后重试                                |
| 草稿/发布失败（封面、token 等业务错误） | 按 `web-system-wechat-mp` 技能第 3 节处理                 |
| MCP 调用失败（连接不通/超时/500） | **进入降级链路**：执行 `web_system/scripts/mcp-fallback/paper-fallback-publish.sh`（见下方第 4 章） |
| 分类不在白名单       | 拒绝执行，提示用户传入合法 arXiv 分类代码                              |

---

## 4. MCP 降级兜底（MCP 不可用时）

当论文 MCP 调用失败（连接不通 / 超时 / 5xx）时，使用工程内降级脚本。降级脚本直接调 arXiv 官方 API + content-hub 微信接口，跳过整个 MCP 链路。

### 4.1 触发条件

满足任一即触发降级：
- `fetch_papers` / `publish_paper_digest` 返回连接错误、超时、500
- MCP 工具不可用（tools/list 失败）

> 「分类不合法」「arXiv 无新论文」等业务错误不属于降级场景，按上表处理。

### 4.2 降级脚本

脚本路径：`/Users/geekwen/workspace/web_system/scripts/mcp-fallback/paper-fallback-publish.sh`

| 参数 | 说明 |
|------|------|
| （无）| 建草稿（默认，安全） |
| `--publish` | 建草稿 + 一键发布 |
| `--title "标题"` | 自定义标题（默认「{日期} arXiv 论文日报（降级通道）」） |
| `--max 5` | 论文条数（默认 5） |
| `--dry-run` | 只打印不执行 |

行为：SSH 到 dev 机器（`ubuntu@175.27.189.123`）→ 探测 content-hub（:6007）+ arXiv 可达性 → 拉 arXiv Atom XML → 解析为中英双语 HTML（模板化中文导读）→ 调 `/api/content/wechat/draft`（或 `/publish`）。

### 4.3 降级执行约束

| # | 约束 |
|---|------|
| 1 | 默认只建草稿（与门禁 1 一致），用户明确要求发布才加 `--publish` |
| 2 | 降级成功要如实汇报 media_id / publish_id 与「已走降级链路」说明 |
| 3 | arXiv 不可达时仍尝试一次（部分网络下不稳定），失败则告知「降级链路也不可用」 |
| 4 | 模板化中文导读的局限：未配 LLM 时仅展示元信息（作者/分类/日期），不生成 LLM 摘要；如需更好中文摘要，请在 dev 机器配置 `LLM_API_KEY` 后扩展 |

### 4.4 与 wechat-mp 技能的配合

降级链路最终发布到公众号的逻辑与 `web-system-wechat-mp` 技能一致：
- 默认仅建草稿（`create_wechat_draft`）
- 仅在用户明确「直接发布」时改 `publish_to_wechat`
- 封面约束同样适用（首段嵌公网图）

### 4.5 与 finnews 技能的差异

| 维度 | finnews 降级 | paper 降级 |
|------|--------------|-----------|
| 数据源 | dev 机器 content-hub `/api/market-pulse` `/api/topics` | arXiv 官方 API（公网，无需 dev 机器中转也能拉） |
| 探测 | content-hub 可达 | content-hub + arXiv 可达（双探） |
| 用途 | 财经日报（已实现 `wechat-fallback-publish.sh`） | 论文日报（本技能降级） |

---
