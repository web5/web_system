import {
  GREETINGS,
  DEFAULT_NICKNAME,
  getGreeting,
  getLocalHour,
  formatGreeting,
} from '../utils/greeting';

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

  it('长昵称截断到 16 码点（PRD 默认 ①-2），不破版 —— 断言精确 16（上下界都锁）', () => {
    const long = '一二三四五六七八九十一二三四五六七八'; // 18 字
    const s = formatGreeting(long, 6);
    expect(s.endsWith('，早上好')).toBe(true);
    const nick = s.slice(0, s.indexOf('，'));
    // 精确等号：只写 toBeLessThanOrEqual(16) 时，把实现里的 16 改成 4 也照样全绿（假绿）。
    expect(Array.from(nick).length).toBe(16);
    expect(nick).toBe('一二三四五六七八九十一二三四五六');
  });

  it('17 码点 → 恰好 16 码点；20 个 emoji → 16 码点且无 lone surrogate', () => {
    const nick17 = 'abcdefghijklmnopq'; // 17 码点
    const s17 = formatGreeting(nick17, 6);
    const cut17 = s17.slice(0, s17.indexOf('，'));
    expect(Array.from(cut17).length).toBe(16);
    expect(cut17).toBe('abcdefghijklmnop');

    // 20 个 emoji（每个都是代理对）→ 16 码点，且不得截出半个代理对
    const emoji20 = '😀'.repeat(20);
    const sEmoji = formatGreeting(emoji20, 6);
    const cutEmoji = sEmoji.slice(0, sEmoji.indexOf('，'));
    expect(Array.from(cutEmoji).length).toBe(16);
    expect(cutEmoji).toBe('😀'.repeat(16));
    // lone surrogate：高代理后不跟低代理 / 低代理前没有高代理
    expect(cutEmoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(cutEmoji).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('区域指示符（🇨🇳 由 2 个码点组成）截断 —— 记录【现状】，P2-2 口径待产品拍板', () => {
    // 'a'×15 + '🇨🇳'(U+1F1E8 U+1F1F3) = 17 码点 > 16 → 按码点截断会切出半个旗帜
    // （只剩 U+1F1E8）。这里只锁【当前实现】的行为，不做正确性判断：
    // 是否改成「按字素簇（grapheme）截断」属 P2-2，需产品拍板后另行修改本用例。
    const nick = 'a'.repeat(15) + '🇨🇳';
    const s = formatGreeting(nick, 6);
    const cut = s.slice(0, s.indexOf('，'));
    expect(Array.from(cut).length).toBe(16);
    expect(cut).toBe('a'.repeat(15) + '\u{1F1E8}');
    expect(cut.endsWith('🇨🇳')).toBe(false); // 现状：旗帜被切掉一半（已知遗留 P2-2）
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
