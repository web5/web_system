/**
 * 装配独立运行的 Agent harness（基于 @kedouai/agent-core）。
 * 负责注册模型客户端、工具、搜索 provider、Agent，并提供可注入的 confirm 确认器。
 */
import {
  AgentEngine,
  AgentRegistry,
  ClientRegistry,
  Compaction,
  DeepseekClient,
  GrepSearchTool,
  Hy3Client,
  InMemoryConversationMemory,
  ListDirTool,
  ReadFileTool,
  SearchProviderRegistry,
  ShellExecTool,
  WriteFileTool,
  BingSearchProvider,
  WsaSearchProvider,
  ToolRegistry,
  WebSearchTool,
} from '@kedouai/agent-core';
import { generalAssistantAgent } from './agents/general-assistant.agent';
import { deployAssistantAgent } from './agents/deploy-assistant.agent';
import { registerDeployTools, resolveMcpConfig } from './mcp/mcp-executor';

export interface Harness {
  clientRegistry: ClientRegistry;
  toolRegistry: ToolRegistry;
  agentRegistry: AgentRegistry;
  searchRegistry: SearchProviderRegistry;
  engine: AgentEngine;
  memory: InMemoryConversationMemory;
  /** 是否启用了 MCP 远程工具（配置了 MCP_GATEWAY_URL 才为 true） */
  mcpEnabled: boolean;
}

/** 确认器：交互式 CLI 注入，弹 [y/N] 确认框；非交互返回 false（默认拒绝） */
export type ConfirmHandler = (message: string) => Promise<boolean>;

export function buildHarness(confirmHandler?: ConfirmHandler): Harness {
  // 模型客户端
  const hy3 = new Hy3Client();
  const deepseek = new DeepseekClient();
  const clientRegistry = new ClientRegistry();
  clientRegistry.register(hy3);
  clientRegistry.register(deepseek);

  // 搜索 Provider（优先腾讯云 WSA，未配置则回退 Bing）
  const searchRegistry = new SearchProviderRegistry();
  searchRegistry.register(new WsaSearchProvider(), 5);
  searchRegistry.register(new BingSearchProvider(), 10);

  // 工具
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new WebSearchTool(searchRegistry));
  toolRegistry.register(new ListDirTool());
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new GrepSearchTool());
  toolRegistry.register(new WriteFileTool());
  toolRegistry.register(new ShellExecTool());

  // Agent（CLI 只集成通用问答智能体，其它场景的 agent 在服务端，不在此注册）
  const agentRegistry = new AgentRegistry();
  agentRegistry.register(generalAssistantAgent);

  // MCP 远程发布工具 + 发布助手（可选：配置 MCP_GATEWAY_URL 才启用）
  // 未配置时 CLI 完全不感知发布能力，其余工具不受影响
  const mcpConfig = resolveMcpConfig();
  if (mcpConfig) {
    registerDeployTools(toolRegistry, mcpConfig);
    agentRegistry.register(deployAssistantAgent);
  }

  // 记忆 + 引擎（注入 confirm）
  const compaction = new Compaction(clientRegistry);
  const memory = new InMemoryConversationMemory(compaction);
  const engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);

  return {
    clientRegistry,
    toolRegistry,
    agentRegistry,
    searchRegistry,
    engine,
    memory,
    mcpEnabled: !!mcpConfig,
  };
}
