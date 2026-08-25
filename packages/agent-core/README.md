# @kedou/agent-core

科豆 AI Agent 核心库（纯 TypeScript，**零运行时依赖**，Node ≥18）。

提供 ReAct 推理引擎、工具/Agent/Client 注册表、模型客户端、记忆与摘要压缩、可插拔搜索 Provider、coding 工具集。

## 特性

- **ReAct 引擎**：`AgentEngine` 循环（工具调用 → 回写 → 最终回答），`maxSteps` 熔断。
- **模型客户端**：`Hy3Client`、`DeepseekClient`（原生 `fetch`，支持 `chatWithTools` / `chatStream`）。
- **注册表**：`ToolRegistry` / `AgentRegistry` / `ClientRegistry` 集中管理。
- **记忆**：`InMemoryConversationMemory` + `Compaction` 增量摘要压缩。
- **搜索插件**：`SearchProviderRegistry` + `SearchProvider` 接口，默认内置 `BingSearchProvider`。
- **coding 工具**：`list-dir` / `read-file` / `grep-search` / `shell-exec`（白名单 + 危险命令确认）。

## 安装

```bash
npm install @kedou/agent-core
```

## 快速开始

```ts
import {
  AgentEngine, AgentRegistry, ClientRegistry, ToolRegistry,
  Hy3Client, InMemoryConversationMemory, Compaction,
  SearchProviderRegistry, BingSearchProvider, WebSearchTool,
  ListDirTool, ReadFileTool, GrepSearchTool, ShellExecTool,
} from '@kedou/agent-core';

// 模型客户端
const clients = new ClientRegistry();
clients.register(new Hy3Client());

// 搜索 provider（默认 Bing）
const search = new SearchProviderRegistry();
search.register(new BingSearchProvider());

// 工具
const tools = new ToolRegistry();
tools.register(new WebSearchTool(search));
tools.register(new ListDirTool());
tools.register(new ReadFileTool());
tools.register(new GrepSearchTool());
tools.register(new ShellExecTool());

// Agent 定义
const agents = new AgentRegistry();
agents.register({
  id: 'dev',
  name: '开发助手',
  systemPrompt: '你是开发助手',
  model: 'hy3',
  tools: ['list-dir', 'read-file', 'grep-search', 'shell-exec'],
  maxSteps: 8,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
});

// 记忆 + 引擎
const memory = new InMemoryConversationMemory(new Compaction(clients));
const engine = new AgentEngine(clients, tools, agents, memory);

// 运行（流式事件）
for await (const ev of engine.run(
  { agentId: 'dev', userInput: '看看当前目录' },
  'user-1',
  'run-1',
)) {
  console.log(ev.type, ev.content ?? ev.name);
}
```

## API 概览

| 模块 | 导出 |
|------|------|
| 引擎 | `AgentEngine`、`AgentRunner` |
| 注册表 | `ToolRegistry`、`AgentRegistry`、`ClientRegistry` |
| 客户端 | `BaseAiClient`、`Hy3Client`、`DeepseekClient` |
| 记忆 | `InMemoryConversationMemory`、`Compaction` |
| 搜索 | `SearchProviderRegistry`、`SearchProvider`、`WebSearchTool`、`BingSearchProvider` |
| coding | `ListDirTool`、`ReadFileTool`、`GrepSearchTool`、`ShellExecTool` |
| 工具 | `Logger`、`API_TIMEOUT` |

## 工具安全

- `shell-exec` 仅白名单命令；删除/覆盖写等危险操作通过 `ToolContext.confirm` 请求确认，未注入则拒绝。
- coding 工具路径限制在当前工作目录内，默认只读。

## License

MIT
