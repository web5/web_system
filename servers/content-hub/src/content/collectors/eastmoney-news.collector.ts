/**
 * 东方财富快讯采集器（p35 · CQO）。
 *
 * 收敛说明：同 sina.collector —— 旧套 `collectEastMoney()` 能跑但不实现 ICollector，
 * 旧 collector 保留不动（红线），本文件提供统一管道形态。
 *
 * 约束：失败 `return []` 不抛异常（与既有约定一致）。
 */
import { createHash } from 'node:crypto';
import { ICollector, RawItem } from './collector.interface';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_ITEMS = 100;

const EM_FAST_NEWS =
  'https://np-listapi.eastmoney.com/comm/web/getFastNewsList';

/** 东财快讯原始行（只声明实际读到的字段） */
interface EmNewsRow {
  title?: string;
  summary?: string;
  url?: string;
  showTime?: string;
  code?: string;
}

function parseShowTime(showTime: unknown): Date | undefined {
  if (!showTime) return undefined;
  // "2026-08-12 10:03:43" → 本地时间
  const d = new Date(String(showTime).replace(' ', 'T'));
  return isNaN(d.getTime()) ? undefined : d;
}

export class EastmoneyNewsCollector implements ICollector {
  readonly code = 'eastmoney_news';

  async collect(
    config: Record<string, unknown> = {},
    limit = 20,
  ): Promise<RawItem[]> {
    const cap = Math.min(Number(limit) || 20, MAX_ITEMS);
    const url =
      `${EM_FAST_NEWS}?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${cap}` +
      `&req_trace=10000000000000`;

    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!resp.ok) return [];

    const data = await resp.json();
    const items = (data?.data?.fastNewsList ?? []) as EmNewsRow[];
    if (!Array.isArray(items)) return [];

    const results: RawItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const link = String(item.url ?? '');
      const content = String(item.summary ?? '');
      const title = String(item.title ?? '') || content;
      if (!title) continue;

      // 东财快讯的 url 常为空，用 code（资讯 ID）兜底做 external_id
      const stableKey = link || String(item.code ?? '') || title;

      results.push({
        external_id: createHash('sha1')
          .update(`${stableKey}|${title}`)
          .digest('hex'),
        title,
        content: content || title,
        url: link || undefined,
        source_name: '东方财富',
        publish_date: parseShowTime(item.showTime),
        meta: {
          legacy_source_type: 'crawler',
          em_news_code: item.code ?? null,
        },
      });
    }
    return results;
  }
}
