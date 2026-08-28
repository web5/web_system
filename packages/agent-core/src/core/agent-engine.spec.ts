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
      } as ChatWithToolsResult),
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
        } as ChatWithToolsResult)
        .mockResolvedValueOnce({
          content: '结果是 2',
          toolCalls: [],
          assistantMessage: { role: 'assistant', content: '结果是 2' },
        } as ChatWithToolsResult),
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
      } as ChatWithToolsResult),
    );
    clientRegistry.getOrFallback.mockReturnValue(client as any);
    toolRegistry.execute.mockResolvedValue({ success: true, content: '1' });

    const events: any[] = [];
    for await (const e of engine.run({ agentId: 'test-agent', userInput: 'loop' }, 'u1', 'r1')) events.push(e);

    expect(events.some((e) => e.type === 'error' && e.content.includes('最大步数'))).toBe(true);
  });
});
