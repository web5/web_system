# web_system MCP 连接器配置（手动添加用）

> 使用方式：WorkBuddy → 连接器中心 → 右上角「自定义连接器」→ 按下方配置逐个添加。
> API Key 说明：`<你的 kedou_ Key>` 统一换成你的 API Key（形如 `kedou_256e...`）。
> 三个端点均为 streamable-http，生产公网地址。

---

## 1. 论文学习（paper）— 每日论文学习任务数据源

| 字段 | 值 |
|------|-----|
| 名称 | web-system-paper |
| 类型 | streamable-http |
| URL | `https://kedouai.com/mcp/paper` |
| Authorization Header | `Bearer <你的 kedou_ Key>` |
| 超时 | 60000 |
| 工具 | `fetch_papers`（拉取 arXiv 最新论文：分类/条数） |

---

## 2. 财经资讯（finnews）— 每日财经资讯 / 每周关注公司 数据源

| 字段 | 值 |
|------|-----|
| 名称 | 橙子财经资讯 |
| 类型 | streamable-http |
| URL | `https://kedouai.com/mcp/finnews` |
| Authorization Header | `Bearer <你的 kedou_ Key>` |
| 超时 | 60000 |
| 工具 | `get_market_pulse`、`get_latest_topics`、`get_sector_library`、`get_sector_hot`、`get_stock_news`、`search_news` |

---

## 3. 公众号发布（wechat_mp）— 所有任务发布通道

| 字段 | 值 |
|------|-----|
| 名称 | wechat-mp-publisher |
| 类型 | streamable-http |
| URL | `https://kedouai.com/mcp/wechat_mp` |
| Authorization Header | `Bearer <你的 kedou_ Key>` |
| 超时 | 120000 |
| 工具 | `create_wechat_draft`（建草稿）、`publish_to_wechat`（发布，暂不用） |

---

## 附录：mcp.json 格式（如按文件方式配置）

```json
{
  "mcpServers": {
    "web-system-paper": {
      "type": "streamableHttp",
      "url": "https://kedouai.com/mcp/paper",
      "headers": {
        "Authorization": "Bearer <你的 kedou_ Key>"
      },
      "timeout": 60000,
      "description": "论文学习：arXiv 最新论文拉取（cs.AI/CL/CV/LG）",
      "disabled": false
    },
    "橙子财经资讯": {
      "type": "streamableHttp",
      "url": "https://kedouai.com/mcp/finnews",
      "headers": {
        "Authorization": "Bearer <你的 kedou_ Key>"
      },
      "timeout": 60000,
      "description": "财经资讯：市场情绪/话题/板块/个股资讯",
      "disabled": false
    },
    "wechat-mp-publisher": {
      "type": "streamableHttp",
      "url": "https://kedouai.com/mcp/wechat_mp",
      "headers": {
        "Authorization": "Bearer <你的 kedou_ Key>"
      },
      "timeout": 120000,
      "description": "公众号发布：创建图文草稿 / 一键发布",
      "disabled": false
    }
  }
}
```

> 注意：`/mcp/paper` 为新增端点（2026-08-25 上线），如按文件方式配置需把上面合并进 `~/.workbuddy/mcp.json` 的 `mcpServers`。
