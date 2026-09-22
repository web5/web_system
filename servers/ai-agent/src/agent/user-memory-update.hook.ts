import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientRegistry, type ChatMessage } from '@kedouai/agent-core';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';
import { PostRunHook, PostRunContext } from '../agent/post-run-hook';

/** AI 提炼出的单条记忆 */
interface ExtractedItem {
  category: 'fact' | 'preference' | 'habit';
  content: string;
  confidence?: number;
  action?: 'add' | 'remove';
}

const EXTRACT_PROMPT = `你是用户记忆提取器。根据一轮对话（用户输入 + AI 回答），提炼值得长期记住的、关于用户的稳定信息。

只提取明确、稳定、与用户个人相关的信息，分三类：
- fact：事实（身份、职业、正在做什么事等）
- preference：偏好（喜欢/不喜欢的表达、语气风格偏好等）
- habit：习惯

严格输出 JSON，格式：
{"items":[{"category":"fact|preference|habit","content":"...","confidence":0.6~1.0,"action":"add|remove"}]}

规则：
1. 没有可沉淀的信息就输出 {"items":[]}
2. 只记长期有效的稳定信息，不记一次性请求或对话细节
3. action 默认 add；若用户明确否定/纠正了之前可能记住的信息，用 remove（content 写被否定的原表述）
4. confidence 低于 0.6 的不要输出
5. 只输出 JSON，不要任何解释文字`;

/**
 * 用户记忆更新插件（PostRunHook 第一个实现）。
 *
 * 每轮对话结束后异步：调 LLM 提炼记忆 → 调 user-service internal 接口写入。
 * 全程失败静默（.catch），绝不影响对话主链路。
 */
@Injectable()
export class UserMemoryUpdateHook implements PostRunHook {
  private readonly logger = new Logger(UserMemoryUpdateHook.name);
  readonly name = 'user-memory-update';

  private readonly userServiceUrl: string;
  private readonly serviceKey: string;
  private readonly extractModel?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly clientRegistry: ClientRegistry,
  ) {
    this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL', SERVICE_URL_DEFAULTS.user);
    this.serviceKey = this.configService.get<string>('USER_SERVICE_KEY', '');
    this.extractModel = this.configService.get<string>('MEMORY_EXTRACT_MODEL');
  }

  async trigger(ctx: PostRunContext): Promise<void> {
    if (!ctx.userId || !ctx.finalAnswer) return;
    try {
      const items = await this.extract(ctx);
      if (!items.length) return;
      await this.upsert(ctx.userId, ctx.conversationId, items);
      this.logger.log(`用户记忆更新: userId=${ctx.userId} items=${items.length}`);
    } catch (e) {
      this.logger.warn(`用户记忆更新失败（不影响对话）: ${(e as Error).message}`);
    }
  }

  /** 调 LLM 提炼本轮对话可沉淀的记忆 */
  private async extract(ctx: PostRunContext): Promise<ExtractedItem[]> {
    const client = this.clientRegistry.getOrFallback(this.extractModel);
    const userMsg: ChatMessage = {
      role: 'user',
      content: `用户输入：${ctx.userInput}\n\nAI 回答：${ctx.finalAnswer}`,
      ts: Date.now(),
    };
    const sysMsg: ChatMessage = { role: 'system', content: EXTRACT_PROMPT, ts: Date.now() };
    const text = await client.chat([sysMsg, userMsg], { temperature: 0.2, maxTokens: 800 });
    const parsed = parseJson(text);
    const items = Array.isArray(parsed?.items) ? (parsed.items as ExtractedItem[]) : [];
    return items.filter(
      (it) =>
        it &&
        ['fact', 'preference', 'habit'].includes(it.category) &&
        typeof it.content === 'string' &&
        it.content.trim().length > 0 &&
        (it.confidence == null || Number(it.confidence) >= 0.6),
    );
  }

  /** 直连 user-service internal 接口写入（x-service-key 鉴权） */
  private async upsert(
    userId: string,
    conversationId: string | null,
    items: ExtractedItem[],
  ): Promise<void> {
    const url = `${this.userServiceUrl.replace(/\/$/, '')}/internal/user-memory/upsert`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': this.serviceKey,
      },
      body: JSON.stringify({ userId, sourceConversationId: conversationId, items }),
    });
    if (!res.ok) {
      throw new Error(`user-service internal 返回 ${res.status}`);
    }
  }
}

/** 从模型输出解析 JSON（容忍 markdown 代码块包裹） */
function parseJson(text: string): { items?: unknown } | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const noFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(noFence);
  } catch {
    // 尝试截取首尾花括号之间的内容
    const start = noFence.indexOf('{');
    const end = noFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(noFence.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
