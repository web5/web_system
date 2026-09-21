/**
 * 今日一句词库 —— 与 `apps/kedou-ai-minigram/utils/daily.ts` **同源**（7 条，字段 cn/en）。
 *
 * 为什么是复制而不是共享：小程序与 PC 是两个独立产物（微信基础库 / 浏览器），
 * 跨端共享要新开 package 并进两侧构建链，成本高于收益；故两侧各持一份，
 * **改动必须同步另一份**，直到后端运营接口（后端待办 B1）上线后统一改为拉取。
 */

export interface DailyQuote {
  /** 中文原文 */
  cn: string;
  /** 英文原文 */
  en: string;
}

const QUOTES: DailyQuote[] = [
  {
    cn: '我们无法决定风的方向，但可以调整帆的角度。',
    en: 'We cannot direct the wind, but we can adjust the sails.',
  },
  {
    cn: '慢慢来，比较快。',
    en: 'Slow is smooth, smooth is fast.',
  },
  {
    cn: '把问题说清楚，就已经解决了一半。',
    en: 'A problem well stated is a problem half solved.',
  },
  {
    cn: '真正的进步，来自每天一点点。',
    en: 'Real progress comes from a little every day.',
  },
  {
    cn: '不必急于求成，先把眼前这一步走稳。',
    en: 'Do not rush the whole journey; steady the next step.',
  },
  {
    cn: '所有的从容，都是准备出来的。',
    en: 'All composure is prepared in advance.',
  },
  {
    cn: '先完成，再完美。',
    en: 'Done is better than perfect.',
  },
];

/** 取「今日」的稳定序号（本地时区，按天变化），与小程序取法一致 */
export function dayIndex(): number {
  const now = new Date();
  const dayNumber = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
  );
  return ((dayNumber % QUOTES.length) + QUOTES.length) % QUOTES.length;
}

export function getDailyQuote(): DailyQuote {
  return QUOTES[dayIndex()];
}

/** 换一句：在词库内循环（PC 端轻互动补充，小程序无此交互） */
export function nextQuote(index: number): { index: number; quote: DailyQuote } {
  const next = (index + 1) % QUOTES.length;
  return { index: next, quote: QUOTES[next] };
}
