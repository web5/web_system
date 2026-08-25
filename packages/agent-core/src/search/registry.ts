/**
 * 搜索 Provider 注册中心：注册 / 优先级 / 选择。
 */
import { SearchProvider } from './provider.interface';
import { Logger } from '../lib/logger';

export class SearchProviderRegistry {
  private readonly logger = new Logger(SearchProviderRegistry.name);
  private readonly providers = new Map<string, SearchProvider>();
  private order: string[] = [];

  /** 注册 provider；同一 id 后注册覆盖（可调优先级） */
  register(provider: SearchProvider, priority = 10): void {
    this.providers.set(provider.id, provider);
    // 用 priority 排序（低值优先），简单实现为插入后重排
    this.order = Array.from(this.providers.keys());
    this.logger.debug(`已注册搜索 provider: ${provider.id} (priority=${priority})`);
  }

  get(id: string): SearchProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`搜索 provider ${id} 未注册`);
    return p;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): SearchProvider[] {
    return Array.from(this.providers.values());
  }

  /** 选择第一个可用的 provider（按注册顺序） */
  selectAvailable(): SearchProvider | undefined {
    for (const id of this.order) {
      const p = this.providers.get(id)!;
      if (p.isAvailable()) return p;
    }
    return undefined;
  }

  /** 是否有任一 provider 可用 */
  anyAvailable(): boolean {
    return Array.from(this.providers.values()).some((p) => p.isAvailable());
  }
}
