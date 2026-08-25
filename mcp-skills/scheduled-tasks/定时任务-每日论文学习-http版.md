# 每日论文学习 · 定时任务 Prompt（纯 HTTP 版 · 可直接复制）

> 使用方法：打开 WorkBuddy 自动化任务 → 编辑「每日论文学习」→ 把下方代码块内容**整体复制**到「提示词」栏。
> 本版**不依赖 SSH**：数据获取与发布全部通过 HTTP 调用生产 MCP 端点完成，内容由定时任务里的 AI 生成。

```text
请执行「每日论文学习」流程，产出论文日报并发布到腾讯文档和公众号。
内容由你（AI）基于接口返回的数据生成，接口只负责提供数据和接收成品。

一、获取论文数据（HTTP 直拉 arXiv 官方 API）
1. 论文数据源为 **arXiv 官方 API**（export.arxiv.org），不要调用 /mcp/finnews（那是财经资讯，没有论文数据）：
   ```bash
   curl -sL "http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.CV+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&start=0&max_results=10"
   ```
   - 返回 Atom XML，解析 <entry> 拿 title / summary / id / published / authors
   - 沙箱若无 curl，可改用已连接连接器（web-system-paper 如已部署 fetch_papers 工具）
2. 记录返回的论文列表（标题 / 摘要 / arxiv id / 链接）。

二、筛选与摘要（由你 AI 完成）
3. 从返回数据中挑选约 10 篇，主线：LLM / 智能体 / 世界模型 / 对齐。
4. 基于每篇 summary 原文撰写结构化中文摘要（中文译名 / 一句话核心贡献 / 方法亮点 / 潜在应用意义）。
5. 整理为日报结构（按你的期望顺序排列）。

三、渲染日报（由你 AI 生成 HTML）
6. 将日报渲染为 HTML 富文本：
   - 整体用 <body> 包裹；段落 <p>；小标题 <h3>；强调 <strong>；论文块之间 <hr/> 分隔
   - 首段必须嵌入公网封面图：
     <img src="https://dummyimage.com/800x400/4A90E2/fff.png&text=arXiv+Daily" />
     （服务端强制要求封面，否则报「缺少封面」错误）

四、发布到腾讯文档（tdocs-app）
7. manage.folder_list（folder_id 为空）查找「每日论文学习」文件夹；不存在则 manage.create_file（file_type=folder）新建。
8. create_smartcanvas_by_mdx（title="每日论文学习 · YYYY-MM-DD"、content_format=markdown、mdx=日报全文）创建智能文档拿 file_id（不支持 parent_id）。
9. manage.move_file 把文档移入「每日论文学习」文件夹，记录文档链接。
10. 若腾讯文档工具不可用：如实告知跳过，不编造链接。

五、创建公众号草稿（HTTP，只建草稿不发布）
11. 文章名称固定为：大橙子社区·每日论文学习
12. 用 HTTP 调用公众号 MCP 端点创建草稿（二选一）：
    - 方式A（推荐）：使用已连接的「wechat-mp-publisher」连接器工具 create_wechat_draft
    - 方式B（HTTP curl）：对 https://kedouai.com/mcp/wechat_mp 发 MCP JSON-RPC 请求（initialize 拿 session → tools/call create_wechat_draft）
13. 调用 create_wechat_draft：title="大橙子社区·每日论文学习"，html=步骤6的HTML → 拿 media_id
14. **只创建草稿，禁止调用 publish_to_wechat 发布**（公众号尚未开通发布权限，发布待认证升级后另行放开）
15. 汇报：论文条数、每篇标题、腾讯文档链接、草稿 media_id（不汇报 publish_id，因为不发布）。

降级兜底：
- 连接器不可用但沙箱可访问公网时，一律改用 curl HTTP 调用（论文用 arXiv API，发布用 /mcp/wechat_mp）
- 若 arXiv 首次请求超时，重试 1 次（arXiv 偶发限流）
- 任一步失败必须如实汇报失败环节与原因，不得编造或谎称成功。

约束：
- 论文必须来自 arXiv 实际抓取，不得编造标题/作者/摘要
- 日期统一用当天日期
- 论文数据只用 arXiv API，不得使用 /mcp/finnews（财经资讯）冒充论文数据
```

---

## 附：定时任务配置建议

| 配置项 | 建议值 |
|--------|--------|
| 任务名称 | 每日论文学习·定时拉取与发布 |
| 提示词 | 上方代码块内容 |
| 工作空间 | `/Users/geekwen/workspace/web_system` |
| 勾选技能 | web-system-paper、web-system-wechat-mp |
| 勾选连接器 | wechat-mp-publisher（公众号 MCP）、腾讯文档 |

## MCP HTTP 调用速查（沙箱内 curl，发布用）

```bash
# wechat_mp：initialize 拿 session
curl -s -D /tmp/h.txt -X POST https://kedouai.com/mcp/wechat_mp \
  -H "Authorization: Bearer <你的Key>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sandbox","version":"1"}}}'
SID=$(grep -i 'mcp-session-id' /tmp/h.txt | tr -d '\r' | awk '{print $2}')

# create_wechat_draft（只建草稿）
curl -s -X POST https://kedouai.com/mcp/wechat_mp \
  -H "Authorization: Bearer <你的Key>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_wechat_draft","arguments":{"title":"标题","html":"<body><p>正文</p></body>"}}}'

# 注意：不调用 publish_to_wechat（公众号尚未开通发布权限，只建草稿）
```

> 论文数据获取不经过 /mcp/finnews，直接 curl arXiv API（见上方第一步）。

## 关键认知

- **内容生成由定时任务里的 AI 完成**（Prompt 驱动的 Agent），不是接口；接口只提供原始数据和建稿通道。
- **论文数据源是 arXiv 官方 API**（`export.arxiv.org`），不是财经资讯端点。
- **建稿必须带封面图**（首段 `<img>` 或 thumb_media_id），否则服务端报「缺少封面」。
- **只建草稿不发布**：公众号尚未开通「发布能力」接口权限（微信 48001），所有任务只创建草稿，等认证升级后再放开发布。
- 本版彻底移除 SSH 依赖，沙箱只要能访问公网（或已连接连接器）即可跑通。
