import { Module, OnModuleInit, Logger, Provider } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConversationModule } from '../conversation/conversation.module';
import { ConversationMemory } from './memory/conversation-memory';
import { ImageGenTool } from './tools/image-gen.tool';
import { ImageGenClient } from '../common/http/image-gen.client';
import { studyAssistantAgent } from './agents/study-assistant.agent';
import { bianbianAgent } from './agents/bianbian.agent';
import {
  AgentEngine,
  AgentRunner,
  AgentRegistry,
  ClientRegistry,
  Compaction,
  Hy3Client,
  DeepseekClient,
  ToolRegistry,
} from '@kedou/agent-core';

/**
 * Agent harness 统一注册入口（收敛自 @kedou/agent-core）。
 * 引擎/注册表/客户端/摘要压缩均复用 agent-core（纯 TS），
 * 通过 useFactory 桥接进 Nest DI；ConversationMemory(DB 版) 与 ImageGenTool(生图) 为 ai-service 特有。
 */
const clientRegistryProvider: Provider = {
  provide: ClientRegistry,
  useFactory: (): ClientRegistry => {
    const registry = new ClientRegistry();
    registry.register(new Hy3Client());
    registry.register(new DeepseekClient());
    return registry;
  },
};

const toolRegistryProvider: Provider = {
  provide: ToolRegistry,
  useFactory: (): ToolRegistry => new ToolRegistry(),
};

const agentRegistryProvider: Provider = {
  provide: AgentRegistry,
  useFactory: (): AgentRegistry => new AgentRegistry(),
};

const compactionProvider: Provider = {
  provide: Compaction,
  useFactory: (clientRegistry: ClientRegistry): Compaction => new Compaction(clientRegistry),
  inject: [ClientRegistry],
};

const engineProvider: Provider = {
  provide: AgentEngine,
  useFactory: (
    clientRegistry: ClientRegistry,
    toolRegistry: ToolRegistry,
    agentRegistry: AgentRegistry,
    memory: ConversationMemory,
  ): AgentEngine => new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory),
  inject: [ClientRegistry, ToolRegistry, AgentRegistry, ConversationMemory],
};

const runnerProvider: Provider = {
  provide: AgentRunner,
  useFactory: (engine: AgentEngine): AgentRunner => new AgentRunner(engine),
  inject: [AgentEngine],
};

@Module({
  imports: [ConversationModule, HttpModule],
  providers: [
    clientRegistryProvider,
    toolRegistryProvider,
    agentRegistryProvider,
    compactionProvider,
    engineProvider,
    runnerProvider,
    // ai-service 特有
    ConversationMemory,
    ImageGenClient,
    ImageGenTool,
  ],
  exports: [AgentRunner, AgentEngine, ToolRegistry, AgentRegistry],
})
export class AgentModule implements OnModuleInit {
  private readonly logger = new Logger(AgentModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly imageGenTool: ImageGenTool,
  ) {}

  onModuleInit(): void {
    // 注册 ai-service 特有工具（生图）
    this.toolRegistry.register(this.imageGenTool);

    // 注册内置 Agent 定义
    this.agentRegistry.register(studyAssistantAgent);
    this.agentRegistry.register(bianbianAgent);

    this.logger.log('Agent harness（agent-core）工具与 Agent 定义注册完成');
  }
}
