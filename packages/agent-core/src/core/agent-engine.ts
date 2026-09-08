/**
 * Agent 运行引擎（ReAct 循环）。
 *
 * 流程：system + 历史摘要 + 近期消息 + user → 模型推理(tools) → 有 toolCalls 则执行并回写 → 无则 final。
 *
 * Skill（on-demand 挂载）：
 * - 运行时不注入技能全文，只注入「技能目录」（code + description 摘要）
 * - 内置工具 load_skill（固定命名，不进 ToolRegistry，避免全局单例跨 Agent 冲突）
 * - 模型判断需要时调 load_skill(code) → 返回 SKILL.md 全文作为 tool_result
 * - 同一 run 内已加载技能去重（Set），重复调用返回提示，避免 token 浪费
 */
import { AgentDefinition } from '../interfaces/agent.interface';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';
import { ToolRegistry } from '../registry/tool.registry';
import { AgentRegistry } from '../registry/agent.registry';
import { ClientRegistry } from '../registry/client.registry';
import { ConversationMemoryPort } from '../memory/memory-port';
import { ChatMessage, ToolCall, ChatWithToolsResult } from '../clients/base-ai.client';
import { ToolSchema } from '../interfaces/tool.interface';
import { SkillLoader } from '../skills/skill-loader';
import { Logger } from '../lib/logger';

/** 内置技能加载工具名（固定命名，用户已确认） */
export const LOAD_SKILL_TOOL_NAME = 'load_skill';

/** load_skill 的工具 schema（仅当 Agent 挂载技能时追加） */
const LOAD_SKILL_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: LOAD_SKILL_TOOL_NAME,
    description:
      '加载已挂载技能的完整规范（Markdown 行为守则：工作流、门禁、工具用法、错误处理）。调用后严格按规范执行。参数 code 为技能标识。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '技能 code，如 web-system-finnews' },
      },
      required: ['code'],
    },
  },
};

export class AgentEngine {
  private readonly logger = new Logger(AgentEngine.name);
  /** 本次 run 已加载的技能（去重，每次 run 重置） */
  private readonly loadedSkills = new Set<string>();

  constructor(
    private readonly clientRegistry: ClientRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly memory: ConversationMemoryPort,
    private readonly skillLoader?: SkillLoader,
  ) {}

  async *run(
    input: RunInput,
    userId: string,
    runId: string,
    confirmHandler?: (message: string) => Promise<boolean>,
  ): AsyncGenerator<StreamEvent> {
    const agent = this.agentRegistry.get(input.agentId);
    // 允许本次运行临时覆盖模型（Playground 调试/多模型对比用）
    const client = this.clientRegistry.getOrFallback(input.model || agent.model);
    this.loadedSkills.clear();

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

    // 2. 拼接 messages（有技能 → 注入技能目录）
    const hasSkills = this.hasSkills(agent);
    let systemPrompt = agent.systemPrompt;
    if (hasSkills && this.skillLoader) {
      const catalog = this.skillLoader.toCatalog(agent.skills);
      if (catalog) systemPrompt = `${systemPrompt}\n${catalog}`;
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: input.userInput },
    ];

    // 3. 工具 schema（挂技能时追加 load_skill）
    const toolSchemas = await this.toolRegistry.toSchemas(agent.tools);
    if (hasSkills) toolSchemas.push(LOAD_SKILL_SCHEMA);
    let currentConversationId = conversationId;

    // 累计本轮对话的 token 消耗（来自大模型返回的 usage）
    let accPrompt = 0;
    let accCompletion = 0;
    const addUsage = (u: ChatWithToolsResult['usage']): void => {
      if (!u) return;
      accPrompt += u.promptTokens;
      accCompletion += u.completionTokens;
    };
    // 本轮已执行的工具调用名（用于多步工具链完成后的 summary 总结事件）
    const toolSteps: string[] = [];

    for (let step = 0; step < agent.maxSteps; step++) {
      let resp: ChatWithToolsResult | undefined;
      let streamedContent = '';
      try {
        for await (const ev of client.chatWithToolsStream(messages, toolSchemas, {
          temperature: agent.temperature,
        })) {
          if (ev.type === 'content_delta' && ev.delta) {
            streamedContent += ev.delta;
            // 流式透传：模型正在生成最终回答内容，边生成边推给前端逐字渲染
            // streaming=false 时只累积不推送，最终回答一次性输出
            if (agent.streaming !== false) {
              yield { type: 'content_delta', content: ev.delta, step };
            }
          } else if (ev.type === 'done' && ev.result) {
            resp = ev.result;
          }
        }
      } catch (error) {
        this.logger.error(`Agent ${agent.id} 模型调用失败: ${(error as Error).message}`);
        yield {
          type: 'error',
          content: `模型调用失败: ${(error as Error).message}`,
          usage: usageOf(accPrompt, accCompletion),
        };
        return;
      }
      if (!resp) {
        yield { type: 'error', content: '模型未返回结果' };
        return;
      }
      addUsage(resp.usage);

      messages.push(resp.assistantMessage);

      // 4. 无工具调用 -> 最终回答（落库记忆）
      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        currentConversationId = await this.memory.persist(
          userId,
          currentConversationId,
          messages,
          agent.memory,
        );
        // 非流式模式：最终回答一次性输出（客户端仍按消息渲染）
        if (agent.streaming === false && streamedContent) {
          yield { type: 'content_delta', content: streamedContent, step };
        }
        // 多步工具链完成：发 summary 总结事件（前端渲染为过程卡片）
        if (toolSteps.length) {
          const finalText = (resp.content || '').replace(/\s+/g, ' ').trim();
          const finalPreview = finalText.slice(0, 150);
          const ellipsis = finalText.length > 150 ? '…' : '';
          yield {
            type: 'summary',
            content: `已完成 ${toolSteps.length} 步工具调用：${toolSteps.join(' → ')}。\n结论预览：${finalPreview}${ellipsis}`,
            step,
            usage: usageOf(accPrompt, accCompletion),
          };
        }
        yield {
          type: 'final',
          content: resp.content,
          step,
          conversationId: currentConversationId,
          usage: usageOf(accPrompt, accCompletion),
        };
        return;
      }

      // 5. 执行工具并回写（load_skill 走引擎内置逻辑，其余走 ToolRegistry）
      for (const call of resp.toolCalls) {
        const args = this.parseArgs(call);
        toolSteps.push(call.name);
        yield { type: 'tool_call', name: call.name, args, step };

        if (call.name === LOAD_SKILL_TOOL_NAME && this.skillLoader) {
          const events = await this.handleLoadSkill(call, args, step, messages);
          for (const ev of events) yield ev;
          continue;
        }

        const result = await this.toolRegistry.execute(
          { name: call.name, args, id: call.id },
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
    yield {
      type: 'error',
      content: `达到最大步数限制 (${agent.maxSteps})`,
      usage: usageOf(accPrompt, accCompletion),
    };
  }

  /** 判断 Agent 是否挂载了技能（skills 字段或 capabilities 中的 skill 类型） */
  private hasSkills(agent: AgentDefinition): boolean {
    if (!this.skillLoader) return false;
    if (agent.skills?.length) return true;
    return (agent.capabilities ?? []).some((c) => c.type === 'skill' && c.enabled !== false);
  }

  /**
   * 内置 load_skill 处理（返回要 yield 的事件数组，主循环统一 yield）：
   *  - 缺参 → tool_result 提示
   *  - 去重：已加载 → tool_result 提示
   *  - 加载全文 → skill_load + tool_result（正文）
   *  - 未找到 → tool_result 错误提示
   */
  private async handleLoadSkill(
    call: ToolCall,
    args: Record<string, unknown>,
    step: number,
    messages: ChatMessage[],
  ): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    const code = String(args?.code || '').trim();

    if (!code) {
      const msg = 'load_skill 需要参数 code（技能标识）';
      events.push({ type: 'tool_result', name: call.name, content: msg, step });
      messages.push({ role: 'tool', content: msg, toolCallId: call.id });
      return events;
    }

    if (this.loadedSkills.has(code)) {
      const msg = `技能 ${code} 已在本次运行中加载，无需重复调用。`;
      events.push({ type: 'tool_result', name: call.name, content: msg, step });
      messages.push({ role: 'tool', content: msg, toolCallId: call.id });
      return events;
    }

    const skill = await this.skillLoader!.load(code);
    if (!skill) {
      const msg = `技能 ${code} 不存在或未挂载，请从已挂载技能列表中选择。`;
      events.push({ type: 'tool_result', name: call.name, content: msg, step });
      messages.push({ role: 'tool', content: msg, toolCallId: call.id });
      return events;
    }

    this.loadedSkills.add(code);
    events.push({ type: 'skill_load', name: code, content: skill.name, step });
    const loadedMsg = `技能「${skill.name}」完整规范：\n${skill.content}`;
    events.push({ type: 'tool_result', name: call.name, content: loadedMsg, step });
    messages.push({ role: 'tool', content: loadedMsg, toolCallId: call.id });
    return events;
  }

  private parseArgs(call: ToolCall): Record<string, unknown> {
    try {
      return JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

/** 根据累计的输入/输出 token 生成 usage 对象 */
function usageOf(promptTokens: number, completionTokens: number): { promptTokens: number; completionTokens: number; totalTokens: number } {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}
