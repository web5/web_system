import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 单价（每 1K tokens；口径与旧表 model_pricing 一致） */
export interface ModelPrice {
  inputPricePer1k: number;
  outputPricePer1k: number;
  currency: string;
}

/** 字典项（`/internal/dict/:code` 返回形状；只用到 value 与 attrs） */
export interface DictRowLike {
  value?: string | null;
  attrs?: Record<string, unknown> | null;
}

/** 把 attrs 里的价格值解析成非负数；非法/缺失返回 undefined */
function toPrice(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * 从字典 llm_models 的启用项解析价格表（**纯函数**，便于单测）。
 *
 * 语义：
 * - 两个价格字段都缺失 → 不进城（等价于"未配价"，成本按 0 计）；
 * - 只配了一个 → 另一个按 0 计（与旧表行为一致）；
 * - 值非法（负数/非数字）→ 视为未配置，不抛错（发布态不该因一条脏数据让成本链路报错）。
 */
export function parseDictPricing(rows: DictRowLike[]): Map<string, ModelPrice> {
  const out = new Map<string, ModelPrice>();
  for (const row of rows || []) {
    const model = String(row?.value ?? '').trim();
    if (!model) continue;
    const attrs = row?.attrs ?? {};
    const input = toPrice(attrs.input_price_per1k);
    const output = toPrice(attrs.output_price_per1k);
    if (input === undefined && output === undefined) continue;
    const currencyRaw = attrs.currency;
    const currency =
      typeof currencyRaw === 'string' && currencyRaw.trim() ? currencyRaw.trim() : 'CNY';
    out.set(model, {
      inputPricePer1k: input ?? 0,
      outputPricePer1k: output ?? 0,
      currency,
    });
  }
  return out;
}

/** 成本 = （prompt × 输入价 + completion × 输出价）/ 1000（价格是"每 1K tokens"） */
export function calcCost(p: ModelPrice, prompt: number, completion: number): number {
  return (prompt * p.inputPricePer1k + completion * p.outputPricePer1k) / 1000;
}

/**
 * 模型价格目录：把「单价」的真相源从旧表 `model_pricing` 切到字典 `llm_models`
 * （见 `specs/llm-models-unify/design.md`）。
 *
 * 实现与 ai-agent 的 `ModelCatalogService` 同款：启动拉一次 + 定时轮询，
 * 失败**保留上一次缓存**（字典抖动不该把当日成本打成 0），从未成功过则视为"无价"
 * （成本 0，与旧行为一致），绝不抛错阻断 run 落库。
 *
 * `PRICE_SOURCE` 三档：
 * - `dict`（默认）：字典优先，字典查不到时由调用方回落旧表；
 * - `dict-only`：纯字典，不回落旧表；
 * - `legacy`：完全不读字典（回退开关，行为与改造前一致）。
 */
@Injectable()
export class ModelPricingCatalog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelPricingCatalog.name);
  private readonly systemServiceUrl: string;
  private readonly internalKey: string;
  private readonly dictCode: string;
  private readonly pollMs: number;
  private readonly forcedSource: 'dict' | 'dict-only' | 'legacy';

  private prices = new Map<string, ModelPrice>();
  private timer?: ReturnType<typeof setInterval>;
  private lastSync: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.systemServiceUrl = (
      this.config.get<string>('SYSTEM_SERVICE_URL', 'http://127.0.0.1:6004') || ''
    ).replace(/\/+$/, '');
    this.internalKey = this.config.get<string>('INTERNAL_API_KEY', '') || '';
    this.dictCode = this.config.get<string>('MODEL_DICT_CODE', 'llm_models') || 'llm_models';
    this.pollMs = Number(this.config.get('PRICE_POLL_MS', '60000')) || 60000;
    const raw = (this.config.get<string>('PRICE_SOURCE', 'dict') || 'dict').toLowerCase();
    this.forcedSource = raw === 'legacy' ? 'legacy' : raw === 'dict-only' ? 'dict-only' : 'dict';
  }

  onModuleInit(): void {
    if (this.forcedSource === 'legacy') {
      this.logger.warn('PRICE_SOURCE=legacy：单价仍从 model_pricing 表读取（未启用字典取价）');
      return;
    }
    void this.sync();
    this.timer = setInterval(() => void this.sync(), this.pollMs);
    this.logger.log(
      `模型价格目录已启动：source=${this.forcedSource}、字典=${this.dictCode}、轮询 ${this.pollMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 生效来源（`legacy` = 完全不查字典，调用方应回落旧表） */
  get source(): 'dict' | 'dict-only' | 'legacy' {
    return this.forcedSource;
  }

  /** 是否允许在字典查不到时回落旧表 */
  get allowLegacyFallback(): boolean {
    return this.forcedSource === 'dict';
  }

  get lastSyncAt(): string | null {
    return this.lastSync;
  }

  get size(): number {
    return this.prices.size;
  }

  /** 取价；`legacy` 模式或未命中返回 undefined（调用方按"无价"处理或回落旧表） */
  get(model: string): ModelPrice | undefined {
    if (this.forcedSource === 'legacy') return undefined;
    return this.prices.get(model);
  }

  /** 从字典同步一次（幂等，可安全重复调用） */
  async sync(): Promise<void> {
    if (this.forcedSource === 'legacy') return;
    if (!this.internalKey) {
      this.logger.warn('INTERNAL_API_KEY 未配置，跳过模型价格同步（将回落旧表/按无价处理）');
      return;
    }
    try {
      const res = await fetch(`${this.systemServiceUrl}/internal/dict/${this.dictCode}`, {
        headers: { 'x-internal-key': this.internalKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`status=${res.status}`);
      const body = (await res.json()) as { data?: DictRowLike[] };
      const next = parseDictPricing(Array.isArray(body?.data) ? body.data : []);
      const changed = next.size !== this.prices.size;
      this.prices = next;
      this.lastSync = new Date().toISOString();
      if (changed) {
        this.logger.log(`模型价格已更新：共 ${next.size} 个模型配价（来源=字典 ${this.dictCode}）`);
      }
    } catch (e) {
      this.logger.warn(
        `模型价格同步失败（保留上一次缓存，${this.prices.size} 个）：${(e as Error).message}`,
      );
    }
  }
}
