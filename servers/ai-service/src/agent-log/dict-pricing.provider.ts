import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 单个模型的单价（元 / 1K tokens） */
export interface ModelPrice {
  inPrice: number;
  outPrice: number;
}

interface DictRow {
  value?: string;
  attrs?: Record<string, unknown> | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 模型单价（数据源：字典 `llm_models` 项的 attrs）。
 *
 * 为什么在内存里：单价消费点是 `AgentLogService.recordRun` 写 run 的**热路径**，
 * 不能在那里做同步 HTTP；所以启动同步一次 + 定时轮询，落库时只查内存 Map。
 *
 * 键位（沿用历史形态，与 model_pricing 的列名一致）：
 *   attrs.input_price_per1k / attrs.output_price_per1k —— 元 / 1K tokens
 *   attrs.currency —— 仅展示用，不参与计算
 *
 * 失败策略：拉取失败/超时（5s）**沿用上次成功清单**；从未成功过则空表（成本按 0，
 * 延续"无单价不发明数值"的口径）。
 */
@Injectable()
export class DictPricingProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DictPricingProvider.name);
  private readonly systemServiceUrl: string;
  private readonly internalKey: string;
  private readonly dictCode: string;
  private readonly pollMs: number;

  private prices = new Map<string, ModelPrice>();
  private timer?: ReturnType<typeof setInterval>;
  private started = false;

  constructor(private readonly configService: ConfigService) {
    this.systemServiceUrl = (
      this.configService.get<string>('SYSTEM_SERVICE_URL', 'http://127.0.0.1:6004') || ''
    ).replace(/\/+$/, '');
    this.internalKey = this.configService.get<string>('INTERNAL_API_KEY', '') || '';
    this.dictCode = this.configService.get<string>('MODEL_DICT_CODE', 'llm_models') || 'llm_models';
    this.pollMs = Number(this.configService.get('MODEL_PRICING_POLL_MS', '60000')) || 60000;
  }

  onModuleInit(): void {
    if (this.started) return;
    this.started = true;
    void this.sync();
    this.timer = setInterval(() => {
      if (this.started) void this.sync();
    }, this.pollMs);
    this.logger.log(
      `模型单价已启动：字典=${this.dictCode}、轮询 ${this.pollMs}ms、system-service=${this.systemServiceUrl || '(未配置)'}`,
    );
  }

  onModuleDestroy(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** 同步查价（热路径只读内存，不做 HTTP） */
  getPrice(model: string): ModelPrice | undefined {
    if (!model) return undefined;
    return this.prices.get(model);
  }

  /** 当前已加载的模型数（诊断用） */
  size(): number {
    return this.prices.size;
  }

  /** 拉取字典启用项并重建单价表；失败保留上次结果 */
  async sync(): Promise<void> {
    if (!this.systemServiceUrl) {
      this.logger.warn('SYSTEM_SERVICE_URL 未配置，模型单价不可用（成本按 0 计）');
      return;
    }
    try {
      const res = await fetch(`${this.systemServiceUrl}/internal/dict/${this.dictCode}`, {
        headers: { 'x-internal-key': this.internalKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`status=${res.status}`);
      const body = (await res.json()) as { data?: DictRow[] };

      const next = new Map<string, ModelPrice>();
      for (const row of Array.isArray(body?.data) ? body.data : []) {
        const model = String(row?.value ?? '').trim();
        if (!model) continue;
        const attrs = row.attrs ?? {};
        const inPrice = toNumber(attrs['input_price_per1k']);
        const outPrice = toNumber(attrs['output_price_per1k']);
        // 两个价格都没配 → 视为未定价，不登记（成本按 0）
        if (inPrice === null && outPrice === null) continue;
        next.set(model, { inPrice: inPrice ?? 0, outPrice: outPrice ?? 0 });
      }

      this.prices = next;
      this.logger.log(`模型单价已更新：${next.size} 个已定价模型（源=字典 ${this.dictCode}）`);
    } catch (e) {
      this.logger.warn(
        `模型单价拉取失败（${(e as Error).message}），沿用上次结果（${this.prices.size} 个模型）`,
      );
    }
  }
}
