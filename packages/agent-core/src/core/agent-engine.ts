/**
 * Agent 运行引擎（ReAct 循环）。
 *
 * 流程：system + 历史摘要 + 近期消息 + user → 模型推理(tools) → 有 toolCalls 则执行并回写 → 无则 final。
 */
import { AgentDefinition } from '../interfaces/agent.interface';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';
import { ToolRegistry } from '../registry/tool.registry';
import { AgentRegistry } from '../registry/agent.registry';
import { ClientRegistry } from '../registry/client.registry';
import { ConversationMemoryPort } from '../memory/memory-port';
import { ChatMessage, ToolCall, ChatWithToolsResult } from '../clients/base-ai.client';
import { Logger } from '../lib/logger';

export class AgentEngine {
  private readonly logger = new Logger(AgentEngine.name);

  constructor(
    private readonly clientRegistry: ClientRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly memory: ConversationMemoryPort,
  ) {}

  async *run(
    input: RunInput,
    userId: string,
    runId: string,
    confirmHandler?: (message: string) => Promise<boolean>,
  ): AsyncGenerator<StreamEvent> {
    const agent = this.agentRegistry.get(input.agentId);
    const client = this.clientRegistry.getOrFallback(agent.model);

    // 1. 加载历史记忆（摘要 + 近期消息）
    let conversationId = input.conversationId;
    let historyMessages: ChatMessage[] = [];
    if (conversationId) {
      const loaded = await this.memory.load(userId, conversationId);
      historyMessages = loaded.messages;
      if (loaded.summary) {
        historyMessages = [
          { role: 'system', content: `[对话历史摘要]\n${loaded.summary}` },
          ...historyMessages,
        ];
      }
    }

    // 2. 拼接 messages
    const messages: ChatMessage[] = [
      { role: 'system', content: agent.systemPrompt },
      ...historyMessages,
      { role: 'user', content: input.userInput },
    ];

    const toolSchemas = this.toolRegistry.toSchemas(agent.tools);
    let currentConversationId = conversationId;

    for (let step = 0; step < agent.maxSteps; step++) {
      let resp: ChatWithToolsResult;
      try {
        resp = await client.chatWithTools(messages, toolSchemas, {
          temperature: agent.temperature,
        });
      } catch (error) {
        this.logger.error(`Agent ${agent.id} 模型调用失败: ${(error as Error).message}`);
        yield { type: 'error', content: `模型调用失败: ${(error as Error).message}` };
        return;
      }

      messages.push(resp.assistantMessage);

      // 3. 无工具调用 -> 最终回答（落库记忆）
      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        currentConversationId = await this.memory.persist(
          userId,
          currentConversationId,
          messages,
          agent.memory,
        );
        yield { type: 'final', content: resp.content, step, conversationId: currentConversationId };
        return;
      }

      // 4. 执行工具并回写
      for (const call of resp.toolCalls) {
        yield { type: 'tool_call', name: call.name, args: this.parseArgs(call), step };

        const result = await this.toolRegistry.execute(
          { name: call.name, args: this.parseArgs(call), id: call.id },
          { userId, runId, deps: {}, confirm: confirmHandler },
        );

        yield {
          type: 'tool_result',
          name: call.name,
          content: result.success ? result.content : `工具执行失败: ${result.error}`,
          step,
        };

        messages.push({
          role: 'tool',
          content: result.success ? result.content : `工具执行失败: ${result.error ?? '未知错误'}`,
          toolCallId: call.id,
        });
      }
    }

    // 超过 maxSteps：尽量保存已产生消息再报错
    await this.memory.persist(userId, currentConversationId, messages, agent.memory);
    yield { type: 'error', content: `达到最大步数限制 (${agent.maxSteps})` };
  }

  private parseArgs(call: ToolCall): Record<string, unknown> {
    try {
      return JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
