/// <reference types="node" />
/**
 * 阶段③ S4 · 显示段 utils/daily.ts 验收。
 *
 * 口径：显示源从「随包 DAILY_QUOTES」换为「本地缓存池 daily_quotes_pool」（service 拉取后写入）；
 * 缓存空 / 失效 / 全脏 → B③ 极薄兜底（≤10 条 NCE 逐字精选句，带 source，替换原 7 条通用句）。
 * 不变量：getDailyQuote(): {cn,en} 同步签名、dayIndex 本地午夜口径、pickNceLine 纯函数、index.* 零改动。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDailyQuote, FALLBACK_QUOTES, pickNceLine } from '../utils/daily';
import type { DailyQuote } from '../utils/daily';

const ASSET = resolve(__dirname, '../../../servers/content-hub/data/daily-quotes.json');
const asset = JSON.parse(readFileSync(ASSET, 'utf-8'));
const POOL: Array<{ cn: string; en: string }> = asset.items.map((it: any) => ({ cn: it.cn, en: it.en }));

/** 注入缓存池（模拟 service 拉取写盘后的状态）；传 null 表示无缓存。 */
function setCache(raw: unknown): void {
  (globalThis as { wx?: unknown }).wx = {
    getStorageSync: jest.fn((key: string) => (key === 'daily_quotes_pool' ? raw : '')),
    setStorageSync: jest.fn(),
    showToast: jest.fn(),
  };
}

describe('getDailyQuote 读缓存池（服务端下发）', () => {
  afterEach(() => {
    jest.useRealTimers();
    setCache(null);
  });

  it('缓存命中：返回缓存池中的一条，且只含 {cn,en}（source 不进 UI）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    setCache({ version: 1, items: POOL, fetchedAt: Date.now() });
    const q = getDailyQuote();
    expect(Object.keys(q).sort()).toEqual(['cn', 'en']);
    expect(POOL.some((it) => it.cn === q.cn && it.en === q.en)).toBe(true);
  });

  it('同天稳定 / 隔天换（缓存池命中）', () => {
    jest.useFakeTimers();
    setCache({ version: 1, items: POOL, fetchedAt: Date.now() });
    jest.setSystemTime(new Date(2026, 0, 15, 23, 59, 59));
    const a = getDailyQuote();
    const b = getDailyQuote();
    expect(a).toEqual(b);
    jest.setSystemTime(new Date(2026, 0, 16, 0, 0, 1));
    expect(getDailyQuote()).not.toEqual(a);
  });

  it('N 天轮回：第 1 天与第 N+1 天一致（N = 缓存池长度，随资产 v2=281，不硬编码）', () => {
    jest.useFakeTimers();
    setCache({ version: 2, items: POOL, fetchedAt: Date.now() });
    const n = POOL.length;
    expect(n).toBe(281); // v2 资产 count，取模按实际池长（变异「回退 136」会被此断言抓红）
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const a = getDailyQuote();
    jest.setSystemTime(new Date(2026, 0, 1 + n, 8, 0, 0));
    expect(getDailyQuote()).toEqual(a);
  });

  it('缓存空 / 非对象 / items 非数组 / 全脏 → 回落 B③ 极薄兜底，不抛、不白屏、不 toast', () => {
    const badCaches: unknown[] = [null, undefined, '', {}, { items: 'x' }, { items: [] }, { items: [{ cn: '', en: 'X' }] }];
    for (const bad of badCaches) {
      setCache(bad);
      expect(() => getDailyQuote()).not.toThrow();
      const q = getDailyQuote();
      expect(Object.keys(q).sort()).toEqual(['cn', 'en']);
      expect(FALLBACK_QUOTES.some((f: any) => f.cn === q.cn && f.en === q.en)).toBe(true);
      const toast = (globalThis as any).wx.showToast;
      expect(toast).not.toHaveBeenCalled();
    }
  });

  it('stale-while-error：旧缓存存在时持续使用旧池（service 只在成功时覆盖，本层只读缓存）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    const stale = POOL.slice(0, 3);
    setCache({ version: 1, items: stale, fetchedAt: 1 });
    const q = getDailyQuote();
    expect(stale.some((it) => it.cn === q.cn && it.en === q.en)).toBe(true);
  });
});

describe('B③ 极薄兜底池（≤10 条 NCE 逐字精选句，替换原 7 条通用句）', () => {
  it('条数 ≤10 且 >0；每条 {cn,en,source} 结构，cn/en 非空', () => {
    expect(FALLBACK_QUOTES.length).toBeGreaterThan(0);
    expect(FALLBACK_QUOTES.length).toBeLessThanOrEqual(10);
    for (const f of FALLBACK_QUOTES as any[]) {
      expect(Object.keys(f).sort()).toEqual(['cn', 'en', 'source']);
      expect(f.cn.length).toBeGreaterThan(0);
      expect(f.en.length).toBeGreaterThan(0);
      expect(f.source.book).toBe('NCE2');
    }
  });

  it('零编造：每条兜底句按 cn+en+source 逐字命中服务端 136 资产（真实 NCE 原句）', () => {
    for (const f of FALLBACK_QUOTES as any[]) {
      const hit = asset.items.some((it: any) =>
        it.cn === f.cn && it.en === f.en
        && it.source.book === f.source.book
        && it.source.lessonId === f.source.lessonId
        && it.source.lineIndex === f.source.lineIndex);
      expect(hit).toBe(true);
    }
  });

  it('不再含原 7 条通用句（如「慢慢来，比较快。」/「先完成，再完美。」）', () => {
    const cns = (FALLBACK_QUOTES as any[]).map((f) => f.cn);
    expect(cns).not.toContain('慢慢来，比较快。');
    expect(cns).not.toContain('先完成，再完美。');
    expect(cns).not.toContain('我们无法决定风的方向，但可以调整帆的角度。');
  });
});

describe('pickNceLine（纯函数 · 注入句池的过滤 / 配对 / 取模 / 兜底边界）', () => {
  const lines: DailyQuote[] = [
    { cn: '占位中文甲', en: 'PLACEHOLDER_EN_A' },
    { cn: '占位中文乙', en: 'PLACEHOLDER_EN_B' },
    { cn: '占位中文丙', en: 'PLACEHOLDER_EN_C' },
  ];

  it('配对性：返回的 cn 与 en 来自同一个注入行', () => {
    for (let day = 0; day < 9; day += 1) {
      const picked = pickNceLine(day, lines);
      expect(lines.find((l) => l.cn === picked.cn && l.en === picked.en)).toEqual(picked);
    }
  });

  it('确定性：同一 dayNumber 结果一致；隔 N 天轮回；隔 1 天换', () => {
    expect(pickNceLine(7, lines)).toEqual(pickNceLine(7, lines));
    expect(pickNceLine(7, lines)).toEqual(pickNceLine(7 + lines.length, lines));
    expect(pickNceLine(7, lines)).not.toEqual(pickNceLine(8, lines));
  });

  it('空池 / 全脏 / 单元素 / 异常 dayNumber：确定性兜底不抛异常、恒 {cn,en}', () => {
    for (const pool of [[], [{ cn: '', en: 'X' }, { cn: 'Y', en: '' }], [{ cn: '单', en: 'ONE' }]]) {
      for (const day of [0, 1, -1, Number.MAX_SAFE_INTEGER, 3.7]) {
        expect(() => pickNceLine(day, pool)).not.toThrow();
        const p = pickNceLine(day, pool);
        expect(Object.keys(p).sort()).toEqual(['cn', 'en']);
        expect(p.cn.length).toBeGreaterThan(0);
        expect(p.en.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('dayIndex 口径（本地午夜 epoch / 86400000，🔴 不改成 UTC）', () => {
  afterEach(() => jest.useRealTimers());

  it('东八锚点：TZ=Asia/Shanghai，2026-11-24 13:00 → dayNumber=20780，取缓存池 [20780 % N]', () => {
    const prevTZ = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Shanghai';
      setCache({ version: 1, items: POOL, fetchedAt: Date.now() });
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-24T05:00:00Z')); // = 13:00 +08
      const now = new Date();
      const dayNumber = Math.floor(
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
      );
      expect(dayNumber).toBe(20780);
      const expected = POOL[20780 % POOL.length];
      expect(getDailyQuote()).toEqual({ cn: expected.cn, en: expected.en });
    } finally {
      if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
      jest.useRealTimers();
    }
  });

  it('与 UTC 口径解耦：本地日期 25 / UTC 日期 24 时，按本地口径取句', () => {
    const prevTZ = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Shanghai';
      setCache({ version: 1, items: POOL, fetchedAt: Date.now() });
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-24T20:00:00Z')); // = 11-25 04:00 +08
      const now = new Date();
      const localDay = Math.floor(
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
      );
      const utcDay = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
      expect(localDay).toBe(20781);
      expect(localDay).not.toBe(utcDay);
      const localPick = POOL[localDay % POOL.length];
      expect(getDailyQuote()).toEqual({ cn: localPick.cn, en: localPick.en });
    } finally {
      if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
      jest.useRealTimers();
    }
  });
});
