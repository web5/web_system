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
  McpToolMeta,
} from '@kedou-ai/agent-core';
import { ContractRuleTool } from '../contract/tools/contract-rule.tool';
import { ContractIrrTool } from '../contract/tools/contract-irr.tool';
import { ContractCleanerTool } from '../contract/tools/contract-cleaner.tool';
import { contractRiskAgent } from '../contract/agents/contract-risk.agent';
import { McpService } from '../mcp/mcp.service';
import { McpModule } from '../mcp/mcp.module';
import { AgentController } from './agent.controller';

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
  imports: [McpModule],
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
    ContractCleanerTool,
  ],
  controllers: [AgentController],
  exports: [AgentRunner, AgentEngine, ToolRegistry, AgentRegistry, ClientRegistry, InMemoryConversationMemory, Compaction],
})
export class AgentModule implements OnModuleInit {
  private readonly logger = new Logger(AgentModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly contractRuleTool: ContractRuleTool,
    private readonly contractIrrTool: ContractIrrTool,
    private readonly contractCleanerTool: ContractCleanerTool,
    private readonly mcpService: McpService,
  ) {}

  onModuleInit(): void {
    // 注册合同风险场景工具（确定性本地插件 + AI 清洗）
    this.toolRegistry.register(this.contractCleanerTool);
    this.toolRegistry.register(this.contractRuleTool);
    this.toolRegistry.register(this.contractIrrTool);

    // 注册 Agent 定义
    this.agentRegistry.register(contractRiskAgent);

    // 演示"MCP 工具作为远程插件懒加载接入"（配置了 MCP_GATEWAY_URL 才生效）
    this.registerMcpTools();

    this.logger.log(
      'Agent harness（agent-core）工具与 Agent 定义注册完成: contract-risk',
    );
  }

  /** 通过 MCP 接入远程工具（懒加载，作为"一切皆插件"的演示） */
  private registerMcpTools(): void {
    if (!this.mcpService.isAvailable()) {
      this.logger.warn('MCP 网关未配置（MCP_GATEWAY_URL），跳过 MCP 工具注册');
      return;
    }

    // 示例：接入一个 MCP 暴露的合同法规查询工具（懒加载）
    const lawSearchMeta: McpToolMeta = {
      name: 'law-search',
      description: '查询合同相关法律法规条文（MCP 远程工具示例）',
      module: 'contract_risk',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '要查询的法律关键词', required: true },
        },
        required: ['keyword'],
      },
    };
    this.mcpService.registerMcpTool(this.toolRegistry, lawSearchMeta);
    this.logger.log('MCP 远程工具已注册（懒加载）: law-search');
  }
}
