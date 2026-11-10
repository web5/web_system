import { getDailyQuote } from '../utils/daily';

describe('getDailyQuote（首页今日一句 · 本地文案池按日期取模）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('同一天多次调用返回同一条文案', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    const a = getDailyQuote();
    const b = getDailyQuote();
    expect(a).toEqual(b);
  });

  it('跨天自动更换（相邻两天文案不同）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 23, 59, 59));
    const a = getDailyQuote();
    jest.setSystemTime(new Date(2026, 0, 16, 0, 0, 1));
    const b = getDailyQuote();
    expect(a).not.toEqual(b);
  });

  it('返回结构含非空 cn 与 en', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 1, 8, 0, 0));
    const q = getDailyQuote();
    expect(typeof q.cn).toBe('string');
    expect(q.cn.length).toBeGreaterThan(0);
    expect(typeof q.en).toBe('string');
    expect(q.en.length).toBeGreaterThan(0);
  });

  it('7 天轮回：第 1 天与第 8 天文案一致', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const a = getDailyQuote();
    jest.setSystemTime(new Date(2026, 0, 8, 8, 0, 0));
    const b = getDailyQuote();
    expect(a).toEqual(b);
  });
});
