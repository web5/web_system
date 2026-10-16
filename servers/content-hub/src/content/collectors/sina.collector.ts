/**
 * 新浪财经滚动资讯采集器（p35 · CQO）。
 *
 * 收敛说明：旧套 `servers/content-hub/src/collectors/collector.ts` 的 `collectSina()`
 * 已能跑，但**不实现 ICollector**、也不产出 `external_id`，无法进统一管道。
 * 本文件是同一数据源的 ICollector 形态实现（旧 collector 保留不动，供
 * `finnews.service.ts` 继续用——那 370 行承载情绪分析/板块识别/实体抽取，属红线）。
 *
 * 双写期两套并存是**刻意**的：旧套继续写 topics/news，新套同步写 content_items，
 * 行数由 FinnewsAdapterService 对账。
 *
 * 约束：失败 `return []` 不抛异常（与既有约定一致，避免上游抖动中断定时任务）。
 */
import { createHash } from 'node:crypto';
import { ICollector, RawItem } from './collector.interface';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 与旧 collector 一致的条数上限，防拉爆 */
const MAX_ITEMS = 100;

const SINA_API = 'https://feed.mix.sina.com.cn/api/roll/get';

/** 新浪快讯原始行（只声明实际读到的字段） */
interface SinaRow {
  title?: string;
  intro?: string;
  url?: string;
  ctime?: string | number;
}

function parseCtime(ctime: unknown): Date | undefined {
  if (!ctime) return undefined;
  const ts = Number(String(ctime).slice(0, 10));
  if (!Number.isFinite(ts) || ts <= 0) return undefined;
  const d = new Date(ts * 1000);
  return isNaN(d.getTime()) ? undefined : d;
}

export class SinaCollector implements ICollector {
  readonly code = 'sina_news';

  async collect(
    config: Record<string, unknown> = {},
    limit = 20,
  ): Promise<RawItem[]> {
    const cap = Math.min(Number(limit) || 20, MAX_ITEMS);
    const url = `${SINA_API}?pageid=153&lid=2516&num=${cap}`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
    });
    if (!resp.ok) return [];

    const data = await resp.json();
    const items = (data?.result?.data ?? []) as SinaRow[];
    if (!Array.isArray(items)) return [];

    const results: RawItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const url_ = String(item.url ?? '');
      const content = String(item.intro ?? '');
      const title = String(item.title ?? '') || content;
      if (!title) continue;

      results.push({
        /**
         * external_id 用 `sha1(url|title)`。
         * 精确去重靠 (pipeline_id, external_id) 唯一索引，近似去重靠 SimHash ——
         * 快讯常是同一事件的不同来源改写版，精确匹配去不掉。
         */
        external_id: createHash('sha1')
          .update(`${url_}|${title}`)
          .digest('hex'),
        title,
        content: content || title,
        url: url_ || undefined,
        source_name: '新浪财经',
        publish_date: parseCtime(item.ctime),
        meta: {
          // 原 source_type 信息装进 meta（原字段表达的是「这是爬来的」，由 code 承载语义）
          legacy_source_type: 'crawler',
        },
      });
    }
    return results;
  }
}
