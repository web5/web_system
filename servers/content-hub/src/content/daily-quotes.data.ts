/**
 * 今日一句 · 冻结池的**类型与常量**（s27 起 DB 存储，runtime 零文件依赖）。
 *
 * 281 条内容逐字取自后台一次性冻结资产 `data/daily-quotes.json`
 * （sha256 41e3588e28b05436a7136e684e20f893bd28c11daa4c86ce2d61d3149d0e74f7，
 * 三册头注溯源 sha16：NCE2 40339154ec0a54ad / NCE3 9558256c30524970 /
 * NCE4 4885c6aee9121a2f），零编造、零运行时生成、零 LLM。
 * v2 三册合池：NCE2 136（冻结原样）+ NCE3 80 + NCE4 65，交错编排。
 * 该 JSON 现在只是 seed 与测试的唯一真源；服务运行期只查 DB + 内存缓存，
 * 不 readFileSync、不依赖发布包内的 data/ 目录（2026-11-25 500 根因）。
 *
 * 版权：教材内容仅供个人学习，不对外分发；派生语句为 NCE 原文筛选 / 提炼。
 * 正式上架 / 商用前须另行确认 NCE 教材与译文授权范围（风险归用户）。
 */

/** 冻结池版本：与资产 `version` 字段一致；换池须走新 migration/seed + 新版本常量。 */
export const DAILY_QUOTES_FROZEN_VERSION = 2;
/** 冻结池条数：与资产 `count` 字段一致；service 与 seed 均按此做形状校验。 */
export const DAILY_QUOTES_FROZEN_COUNT = 281;
/** 冻结资产快照 sha256：seed/测试用于防篡改（内容若变必须显式换版本）。 */
export const DAILY_QUOTES_ASSET_SHA256 = '41e3588e28b05436a7136e684e20f893bd28c11daa4c86ce2d61d3149d0e74f7';

/** 册别白名单与课号上限（与 seed 一致；NCE4 官方仅 48 课）。 */
export const DAILY_QUOTE_BOOK_LESSON_MAX: Record<string, number> = {
  NCE2: 96,
  NCE3: 60,
  NCE4: 48,
};

/** 单条 source 形状合法（含册别白名单 + 按册课号上限）。 */
export function dailyQuoteSourceValid(s: { book: string; lessonId: number; title: string; lineIndex: number }): boolean {
  const max = DAILY_QUOTE_BOOK_LESSON_MAX[s.book];
  return max !== undefined
    && Number.isInteger(s.lessonId) && s.lessonId >= 1 && s.lessonId <= max
    && typeof s.title === 'string' && s.title.length > 0
    && Number.isInteger(s.lineIndex) && s.lineIndex >= 0;
}

/** 跨册身份键：含 book，避免三册课号都从 1 起导致的 (lessonId,lineIndex) 碰撞误杀。 */
export function dailyQuoteIdentity(book: string, lessonId: number, lineIndex: number): string {
  return `${book}:${lessonId}:${lineIndex}`;
}

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
