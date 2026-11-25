/**
 * 今日一句 —— 首页「今日一句」模块文案源（阶段③ S4 · 服务端存储）。
 *
 * 取法：显示源为**本地缓存池** `daily_quotes_pool`（由 services/daily-quotes.ts 在登录态内
 * 静默拉取 content-hub 冻结 JSON 资产后写入）；本模块运行时只读现成数据，不调 LLM、
 * 不生成、原文不出本机。缓存空 / 失效 / 全脏 → 回落 B③ 极薄兜底（10 条 NCE 逐字精选句）。
 *
 * 不变量（锁死）：
 *  - getDailyQuote(): DailyQuote 同步签名与 { cn, en } 返回形状**不变** →
 *    唯一调用点 pages/home/index/index.ts 零改动，index.wxml 渲染不变。
 *  - dayIndex() 本地午夜口径 new Date(y, m, d).getTime() / 86400000（🔴 不改成 UTC epoch 天数）。
 *  - pickNceLine() 纯函数保留（过滤脏行 / 同句配对 / 确定性取模 / 空池兜底）。
 *  - 全量 1601 原句池 utils/nce-quotes.ts 与 s16 精选池 utils/daily-quotes.ts 保留不删，
 *    仅作溯源底稿 / JSON 生成源，退出显示层随包消费。
 *
 * 版权：教材内容仅供个人学习，不对外分发；派生语句为 NCE 原文筛选 / 提炼。
 */
import { DAILY_QUOTES_CACHE_KEY } from '../services/daily-quotes';

export type DailyQuote = {
  /** 中文原文 */
  cn: string;
  /** 英文原文 */
  en: string;
};

/** 册别角标（A3 / 原型 d3c3730281e758d8）：中文册名映射留前端，book 存规范码。 */
export const BOOK_LABEL: Record<string, string> = {
  NCE2: '新概念二册',
  NCE3: '新概念三册',
  NCE4: '新概念四册',
};

/** 角标锚点：book/lessonId 缺省时为 undefined（旧缓存无 book → UI 隐藏角标，不显 undefined）。 */
export type DailyQuoteMeta = { book?: string; lessonId?: number };

/** 带册别锚点的缓存行：在 {cn,en} 上可选携带 book/lessonId。 */
type MetaQuote = DailyQuote & DailyQuoteMeta;

/** 兜底句出处锚点，仅供溯源留痕，不在 UI 展示 */
type FallbackSource = { book: string; lessonId: number; title: string; lineIndex: number };
type FallbackQuote = DailyQuote & { source: FallbackSource };

/**
 * B③ 极薄兜底池（10 条，替换原 7 条通用句）。
 * 全部逐字取自真实 NCE 原文、带 source 溯源锚点、零编造；从 136 条精选池中挑出，
 * 覆盖 lessonId 2→96 分散取样，保证首启无缓存 / 断网无缓存时显示的仍是精选池原句。
 * 🔴 仅缓存不可用时的确定性回落；source 不进 UI（pickNceLine 只返回 {cn,en}）。
 */
export const FALLBACK_QUOTES: FallbackQuote[] = [
  { cn: "我从不在星期天早起。", en: "I never get up early on Sundays.", source: { book: "NCE2", lessonId: 2, title: "Breakfast or Lunch", lineIndex: 1 } },
  { cn: "在这些场合下，情况总是如此。", en: "It is always the same on these occasions.", source: { book: "NCE2", lessonId: 13, title: "The Greenwood Boys", lineIndex: 13 } },
  { cn: "信件的花费会多一点，但肯定会更快送达。", en: "Letters will cost a little more, but they will certainly travel faster.", source: { book: "NCE2", lessonId: 22, title: "A Glass Envelope", lineIndex: 7 } },
  { cn: "弗兰克回想起他艰难的早年岁月和漫长的成功之路时，露出了笑容。", en: "Frank smiled when he remembered his hard early years and the long road to success.", source: { book: "NCE2", lessonId: 31, title: "Success Story", lineIndex: 9 } },
  { cn: "最终，山姆所有的钱都以这种方式还了回来。", en: "In time, all Sam's money was paid back in this way.", source: { book: "NCE2", lessonId: 45, title: "A Clear Conscience", lineIndex: 9 } },
  { cn: "没有什么比这更烦人的了。", en: "Nothing could have been more annoying.", source: { book: "NCE2", lessonId: 54, title: "Sticky Fingers", lineIndex: 6 } },
  { cn: "大家都因为他出色的幽默感而敬佩他。", en: "Everybody admires him for his fine sense of humor.", source: { book: "NCE2", lessonId: 63, title: "She Was Not Amused", lineIndex: 1 } },
  { cn: "他悄悄溜走时，没有人注意到他。", en: "No one noticed the boy as he crept off.", source: { book: "NCE2", lessonId: 73, title: "The Record", lineIndex: 13 } },
  { cn: "这次，尽管那位警察有点怀疑，但他还是做了同样的回答。", en: "Though a little suspicious this time, the policeman gave him the same answer.", source: { book: "NCE2", lessonId: 83, title: "After the Elections", lineIndex: 7 } },
  { cn: "整夜，人们都在跳舞唱歌。", en: "All night long, people dance and sing.", source: { book: "NCE2", lessonId: 96, title: "The Dead Return", lineIndex: 7 } },
];

/** 读本地缓存池；任何异常 / 脏结构 → 空数组（交给 pickNceLine 回落兜底），绝不抛到 UI。
 *  透传 book/lessonId（旧缓存缺字段 → 保持 undefined，由 UI 降级隐藏角标）。 */
function readCachedPool(): MetaQuote[] {
  try {
    const raw = wx.getStorageSync(DAILY_QUOTES_CACHE_KEY);
    if (!raw || typeof raw !== 'object') return [];
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.filter((it): it is MetaQuote =>
      !!it && typeof it === 'object'
      && typeof (it as MetaQuote).cn === 'string' && (it as MetaQuote).cn.length > 0
      && typeof (it as MetaQuote).en === 'string' && (it as MetaQuote).en.length > 0);
  } catch {
    return [];
  }
}

/** 取「今日」的稳定序号（本地时区，按天变化）—— 本地日期序数，不改成 UTC epoch 天数。 */
function dayIndex(): number {
  const now = new Date();
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
  );
}

/** 今日一句（签名 { cn, en } 与「同天稳定 / 隔天换」行为完全不变）。 */
export function getDailyQuote(): DailyQuote {
  return pickNceLine(dayIndex(), readCachedPool());
}

/**
 * 今日一句的册别锚点（A3 角标）；与 getDailyQuote() 同源同天同条。
 * 缓存行缺 book/lessonId（旧缓存）→ 返回 undefined 字段，UI 据此隐藏角标，不编造。
 * 兜底路径恒 NCE2，取兜底句的 source.book/lessonId（真实锚点，非编造）。
 */
export function getDailyQuoteMeta(): DailyQuoteMeta {
  const pool = readCachedPool().filter(
    (l) => typeof l.cn === 'string' && l.cn.length > 0 && typeof l.en === 'string' && l.en.length > 0,
  );
  const day = dayIndex();
  if (pool.length === 0) {
    const fb = FALLBACK_QUOTES[normalizeIndex(day, FALLBACK_QUOTES.length)];
    return { book: fb.source.book, lessonId: fb.source.lessonId };
  }
  const picked = pool[normalizeIndex(day, pool.length)];
  return { book: picked.book, lessonId: picked.lessonId };
}

/** 把任意 dayNumber 归一化为 [0, len) 下标：负数 / 超大 / 小数 / 非有限值均安全，不抛异常。 */
function normalizeIndex(dayNumber: number, len: number): number {
  if (len <= 0 || !Number.isFinite(dayNumber)) return 0;
  const n = Math.trunc(dayNumber);
  return ((n % len) + len) % len;
}

/**
 * 句池选取纯函数。
 * 由调用方注入 lines（中英已配对的句池）；getDailyQuote() 注入本地缓存池：
 *  - 过滤掉 cn / en 任一为空的脏行，只保留同时非空的行；
 *  - 保证 cn 与 en 来自**同一个**注入行（配对性，不允许中英各取一句）；
 *  - 按 dayNumber 确定性取模（同天稳定、隔天换、按句池长度 N 轮回）；
 *  - 空池 / 全脏行 / 单元素 / dayNumber 负数或超大 → 回落 FALLBACK_QUOTES（10 条 NCE 逐字句），
 *    确定性、不抛异常、不弹 toast；
 *  - 返回恒为 { cn, en } 两字段结构，source 仅留痕不进 UI。
 */
export function pickNceLine(dayNumber: number, lines: readonly DailyQuote[]): DailyQuote {
  const pool = (Array.isArray(lines) ? lines : []).filter(
    (l) => !!l && typeof l.cn === 'string' && l.cn.length > 0
      && typeof l.en === 'string' && l.en.length > 0,
  );

  if (pool.length === 0) {
    const q = FALLBACK_QUOTES[normalizeIndex(dayNumber, FALLBACK_QUOTES.length)];
    return { cn: q.cn, en: q.en };
  }

  const picked = pool[normalizeIndex(dayNumber, pool.length)];
  // 只取同一行的 cn/en，构造新对象 → 结构上保证配对、且恒为 { cn, en }
  return { cn: picked.cn, en: picked.en };
}
