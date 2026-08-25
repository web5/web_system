---
name: kedou-mcp-curl
description: 在无法加载 mcp.json / 没有 MCP 客户端的沙箱或云端自动任务中，用 curl 直接调用 kedouai.com 的 MCP 端点（finnews 财经资讯 / wechat_mp 公众号草稿 / paper arXiv 论文）。当用户需要在自动任务或脚本里拉取财经资讯、生成并发布公众号草稿、拉取最新论文时使用。
---

# kedou MCP 直调（curl 版，无需 mcp.json）

当运行环境读不到 `~/.workbuddy/mcp.json`、也没有 MCP 客户端时，用下面的 bash 函数直接对 `https://kedouai.com/mcp/<module>` 发 JSON-RPC。本函数已端到端实测可用（finnews / wechat_mp / paper 三个模块均通过）。

## 前置条件
- 沙箱需具备 `curl` 与 `python3`
- Token：从本地 `~/.workbuddy/mcp.json` 的 `Authorization` 字段复制，格式为 `kedou_xxx`

## 调用函数（每次自动完成 initialize 拿会话 -> tools/call）

```bash
KEDOU_TOKEN="kedou_256ee5214dd20af9b3e251712cabaa03a5ccc4479a2daf10"   # ← 换成你 ~/.workbuddy/mcp.json 里的 Bearer 值

mcp_call() {
  local module="$1" tool="$2" args="$3"
  local url="https://kedouai.com/mcp/$module"
  local sid
  sid=$(curl -s -D - -o /dev/null -X POST "$url" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "Authorization: Bearer $KEDOU_TOKEN" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"wb-auto","version":"1.0"}}}' \
    | grep -i '^mcp-session-id' | tr -d '\r' | awk '{print $2}')
  curl -s -X POST "$url" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "Authorization: Bearer $KEDOU_TOKEN" \
    -H "Mcp-Session-Id: $sid" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
    | sed -n 's/^data: //p' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])"
}
```

## 工具清单

| module    | tool                | arguments 示例                                  |
|-----------|---------------------|-----------------------------------------------|
| finnews   | get_market_pulse    | `{}`                                          |
| finnews   | get_latest_topics   | `{}`                                          |
| finnews   | get_sector_hot      | `{}`                                          |
| finnews   | get_stock_news      | `{"symbol":"600519"}`                         |
| finnews   | search_news         | `{"keyword":"半导体"}`                        |
| wechat_mp | create_wechat_draft | `{"title":"标题","html":"<body>...</body>"}`  |
| paper     | fetch_papers        | `{"categories":"cs.AI,cs.CL,cs.CV,cs.LG","max_results":8}` |

## 用法示例

```bash
# 论文：拉 arXiv 最新论文
mcp_call paper fetch_papers '{"categories":"cs.AI,cs.CL,cs.CV,cs.LG","max_results":8}'

# 财经：情绪脉搏
mcp_call finnews get_market_pulse '{}'

# 公众号：只建草稿（正文必须含公网 <img>，否则触发封面门禁被拒）
mcp_call wechat_mp create_wechat_draft '{"title":"标题","html":"<body><h1>标题</h1><img src=\"https://picsum.photos/600/300\"/><p>正文</p></body>"}'
```

## 关键注意事项
- **必须带 `Mcp-Session-Id`**：网关非无状态，直调 `tools/call` 会返回 400 `No valid session ID`。上面函数每次自动 `initialize` 取会话头再带上，已实测可用。
- **响应是 SSE**：`event: message` + `data: {...}`，函数用 `sed -n 's/^data: //p'` 抽取后用 python 解析，Agent 直接拿到工具返回的 `text`。
- **封面门禁**：`create_wechat_draft` 强制要求正文含公网 `<img>` 或传 `thumb_media_id`，纯文字 HTML 会被拒。
- **禁止发布**：公众号未开通「发布能力」接口权限（48001），一律只调 `create_wechat_draft` 建草稿，不要调 `publish_to_wechat`。
- **Token 安全**：本 skill 里的 token 仅作占位，请替换为你的真实值；若项目会入库/分享，注意不要把真实 token 提交进版本库。
