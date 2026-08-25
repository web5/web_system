# 未来一周关注公司 · 定时任务 Prompt（纯 HTTP 版 · 可直接复制）

> 使用方法：打开 WorkBuddy 自动化任务 → 编辑「未来一周关注公司」→ 把下方代码块内容**整体复制**到「提示词」栏。
> 本版**不依赖 SSH**：数据获取与发布全部通过 HTTP 调用生产 MCP 端点完成，内容由定时任务里的 AI 生成。

```text
推荐未来一周值得关注的公司。不一定是新的公司——如果前面推荐过的公司仍然值得关注，继续推荐即可；
如果不值得关注了，给出放弃理由，再推荐新的公司。
内容由你（AI）基于接口返回的数据生成，接口只负责提供数据。

一、获取公司/板块数据（HTTP 调用生产 MCP 端点）
1. 调用财经数据源（二选一）：
   - 方式A（推荐）：使用已连接的「橙子财经资讯」连接器工具：
     get_sector_library（先取真实板块名）、get_sector_hot、get_stock_news、get_market_pulse
   - 方式B（HTTP curl）：对 https://kedouai.com/mcp/finnews 发 MCP JSON-RPC 请求调用上述工具
2. 板块名必须来自 get_sector_library 返回的真实板块，不得自造。

二、生成关注公司清单（由你 AI 分析生成）
3. 基于板块热度 + 个股资讯，筛选 3-5 家值得关注的公司：
   - 判断标准：板块热度上升、有实质利好资讯、市场情绪配合
   - 检查历史推荐：若之前推荐的公司仍值得关注（数据支撑），继续推荐；否则说明放弃理由
4. 对每家公司给出：公司名称、推荐理由（基于数据）、关注要点（板块/事件/资金面）。

三、创建公众号草稿（HTTP，只建草稿不发布）
5. 加载 web-system-wechat-mp 技能规范，将清单转 HTML（body/p/h3/strong）：
   - 首段必须嵌入公网封面图：
     <img src="https://dummyimage.com/800x400/FF8C42/fff.png&text=Weekly+Watch" />
6. 文章名称固定为：大橙子社区·每周关注公司
7. 用 HTTP 调用公众号 MCP 端点创建草稿（二选一）：
   - 方式A（推荐）：使用已连接的「wechat-mp-publisher」连接器工具
   - 方式B（HTTP curl）：对 https://kedouai.com/mcp/wechat_mp 发 MCP JSON-RPC 请求
8. create_wechat_draft（title="大橙子社区·每周关注公司"，html=步骤5）→ 拿 media_id
9. **只创建草稿，禁止调用 publish_to_wechat 发布**（公众号尚未开通发布权限，发布待认证升级后另行放开）
10. 汇报：推荐公司清单、放弃理由、草稿 media_id（不汇报 publish_id，因为不发布）。

降级兜底：
- 连接器不可用但沙箱可访问公网时，一律改用 curl HTTP 调用（端点见上）
- 若板块/个股接口无数据（如资讯未入库），如实汇报数据不足，不编造推荐
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
| 工作空间 | `/Users/geekwen/workspace/web_system` |
| 勾选技能 | web-system-finnews、web-system-wechat-mp |
| 勾选连接器 | 橙子财经资讯（finnews）、wechat-mp-publisher（公众号） |

## MCP HTTP 调用速查（沙箱内 curl）

```bash
# finnews：先 get_sector_library 拿板块，再 get_sector_hot / get_stock_news
curl -s -D /tmp/h.txt -X POST https://kedouai.com/mcp/finnews \
  -H "Authorization: Bearer <你的Key>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sandbox","version":"1"}}}'
SID=$(grep -i 'mcp-session-id' /tmp/h.txt | tr -d '\r' | awk '{print $2}')

# get_sector_library（无参数）
curl -s -X POST https://kedouai.com/mcp/finnews \
  -H "Authorization: Bearer <你的Key>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_sector_library","arguments":{}}}'

# get_sector_hot（带板块名）
curl -s -X POST https://kedouai.com/mcp/finnews \
  -H "Authorization: Bearer <你的Key>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_sector_hot","arguments":{"sector":"人工智能"}}}'
```

## 关键认知

- **内容生成由定时任务里的 AI 完成**，接口只提供板块/个股原始数据。
- **板块名必须先用 get_sector_library 取真实值**，不得自造。
- **只建草稿不发布**：公众号尚未开通「发布能力」接口权限（微信 48001），所有任务只创建草稿，等认证升级后再放开发布。
- 本版彻底移除 SSH 依赖，沙箱只要能访问公网（或已连接连接器）即可跑通。
