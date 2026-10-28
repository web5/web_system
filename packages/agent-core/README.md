# @kedouai/agent-core

科豆 AI Agent 核心库（纯 TypeScript，**零运行时依赖**，Node ≥18）。

提供 ReAct 推理引擎、工具/Agent/Client 注册表、模型客户端、记忆与摘要压缩、可插拔搜索 Provider、coding 工具集。

## 特性

- **ReAct 引擎**：`AgentEngine` 循环（工具调用 → 回写 → 最终回答），`maxSteps` 熔断。
- **模型客户端**：`Hy3Client`、`TokenHubClient`（原生 `fetch`，支持 `chatWithTools` / `chatStream`；`TokenHubClient` 按传入 modelId 走 TokenHub 网关，DeepSeek 系由此承载）。
- **注册表**：`ToolRegistry` / `AgentRegistry` / `ClientRegistry` 集中管理。
- **记忆**：`InMemoryConversationMemory` + `Compaction` 增量摘要压缩。
- **搜索插件**：`SearchProviderRegistry` + `SearchProvider` 接口，默认内置 `BingSearchProvider`。
- **coding 工具**：`list-dir` / `read-file` / `grep-search` / `write-file`（全部写操作需确认）/ `shell-exec`（白名单 + 危险命令确认）。

## 安装

```bash
npm install @kedouai/agent-core
```

## 快速开始

```ts
import {
  AgentEngine, AgentRegistry, ClientRegistry, ToolRegistry,
  Hy3Client, InMemoryConversationMemory, Compaction,
  SearchProviderRegistry, BingSearchProvider, WebSearchTool,
  ListDirTool, ReadFileTool, GrepSearchTool, ShellExecTool,
} from '@kedouai/agent-core';

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
| 客户端 | `BaseAiClient`、`Hy3Client`、`TokenHubClient` |
| think 统一策略（D1） | `resolveThinking`、`resolveMaxTokens`、`lookupModelMaxTokens`、`MODEL_MAX_OUTPUT_TOKENS`、`DEFAULT_MODEL_MAX_OUTPUT` |
| 记忆 | `InMemoryConversationMemory`、`Compaction` |
| 搜索 | `SearchProviderRegistry`、`SearchProvider`、`WebSearchTool`、`BingSearchProvider` |
| coding | `ListDirTool`、`ReadFileTool`、`GrepSearchTool`、`WriteFileTool`、`ShellExecTool` |
| 工具 | `Logger`、`API_TIMEOUT` |

## 生成参数（C7）

Agent 定义里的 `temperature` / `maxTokens` / `topP` / `thinking` 会在 `AgentEngine` 里组装成
`ChatOptions` 透传给模型客户端 —— **只有显式填了（非 null）的字段才会带上**，全为 null 时等价于
不传，行为与未配置完全一致（可回归对照）。

两条硬约定：

- `temperature` 与 `topP` **只能填其一**（同时填会让输出时好时坏且无法归因）；
- `thinking` 为 `ThinkingOption`：`{ type: 'enabled' | 'disabled', budget_tokens?: number }`，
  `null` = 未配置。**意图分类链路不受它控制**（固定 disabled）。

### think 统一策略（D1）

thinking 判定与 budget 公式收口在 `resolveThinking`（`thinking-policy.ts`，tokenhub / hy3 /
content-hub 三处同一函数）。优先级（P1 最高）：

1. **带工具强制 enabled**（纠正一切 disabled；显式 budget 不放行，一律公式值）
2. `options.thinking` 显式（仅非工具场景）
3. `options.agentThinking`（Agent 定义层，C7 `thinking` 列）
4. env `TOKENHUB_THINKING`（`none|disabled`→关；`budget:<N>`→开+限；仅作用于未决调用）
5. 形态默认（非工具→`disabled`）

budget 仅在最终 enabled 时携带：`budget_tokens = min(模型 max_tokens 上限, maxTokens/2)`
（`MODEL_MAX_OUTPUT_TOKENS` 常量表 + env `MODEL_MAX_OUTPUT_TOKENS_JSON` 覆盖，未知模型回落
`DEFAULT_MODEL_MAX_OUTPUT=8192`）。带工具未配 maxTokens 时默认 = 模型上限。

取值档位与完整契约见 `docs/api/contracts.md` §7（C7）。

## 工具安全

- `shell-exec` 仅白名单命令；删除/覆盖写等危险操作通过 `ToolContext.confirm` 请求确认，未注入则拒绝。
- coding 工具路径限制在当前工作目录内，默认只读。

## License

MIT
