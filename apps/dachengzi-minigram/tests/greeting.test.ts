import {
  GREETINGS,
  DEFAULT_NICKNAME,
  NICKNAME_MAX_CHARS,
  getGreeting,
  getLocalHour,
  formatGreeting,
  resolveNickname,
} from '../utils/greeting';

/**
 * 测试侧的字素簇计数（与被测实现的回退算法互相独立：优先用运行时 Intl.Segmenter，
 * 这样「实现算错簇」不会因为「测试用同一套算法算簇」而双双算错、假绿）。
 * 本机 node22 / CI node 均带 Segmenter；万一没有则退回码点计数并让断言自然失败。
 */
const graphemeCount = (s: string): number => {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(i: string): Iterable<{ segment: string }> } }).Segmenter;
  if (typeof Seg === 'function') {
    const seg = new Seg('zh', { granularity: 'grapheme' });
    return Array.from(seg.segment(s)).length;
  }
  return Array.from(s).length;
};

describe('getGreeting（① 5 段时段表 · 纯函数）', () => {
  const boundaries: Array<[number, string]> = [
    [0, '夜深了'], [5, '夜深了'],
    [6, '早上好'], [11, '早上好'],
    [12, '中午好'], [13, '中午好'],
    [14, '下午好'], [17, '下午好'],
    [18, '晚上好'], [23, '晚上好'],
  ];

  it.each(boundaries)('hour=%i → %s', (hour: number, expected: string) => {
    expect(getGreeting(hour)).toBe(expected);
  });

  it('文案表恰为 5 段、文案与区间固定（文案只在此一处定义）', () => {
    expect(GREETINGS.map((g) => g.text)).toEqual(['夜深了', '早上好', '中午好', '下午好', '晚上好']);
    expect(GREETINGS.map((g) => [g.start, g.end])).toEqual([
      [0, 6], [6, 12], [12, 14], [14, 18], [18, 24],
    ]);
  });

  it('跨段边界 ±1 分钟不串段（经 getLocalHour 取本地小时）', () => {
    const pick = (d: Date) => getGreeting(getLocalHour(d));
    expect(pick(new Date(2026, 0, 15, 5, 59, 0))).toBe('夜深了');
    expect(pick(new Date(2026, 0, 15, 6, 0, 0))).toBe('早上好');
    expect(pick(new Date(2026, 0, 15, 11, 59, 0))).toBe('早上好');
    expect(pick(new Date(2026, 0, 15, 12, 0, 0))).toBe('中午好');
    expect(pick(new Date(2026, 0, 15, 13, 59, 0))).toBe('中午好');
    expect(pick(new Date(2026, 0, 15, 14, 0, 0))).toBe('下午好');
    expect(pick(new Date(2026, 0, 15, 17, 59, 0))).toBe('下午好');
    expect(pick(new Date(2026, 0, 15, 18, 0, 0))).toBe('晚上好');
    expect(pick(new Date(2026, 0, 15, 23, 59, 0))).toBe('晚上好');
    expect(pick(new Date(2026, 0, 16, 0, 0, 0))).toBe('夜深了');
  });

  it('越界 / 非有限输入确定性兜底、不抛异常、输出恒在 5 段文案内', () => {
    const all = GREETINGS.map((g) => g.text);
    for (const hour of [-1, -100, 24, 25, 999, NaN, Infinity, -Infinity, 3.7, -0.5]) {
      expect(() => getGreeting(hour)).not.toThrow();
      const a = getGreeting(hour);
      expect(a).toBe(getGreeting(hour)); // 同一输入恒定同一输出
      expect(all).toContain(a);
    }
  });
});

describe('formatGreeting（① 昵称三态 · 展示「<昵称>，<问候语>」）', () => {
  it('有值：昵称 + 中文逗号 + 时段问候', () => {
    expect(formatGreeting('小橙', 15)).toBe('小橙，下午好');
    expect(formatGreeting('小橙', 3)).toBe('小橙，夜深了');
  });

  it('undefined / null / 空串 / 纯空白 → 兜底「同学」', () => {
    expect(formatGreeting(undefined, 9)).toBe('同学，早上好');
    expect(formatGreeting(null, 9)).toBe('同学，早上好');
    expect(formatGreeting('', 9)).toBe('同学，早上好');
    expect(formatGreeting('   ', 9)).toBe('同学，早上好');
    expect(DEFAULT_NICKNAME).toBe('同学');
  });

  it('wx_ 占位昵称按「未设置」处理（镜像 services/account.ts isNicknameUnset）', () => {
    expect(formatGreeting('wx_abc123', 20)).toBe('同学，晚上好');
    expect(formatGreeting(' wx_abc123 ', 20)).toBe('同学，晚上好');
  });

  it('输出恒非空、恒含中文逗号、不含半角逗号拼接', () => {
    for (const h of [0, 6, 12, 14, 18, 23]) {
      const s = formatGreeting('小橙', h);
      expect(s.length).toBeGreaterThan(0);
      expect(s).toContain('，');
      expect(s).not.toBe('小橙,下午好');
    }
  });

  it('长昵称截断到 16 字素簇（PRD 默认 ①-2），不破版 —— 断言精确 16（上下界都锁）', () => {
    const long = '一二三四五六七八九十一二三四五六七八'; // 18 字
    const s = formatGreeting(long, 6);
    expect(s.endsWith('，早上好')).toBe(true);
    const nick = s.slice(0, s.indexOf('，'));
    // 精确等号：只写 toBeLessThanOrEqual(16) 时，把实现里的 16 改成 4 也照样全绿（假绿）。
    expect(Array.from(nick).length).toBe(16);
    expect(nick).toBe('一二三四五六七八九十一二三四五六');
  });

  it('17 码点(=17 簇) → 恰好 16；20 个 emoji → 16 簇且无 lone surrogate', () => {
    const nick17 = 'abcdefghijklmnopq'; // 17 码点
    const s17 = formatGreeting(nick17, 6);
    const cut17 = s17.slice(0, s17.indexOf('，'));
    expect(Array.from(cut17).length).toBe(16);
    expect(cut17).toBe('abcdefghijklmnop');

    // 20 个 emoji（每个都是代理对，1 簇）→ 16 簇 = 16 个 emoji，且不得截出半个代理对
    const emoji20 = '😀'.repeat(20);
    const sEmoji = formatGreeting(emoji20, 6);
    const cutEmoji = sEmoji.slice(0, sEmoji.indexOf('，'));
    expect(Array.from(cutEmoji).length).toBe(16);
    expect(cutEmoji).toBe('😀'.repeat(16));
    // lone surrogate：高代理后不跟低代理 / 低代理前没有高代理
    expect(cutEmoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(cutEmoji).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('区域指示符（🇨🇳 由 2 码点组成）→ 按【字素簇】截断，末位是完整旗帜，绝不切出孤立 U+1F1E8', () => {
    // 盲测 P2-2：'a'×15 + '🇨🇳'(U+1F1E8 U+1F1F3) = 17 码点 / 16 簇。
    // 旧实现按码点截断 → '\u{1F1E8}' 孤立代理区指示符（半个旗帜，渲染成字母 C 或豆腐块）。
    // 新口径（产品已拍板）：单位是字素簇，16 簇 → 一面完整旗帜必须整块保留。
    const nick = 'a'.repeat(15) + '🇨🇳';
    const s = formatGreeting(nick, 6);
    const cut = s.slice(0, s.indexOf('，'));
    expect(graphemeCount(cut)).toBe(16);
    expect(cut).toBe('a'.repeat(15) + '🇨🇳');
    expect(cut.endsWith('🇨🇳')).toBe(true);
    // 区域指示符必须成对（奇数个 = 一定有半个旗帜）
    const ri = cut.match(/[\u{1F1E6}-\u{1F1FF}]/gu) ?? [];
    expect(ri.length).toBe(2);
    expect(ri.length % 2).toBe(0);
  });
});

describe('getLocalHour（① 跟随设备本地时区 · new Date().getHours()）', () => {
  it('取值来自 getHours（本地时区）而非 getUTCHours', () => {
    const mockDate = { getHours: () => 15, getUTCHours: () => 7 } as unknown as Date;
    expect(getLocalHour(mockDate)).toBe(15);
    expect(getGreeting(getLocalHour(mockDate))).toBe('下午好');
  });

  it('同一 hour 在不同 mock Date（UTC 小时不同）下 → 同一问候，证明只认本地小时', () => {
    const a = { getHours: () => 12, getUTCHours: () => 4 } as unknown as Date;
    const b = { getHours: () => 12, getUTCHours: () => 20 } as unknown as Date;
    expect(a.getUTCHours()).not.toBe(b.getUTCHours());
    expect(formatGreeting('小橙', getLocalHour(a))).toBe('小橙，中午好');
    expect(formatGreeting('小橙', getLocalHour(b))).toBe('小橙，中午好');
  });

  it('同一 UTC 小时、不同设备本地小时 → 不同问候（不写死 UTC+8、不引时区库）', () => {
    const morning = { getHours: () => 9, getUTCHours: () => 1 } as unknown as Date;
    const night = { getHours: () => 23, getUTCHours: () => 1 } as unknown as Date;
    expect(morning.getUTCHours()).toBe(night.getUTCHours());
    expect(getGreeting(getLocalHour(morning))).toBe('早上好');
    expect(getGreeting(getLocalHour(night))).toBe('晚上好');
  });

  it('无参可调用（默认 new Date()），返回 0–23 的本地小时', () => {
    const h = getLocalHour();
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });
});

describe('resolveNickname · 按【字素簇】截断（P2-2 新口径：绝不切半 emoji）', () => {
  it('NICKNAME_MAX_CHARS 语义是「字素簇」，值仍为 16（口径改了、上限没改）', () => {
    expect(NICKNAME_MAX_CHARS).toBe(16);
  });

  it('恰好 16 簇不截断、17 簇截到 16（ASCII 与中文各一遍，上下界都锁）', () => {
    expect(resolveNickname('a'.repeat(16))).toBe('a'.repeat(16));
    expect(resolveNickname('a'.repeat(17))).toBe('a'.repeat(16));
    const cn16 = '一二三四五六七八九十一二三四五六';
    expect(Array.from(cn16).length).toBe(16);
    expect(resolveNickname(cn16)).toBe(cn16); // 16 字不截断
    expect(resolveNickname(cn16 + '七')).toBe(cn16); // 17 字截到 16 字
  });

  it('16 面国旗（32 码点 / 16 簇）全部保留，一面都不切半', () => {
    const flags = '🇨🇳🇺🇸🇯🇵🇰🇷🇬🇧🇫🇷🇩🇪🇮🇹🇪🇸🇨🇦🇦🇺🇧🇷🇷🇺🇮🇳🇹🇭🇻🇳';
    expect(Array.from(flags).length).toBe(32); // 32 码点
    expect(graphemeCount(flags)).toBe(16); // 16 簇
    // 16 簇 = 上限，不截断：一面不少、无孤立区域指示符
    expect(resolveNickname(flags)).toBe(flags);
    const ri = resolveNickname(flags).match(/[\u{1F1E6}-\u{1F1FF}]/gu) ?? [];
    expect(ri.length).toBe(32);
  });

  it('ZWJ 家庭（👨‍👩‍👧‍👦 = 4 emoji + 3×U+200D = 7 码点）计 1 簇；\'a\'×15 + 家庭 → 完整保留', () => {
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}';
    expect(Array.from(family).length).toBe(7); // 7 码点
    expect(graphemeCount(family)).toBe(1); // 1 簇
    const nick = 'a'.repeat(15) + family;
    const cut = resolveNickname(nick);
    expect(graphemeCount(cut)).toBe(16);
    expect(cut).toBe(nick);
    expect(cut.endsWith(family)).toBe(true);
    expect(cut.endsWith('\u200d')).toBe(false); // 不得切在连接符后（= 半个家庭）
  });

  it('肤色修饰 👍🏽（U+1F44D + U+1F3FD）计 1 簇，不被拆成两簇', () => {
    const thumbs = '\u{1F44D}\u{1F3FD}';
    expect(Array.from(thumbs).length).toBe(2); // 2 码点
    expect(graphemeCount(thumbs)).toBe(1); // 1 簇
    const nick = 'a'.repeat(15) + thumbs;
    const cut = resolveNickname(nick);
    expect(cut).toBe(nick);
    expect(cut.endsWith(thumbs)).toBe(true);
  });

  it('变体选择符 ❤️（U+2764 + U+FE0F）计 1 簇，不被拆成「黑白心 + 孤立 FE0F」', () => {
    const heart = '\u2764\uFE0F';
    expect(Array.from(heart).length).toBe(2); // 2 码点
    expect(graphemeCount(heart)).toBe(1); // 1 簇
    const nick = 'a'.repeat(15) + heart;
    const cut = resolveNickname(nick);
    expect(cut).toBe(nick);
    expect(cut.endsWith('\uFE0F')).toBe(true);
  });

  it('组合附加符 e + U+0301 计 1 簇，不把重音符号切下来', () => {
    const eAcute = 'e\u0301';
    expect(graphemeCount(eAcute)).toBe(1);
    const nick = 'x'.repeat(15) + eAcute;
    const cut = resolveNickname(nick);
    expect(cut).toBe(nick);
    expect(cut.endsWith('e\u0301')).toBe(true);
  });

  it('奇数个区域指示符：15a + 🇨🇳🇺 = 17 簇 → 截到 16 簇，只留完整旗帜不留半个', () => {
    // 15 + 2 簇 = 17 > 16 → 末位簇是落单的 RI（它本身自成一簇，截断点落在簇边界上）
    const nick = 'a'.repeat(15) + '🇨🇳🇺';
    expect(resolveNickname(nick)).toBe('a'.repeat(15) + '🇨🇳');
  });
});

describe('resolveNickname · 回退分支（老基础库无 Intl.Segmenter）与主分支结果一致', () => {
  const intl = Intl as unknown as { Segmenter?: unknown };
  const realSegmenter = intl.Segmenter;

  const samples: string[] = [
    'a'.repeat(15) + '🇨🇳',
    '🇨🇳🇺🇸🇯🇵🇰🇷🇬🇧🇫🇷🇩🇪🇮🇹🇪🇸🇨🇦🇦🇺🇧🇷🇷🇺🇮🇳🇹🇭🇻🇳',
    'a'.repeat(15) + '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}',
    'a'.repeat(15) + '\u{1F44D}\u{1F3FD}',
    'a'.repeat(15) + '\u2764\uFE0F',
    'x'.repeat(15) + 'e\u0301',
    '一二三四五六七八九十一二三四五六七八',
    '😀'.repeat(20),
  ];

  beforeEach(() => {
    // 强制走内置回退切分（模拟小程序基础库 / 老设备没有 Segmenter）
    intl.Segmenter = undefined;
  });

  afterAll(() => {
    intl.Segmenter = realSegmenter;
  });

  it.each(samples)('回退路径结果 == Segmenter 路径结果：%s', (sample: string) => {
    intl.Segmenter = undefined;
    const fallback = resolveNickname(sample);
    intl.Segmenter = realSegmenter;
    const primary = resolveNickname(sample);
    expect(fallback).toBe(primary);
    // 回退路径同样不得切出孤立代理项 / 半个旗帜
    expect(fallback).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(fallback).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    const ri = fallback.match(/[\u{1F1E6}-\u{1F1FF}]/gu) ?? [];
    expect(ri.length % 2).toBe(0);
  });

  it('回退路径下 16 面国旗原样保留（该断言在码点实现下必红）', () => {
    intl.Segmenter = undefined;
    const flags = '🇨🇳🇺🇸🇯🇵🇰🇷🇬🇧🇫🇷🇩🇪🇮🇹🇪🇸🇨🇦🇦🇺🇧🇷🇷🇺🇮🇳🇹🇭🇻🇳';
    expect(resolveNickname(flags)).toBe(flags);
  });

  it('回退路径下 ZWJ 家庭整块保留（删掉 ZWJ 处理该断言必红）', () => {
    intl.Segmenter = undefined;
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}';
    const nick = 'a'.repeat(15) + family;
    expect(resolveNickname(nick)).toBe(nick);
    const over = 'a'.repeat(16) + family; // 17 簇 → 截掉家庭，但不得留半个
    expect(resolveNickname(over)).toBe('a'.repeat(16));
    expect(resolveNickname(over).endsWith('\u200d')).toBe(false);
  });
});

