/** arXiv 论文采集器——官方 API，Atom 解析，无需密钥 */
import { ICollector, RawItem } from './collector.interface';
import { decodeEntities, stripTags, extractTag } from './xml';

const ARXIV_API = 'http://export.arxiv.org/api/query';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class ArxivCollector implements ICollector {
  readonly code = 'arxiv';

  async collect(
    config: Record<string, unknown> = {},
    limit = 10,
  ): Promise<RawItem[]> {
    const categories = (config['categories'] as string) ?? 'cs.AI+OR+cat:cs.CL+OR+cat:cs.CV+OR+cat:cs.LG';
    const maxResults = Number(config['max_results'] ?? limit);

    const url =
      `${ARXIV_API}?search_query=cat:${categories}` +
      `&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${maxResults}`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) return [];
    const xml = await resp.text();

    // 按 <entry> 切分
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    const results: RawItem[] = [];

    for (const entry of entries) {
      const idFull = extractTag(entry, 'id');
      // id 形如 http://arxiv.org/abs/2408.12345v1
      const externalId = idFull ? idFull.split('/abs/').pop() ?? idFull : idFull ?? '';
      const title = stripTags(extractTag(entry, 'title') ?? '');
      const summary = stripTags(extractTag(entry, 'summary') ?? '');
      const publishedRaw = extractTag(entry, 'published') ?? '';
      const published = publishedRaw ? new Date(publishedRaw) : undefined;

      if (!title) continue;

      results.push({
        external_id: externalId,
        title,
        content: summary,
        url: idFull ?? undefined,
        source_name: 'arXiv',
        publish_date: isNaN(published?.getTime() ?? NaN) ? undefined : published,
        meta: { categories },
      });
    }

    return results;
  }
}
