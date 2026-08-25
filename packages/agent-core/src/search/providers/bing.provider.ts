/**
 * Bing Web Search Provider（默认内置）。
 * 需用户配置 BING_SEARCH_API_KEY（Azure Bing Search 或 微软新 Bing Search API）。
 */
import { SearchProvider, SearchResult } from '../provider.interface';

const BING_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/search';

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

    const data = await resp.json();
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
