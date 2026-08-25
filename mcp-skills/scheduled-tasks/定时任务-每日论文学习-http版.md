# 每日论文学习 · 定时任务 Prompt（引用 //kedou-mcp-curl 技能版 · 可直接复制）

> 使用方法：打开 WorkBuddy 自动化任务 → 编辑「每日论文学习」→ 把下方代码块内容**整体复制**到「提示词」栏。
> 本版**不依赖 mcp.json / 连接器**：通过 `//kedou-mcp-curl` 技能里的 `mcp_call` 函数用 curl 直调生产 MCP 端点，内容由定时任务里的 AI 生成。

```text
请执行「每日论文学习」流程，产出论文日报并发布到腾讯文档和公众号。

先加载 kedou-mcp-curl 技能（//kedou-mcp-curl）：它提供 mcp_call(module, tool, args) 函数，用 curl 直接调用 kedouai 生产 MCP 端点（finnews / wechat_mp / paper），无需 mcp.json。
- 若技能内 KEDOU_TOKEN 未填真实值，先在沙箱执行：export KEDOU_TOKEN='kedou_你的真实Token'（从 ~/.workbuddy/mcp.json 的 Authorization 复制）

内容由你（AI）基于接口返回的数据生成，接口只负责提供数据和接收成品。

一、获取论文数据（kedou-mcp-curl 技能）
1. 用 mcp_call 调用 paper 模块 fetch_papers 拉取 arXiv 最新论文：
   mcp_call paper fetch_papers '{"categories":"cs.AI,cs.CL,cs.CV,cs.LG","max_results":10}'
   - 返回每篇论文的 title / summary / arxiv_id / abs_url / published / authors
   - 若 fetch_papers 不可用，降级直拉 arXiv API：
     curl -sL "http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.CV+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&start=0&max_results=10"
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

五、创建公众号草稿（kedou-mcp-curl 技能，只建草稿不发布）
11. 文章名称固定为：大橙子社区·每日论文学习
12. 用 mcp_call 调用 wechat_mp 的 create_wechat_draft：
    mcp_call wechat_mp create_wechat_draft '{"title":"大橙子社区·每日论文学习","html":"<步骤6的HTML>"}'
13. 只创建草稿，禁止调用 publish_to_wechat 发布（公众号尚未开通发布权限，发布待认证升级后另行放开）。
14. 汇报：论文条数、每篇标题、腾讯文档链接、草稿 media_id（不汇报 publish_id，因为不发布）。

降级兜底：
- mcp_call 失败（网络/超时）重试 1 次；仍失败如实汇报失败环节。
- fetch_papers 不可用时按第一步降级到 arXiv API。
- 任一步失败必须如实汇报失败环节与原因，不得编造或谎称成功。

约束：
- 论文必须来自接口实际抓取，不得编造标题/作者/摘要
- 日期统一用当天日期
```

---

## 附：定时任务配置建议

| 配置项 | 建议值 |
|--------|--------|
| 任务名称 | 每日论文学习·定时拉取与发布 |
| 提示词 | 上方代码块内容 |
| 工作空间 | 云端项目「个人开发工作台」（或本地 /Users/geekwen/workspace/web_system） |
| 勾选技能 | **kedou-mcp-curl**（必须，提供 mcp_call） |
| 勾选连接器 | 腾讯文档（仅第四步用；kedou MCP 已由技能 curl 完成，无需勾选 finnews/wechat_mp 连接器） |

## MCP 调用方式（由 kedou-mcp-curl 技能统一提供）

本任务的 MCP 调用全部通过 `kedou-mcp-curl` 技能的 `mcp_call` 函数完成：curl 实现、`Mcp-Session-Id` 会话头处理、SSE 响应解析都已在技能内封装，无需在此重复。需自定义时直接编辑技能或调用 `mcp_call(module, tool, args)`。

## 关键认知

- **内容生成由定时任务里的 AI 完成**（Prompt 驱动的 Agent），不是接口；接口只提供原始数据和建稿通道。
- **论文数据优先走 paper.fetch_papers（skill）**，降级才用 arXiv API；不要用 /mcp/finnews（那是财经资讯，无论文数据）。
- **建稿必须带封面图**（首段 `<img>` 或 thumb_media_id），否则服务端报「缺少封面」。
- **只建草稿不发布**：公众号尚未开通「发布能力」接口权限（微信 48001），所有任务只创建草稿，等认证升级后再放开发布。
- 本版彻底移除 SSH 依赖与 mcp.json 依赖，沙箱只要有 curl + python3 + 公网即可跑通。
