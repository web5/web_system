import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../common/exceptions/business.exception';

/**
 * EmbeddingProvider — 默认提供方 = tokenhub（OpenAI 兼容 /embeddings）。
 * env: TOKENHUB_BASE_URL(回落 HY3_BASE_URL / LLM_BASE_URL) + API_KEY + EMBEDDING_MODEL。
 * 调用失败抛明确错误（R3.2：向量化失败必须落 failed + error，不静默）。
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly model: string;
}

@Injectable()
export class TokenHubEmbeddingService implements EmbeddingProvider {
  private readonly base: string;
  private readonly key: string;
  readonly model: string;

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
    this.model = configService.get<string>('EMBEDDING_MODEL', 'bge-m3');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    if (!this.base || !this.key) {
      throw new BusinessException('embedding 未配置：请配置 TOKENHUB_BASE_URL / TOKENHUB_API_KEY');
    }
    const url = `${this.base.replace(/\/+$/, '')}/embeddings`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new BusinessException(`embedding 服务错误 ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
    if (!json.data?.length || !json.data[0]?.embedding?.length) {
      throw new BusinessException('embedding 服务返回为空');
    }
    return json.data.map((d) => d.embedding ?? []);
  }
}
