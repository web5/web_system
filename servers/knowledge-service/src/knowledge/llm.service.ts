import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../common/exceptions/business.exception';

/**
 * 轻量 LLM 调用（OpenAI 兼容 /chat/completions，经 tokenhub）。
 * 仅用于 Ragas 评测的生成与 judge（eval 模型与被测 agent 模型解耦，env EVAL_LLM_MODEL）。
 */
@Injectable()
export class LlmChatService {
  private readonly base: string;
  private readonly key: string;
  private readonly model: string;

  constructor(configService: ConfigService) {
    this.base =
      configService.get<string>('TOKENHUB_BASE_URL') ||
      configService.get<string>('HY3_BASE_URL') ||
      configService.get<string>('LLM_BASE_URL') ||
      '';
    this.key =
      configService.get<string>('TOKENHUB_API_KEY') ||
      configService.get<string>('HY3_API_KEY') ||
      configService.get<string>('LLM_API_KEY') ||
      '';
    this.model = configService.get<string>('EVAL_LLM_MODEL', 'deepseek-v4-flash');
  }

  async chat(system: string, user: string, maxTokens = 800): Promise<string> {
    if (!this.base || !this.key) {
      throw new BusinessException('LLM 未配置：评测需要 TOKENHUB_BASE_URL / TOKENHUB_API_KEY');
    }
    const url = `${this.base.replace(/\/+$/, '')}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new BusinessException(`评测 LLM 调用错误 ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content) throw new BusinessException('评测 LLM 返回为空');
    return content;
  }
}
