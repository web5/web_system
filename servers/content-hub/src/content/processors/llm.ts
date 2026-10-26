/** 内容域 LLM 处理——论文结构化摘要 / AI 资讯摘要分类（复用 common/llm 的 chat 基座） */
import { Logger } from '@nestjs/common';
import { chat } from '../../common/llm';

const logger = new Logger('ContentLLM');

export interface PaperSummary {
  译名: string;
  核心贡献: string;
  方法亮点: string;
  潜在应用: string;
}

export interface NewsSummary {
  摘要: string;
  标签: string[];
  分类: string;
}

/**
 * 论文结构化摘要（对齐原人工 summaries.json 的格式，实现去人工化）。
 *
 * @param customPrompt 管线的 llm_prompt（admin「LLM prompt 模板」）。
 *   传入时**整体替换**默认 system prompt；留空走内置默认。
 *   ⚠️ 无论用哪套 prompt，输出 JSON key 必须是 译名/核心贡献/方法亮点/潜在应用——
 *   解析器只认这 4 个 key，改名 = 全部走兜底。
 */
export async function summarizePaper(
  title: string,
  content: string,
  customPrompt?: string | null,
): Promise<PaperSummary | null> {
  const systemPrompt =
    customPrompt?.trim() ||
    '你是 AI 论文精读助手。请用中文概括以下论文，只输出 JSON：' +
      '{"译名":"论文中文译名","核心贡献":"一句话核心贡献","方法亮点":"1-2 个方法亮点","潜在应用":"潜在应用场景"}。' +
      '不要输出 JSON 以外的任何内容。';
  try {
    const result = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `标题：${title}\n\n摘要：${content.slice(0, 1500)}` },
      ],
      { maxTokens: 500 },
    );
    const parsed = JSON.parse(result);
    return {
      译名: parsed['译名'] ?? title,
      核心贡献: parsed['核心贡献'] ?? '',
      方法亮点: parsed['方法亮点'] ?? '',
      潜在应用: parsed['潜在应用'] ?? '',
    };
  } catch (e) {
    logger.warn(`论文摘要生成失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * AI / 热点资讯摘要 + 标签 + 分类（ai_news 与 hot_news 共用）。
 *
 * @param customPrompt 管线的 llm_prompt，整体替换默认 system prompt。
 *   ⚠️ 输出 JSON key 必须是 摘要/标签/分类，改名 = 全部走兜底。
 */
export async function summarizeNews(
  title: string,
  content: string,
  customPrompt?: string | null,
): Promise<NewsSummary | null> {
  const systemPrompt =
    customPrompt?.trim() ||
    '你是 AI 资讯编辑。请概括以下资讯，只输出 JSON：' +
      '{"摘要":"一句话中文摘要","标签":["2-3 个关键词"],"分类":"大模型|Agent|具身智能|开源|算力|多模态|产品发布|融资|学术|其他"}。' +
      '不要输出 JSON 以外的任何内容。';
  try {
    const result = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `标题：${title}\n\n内容：${content.slice(0, 1000)}` },
      ],
      { maxTokens: 300 },
    );
    const parsed = JSON.parse(result);
    return {
      摘要: parsed['摘要'] ?? content.slice(0, 100),
      标签: Array.isArray(parsed['标签']) ? parsed['标签'] : [],
      分类: parsed['分类'] ?? '其他',
    };
  } catch (e) {
    logger.warn(`资讯摘要生成失败: ${(e as Error).message}`);
    return null;
  }
}
