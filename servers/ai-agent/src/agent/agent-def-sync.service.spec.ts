import { ConfigService } from '@nestjs/config';
import { AgentRegistry, ToolRegistry } from '@kedouai/agent-core';
import { McpService } from '../mcp/mcp.service';
import { AgentDefSyncService } from './agent-def-sync.service';

/**
 * 回归：knowledge 工具的装配规则（开放决策 7 = C）。
 *
 * - 按集合操作的工具（knowledge_search/ingest/delete）：必须显式 config.collectionId，缺则跳过；
 * - 集合无关的工具（knowledge_list/status）：只要 agent 绑定 ≥1 个集合就应注册。
 *
 * 曾经的反例：knowledge_list 未配 collectionId 被一并跳过 → 运行时报「工具 knowledge_list 未注册」。
 */
describe('AgentDefSyncService.registerMcpCapabilities', () => {
  function setup(capabilities: Array<Record<string, unknown>>) {
    const configService = {
      get: (key: string, fallback?: string) =>
        key === 'AI_SERVICE_URL' ? 'http://ai-service.test' : fallback,
    } as unknown as ConfigService;
    const agentRegistry = { upsert: jest.fn() } as unknown as AgentRegistry;
    const toolRegistry = { has: jest.fn().mockReturnValue(false) } as unknown as ToolRegistry;
    const registerMcpTool = jest.fn();
    const mcpService = {
      isAvailable: () => true,
      registerMcpTool,
    } as unknown as McpService;

    const rows = [
      {
        id: 'web-system-dev',
        name: 'web_system 研发助手',
        systemPrompt: 'p',
        model: 'deepseek-v4-flash',
        capabilities,
      },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => rows,
    }) as unknown as typeof fetch;

    const svc = new AgentDefSyncService(configService, agentRegistry, toolRegistry, mcpService);
    return { svc, registerMcpTool };
  }

  function registeredNames(registerMcpTool: jest.Mock): string[] {
    return registerMcpTool.mock.calls.map((call) => (call[1] as { name: string }).name);
  }

  it('knowledge_list 无 config.collectionId，但 agent 已绑定集合 → 仍注册', async () => {
    const { svc, registerMcpTool } = setup([
      { type: 'mcp', ref: 'knowledge/knowledge_list', enabled: true },
      {
        type: 'mcp',
        ref: 'knowledge/knowledge_search',
        enabled: true,
        config: { collectionId: 'ws-arch' },
      },
    ]);

    await svc.sync();

    expect(registeredNames(registerMcpTool)).toEqual(['knowledge_list', 'knowledge_search']);
  });

  it('agent 未绑定任何集合 → 集合无关的知识工具也不注册', async () => {
    const { svc, registerMcpTool } = setup([
      { type: 'mcp', ref: 'knowledge/knowledge_list', enabled: true },
    ]);

    await svc.sync();

    expect(registerMcpTool).not.toHaveBeenCalled();
  });

  it('按集合操作的工具缺 config.collectionId → 跳过（装配错误，不静默放行）', async () => {
    const { svc, registerMcpTool } = setup([
      { type: 'mcp', ref: 'knowledge/knowledge_search', enabled: true },
      { type: 'mcp', ref: 'knowledge/knowledge_list', enabled: true },
    ]);

    await svc.sync();

    expect(registeredNames(registerMcpTool)).toEqual([]);
  });

  it('非 knowledge 模块的 MCP 能力不受集合绑定约束', async () => {
    const { svc, registerMcpTool } = setup([
      { type: 'mcp', ref: 'deploy/list_modules', enabled: true },
    ]);

    await svc.sync();

    expect(registeredNames(registerMcpTool)).toEqual(['list_modules']);
  });
});
