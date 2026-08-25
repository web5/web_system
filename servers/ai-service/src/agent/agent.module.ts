import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ClientRegistry } from '../common/client.registry';
import { ConversationModule } from '../conversation/conversation.module';
import { ToolRegistry } from './registry/tool.registry';
import { AgentRegistry } from './registry/agent.registry';
import { AgentEngine } from './core/agent-engine';
import { AgentRunner } from './core/agent-runner';
import { ConversationMemory } from './memory/conversation-memory';
import { Compaction } from './memory/compaction';
import { ImageGenTool } from './tools/image-gen.tool';
import { CalculatorTool } from './tools/calculator.tool';
import { WebSearchTool } from './tools/web-search.tool';
import { studyAssistantAgent } from './agents/study-assistant.agent';
import { bianbianAgent } from './agents/bianbian.agent';

/**
 * Agent harness 统一注册入口。
 * 内置工具与 Agent 定义在此集中注册，禁止各 service 自行散落 new 工具。
 */
@Module({
  imports: [ConversationModule],
  providers: [
    ClientRegistry,
    ToolRegistry,
    AgentRegistry,
    Compaction,
    AgentEngine,
    AgentRunner,
    ConversationMemory,
    // 内置工具
    ImageGenTool,
    CalculatorTool,
    WebSearchTool,
  ],
  exports: [AgentRunner, AgentEngine, ToolRegistry, AgentRegistry],
})
export class AgentModule implements OnModuleInit {
  private readonly logger = new Logger(AgentModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly imageGenTool: ImageGenTool,
    private readonly calculatorTool: CalculatorTool,
    private readonly webSearchTool: WebSearchTool,
  ) {}

  onModuleInit(): void {
    // 注册内置工具
    this.toolRegistry.register(this.imageGenTool);
    this.toolRegistry.register(this.calculatorTool);
    this.toolRegistry.register(this.webSearchTool);

    // 注册内置 Agent 定义
    this.agentRegistry.register(studyAssistantAgent);
    this.agentRegistry.register(bianbianAgent);

    this.logger.log('Agent harness 工具与 Agent 定义注册完成');
  }
}
