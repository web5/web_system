/**
 * Hy3 客户端（腾讯混元 Turbo，Tencent MaaS TokenHub），原生 fetch 版。
 */
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk, ToolCallSchema, ToolCall, ChatWithToolsResult, StreamToolEvent, parseJsonToolCall } from './base-ai.client';
import { Logger } from '../lib/logger';
import { API_TIMEOUT } from '../lib/timeout';
import { postJson, streamSse } from '../lib/fetch-http';

const DEFAULT_BASE_URL = 'https://tokenhub.tencentmaas.com/v1';

/**
 * 解析 hy3 模型的 XML 文本工具调用（混元固有行为：部分场景模型不返回标准
 * tool_calls，而是输出 XML 文本）。已观察到的变体：
 *   A) <tool_calls><tool_call>name\n<query>v</query></tool_call></tool_calls>
 *   B) 带会话 ID 后缀：<tool_calls:ID><tool_call:ID>name\n<query>v</query></tool_call:ID></tool_calls:ID>
 *   C) 成对参数：<arg_key>k</arg_key><arg_value>v</arg_value>，闭合为 </function>
 * 返回 null 表示内容不含可解析的 XML 工具调用。
 */
function parseXmlToolCalls(content: string): ToolCall[] | null {
  const callsMatch = content.match(/<tool_calls(?::[\w-]+)?>([\s\S]*?)<\/tool_calls(?::[\w-]+)?>/);
  if (!callsMatch) return null;

  const block = callsMatch[1];
  const toolBlocks = block.match(
    /<tool_call(?::[\w-]+)?>[\s\S]*?(?=<\/tool_call(?::[\w-]+)?>|<\/function>|<\/invoke>|<tool_call(?::[\w-]+)?>|$)/g,
  );
  if (!toolBlocks || toolBlocks.length === 0) return null;

  const stripCdata = (v: string): string =>
    v.trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

  const calls: ToolCall[] = [];
  for (const tb of toolBlocks) {
    const inner = tb.replace(/^<tool_call(?::[\w-]+)?>/g, '').trim();
    const nl = inner.search(/[\r\n]/);
    const name = (nl === -1 ? inner : inner.slice(0, nl)).trim();
    if (!name || name.startsWith('<')) continue;

    const args: Record<string, unknown> = {};
    // 1) 成对参数 <arg_key>k</arg_key><arg_value>v</arg_value>
    const kvRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    let kv: RegExpExecArray | null;
    while ((kv = kvRe.exec(inner))) {
      args[kv[1].trim()] = stripCdata(kv[2]);
    }
    // 2) 属性式 <argument name="k">v</argument>
    if (Object.keys(args).length === 0) {
      const attrRe = /<argument(?:\s+name\s*=\s*["']?([\w-]+)["']?)?[^>]*>([\s\S]*?)<\/argument>/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(inner))) {
        args[am[1]?.trim() || `arg${Object.keys(args).length}`] = stripCdata(am[2]);
      }
    }
    // 3) 常规 <param>value</param>（以上未命中时）
    if (Object.keys(args).length === 0) {
      const re = /<([A-Za-z_][\w]*)(?::[\w-]+)?(?:\s[^>]*)?>([\s\S]*?)<\/\1(?::[\w-]+)?>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(inner))) {
        args[m[1]] = stripCdata(m[2]);
      }
    }
    calls.push({
      id: `call_${calls.length + 1}`,
      name,
      arguments: JSON.stringify(args),
    });
  }
  return calls.length ? calls : null;
}

export class Hy3Client extends BaseAiClient {
  readonly modelId = 'hy3';
  readonly displayName = 'hy3';
  readonly description = 'hy3（腾讯混元，Tencent MaaS TokenHub）';
  private readonly logger = new Logger(Hy3Client.name);

  private getApiKey(): string {
    return process.env.HY3_API_KEY ?? '';
  }
  private getBaseUrl(): string {
    return process.env.HY3_BASE_URL || DEFAULT_BASE_URL;
  }
  private getChatEndpoint(): string {
    const base = this.getBaseUrl().replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) return base;
    return `${base}/chat/completions`;
  }

  isAvailable(): boolean {
    return !!this.getApiKey().trim();
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return (await this.chatWithTools(messages, [], options)).content;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): Promise<ChatWithToolsResult> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`Hy3 模型不可用：请配置 HY3_API_KEY 环境变量`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      top_p: options?.topP ?? 1.0,
      stream: false,
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    this.logger.debug(`调用 Hy3 API，messages=${messages.length}, tools=${tools.length}`);

    try {
      const data = await postJson<any>(
        this.getChatEndpoint(),
        payload,
        { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 300_000 },
      );
      const choice = data.choices?.[0];
      const message = choice?.message ?? {};
      if (!choice) throw new Error('Invalid response from Hy3 API');

      const rawToolCalls: any[] | undefined = message.tool_calls;
      let toolCalls: ToolCall[] = Array.isArray(rawToolCalls)
        ? rawToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments ?? '{}',
          }))
        : [];
      // hy3 兜底：模型偶发输出 XML/JSON 文本工具调用而非标准 tool_calls
      if (toolCalls.length === 0) {
        const xmlParsed = parseXmlToolCalls(message.content ?? '');
        if (xmlParsed) {
          toolCalls = xmlParsed;
        } else {
          const jsonParsed = parseJsonToolCall(message.content ?? '');
          if (jsonParsed) toolCalls = jsonParsed;
        }
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: message.content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };

      // OpenAI 标准 usage：{ prompt_tokens, completion_tokens, total_tokens }
      const usage = data.usage;
      return {
        content: assistantMessage.content,
        toolCalls,
        assistantMessage,
        finishReason: choice?.finish_reason,
        usage:
          usage
            ? {
                promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
                completionTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
                totalTokens:
                  usage.total_tokens ??
                  (usage.prompt_tokens ?? usage.input_tokens ?? 0) +
                    (usage.completion_tokens ?? usage.output_tokens ?? 0),
              }
            : undefined,
      };
    } catch (error) {
      this.logger.error(`Hy3 API error: ${(error as Error).message}`);
      throw new Error(`Hy3 服务调用失败: ${(error as Error).message}`);
    }
  }

  /**
   * 流式带工具推理（真流式）。
   *
   * 混元流式 API 与 OpenAI 兼容：
   * - delta.content 增量 → yield content_delta（前端逐字渲染）
   * - delta.tool_calls 增量 → 按 index 聚合（arguments 分片拼接）
   * 流结束按有无 toolCalls 返回 result；模型若输出 XML/JSON 文本工具调用
   * 则用兜底解析（与 chatWithTools 一致）。
   */
  async *chatWithToolsStream(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamToolEvent, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`Hy3 模型不可用：请配置 HY3_API_KEY 环境变量`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
      top_p: options?.topP ?? 1.0,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    let content = '';
    let finishReason: string | undefined;
    const toolAcc: Record<number, { id: string; name: string; arguments: string }> = {};
    let sawAnyToolCall = false;
    let lastUsage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;

    for await (const ev of streamSse(this.getChatEndpoint(), payload, {
      headers: { Authorization: `Bearer ${key}` },
      timeoutMs: API_TIMEOUT.AI_TASK,
    })) {
      if (ev.done) break;
      let parsed: any;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        continue;
      }
      // 流式 usage：OpenAI Chat Completions 用 prompt_tokens/completion_tokens；
      // TokenHub 兼容 Responses API 时用 input_tokens/output_tokens（字段名不同）
      const u = parsed.usage;
      if (u) {
        const prompt = u.prompt_tokens ?? u.input_tokens;
        const completion = u.completion_tokens ?? u.output_tokens;
        if (typeof prompt === 'number' && typeof completion === 'number') {
          lastUsage = {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: u.total_tokens ?? prompt + completion,
          };
        }
      }
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      finishReason = choice.finish_reason ?? finishReason;

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        yield { type: 'content_delta', delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        sawAnyToolCall = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = (toolAcc[idx] = toolAcc[idx] ?? { id: '', name: '', arguments: '' });
          if (tc.id) acc.id += tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    let toolCalls: ToolCall[] = sawAnyToolCall
      ? Object.values(toolAcc).map((a) => ({
          id: a.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: a.name,
          arguments: a.arguments || '{}',
        }))
      : [];
    // 兜底：XML / JSON 文本工具调用
    if (toolCalls.length === 0) {
      const xmlParsed = parseXmlToolCalls(content);
      if (xmlParsed) {
        toolCalls = xmlParsed;
      } else {
        const jsonParsed = parseJsonToolCall(content);
        if (jsonParsed) toolCalls = jsonParsed;
      }
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
    yield {
      type: 'done',
      result: { content, toolCalls, assistantMessage, finishReason, usage: lastUsage },
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`Hy3 模型不可用：请配置 HY3_API_KEY 环境变量`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      stream: true,
    };

    for await (const ev of streamSse(this.getChatEndpoint(), payload, {
      headers: { Authorization: `Bearer ${key}` },
      timeoutMs: API_TIMEOUT.AI_TASK,
    })) {
      if (ev.done) break;
      let parsed: any;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) yield { content: delta, done: false };
    }
    yield { content: '', done: true };
  }

  private toApiMessage(m: ChatMessage): Record<string, unknown> {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content };
  }
}
