/** LLM 服务——摘要生成、情感分析（OpenAI 兼容接口，TokenHub hy3） */
import { Logger } from '@nestjs/common';

const logger = new Logger('FinnewsLLM');

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function chat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
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

/** 生成话题摘要（2-3 句话） */
export async function generateSummary(title: string, content: string): Promise<string> {
  try {
    return await chat(
      [
        {
          role: 'system',
          content:
            '你是一个财经资讯编辑。请用简洁的中文概括以下资讯的核心内容，2-3 句话，不超过 100 字。只输出摘要，不要加前缀。',
        },
        { role: 'user', content: `标题：${title}\n\n内容：${content.slice(0, 1000)}` },
      ],
      { maxTokens: 200 },
    );
  } catch (e) {
    logger.warn(`摘要生成失败: ${(e as Error).message}`);
    return content.slice(0, 100);
  }
}

/** 情感分析 */
export async function analyzeSentiment(
  title: string,
  content: string,
): Promise<{ sentiment: string; score: number; reason: string }> {
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            '你是一个金融分析师。判断以下财经资讯对相关股票/板块的影响。' +
            '只输出 JSON：{"sentiment":"利好|利空|中性","score":0.0~1.0,"reason":"简述原因"}',
        },
        { role: 'user', content: `标题：${title}\n\n内容：${content.slice(0, 800)}` },
      ],
      { maxTokens: 200 },
    );
    const parsed = JSON.parse(result);
    return {
      sentiment: parsed.sentiment ?? '中性',
      score: parsed.score ?? 0.5,
      reason: parsed.reason ?? '',
    };
  } catch {
    return { sentiment: '中性', score: 0.5, reason: '解析失败' };
  }
}
