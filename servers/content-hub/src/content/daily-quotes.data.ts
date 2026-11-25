/**
 * 今日一句 · 服务端冻结内容资产只读加载器。
 *
 * 该资产由后台一次性从 s16 的 136 条精选句迁用导出（见 daily-quotes.json 头注），
 * 逐字取自 lessons.json（sha16 40339154ec0a54ad），零编造、零运行时生成、零 LLM。
 * 运行时只做「读文件 → 基本形状校验 → 内存缓存」，不改内容、不落库、不发外部请求。
 *
 * 版权：教材内容仅供个人学习，不对外分发；派生语句为 NCE 原文筛选 / 提炼。
 * 正式上架 / 商用前须另行确认 NCE 教材与译文授权范围（风险归用户）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type DailyQuoteSource = {
  book: string;
  lessonId: number;
  title: string;
  lineIndex: number;
};

export type DailyQuoteItem = {
  cn: string;
  en: string;
  source: DailyQuoteSource;
};

export type DailyQuotesPool = {
  version: number;
  count: number;
  items: DailyQuoteItem[];
};

/**
 * 资产路径：优先相对 cwd（content-hub 服务根），回退相对本文件（dist/src 两种布局）。
 * 服务部署时该 JSON 随 content-hub 一起发布到同一相对位置（dev/prod 各一份）。
 */
export const DAILY_QUOTES_ASSET_PATH = resolve(
  __dirname,
  '../../data/daily-quotes.json',
);

let cached: DailyQuotesPool | null = null;

function isValidItem(x: unknown): x is DailyQuoteItem {
  if (!x || typeof x !== 'object') return false;
  const q = x as Partial<DailyQuoteItem>;
  if (typeof q.cn !== 'string' || q.cn.length === 0) return false;
  if (typeof q.en !== 'string' || q.en.length === 0) return false;
  const s = q.source as Partial<DailyQuoteSource> | undefined;
  if (!s || typeof s !== 'object') return false;
  return (
    typeof s.book === 'string'
    && Number.isInteger(s.lessonId)
    && typeof s.title === 'string'
    && Number.isInteger(s.lineIndex)
  );
}

/** 读取冻结资产（首次读盘 + 形状校验，之后走内存缓存）；形状非法直接抛，属部署错误不该静默吞。 */
export function loadDailyQuotesPool(): DailyQuotesPool {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(DAILY_QUOTES_ASSET_PATH, 'utf-8'));
  if (
    !raw
    || !Number.isInteger(raw.version)
    || !Number.isInteger(raw.count)
    || !Array.isArray(raw.items)
    || raw.items.length !== raw.count
    || !raw.items.every(isValidItem)
  ) {
    throw new Error('[daily-quotes] frozen asset shape invalid');
  }
  cached = { version: raw.version, count: raw.count, items: raw.items };
  return cached;
}
