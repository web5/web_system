/** 通用 RSS/Atom 采集器——高端资讯平台主力源（机器之心/量子位/MIT TR 等） */
import { ICollector, RawItem } from './collector.interface';
import { stripTags, extractTag, extractAttr } from './xml';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class RssCollector implements ICollector {
  readonly code = 'rss';

  async collect(
    config: Record<string, unknown> = {},
    limit = 20,
  ): Promise<RawItem[]> {
    const url = config['url'] as string;
    if (!url) return [];

    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) return [];
    const xml = await resp.text();

    // Atom（有 <entry>）优先，否则按 RSS 2.0（有 <item>）处理
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g);
    if (entries && entries.length > 0) {
      return this.parseAtom(entries);
    }

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    return this.parseRss(items);
  }

  private parseAtom(entries: string[]): RawItem[] {
    const results: RawItem[] = [];
    for (const entry of entries) {
      const title = stripTags(extractTag(entry, 'title') ?? '');
      const summary = stripTags(extractTag(entry, 'summary') ?? extractTag(entry, 'content') ?? '');
      const link = extractAttr(entry, 'link', 'href') ?? '';
      const id = extractTag(entry, 'id') ?? link;
      const publishedRaw = extractTag(entry, 'published') ?? extractTag(entry, 'updated') ?? '';
      const published = publishedRaw ? new Date(publishedRaw) : undefined;

      if (!title) continue;
      results.push({
        external_id: id,
        title,
        content: summary,
        url: link || undefined,
        source_name: this.sourceName(link),
        publish_date: isNaN(published?.getTime() ?? NaN) ? undefined : published,
      });
    }
    return results;
  }

  private parseRss(items: string[]): RawItem[] {
    const results: RawItem[] = [];
    for (const item of items) {
      const title = stripTags(extractTag(item, 'title') ?? '');
      const description = stripTags(extractTag(item, 'description') ?? '');
      const link = stripTags(extractTag(item, 'link') ?? '');
      const guid = stripTags(extractTag(item, 'guid') ?? '') || link;
      const pubDateRaw = stripTags(extractTag(item, 'pubDate') ?? '');
      const published = pubDateRaw ? new Date(pubDateRaw) : undefined;

      if (!title) continue;
      results.push({
        external_id: guid,
        title,
        content: description,
        url: link || undefined,
        source_name: this.sourceName(link),
        publish_date: isNaN(published?.getTime() ?? NaN) ? undefined : published,
      });
    }
    return results;
  }

  /** 从链接推断来源名，取域名主体 */
  private sourceName(url: string): string {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return host.split('.')[0] || 'RSS';
    } catch {
      return 'RSS';
    }
  }
}
