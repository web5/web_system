/**
 * 今日一句 —— 欢迎页与对话首条共用同一份，避免两处文案漂移。
 *
 * 取法：按本地日期序数对文案池取模，保证「同一天内两处一致、隔天自动更换」。
 * 后续如需后台可配，改成本地缓存 + 启动拉取即可，调用方不用动。
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

/** 取「今日」的稳定序号（本地时区，按天变化） */
function dayIndex(): number {
  const now = new Date();
  const dayNumber = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
  );
  return ((dayNumber % QUOTES.length) + QUOTES.length) % QUOTES.length;
}

/** 今日一句（欢迎页与对话首条共用） */
export function getDailyQuote(): DailyQuote {
  return QUOTES[dayIndex()];
}
