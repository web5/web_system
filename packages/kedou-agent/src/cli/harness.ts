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
  ToolRegistry,
  WebSearchTool,
} from '@kedouai/agent-core';
import { studyAssistantAgent } from './agents/study-assistant.agent';
import { devAssistantAgent } from './agents/dev-assistant.agent';
import { generalAssistantAgent } from './agents/general-assistant.agent';

export interface Harness {
  clientRegistry: ClientRegistry;
  toolRegistry: ToolRegistry;
  agentRegistry: AgentRegistry;
  searchRegistry: SearchProviderRegistry;
  engine: AgentEngine;
  memory: InMemoryConversationMemory;
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

  // 搜索 Provider（默认内置 Bing）
  const searchRegistry = new SearchProviderRegistry();
  searchRegistry.register(new BingSearchProvider(), 10);

  // 工具
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new WebSearchTool(searchRegistry));
  toolRegistry.register(new ListDirTool());
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new GrepSearchTool());
  toolRegistry.register(new WriteFileTool());
  toolRegistry.register(new ShellExecTool());

  // Agent
  const agentRegistry = new AgentRegistry();
  agentRegistry.register(studyAssistantAgent);
  agentRegistry.register(devAssistantAgent);
  agentRegistry.register(generalAssistantAgent);

  // 记忆 + 引擎（注入 confirm）
  const compaction = new Compaction(clientRegistry);
  const memory = new InMemoryConversationMemory(compaction);
  const engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);

  return { clientRegistry, toolRegistry, agentRegistry, searchRegistry, engine, memory };
}
