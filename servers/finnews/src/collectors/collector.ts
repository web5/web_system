/** 财经资讯采集器（新浪财经 + 东方财富 JSON API） */

export interface RawNews {
  title: string;
  content: string;
  source_name: string;
  source_url: string;
  source_type: string;
  publish_date: Date | null;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 按点号路径取值 */
function getByPath(data: unknown, path: string): unknown {
  let cur: any = data;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** 新浪财经滚动资讯采集 */
export async function collectSina(limit = 20): Promise<RawNews[]> {
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=${limit}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://finance.sina.com.cn/' },
  });
  if (!resp.ok) return [];
  const data = await resp.json();

  const items = (getByPath(data, 'result.data') as any[]) ?? [];
  const results: RawNews[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    let title = String(item.title ?? '');
    const content = String(item.intro ?? '');
    if (!title) title = content;
    results.push({
      title,
      content: content || title,
      source_name: '新浪财经',
      source_url: String(item.url ?? ''),
      source_type: 'crawler',
      publish_date: parseTimestamp(item.ctime),
    });
  }
  return results;
}

/** 东方财富快讯采集 */
export async function collectEastMoney(pageSize = 20): Promise<RawNews[]> {
  const url =
    'https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=' +
    pageSize +
    '&req_trace=10000000000000';
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) return [];
  const data = await resp.json();

  const items = (getByPath(data, 'data.fastNewsList') as any[]) ?? [];
  const results: RawNews[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    let title = String(item.title ?? '');
    const content = String(item.summary ?? '');
    if (!title) title = content;
    results.push({
      title,
      content: content || title,
      source_name: '东方财富',
      source_url: '',
      source_type: 'crawler',
      publish_date: parseShowTime(item.showTime),
    });
  }
  return results;
}

function parseTimestamp(ctime: unknown): Date | null {
  if (!ctime) return null;
  try {
    const ts = Number(String(ctime).slice(0, 10));
    return new Date(ts * 1000);
  } catch {
    return null;
  }
}

function parseShowTime(showTime: unknown): Date | null {
  if (!showTime) return null;
  try {
    // "2026-08-12 10:03:43"
    const d = new Date(String(showTime).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** 采集所有源 */
export async function collectAll(): Promise<RawNews[]> {
  const [sina, eastmoney] = await Promise.all([
    collectSina(20),
    collectEastMoney(20),
  ]);
  return [...sina, ...eastmoney];
}
