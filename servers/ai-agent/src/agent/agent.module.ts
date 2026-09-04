import { Module, OnModuleInit, OnModuleDestroy, Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgentEngine,
  AgentRunner,
  AgentRegistry,
  ClientRegistry,
  Compaction,
  Hy3Client,
  DeepseekClient,
  ToolRegistry,
  McpToolMeta,
  SkillLoader,
  SearchProviderRegistry,
  WsaSearchProvider,
  WebSearchTool,
  TokenHubClient,
} from '@kedouai/agent-core';
import { ContractRuleTool } from '../contract/tools/contract-rule.tool';
import { ContractIrrTool } from '../contract/tools/contract-irr.tool';
import { ContractCleanerTool } from '../contract/tools/contract-cleaner.tool';
import { ContractBenchmarkTool } from '../contract/tools/contract-benchmark.tool';
import { contractRiskAgent } from '../contract/agents/contract-risk.agent';
import { deployAgent } from '../deploy/agents/deploy.agent';
import { McpService } from '../mcp/mcp.service';
import { McpModule } from '../mcp/mcp.module';
import { AgentController } from './agent.controller';
import { DbConversationMemory } from './memory/db-conversation-memory';
import { AgentConversation } from './memory/agent-conversation.entity';
import { AgentRunPusher } from './agent-run-pusher';
import { AgentDefSyncService } from './agent-def-sync.service';
import { SkillModule } from '../skill/skill.module';
import { AgentSkillProvider } from '../skill/agent-skill-provider';

/**
 * Agent harness 统一注册入口（复用 @kedouai/agent-core）。
 * 引擎/注册表/客户端/记忆均复用 agent-core，通过 useFactory 桥接进 Nest DI。
 * 合同风险识别为第一个落地场景：ContractRuleTool + ContractIrrTool + contractRiskAgent。
 */

const clientRegistryProvider: Provider = {
  provide: ClientRegistry,
  useFactory: (configService: ConfigService): ClientRegistry => {
    const registry = new ClientRegistry();
    registry.register(new Hy3Client());
    registry.register(new DeepseekClient());

    // TokenHub 网关托管模型（model 可配，缺省 deepseek-v4-flash）
    // 例：TOKENHUB_MODELS=deepseek-v4-flash,deepseek-v4-pro-0813,glm-5.3
    const models = (configService.get<string>('TOKENHUB_MODELS', 'deepseek-v4-flash') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    for (const m of models) {
      if (seen.has(m)) continue;
      seen.add(m);
      registry.register(new TokenHubClient(m));
    }
    return registry;
  },
  inject: [ConfigService],
};

const toolRegistryProvider: Provider = {
  provide: ToolRegistry,
  useFactory: (): ToolRegistry => new ToolRegistry(),
};

/** 联网搜索 Provider（腾讯云 WSA，复用 OCR 同一对 TENCENT_SECRET_ID/KEY） */
const searchRegistryProvider: Provider = {
  provide: SearchProviderRegistry,
  useFactory: (): SearchProviderRegistry => {
    const registry = new SearchProviderRegistry();
    registry.register(new WsaSearchProvider(), 5);
    return registry;
  },
};

/** 通用问答用工具：web-search（联网搜索，安全；不开放文件/命令工具） */
const webSearchToolProvider: Provider = {
  provide: WebSearchTool,
  useFactory: (searchRegistry: SearchProviderRegistry): WebSearchTool =>
    new WebSearchTool(searchRegistry),
  inject: [SearchProviderRegistry],
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

// 数据库版记忆：多轮追问上下文落库到 agent_conversations，跨请求/跨重启保持
const engineProvider: Provider = {
  provide: AgentEngine,
  useFactory: (
    clientRegistry: ClientRegistry,
    toolRegistry: ToolRegistry,
    agentRegistry: AgentRegistry,
    memory: DbConversationMemory,
    skillProvider: AgentSkillProvider,
  ): AgentEngine =>
    new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory, new SkillLoader(skillProvider)),
  inject: [ClientRegistry, ToolRegistry, AgentRegistry, DbConversationMemory, AgentSkillProvider],
};

const runnerProvider: Provider = {
  provide: AgentRunner,
  useFactory: (engine: AgentEngine): AgentRunner => new AgentRunner(engine),
  inject: [AgentEngine],
};

@Module({
  imports: [McpModule, SkillModule, TypeOrmModule.forFeature([AgentConversation])],
  providers: [
    clientRegistryProvider,
    toolRegistryProvider,
    agentRegistryProvider,
    compactionProvider,
    engineProvider,
    runnerProvider,
    searchRegistryProvider,
    webSearchToolProvider,
    DbConversationMemory,
    AgentRunPusher,
    AgentDefSyncService,
    // 合同风险场景特有
    ContractRuleTool,
    ContractIrrTool,
    ContractCleanerTool,
    ContractBenchmarkTool,
  ],
  controllers: [AgentController],
  exports: [AgentRunner, AgentEngine, ToolRegistry, AgentRegistry, ClientRegistry, DbConversationMemory, Compaction],
})
export class AgentModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly contractRuleTool: ContractRuleTool,
    private readonly contractIrrTool: ContractIrrTool,
    private readonly contractCleanerTool: ContractCleanerTool,
    private readonly contractBenchmarkTool: ContractBenchmarkTool,
    private readonly mcpService: McpService,
    private readonly agentDefSync: AgentDefSyncService,
    private readonly webSearchTool: WebSearchTool,
  ) {}

  onModuleInit(): void {
    // 注册合同风险场景工具（确定性本地插件 + AI 清洗）
    this.toolRegistry.register(this.webSearchTool);
    this.toolRegistry.register(this.contractCleanerTool);
    this.toolRegistry.register(this.contractRuleTool);
    this.toolRegistry.register(this.contractIrrTool);
    this.toolRegistry.register(this.contractBenchmarkTool);

    // 注册代码内置 Agent 定义（upsert 兜底，幂等不抛重复）
    this.agentRegistry.upsert(contractRiskAgent);
    this.agentRegistry.upsert(deployAgent);

    // 演示"MCP 工具作为远程插件懒加载接入"（配置了 MCP_GATEWAY_URL 才生效）
    this.registerMcpTools();

    // 发布助手的 MCP 能力（publish_pipeline 为长任务，启用自动轮询）
    this.registerDeployMcpCapabilities();

    this.logger.log(
      'Agent harness（agent-core）工具与 Agent 定义注册完成: contract-risk, deploy',
    );

    // 再启动 DB 定义同步：用 published 定义覆盖本地（DB 优先），并开启 30s 轮询
    this.agentDefSync.start();
  }

  onModuleDestroy(): void {
    this.agentDefSync.stop();
  }

  /**
   * 注册发布助手的 MCP 能力。
   * publish_pipeline 声明了 longRunning，启用长任务插件后对 Agent 引擎表现为同步工具，
   * 引擎无需感知 jobId 轮询细节。
   */
  private registerDeployMcpCapabilities(): void {
    if (!this.mcpService.isAvailable()) {
      this.logger.warn('MCP 网关未配置（MCP_GATEWAY_URL），跳过发布助手 MCP 工具注册');
      return;
    }
    const runtimeConfig = (cap: { config?: Record<string, unknown> }) =>
      (cap.config ?? {}) as {
        longRunning?: boolean;
        maxWaitMs?: number;
        timeoutMs?: number;
        intervalMs?: number;
      };

    for (const cap of deployAgent.capabilities ?? []) {
      if (cap.type !== 'mcp' || cap.enabled === false) continue;
      const [module, tool] = cap.ref.split('/');
      if (!module || !tool || this.toolRegistry.has(tool)) continue;
      this.mcpService.registerMcpTool(
        this.toolRegistry,
        {
          name: tool,
          module,
          description: `MCP 远程工具 ${cap.ref}`,
          inputSchema: { type: 'object', properties: {} },
        },
        runtimeConfig(cap),
      );
    }
    this.logger.log('发布助手 MCP 能力注册完成（含长任务 publish_pipeline）');
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
