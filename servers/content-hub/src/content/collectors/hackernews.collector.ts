/** Hacker News 采集器——Algolia API，技术/开源/AI 资讯源，无需密钥 */
import { ICollector, RawItem } from './collector.interface';

const HN_API = 'https://hn.algolia.com/api/v1/search_by_date';

export class HackerNewsCollector implements ICollector {
  readonly code = 'hackernews';

  async collect(
    config: Record<string, unknown> = {},
    limit = 20,
  ): Promise<RawItem[]> {
    const query = (config['query'] as string) ?? 'AI';
    const tags = (config['tags'] as string) ?? 'story';
    const hits = Number(config['hits'] ?? limit);

    const url = `${HN_API}?query=${encodeURIComponent(query)}&tags=${tags}&hitsPerPage=${hits}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();

    const items = (data.hits ?? []) as any[];
    const results: RawItem[] = [];
    for (const item of items) {
      const title = String(item.title ?? '');
      if (!title) continue;
      const publishedRaw = item.created_at ? new Date(item.created_at) : undefined;
      results.push({
        external_id: String(item.objectID ?? ''),
        title,
        content: String(item.story_text ?? title),
        url: item.url ? String(item.url) : `https://news.ycombinator.com/item?id=${item.objectID}`,
        source_name: 'Hacker News',
        publish_date: isNaN(publishedRaw?.getTime() ?? NaN) ? undefined : publishedRaw,
        meta: { points: item.points, num_comments: item.num_comments },
      });
    }
    return results;
  }
}
