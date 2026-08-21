/** 财经域 LLM 处理——摘要、情感分析、实体抽取（复用 common/llm 的 chat 基座） */
import { Logger } from '@nestjs/common';
import { chat } from '../common/llm';

const logger = new Logger('FinnewsLLM');

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

/** 实体抽取：公司 / 人物 / 产品（用于补全 topic.entities 与 finnews_entities 表） */
export async function extractEntities(
  title: string,
  content: string,
): Promise<Array<{ type: string; name: string; stock_code?: string }>> {
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            '你是金融信息抽取器。从以下财经资讯中抽取涉及的实体，类型限定为：公司、人物、产品。' +
            '只输出 JSON 数组，元素格式：{"type":"公司|人物|产品","name":"实体名","stock_code":"股票代码(若文中出现，如600519.SH或300750.SZ，否则省略)"}。' +
            '若无任何实体，输出 []。不要输出数组以外的任何内容。',
        },
        { role: 'user', content: `标题：${title}\n\n内容：${content.slice(0, 800)}` },
      ],
      { maxTokens: 300 },
    );
    const parsed = JSON.parse(result);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e: any) =>
          e && typeof e.name === 'string' && ['公司', '人物', '产品'].includes(e.type),
      )
      .map((e: any) => ({
        type: e.type,
        name: String(e.name),
        ...(typeof e.stock_code === 'string' && e.stock_code ? { stock_code: e.stock_code } : {}),
      }));
  } catch (e) {
    logger.warn(`实体抽取失败: ${(e as Error).message}`);
    return [];
  }
}
