import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { ClientRegistry } from '../../common/client.registry';
import { Hy3Client } from '../../common/http/hy3.client';
import { DeepseekClient } from '../../common/http/deepseek.client';
import { ImageGenClient } from '../../common/http/image-gen.client';
import { ToolRegistry } from '../registry/tool.registry';
import { AgentRegistry } from '../registry/agent.registry';
import { AgentEngine } from '../core/agent-engine';
import { Compaction } from '../memory/compaction';
import { InMemoryConversationMemory } from '../memory/in-memory-conversation-memory';
import { ImageGenTool } from '../tools/image-gen.tool';
import { CalculatorTool } from '../tools/calculator.tool';
import { WebSearchTool } from '../tools/web-search.tool';
import { studyAssistantAgent } from '../agents/study-assistant.agent';
import { bianbianAgent } from '../agents/bianbian.agent';

/**
 * 装配独立运行的 Agent harness（不依赖 Nest 容器与数据库），供 shell CLI / 测试使用。
 */
export function buildStandaloneHarness() {
  const httpService = new HttpService(axios.create());

  const hy3 = new Hy3Client(httpService);
  const deepseek = new DeepseekClient(httpService);
  const imageGen = new ImageGenClient(httpService);

  const clientRegistry = new ClientRegistry(hy3, deepseek);
  clientRegistry.register(hy3);
  clientRegistry.register(deepseek);

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new ImageGenTool(imageGen));
  toolRegistry.register(new CalculatorTool());
  toolRegistry.register(new WebSearchTool());

  const agentRegistry = new AgentRegistry();
  agentRegistry.register(studyAssistantAgent);
  agentRegistry.register(bianbianAgent);

  const compaction = new Compaction(clientRegistry);
  const memory = new InMemoryConversationMemory(compaction);
  const engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);

  return { clientRegistry, toolRegistry, agentRegistry, engine, memory };
}
