/** 通用 LLM 对话客户端（OpenAI 兼容接口，TokenHub hy3）——财经 / 论文 / AI 资讯三领域共用 */
import { Logger } from '@nestjs/common';

const logger = new Logger('ContentHubLLM');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

/** OpenAI 兼容 chat 基座；未配置 LLM_API_KEY 时抛错 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY ?? '';
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://tokenhub.tencentmaas.com/v1';
  const model = process.env.LLM_MODEL ?? 'hy3';

  if (!apiKey) {
    throw new Error('LLM_API_KEY 未配置');
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 500,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM 调用失败: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 供需要日志的领域模块复用，避免各自 new Logger */
export { logger };
