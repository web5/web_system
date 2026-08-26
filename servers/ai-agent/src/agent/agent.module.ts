import { Module, OnModuleInit, Logger, Provider } from '@nestjs/common';
import {
  AgentEngine,
  AgentRunner,
  AgentRegistry,
  ClientRegistry,
  Compaction,
  Hy3Client,
  DeepseekClient,
  ToolRegistry,
  InMemoryConversationMemory,
} from '@kedou-ai/agent-core';
import { ContractRuleTool } from '../contract/tools/contract-rule.tool';
import { ContractIrrTool } from '../contract/tools/contract-irr.tool';
import { contractRiskAgent } from '../contract/agents/contract-risk.agent';

/**
 * Agent harness 统一注册入口（复用 @kedou-ai/agent-core）。
 * 引擎/注册表/客户端/记忆均复用 agent-core，通过 useFactory 桥接进 Nest DI。
 * 合同风险识别为第一个落地场景：ContractRuleTool + ContractIrrTool + contractRiskAgent。
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

// 内存版记忆（合同风险为一次性分析，MVP 阶段无需 DB 持久化多轮记忆）
const memoryProvider: Provider = {
  provide: InMemoryConversationMemory,
  useFactory: (compaction: Compaction): InMemoryConversationMemory => {
    return new InMemoryConversationMemory(compaction);
  },
  inject: [Compaction],
};

const engineProvider: Provider = {
  provide: AgentEngine,
  useFactory: (
    clientRegistry: ClientRegistry,
    toolRegistry: ToolRegistry,
    agentRegistry: AgentRegistry,
    memory: InMemoryConversationMemory,
  ): AgentEngine => new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory),
  inject: [ClientRegistry, ToolRegistry, AgentRegistry, InMemoryConversationMemory],
};

const runnerProvider: Provider = {
  provide: AgentRunner,
  useFactory: (engine: AgentEngine): AgentRunner => new AgentRunner(engine),
  inject: [AgentEngine],
};

@Module({
  providers: [
    clientRegistryProvider,
    toolRegistryProvider,
    agentRegistryProvider,
    compactionProvider,
    memoryProvider,
    engineProvider,
    runnerProvider,
    // 合同风险场景特有
    ContractRuleTool,
    ContractIrrTool,
  ],
  exports: [AgentRunner, AgentEngine, ToolRegistry, AgentRegistry],
})
export class AgentModule implements OnModuleInit {
  private readonly logger = new Logger(AgentModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly contractRuleTool: ContractRuleTool,
    private readonly contractIrrTool: ContractIrrTool,
  ) {}

  onModuleInit(): void {
    // 注册合同风险场景工具
    this.toolRegistry.register(this.contractRuleTool);
    this.toolRegistry.register(this.contractIrrTool);

    // 注册 Agent 定义
    this.agentRegistry.register(contractRiskAgent);

    this.logger.log(
      'Agent harness（agent-core）工具与 Agent 定义注册完成: contract-risk',
    );
  }
}
