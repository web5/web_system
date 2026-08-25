# 未来一周关注公司 · 定时任务 Prompt（引用 //kedou-mcp-curl 技能版 · 可直接复制）

> 使用方法：打开 WorkBuddy 自动化任务 → 编辑「未来一周关注公司」→ 把下方代码块内容**整体复制**到「提示词」栏。
> 本版**不依赖 mcp.json / 连接器**：通过 `//kedou-mcp-curl` 技能里的 `mcp_call` 函数用 curl 直调生产 MCP 端点，内容由定时任务里的 AI 生成。

```text
推荐未来一周值得关注的公司。不一定是新的公司——如果前面推荐过的公司仍然值得关注，继续推荐即可；
如果不值得关注了，给出放弃理由，再推荐新的公司。

先加载 kedou-mcp-curl 技能（//kedou-mcp-curl）：它提供 mcp_call(module, tool, args) 函数，用 curl 直接调用 kedouai 生产 MCP 端点（finnews / wechat_mp / paper），无需 mcp.json。
- 若技能内 KEDOU_TOKEN 未填真实值，先在沙箱执行：export KEDOU_TOKEN='kedou_你的真实Token'（从 ~/.workbuddy/mcp.json 的 Authorization 复制）

内容由你（AI）基于接口返回的数据生成，接口只负责提供数据。

一、获取公司/板块数据（kedou-mcp-curl 技能）
1. 用 mcp_call 调用 finnews 模块工具：
   mcp_call finnews get_sector_library '{}'      # 先取真实板块名
   mcp_call finnews get_sector_hot '{"sector":"人工智能"}'
   mcp_call finnews get_stock_news '{"symbol":"600519"}'
   mcp_call finnews get_market_pulse '{}'
2. 板块名必须来自 get_sector_library 返回的真实板块，不得自造。

二、生成关注公司清单（由你 AI 分析生成）
3. 基于板块热度 + 个股资讯，筛选 3-5 家值得关注的公司：
   - 判断标准：板块热度上升、有实质利好资讯、市场情绪配合
   - 检查历史推荐：若之前推荐的公司仍值得关注（数据支撑），继续推荐；否则说明放弃理由
4. 对每家公司给出：公司名称、推荐理由（基于数据）、关注要点（板块/事件/资金面）。

三、创建公众号草稿（kedou-mcp-curl 技能，只建草稿不发布）
5. 将清单转 HTML（body/p/h3/strong）：
   - 首段必须嵌入公网封面图：
     <img src="https://dummyimage.com/800x400/FF8C42/fff.png&text=Weekly+Watch" />
6. 文章名称固定为：大橙子社区·每周关注公司
7. 用 mcp_call 调用 wechat_mp 的 create_wechat_draft：
   mcp_call wechat_mp create_wechat_draft '{"title":"大橙子社区·每周关注公司","html":"<步骤5的HTML>"}'
8. 只创建草稿，禁止调用 publish_to_wechat 发布（公众号尚未开通发布权限，发布待认证升级后另行放开）。
9. 汇报：推荐公司清单、放弃理由、草稿 media_id（不汇报 publish_id，因为不发布）。

降级兜底：
- mcp_call 失败（网络/超时）重试 1 次；仍失败如实汇报失败环节。
- 若板块/个股接口无数据（如资讯未入库），如实汇报数据不足，不编造推荐。
- 任一步失败必须如实汇报失败环节与原因，不得编造或谎称成功。

约束：
- 推荐必须基于工具实际返回的数据，不得编造公司/理由
- 板块名必须先取真实板块库，不得自造板块名
- 日期统一用当天日期
```

---

## 附：定时任务配置建议

| 配置项 | 建议值 |
|--------|--------|
| 任务名称 | 未来一周关注公司 |
| 提示词 | 上方代码块内容 |
| 工作空间 | 云端项目「个人开发工作台」（或本地 /Users/geekwen/workspace/web_system） |
| 勾选技能 | **kedou-mcp-curl**（必须，提供 mcp_call） |
| 勾选连接器 | 无需勾选 finnews / wechat_mp 连接器（已由技能 curl 完成） |

## MCP 调用方式（由 kedou-mcp-curl 技能统一提供）

本任务的 MCP 调用全部通过 `kedou-mcp-curl` 技能的 `mcp_call` 函数完成：curl 实现、`Mcp-Session-Id` 会话头处理、SSE 响应解析都已在技能内封装，无需在此重复。需自定义时直接编辑技能或调用 `mcp_call(module, tool, args)`。

## 关键认知

- **内容生成由定时任务里的 AI 完成**，接口只提供板块/个股原始数据。
- **板块名必须先用 get_sector_library 取真实值**，不得自造。
- **只建草稿不发布**：公众号尚未开通「发布能力」接口权限（微信 48001），所有任务只创建草稿，等认证升级后再放开发布。
- 本版彻底移除 SSH 依赖与 mcp.json 依赖，沙箱只要有 curl + python3 + 公网即可跑通。
