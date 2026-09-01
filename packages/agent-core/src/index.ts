/**
 * @kedouai/agent-core 统一导出。
 */

// 接口
export * from './interfaces/tool.interface';
export * from './interfaces/agent.interface';
export * from './interfaces/runtime.interface';

// Skill（on-demand 技能加载）
export { SkillLoader } from './skills/skill-loader';
export type { SkillProvider } from './skills/skill-loader';
export { LOAD_SKILL_TOOL_NAME } from './core/agent-engine';

// 模型客户端
export * from './clients/base-ai.client';
export { Hy3Client } from './clients/hy3.client';
export { DeepseekClient } from './clients/deepseek.client';

// 注册表
export { ToolRegistry } from './registry/tool.registry';
export { AgentRegistry } from './registry/agent.registry';
export { ClientRegistry } from './registry/client.registry';

// MCP 工具适配器（插件化：远程工具接入统一 Tool 契约）
export { McpToolAdapter } from './mcp/mcp-tool.adapter';
export type { McpToolMeta, McpToolParameter, McpToolExecutor } from './mcp/mcp-tool.adapter';

// 长任务插件（可选装饰器：把返回 jobId 的工具包装成自动轮询的同步工具；不绑定 MCP）
export { withLongRunning, isTerminalJobStatus } from './plugins/long-running';
export type {
  JobStatus,
  JobStatusFetcher,
  JobIdDetector,
  LongRunningOptions,
} from './plugins/long-running';

// 引擎
export { AgentEngine } from './core/agent-engine';
export { AgentRunner } from './core/agent-runner';

// 记忆
export * from './memory/stored-message';
export * from './memory/memory-port';
export { Compaction } from './memory/compaction';
export { InMemoryConversationMemory } from './memory/in-memory-conversation-memory';

// 搜索（插件式 Provider）
export * from './search/provider.interface';
export { SearchProviderRegistry } from './search/registry';
export { WebSearchTool } from './search/web-search.tool';
export { BingSearchProvider } from './search/providers/bing.provider';
export { WsaSearchProvider } from './search/providers/wsa.provider';

// 内置工具
export { ListDirTool } from './tools/coding/list-dir.tool';
export { ReadFileTool } from './tools/coding/read-file.tool';
export { GrepSearchTool } from './tools/coding/grep-search.tool';
export { WriteFileTool } from './tools/coding/write-file.tool';
export { ShellExecTool } from './tools/coding/shell-exec.tool';

// 工具函数
export { Logger } from './lib/logger';
export { API_TIMEOUT } from './lib/timeout';
