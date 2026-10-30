import { AgentEngine } from './agent-engine';
import { ToolRegistry } from '../registry/tool.registry';
import { AgentRegistry } from '../registry/agent.registry';
import { ClientRegistry } from '../registry/client.registry';
import { ConversationMemoryPort } from '../memory/memory-port';
import { AgentDefinition } from '../interfaces/agent.interface';
import { ChatWithToolsResult, ChatMessage, ToolCall, ToolCallSchema, ChatOptions } from '../clients/base-ai.client';

/**
 * 用 chatWithTools mock 构造一个兼容流式的 client mock。
 * 引擎当前调用 client.chatWithToolsStream(...)，此处模拟基类默认实现：
 * 委托给 chatWithTools，结果以 content_delta + done 事件流式产出。
 */
function makeStreamingClient(
  chatWithTools: jest.Mock<Promise<ChatWithToolsResult>>,
): {
  chatWithTools: jest.Mock<Promise<ChatWithToolsResult>>;
  chatWithToolsStream: (
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ) => AsyncGenerator<{ type: 'content_delta' | 'done'; delta?: string; result?: ChatWithToolsResult }, void, unknown>;
} {
  return {
    chatWithTools,
    async *chatWithToolsStream(messages, tools, options) {
      const result = await chatWithTools(messages, tools, options);
      if (result.content) yield { type: 'content_delta', delta: result.content };
      yield { type: 'done', result };
    },
  };
}

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'test-agent',
    name: '测试',
    systemPrompt: '你是测试 Agent',
    model: 'hy3',
    tools: ['calc'],
    maxSteps: 5,
    memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
    ...overrides,
  };
}

describe('AgentEngine (agent-core)', () => {
  let toolRegistry: jest.Mocked<ToolRegistry>;
  let agentRegistry: jest.Mocked<AgentRegistry>;
  let clientRegistry: jest.Mocked<ClientRegistry>;
  let memory: jest.Mocked<ConversationMemoryPort>;
  let engine: AgentEngine;

  beforeEach(() => {
    toolRegistry = { toSchemas: jest.fn().mockResolvedValue([]), execute: jest.fn() } as any;
    agentRegistry = { get: jest.fn() } as any;
    clientRegistry = { getOrFallback: jest.fn() } as any;
    memory = {
      load: jest.fn().mockResolvedValue({ summary: null, messages: [] }),
      persist: jest.fn().mockResolvedValue('conv-1'),
    } as any;
    engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);
  });

  it('无 toolCalls 时直接返回 final 并落库记忆', async () => {
    const agent = makeAgent();
    agentRegistry.get.mockReturnValue(agent);
    const client = makeStreamingClient(
      jest.fn().mockResolvedValue({
        content: '你好',
        toolCalls: [],
        assistantMessage: { role: 'assistant', content: '你好' },
      } as unknown as ChatWithToolsResult),
    );
    clientRegistry.getOrFallback.mockReturnValue(client as any);

    const events: any[] = [];
    for await (const e of engine.run({ agentId: 'test-agent', userInput: 'hi' }, 'u1', 'r1')) events.push(e);

    expect(events).toContainEqual(expect.objectContaining({ type: 'final', content: '你好', step: 0, conversationId: 'conv-1' }));
    expect(memory.persist).toHaveBeenCalledTimes(1);
  });

  it('有 toolCalls 时执行工具并回写 tool 消息后继续', async () => {
    const agent = makeAgent();
    agentRegistry.get.mockReturnValue(agent);
    const firstCall: ToolCall = { id: 't1', name: 'calc', arguments: '{"x":1}' };
    const client = makeStreamingClient(
      jest
        .fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [firstCall],
          assistantMessage: { role: 'assistant', content: '', toolCalls: [firstCall] },
        } as unknown as ChatWithToolsResult)
        .mockResolvedValueOnce({
          content: '结果是 2',
          toolCalls: [],
          assistantMessage: { role: 'assistant', content: '结果是 2' },
        } as unknown as ChatWithToolsResult),
    );
    clientRegistry.getOrFallback.mockReturnValue(client as any);
    toolRegistry.execute.mockResolvedValue({ success: true, content: '2' });

    const events: any[] = [];
    for await (const e of engine.run({ agentId: 'test-agent', userInput: '1+1' }, 'u1', 'r1')) events.push(e);

    expect(toolRegistry.execute).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'calc')).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'final', content: '结果是 2' }));
  });

  it('超过 maxSteps 时熔断并返回 error', async () => {
    const agent = makeAgent({ maxSteps: 2 });
    agentRegistry.get.mockReturnValue(agent);
    const call: ToolCall = { id: 't', name: 'calc', arguments: '{}' };
    const client = makeStreamingClient(
      jest.fn().mockResolvedValue({
        content: '',
        toolCalls: [call],
        assistantMessage: { role: 'assistant', content: '', toolCalls: [call] },
      } as unknown as ChatWithToolsResult),
    );
    clientRegistry.getOrFallback.mockReturnValue(client as any);
    toolRegistry.execute.mockResolvedValue({ success: true, content: '1' });

    const events: any[] = [];
    for await (const e of engine.run({ agentId: 'test-agent', userInput: 'loop' }, 'u1', 'r1')) events.push(e);

    expect(events.some((e) => e.type === 'error' && e.content.includes('最大步数'))).toBe(true);
  });

  describe('TC-G4 runId 透出（N5 补齐回归 #254）', () => {
    it('TC-G4-02: final 帧携带 runId', async () => {
      const agent = makeAgent();
      agentRegistry.get.mockReturnValue(agent);
      const client = makeStreamingClient(
        jest.fn().mockResolvedValue({
          content: '你好',
          toolCalls: [],
          assistantMessage: { role: 'assistant', content: '你好' },
        } as unknown as ChatWithToolsResult),
      );
      clientRegistry.getOrFallback.mockReturnValue(client as any);

      const events: any[] = [];
      for await (const e of engine.run({ agentId: 'test-agent', userInput: 'hi' }, 'u1', 'tc-g4-02-run')) events.push(e);

      const finalEvent = events.find((e) => e.type === 'final');
      expect(finalEvent).toBeDefined();
      expect(finalEvent.runId).toBe('tc-g4-02-run');
    });

    it('TC-G4-03: error 帧携带 runId（模型异常路径）', async () => {
      const agent = makeAgent();
      agentRegistry.get.mockReturnValue(agent);
      const client = makeStreamingClient(jest.fn().mockRejectedValue(new Error('API down')));
      clientRegistry.getOrFallback.mockReturnValue(client as any);

      const events: any[] = [];
      for await (const e of engine.run({ agentId: 'test-agent', userInput: 'hi' }, 'u1', 'tc-g4-03-run')) events.push(e);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.runId).toBe('tc-g4-03-run');
    });

    it('TC-G4-03b: error 帧携带 runId（maxSteps 熔断路径）', async () => {
      const agent = makeAgent({ maxSteps: 1 });
      agentRegistry.get.mockReturnValue(agent);
      const call: ToolCall = { id: 't', name: 'calc', arguments: '{}' };
      const client = makeStreamingClient(
        jest.fn().mockResolvedValue({
          content: '',
          toolCalls: [call],
          assistantMessage: { role: 'assistant', content: '', toolCalls: [call] },
        } as unknown as ChatWithToolsResult),
      );
      clientRegistry.getOrFallback.mockReturnValue(client as any);
      toolRegistry.execute.mockResolvedValue({ success: true, content: '1' });

      const events: any[] = [];
      for await (const e of engine.run({ agentId: 'test-agent', userInput: 'loop' }, 'u1', 'tc-g4-03b-run')) events.push(e);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.runId).toBe('tc-g4-03b-run');
    });
  });

  describe('TelemetryPort（Phase2.1）', () => {
    it('注入 telemetry 时，run 触发 onRunStart / onLlmSpan / onRunEnd（无工具直接回答）', async () => {
      const agent = makeAgent();
      agentRegistry.get.mockReturnValue(agent);
      const client = makeStreamingClient(
        jest.fn().mockResolvedValue({
          content: '你好',
          toolCalls: [],
          assistantMessage: { role: 'assistant', content: '你好' },
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } as unknown as ChatWithToolsResult),
      );
      clientRegistry.getOrFallback.mockReturnValue(client as any);

      const tel = {
        onRunStart: jest.fn(),
        onLlmSpan: jest.fn(),
        onToolSpan: jest.fn(),
        onSkillLoad: jest.fn(),
        onRunEnd: jest.fn(),
      };
      const telemetryEngine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory, undefined, tel as any);

      const events: any[] = [];
      for await (const e of telemetryEngine.run({ agentId: 'test-agent', userInput: 'hi' }, 'u1', 'r1')) events.push(e);

      expect(tel.onRunStart).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'r1', agentId: 'test-agent', userId: 'u1', model: 'hy3' }),
      );
      expect(tel.onLlmSpan).toHaveBeenCalledTimes(1);
      expect(tel.onLlmSpan).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'r1', operation: 'chat_with_tools', inputTokens: 10, outputTokens: 5 }),
      );
      expect(tel.onToolSpan).not.toHaveBeenCalled();
      expect(tel.onRunEnd).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r1', status: 'ok', totalTokens: 15 }));
    });

    it('工具执行后触发 onToolSpan（含失败信息）', async () => {
      const agent = makeAgent();
      agentRegistry.get.mockReturnValue(agent);
      const call: ToolCall = { id: 't1', name: 'calc', arguments: '{}' };
      const client = makeStreamingClient(
        jest
          .fn()
          .mockResolvedValueOnce({
            content: '',
            toolCalls: [call],
            assistantMessage: { role: 'assistant', content: '', toolCalls: [call] },
          } as unknown as ChatWithToolsResult)
          .mockResolvedValueOnce({
            content: 'ok',
            toolCalls: [],
            assistantMessage: { role: 'assistant', content: 'ok' },
          } as unknown as ChatWithToolsResult),
      );
      clientRegistry.getOrFallback.mockReturnValue(client as any);
      toolRegistry.execute.mockResolvedValue({ success: false, content: '', error: '工具爆炸' });

      const tel = { onRunStart: jest.fn(), onLlmSpan: jest.fn(), onToolSpan: jest.fn(), onSkillLoad: jest.fn(), onRunEnd: jest.fn() };
      const telemetryEngine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory, undefined, tel as any);

      const events: any[] = [];
      for await (const e of telemetryEngine.run({ agentId: 'test-agent', userInput: 'x' }, 'u1', 'r2')) events.push(e);

      expect(tel.onToolSpan).toHaveBeenCalledTimes(1);
      expect(tel.onToolSpan).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'r2', tool: 'calc', ok: false, error: '工具爆炸' }),
      );
    });
  });
});

describe('AgentEngine 生成参数分层透传（D1 O2-A）', () => {
  let toolRegistry: jest.Mocked<ToolRegistry>;
  let agentRegistry: jest.Mocked<AgentRegistry>;
  let clientRegistry: jest.Mocked<ClientRegistry>;
  let memory: jest.Mocked<ConversationMemoryPort>;
  let engine: AgentEngine;

  beforeEach(() => {
    toolRegistry = { toSchemas: jest.fn().mockResolvedValue([]), execute: jest.fn() } as any;
    agentRegistry = { get: jest.fn() } as any;
    clientRegistry = { getOrFallback: jest.fn() } as any;
    memory = {
      load: jest.fn().mockResolvedValue({ summary: null, messages: [] }),
      persist: jest.fn().mockResolvedValue('conv-1'),
    } as any;
    engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);
  });

  it('agent.thinking → agentThinking（P3）、runInput.thinking → thinking（P2），不预合并', async () => {
    const agent = makeAgent({
      tools: [],
      thinking: { type: 'disabled' },
    });
    agentRegistry.get.mockReturnValue(agent);
    const chatWithTools = jest.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
      assistantMessage: { role: 'assistant', content: 'ok' },
    } as unknown as ChatWithToolsResult);
    const client = makeStreamingClient(chatWithTools);
    clientRegistry.getOrFallback.mockReturnValue(client as any);

    const runInput = {
      agentId: 'test-agent',
      userInput: 'hi',
      thinking: { type: 'enabled' as const, budget_tokens: 12 },
    };
    for await (const _e of engine.run(runInput, 'u1', 'r1')) {
      // drain
    }

    expect(chatWithTools).toHaveBeenCalledTimes(1);
    const options = chatWithTools.mock.calls[0][2] as ChatOptions;
    // 分层收参：两层各自保留，引擎不把 runInput.thinking 合进 agentThinking
    expect(options.agentThinking).toEqual({ type: 'disabled' });
    expect(options.thinking).toEqual({ type: 'enabled', budget_tokens: 12 });
  });

  it('agent.thinking 为 null 时不设置 agentThinking（未配置 → 走优先级链下层）', async () => {
    const agent = makeAgent({ tools: [], thinking: null });
    agentRegistry.get.mockReturnValue(agent);
    const chatWithTools = jest.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
      assistantMessage: { role: 'assistant', content: 'ok' },
    } as unknown as ChatWithToolsResult);
    clientRegistry.getOrFallback.mockReturnValue(makeStreamingClient(chatWithTools) as any);

    for await (const _e of engine.run({ agentId: 'test-agent', userInput: 'hi' }, 'u1', 'r1')) {
      // drain
    }
    const options = chatWithTools.mock.calls[0][2] as ChatOptions;
    expect(options).not.toHaveProperty('agentThinking');
    expect(options).not.toHaveProperty('thinking');
  });
});
