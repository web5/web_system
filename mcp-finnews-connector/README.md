# 科豆财经资讯 MCP — WorkBuddy Connector 上架包

本包是 `橙子财经资讯`（finnews）在 WorkBuddy 内的分发形态，格式对齐官方 Connector（参考 `mx-ds-mcp` 东方财富妙想 / `westock-mcp` 腾讯自选股）：

```
kedou-finnews/
├── mcp.json          # MCP Server 连接配置（type / url / timeout / headers）
└── skills/
    └── SKILL.md      # AI 调用行为守则：工作流 + 门禁 + 工具表 + 错误处理
```

服务端点：`https://kedouai.com/mcp/finnews`（streamableHttp）
鉴权：**每用户独立 API Key**（自助申请，不共享密钥）

---

## 在 WorkBuddy 内推广的两条路径

### 路径 A · 进官方 Connector 目录（推荐，真正的「推广」）

只有进入 WorkBuddy 官方 Connector 目录，用户提问涉及财经资讯时，`recommend-connectors` 才会**自动推送卡片**、并支持应用内**一键授权接入**。

上架方式：将本包 `kedou-finnews/` 提交给 WorkBuddy 的 Connector 收录流程（外部申请）。
收录后效果：
- 用户说「帮我看下今天财经热点 / 市场情绪怎么样 / 某某板块最近怎么」→ 自动出现「科豆财经资讯」Connector 卡片
- 用户点一下即连（首次会引导申请自己的 API Key），无需手动改配置

> 注意：本地 `~/.workbuddy/connectors-marketplace/` 是**远程同步缓存**，不是 git 仓库；直接往里写会被下次同步覆盖，不会真正上架。上架必须走官方收录通道（外部申请）。

### 路径 B · 自助分发（现在就能用，适合内测/发给朋友）

把连接配置 + 行为说明书交给用户，用户本地落地即可：

1. 用户先到 `https://kedouai.com/mcp-admin` 自助申请 API Key（邮箱收验证码 → 领取 `kedou_xxx`）
2. 将 `mcp.json` 里的 `kedou-finnews` 合并进 `~/.workbuddy/mcp.json`，并把 `headers.Authorization` 的占位值换成自己的 Key：
   ```json
   {
     "mcpServers": {
       "kedou-finnews": {
         "type": "streamableHttp",
         "url": "https://kedouai.com/mcp/finnews",
         "timeout": 60000,
         "headers": { "Authorization": "Bearer <你申请的API Key>" }
       }
     }
   }
   ```
3. 将 `skills/SKILL.md` 放到 `~/.workbuddy/connectors/skills/connector-kedou-finnews/SKILL.md`（用户本地路径，持久生效，不被同步覆盖）。

完成后该用户即可在 WorkBuddy 中通过自然语言调用财经资讯工具，且 AI 会遵循 `SKILL.md` 的行为门禁。

---

## 发布前检查清单

- [x] 端点已切到正式域名 `https://kedouai.com/mcp/finnews`（不再用 dev 环境）
- [x] 公网鉴权改为**每用户 API Key**（自助申请，mcp.json 不硬编码共享密钥，仅留占位）
- [x] `SKILL.md` 工具名/描述与服务 `tools/list` 实际返回一致（6 个工具）
- [ ] 服务端部署：nginx 加 `kedouai.com/mcp` → mcp-gateway:6006；建表 `mcp_api_keys` / `mcp_key_codes`（见 `servers/mcp-gateway/sql/mcp_keys_tables.sql`）
- [ ] 配置生产环境变量 `MCP_ADMIN_KEY`、`SMTP_HOST/USER/PASS/FROM`
- [ ] 图标（可选）：放入 `connectors-marketplace/icons/` 对应条目以在目录中显示
