/**
 * 今日一句 · 精选池拉取（阶段③ S4）。
 *
 * 后台一次性从真实 NCE 原文迁用筛选 136 条精选句，冻结为 content-hub 只读 JSON 资产
 * （见 servers/content-hub/data/daily-quotes.json 头注），经网关用户 JWT 只读通道下发。
 * 本服务只做「静默拉取 → 基本形状校验 → 写本地缓存」，运行时不调 LLM、不生成、原文不出本机。
 *
 * 版权：教材内容仅供个人学习，不对外分发；派生语句为 NCE 原文筛选 / 提炼。
 * 正式上架 / 商用前须另行确认 NCE 教材与译文授权范围（风险归用户）。
 */
import { request } from '../utils/request';

const ENDPOINT = '/api/content-admin/nce/daily-quotes';

/** 本地缓存键（中性命名；source 仅留痕、不进缓存、不进 UI） */
export const DAILY_QUOTES_CACHE_KEY = 'daily_quotes_pool';

export type CachedQuote = { cn: string; en: string };
export type CachedPool = {
  version: number;
  items: CachedQuote[];
  fetchedAt: number;
};

type PoolBody = {
  version: number;
  count: number;
  items: Array<{ cn: string; en: string; source: unknown }>;
};

/** 服务端 data 形状校验：version/count 整数、items 数组、count 自洽、每条 cn/en 非空且带 source。 */
export function isValidPoolBody(data: unknown): data is PoolBody {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Partial<PoolBody>;
  if (!Number.isInteger(d.version) || !Number.isInteger(d.count)) return false;
  if (!Array.isArray(d.items) || d.items.length !== d.count || d.items.length === 0) return false;
  return d.items.every((it) =>
    !!it && typeof it === 'object'
    && typeof it.cn === 'string' && it.cn.length > 0
    && typeof it.en === 'string' && it.en.length > 0
    && !!it.source && typeof it.source === 'object');
}

/** 把服务端 data 剥成缓存结构：只留 {cn,en}（source 不进缓存/UI），写缓存时间。 */
export function toCachePool(data: PoolBody, now: number = Date.now()): CachedPool {
  return {
    version: data.version,
    items: data.items.map((it) => ({ cn: it.cn, en: it.en })),
    fetchedAt: now,
  };
}

/**
 * 启动静默预取：失败 / 非 2xx / 非 0 信封 / 脏响应一律 silent 吞掉、不写缓存。
 * request({silent:true}) 保证失败不弹 toast；外层 try/catch 再兜底不抛到 UI。
 * 保留旧缓存（stale-while-error）：只在拿到合法池时才覆盖写入。
 */
export async function prefetchDailyQuotes(): Promise<void> {
  try {
    const res = await request<unknown>({ url: ENDPOINT, silent: true, method: 'GET' });
    if (!res || typeof res !== 'object') return;
    const wrapped = res as { code?: unknown; data?: unknown };
    if (wrapped.code !== 0 || !isValidPoolBody(wrapped.data)) return;
    const pool = toCachePool(wrapped.data);
    try {
      wx.setStorageSync(DAILY_QUOTES_CACHE_KEY, pool);
    } catch {
      // 存储写入失败（空间满等）：静默跳过，保留旧缓存
    }
  } catch {
    // 断网 / 未登录 / 非 2xx：request 已 silent 不弹 toast，这里只吞错、不写缓存
  }
}
