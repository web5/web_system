import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DictItemLite {
  value: string;
  label: string;
  attrs: Record<string, unknown> | null;
  sort: number;
}

interface CacheEntry {
  items: DictItemLite[];
  fetchedAt: number;
}

/**
 * 字典读取客户端（服务间调用 system-service `/internal/dict/:code`）。
 *
 * 约定（与 ModelCatalogService 一致）：
 * - 只读**启用项**；字典不可用/无启用项时由调用方给的 fallback 兜底，绝不因此抛错中断业务；
 * - 60s 内存缓存（`DICT_CACHE_MS` 可调）：字典变更容忍分钟级生效，避免每次工具调用都打网络。
 */
@Injectable()
export class DictClientService {
  private readonly logger = new Logger(DictClientService.name);
  private readonly systemServiceUrl: string;
  private readonly internalKey: string;
  private readonly cacheMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly configService: ConfigService) {
    this.systemServiceUrl = (
      this.configService.get<string>('SYSTEM_SERVICE_URL', 'http://127.0.0.1:6004') || ''
    ).replace(/\/+$/, '');
    this.internalKey = this.configService.get<string>('INTERNAL_API_KEY', '') || '';
    this.cacheMs = Number(this.configService.get('DICT_CACHE_MS', '60000')) || 60000;
  }

  /** 取字典启用项（带缓存）；失败抛错，由 getEnabledValues 兜底 */
  async getEnabledItems(code: string, forceRefresh = false): Promise<DictItemLite[]> {
    const hit = this.cache.get(code);
    if (!forceRefresh && hit && Date.now() - hit.fetchedAt < this.cacheMs) {
      return hit.items;
    }
    const res = await fetch(`${this.systemServiceUrl}/internal/dict/${code}`, {
      headers: { 'x-internal-key': this.internalKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status=${res.status}`);
    const body = (await res.json()) as { data?: DictItemLite[] };
    const items = Array.isArray(body?.data) ? body.data : [];
    this.cache.set(code, { items, fetchedAt: Date.now() });
    return items;
  }

  /**
   * 取字典启用项的 value 列表；字典不可用或为空时回落 `fallback`（代码常量）。
   * 这是"字典参与判断"类枚举的推荐用法：宽松并集，不让运维误删导致业务拒单。
   */
  async getEnabledValues(code: string, fallback: string[] = []): Promise<string[]> {
    try {
      const items = await this.getEnabledItems(code);
      if (items.length) return items.map((i) => i.value);
      this.logger.warn(`字典 ${code} 无启用项，使用代码兜底（${fallback.length} 项）`);
    } catch (e) {
      this.logger.warn(`字典 ${code} 读取失败（${(e as Error).message}），使用代码兜底`);
    }
    return fallback;
  }

  /** 字典值 ∪ 代码常量（校验场景等"参与判断"枚举时用，宽松不误伤） */
  async getAllowedValues(code: string, codeValues: string[]): Promise<string[]> {
    const dictValues = await this.getEnabledValues(code, []);
    return [...new Set([...codeValues, ...dictValues])];
  }
}
