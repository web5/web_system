/// <reference types="node" />
/**
 * s33 · 册别角标显示契约验收（A3 方案①，原型 d3c3730281e758d8）。
 *
 * 钉住：
 *  ① getDailyQuote(): {cn,en} 签名与返回形状不变（163 V9）；
 *  ② getDailyQuoteMeta(): {book,lessonId} 另开 getter，随当日句一致；
 *  ③ 缓存 items 带 book/lessonId；旧缓存缺 book → meta 降级为空、不崩、不显 undefined；
 *  ④ 兜底句恒 NCE2（至少显册名、课号缺省不编造）；
 *  ⑤ 册名中文映射 BOOK_LABEL 三册齐全，缺省只显册名。
 *  ⑥ dayIndex 本地午夜口径不受影响（角标与取句同源同天）。
 */
import { getDailyQuote, getDailyQuoteMeta, BOOK_LABEL, FALLBACK_QUOTES } from '../utils/daily';

function setCache(raw: unknown): void {
  (globalThis as { wx?: unknown }).wx = {
    getStorageSync: jest.fn((key: string) => (key === 'daily_quotes_pool' ? raw : '')),
    setStorageSync: jest.fn(),
    showToast: jest.fn(),
  };
}

const POOL_WITH_META = [
  { cn: '中文甲', en: 'EN_A', book: 'NCE2', lessonId: 44 },
  { cn: '中文乙', en: 'EN_B', book: 'NCE3', lessonId: 37 },
  { cn: '中文丙', en: 'EN_C', book: 'NCE4', lessonId: 12 },
];

describe('getDailyQuote 契约不变（①）', () => {
  afterEach(() => { jest.useRealTimers(); setCache(null); });
  it('始终只返回 {cn,en} 两字段，不掺 book/lessonId', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    setCache({ version: 2, items: POOL_WITH_META, fetchedAt: Date.now() });
    const q = getDailyQuote();
    expect(Object.keys(q).sort()).toEqual(['cn', 'en']);
  });
});

describe('getDailyQuoteMeta（②③）', () => {
  afterEach(() => { jest.useRealTimers(); setCache(null); });

  it('缓存带 book/lessonId：meta 与当日取句同源同条', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    setCache({ version: 2, items: POOL_WITH_META, fetchedAt: Date.now() });
    const q = getDailyQuote();
    const meta = getDailyQuoteMeta();
    const match = POOL_WITH_META.find((it) => it.cn === q.cn && it.en === q.en);
    expect(match).toBeDefined();
    expect(meta).toEqual({ book: match!.book, lessonId: match!.lessonId });
  });

  it('旧缓存（无 book/lessonId）→ meta 降级为空对象，不崩、不显 undefined', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    setCache({ version: 1, items: [{ cn: '旧句', en: 'OLD' }], fetchedAt: 1 });
    expect(() => getDailyQuoteMeta()).not.toThrow();
    const meta = getDailyQuoteMeta();
    expect(meta.book).toBeUndefined();
    expect(meta.lessonId).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain('undefined');
  });

  it('缓存空 / 全脏 → meta 回落兜底 NCE2，课号缺省不编造', () => {
    setCache({ version: 2, items: [], fetchedAt: 1 });
    const meta = getDailyQuoteMeta();
    expect(meta.book).toBe('NCE2');
    // 兜底句带真实 lessonId 时给出，不编造
    expect(Number.isInteger(meta.lessonId)).toBe(true);
  });

  it('全脏缓存（cn/en 空 / 非对象）→ 取句与角标一致回落兜底，不崩、不 toast（V11）', () => {
    const badCaches: unknown[] = [null, '', {}, { items: 'x' }, { items: [{ cn: '', en: 'X' }] }, { items: [{ cn: 'Y', en: '' }] }];
    for (const bad of badCaches) {
      setCache(bad);
      expect(() => getDailyQuote()).not.toThrow();
      expect(() => getDailyQuoteMeta()).not.toThrow();
      const q = getDailyQuote();
      const meta = getDailyQuoteMeta();
      expect(FALLBACK_QUOTES.some((f: any) => f.cn === q.cn && f.en === q.en)).toBe(true);
      expect(meta.book).toBe('NCE2');
      expect((globalThis as any).wx.showToast).not.toHaveBeenCalled();
    }
  });
});

describe('册名映射与兜底（④⑤）', () => {
  it('BOOK_LABEL 三册齐全、中文正确', () => {
    expect(BOOK_LABEL).toEqual({
      NCE2: '新概念二册',
      NCE3: '新概念三册',
      NCE4: '新概念四册',
    });
  });

  it('兜底池恒 NCE2，source.book 存在（角标至少显册名）', () => {
    expect(FALLBACK_QUOTES.length).toBeGreaterThan(0);
    for (const f of FALLBACK_QUOTES as any[]) {
      expect(f.source.book).toBe('NCE2');
    }
  });
});

describe('本地午夜同源（⑥）', () => {
  afterEach(() => { jest.useRealTimers(); setCache(null); });
  it('同天 meta 稳定、隔天随取句变（东八锚点，不采 UTC）', () => {
    const prevTZ = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Shanghai';
      setCache({ version: 2, items: POOL_WITH_META, fetchedAt: 1 });
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-24T05:00:00Z')); // 13:00 +08
      const m1 = getDailyQuoteMeta();
      const q1 = getDailyQuote();
      expect(getDailyQuoteMeta()).toEqual(m1);
      jest.setSystemTime(new Date('2026-11-25T05:00:00Z')); // 次日 13:00 +08
      const q2 = getDailyQuote();
      expect(q2).not.toEqual(q1);
      expect(getDailyQuoteMeta()).not.toEqual(m1);
    } finally {
      if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
      jest.useRealTimers();
    }
  });
});
