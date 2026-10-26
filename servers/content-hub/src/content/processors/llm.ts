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
  /**
   * 中文标题（可选）。
   *
   * 2026-10-26 新增：prompt 里多要一个 `标题` key，让「摘要」和「译名」一次调用拿到，
   * 不给英文源单独发一次翻译请求（每条省一次 ~100 token 的调用）。
   *
   * ⚠️ 这是**可选** key：管理员把 prompt 改回旧版（没有 `标题`）不会报错，
   *    只是退化成 pipeline 里的 `translateTitle()` 兜底。
   *    所以「prompt 改坏了」= 多花一次调用，不会漏翻，也不会挂。
   */
  标题?: string;
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
 *   ⚠️ 输出 JSON key 必须是 摘要/标签/分类（`标题` 可选），改名 = 全部走兜底。
 *   maxTokens 从 300 提到 400：多要一个 `标题` 后 300 会在个别长标题上被截断。
 */
export async function summarizeNews(
  title: string,
  content: string,
  customPrompt?: string | null,
): Promise<NewsSummary | null> {
  const systemPrompt =
    customPrompt?.trim() ||
    '你是 AI 资讯编辑。请概括以下资讯，只输出 JSON：' +
      '{"标题":"中文标题（原文标题是英文则译成中文）","摘要":"一句话中文摘要","标签":["2-3 个关键词"],"分类":"大模型|Agent|具身智能|开源|算力|多模态|产品发布|融资|学术|其他"}。' +
      '不要输出 JSON 以外的任何内容。';
  try {
    const result = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `标题：${title}\n\n内容：${content.slice(0, 1000)}` },
      ],
      { maxTokens: 400 },
    );
    const parsed = JSON.parse(result);
    const headline = typeof parsed['标题'] === 'string' ? parsed['标题'].trim() : '';
    return {
      摘要: parsed['摘要'] ?? content.slice(0, 100),
      标签: Array.isArray(parsed['标签']) ? parsed['标签'] : [],
      分类: parsed['分类'] ?? '其他',
      标题: headline || undefined,
    };
  } catch (e) {
    logger.warn(`资讯摘要生成失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 只翻标题——`summarizeNews` 没给出中文标题时的兜底通道。
 *
 * 什么时候会走到这里：
 *   1. 管理员把 llm_prompt 改回了不带 `标题` 的旧版
 *   2. 手动采集（`persistItems` 不走 LLM，压根没有摘要产出）
 *   3. LLM 把 `标题` 原样返回了英文（下面由调用方用 looksChinese 判掉）
 *
 * 成本：每条英文源多一次 ~100 token 的调用，中文源完全不走（调用方先判语言）。
 * 失败返回 null —— 调用方回落原文标题，绝不写空标题。
 */
export async function translateTitle(title: string): Promise<string | null> {
  const systemPrompt =
    '你是中文科技媒体的标题编辑。把用户给的资讯标题译成简洁的中文标题。\n' +
    '要求：\n' +
    '1. 保留 OpenAI、GPT-5、iPhone、arXiv 这类专有名词的英文原名，不要音译\n' +
    '2. 不加引号、不加书名号、不加「重磅」「炸裂」这类夸张词\n' +
    '3. 不添加原标题里没有的信息，不补充背景\n' +
    '4. 不超过 30 个汉字\n' +
    '5. 只输出译文本身，不要任何解释、前缀或引号';
  try {
    const result = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: title },
      ],
      { maxTokens: 120, temperature: 0.2 },
    );
    // LLM 偶尔会自作多情套引号或写「标题：xxx」，这里剥掉
    const cleaned = result
      .trim()
      .replace(/^(标题|译文|中文标题)\s*[:：]\s*/, '')
      .replace(/^["'“”『「]+|["'“”』」]+$/g, '')
      .trim();
    return cleaned || null;
  } catch (e) {
    logger.warn(`标题翻译失败: ${(e as Error).message}`);
    return null;
  }
}
