# kedou-agent

科豆 AI Agent CLI —— 基于 `@kedou/agent-core` 的交互式 AI Agent。

- **自带模型**：你配置自己的大模型 API key（不消耗作者 token）。
- **零运行时依赖**：纯 Node ≥18，原生 `fetch`。
- **内置 Agent**：`study-assistant`（学习助手）、`dev-assistant`（开发助手，含 coding 工具）。

## 安装

```bash
# 全局安装
npm install -g kedou-agent

# 或免安装运行
npx kedou-agent
```

## 首次使用：配置大模型

```bash
kedou-agent config
```

按提示选择模型（混元 Turbo / DeepSeek）并填入你的 API Key。
配置保存在 `~/.kedou/agent-cli.config.json`（权限 600，仅本人可读），**不会上传，也不会随包发布**。

> 未配置大模型时无法对话，运行 `kedou-agent` 会引导你配置。

### 联网搜索（可选）

`web-search` 默认使用 **Bing Web Search API**，配置时可选填 `BING_SEARCH_API_KEY`。
不配置则 web-search 工具不可用（其他功能不受影响）。

## 使用

```bash
kedou-agent                           # 交互式 REPL 对话
kedou-agent chat [--agent dev-assistant]   # 指定 Agent 对话
kedou-agent config                    # 配置 / 重新配置
kedou-agent agents                    # 查看可用 Agent
kedou-agent models                    # 查看模型与搜索配置状态
kedou-agent --message "你好"           # 单轮对话
kedou-agent --version / --help
```

## 内置 Agent

| Agent | 工具 | 说明 |
|-------|------|------|
| `study-assistant` | web-search | 学习助手，可联网查询 |
| `dev-assistant` | list-dir / read-file / grep-search / write-file / shell-exec | 开发助手，读写代码、受限执行命令 |

## 安全

- 大模型 API key 存于 `~/.kedou`（权限 600），仅本人可读。
- `shell-exec` 仅允许白名单命令；**删除、覆盖写、sudo 等危险操作会弹出确认**，未确认不执行；非交互环境默认拒绝。
- `write-file` 支持新建/覆盖/追加，**所有写操作都会弹出确认**；非交互环境默认拒绝。
- coding 工具路径限制在当前工作目录内。

## 环境变量

| 变量 | 说明 |
|------|------|
| `HY3_API_KEY` / `HY3_BASE_URL` | 混元 Turbo |
| `DEPSEEK_API_KEY` | DeepSeek |
| `BING_SEARCH_API_KEY` | Bing Web Search（web-search 默认 Provider） |

> 环境变量优先级高于 `~/.kedou` 配置文件。

## 开发

```bash
pnpm install
pnpm --filter @kedou/agent-core build
pnpm --filter kedou-agent build
pnpm --filter kedou-agent start   # node bin/kedou-agent.js
```

## 发布

```bash
cd packages/agent-core && pnpm publish
cd packages/kedou-agent && pnpm publish
```

## License

MIT
