/**
 * 今日一句 · 冻结池的**类型与常量**（s27 起 DB 存储，runtime 零文件依赖）。
 *
 * 136 条内容逐字取自后台一次性冻结资产 `data/daily-quotes.json`
 * （sha256 6f5fe566dc9191d0dfae0d0211f8132b9492681b514ee4d7f58a9d2676fd0756，
 * 头注溯源 sha16 40339154ec0a54ad），零编造、零运行时生成、零 LLM。
 * 该 JSON 现在只是 seed 与测试的唯一真源；服务运行期只查 DB + 内存缓存，
 * 不 readFileSync、不依赖发布包内的 data/ 目录（2026-11-25 500 根因）。
 *
 * 版权：教材内容仅供个人学习，不对外分发；派生语句为 NCE 原文筛选 / 提炼。
 * 正式上架 / 商用前须另行确认 NCE 教材与译文授权范围（风险归用户）。
 */

/** 冻结池版本：与资产 `version` 字段一致；换池须走新 migration/seed + 新版本常量。 */
export const DAILY_QUOTES_FROZEN_VERSION = 1;
/** 冻结池条数：与资产 `count` 字段一致；service 与 seed 均按此做形状校验。 */
export const DAILY_QUOTES_FROZEN_COUNT = 136;
/** 冻结资产快照 sha256：seed/测试用于防篡改（内容若变必须显式换版本）。 */
export const DAILY_QUOTES_ASSET_SHA256 = '6f5fe566dc9191d0dfae0d0211f8132b9492681b514ee4d7f58a9d2676fd0756';

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
