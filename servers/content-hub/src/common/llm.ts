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
  /**
   * 是否允许模型「先思考再回答」，默认 `disabled`。
   *
   * 🔴 必须默认关掉，原因实测（2026-10-26，TokenHub / hy3）：
   *   `hy3` 是 reasoning 模型，`reasoning_content` 与 `content` **共用 max_tokens**。
   *   一张资讯摘要卡要求它只吐 60 token 的 JSON，它却能思考 900~1500 token 还没停，
   *   于是 `finish_reason=length` 且 `content=""` —— 表现是「LLM 什么都没返回」，
   *   上层 JSON.parse 抛错 → 走兜底截断。
   *
   *   这就是历史数据里 `summary` 全是英文截断（`content.slice(0,100)`）的根因：
   *   不是模型不会写中文，是它一个字都没写出来。
   *
   * 关思考的方式只认 `thinking:{type:'disabled'}`：
   *   `enable_thinking:false` 实测无效（照样烧 600 token），别用那个。
   *
   * 需要推理的场合（复杂判定、多步计算）才显式传 `'auto'`。
   *
   * 换到不认这个参数的服务商（OpenAI 官方等）时，置环境变量 `LLM_THINKING=auto`
   * 可整体关掉本参数，避免 400「未知字段」。
   */
  thinking?: 'disabled' | 'auto';
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

  /**
   * 是否发 `thinking` 参数。`LLM_THINKING=auto` 时整体不发 —— 供换到
   * 不认该字段的服务商时自救，不用改代码。
   */
  const envThinking = (process.env.LLM_THINKING ?? '').toLowerCase() === 'auto';
  const wantsThinking = opts.thinking === 'auto' || envThinking;

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
      ...(wantsThinking ? {} : { thinking: { type: 'disabled' } }),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM 调用失败: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';

  /**
   * 空 content + 被预算截断 = 思考把额度烧光了。
   *
   * 必须显式抛错而不是返回空串：返回空串时上层只看到「JSON 解析失败」，
   * 会误判成 prompt 写错，然后去改 prompt —— 上面那条历史 bug 就是这么拖了很久。
   */
  if (!content.trim() && data.choices?.[0]?.finish_reason === 'length') {
    const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    throw new Error(
      `LLM 返回空白且被 max_tokens 截断（reasoning_tokens=${reasoning}）：` +
        `疑似模型思考占满预算，请关闭 thinking 或提高 maxTokens`,
    );
  }

  return content;
}

/** 供需要日志的领域模块复用，避免各自 new Logger */
export { logger };
