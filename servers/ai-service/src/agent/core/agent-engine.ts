import { Injectable, Logger } from '@nestjs/common';
import { AgentDefinition } from '../interfaces/agent.interface';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';
import { ToolRegistry } from '../registry/tool.registry';
import { AgentRegistry } from '../registry/agent.registry';
import { ClientRegistry } from '../../common/client.registry';
import { ConversationMemoryPort } from '../memory/conversation-memory';
import { ChatMessage, ToolCall, ChatWithToolsResult } from '../../common/http/base-ai.client';

/**
 * Agent 运行引擎（ReAct 循环）。
 *
 * 核心流程：
 *   for step in 0..maxSteps:
 *     resp = client.chatWithTools(messages, toolSchemas, agent)
 *     if 无 toolCalls: yield final; return
 *     逐个执行工具 -> 回写 tool 消息 -> yield tool_call/tool_result
 */
@Injectable()
export class AgentEngine {
  private readonly logger = new Logger(AgentEngine.name);

  constructor(
    private readonly clientRegistry: ClientRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly memory: ConversationMemoryPort,
  ) {}

  async *run(input: RunInput, userId: string, runId: string): AsyncGenerator<StreamEvent> {
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

    // 2. 拼接本次运行的 messages
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

      // 3. 无工具调用 -> 最终回答
      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        // 落库记忆（含摘要压缩判断）
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

        const tool = this.toolRegistry.get(call.name);
        const result = await this.toolRegistry.execute(
          { name: call.name, args: this.parseArgs(call), id: call.id },
          { userId, runId, deps: {} },
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
        void tool;
      }
    }

    yield { type: 'error', content: `达到最大步数限制 (${agent.maxSteps})` };
    // 即使超步数也尽量保存已产生的消息
    await this.memory.persist(userId, currentConversationId, messages, agent.memory);
  }

  private parseArgs(call: ToolCall): Record<string, unknown> {
    try {
      return JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
