/**
 * Bing Web Search Provider（默认内置）。
 * 需用户配置 BING_SEARCH_API_KEY（Azure Bing Search 或 微软新 Bing Search API）。
 */
import { type SearchProvider, type SearchResult } from '../provider.interface';

const BING_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/search';

/** Bing 返回的网页条目（字段全部可选：不同 API 版本/配额下可能缺失）。 */
interface BingWebPage {
  name?: unknown;
  url?: unknown;
  snippet?: unknown;
}

export class BingSearchProvider implements SearchProvider {
  readonly id = 'bing';
  readonly name = 'Bing Web Search';

  private getApiKey(): string {
    return process.env.BING_SEARCH_API_KEY ?? '';
  }

  isAvailable(): boolean {
    return !!this.getApiKey().trim();
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error('Bing 搜索未配置：请设置 BING_SEARCH_API_KEY');
    }

    const url = `${BING_ENDPOINT}?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}&mkt=zh-CN`;
    const resp = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'User-Agent': 'kedou-agent/0.1',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      throw new Error(`Bing 搜索请求失败: HTTP ${resp.status}`);
    }

    // 显式声明响应结构：fetch().json() 在各版本 @types/node 下推断不同（any / unknown / {}），
    // 直接取值会在 TS 严格检查下报 TS2339（曾导致 prod 目标机编译失败）。
    const data = (await resp.json()) as { webPages?: { value?: BingWebPage[] } } | null;
    const results: SearchResult[] = [];
    const webPages = data?.webPages?.value ?? [];
    for (const item of webPages) {
      const title = String(item.name ?? '').trim();
      if (!title) continue;
      results.push({
        title,
        url: String(item.url ?? ''),
        snippet: String(item.snippet ?? ''),
        source: 'bing',
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}
