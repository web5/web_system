/**
 * 新概念英语书册常量与分组区间（pages/nce/books.ts）单元测试
 *
 * 守住多册支持的两条口径：
 *   ① 三册 lesson_no 都从 1 起、total 分别为 96/60/48，未知册回退 NCE2。
 *   ② 目录分组按各册 total 动态截断（NCE3 末组 49–60、NCE4 末组 25–48），
 *      不再硬编码 96。
 */
import {
  NCE_BOOKS,
  DEFAULT_NCE_BOOK,
  nceBookTotal,
  buildNceGroupRanges,
} from '../pages/nce/books';

describe('NCE 书册常量', () => {
  it('三册顺序与课数正确', () => {
    expect(NCE_BOOKS.map((b) => b.book)).toEqual(['NCE2', 'NCE3', 'NCE4']);
    expect(NCE_BOOKS.map((b) => b.total)).toEqual([96, 60, 48]);
    expect(DEFAULT_NCE_BOOK).toBe('NCE2');
  });

  it('nceBookTotal：按册返回课数，未知册回退 NCE2', () => {
    expect(nceBookTotal('NCE2')).toBe(96);
    expect(nceBookTotal('NCE3')).toBe(60);
    expect(nceBookTotal('NCE4')).toBe(48);
    expect(nceBookTotal('NCE9')).toBe(96);
    expect(nceBookTotal(undefined)).toBe(96);
  });
});

describe('buildNceGroupRanges 目录分组', () => {
  it('NCE2 96 课 → 4 组，每组 24', () => {
    expect(buildNceGroupRanges(96)).toEqual([
      { start: 1, end: 24 },
      { start: 25, end: 48 },
      { start: 49, end: 72 },
      { start: 73, end: 96 },
    ]);
  });

  it('NCE3 60 课 → 末组 49–60', () => {
    expect(buildNceGroupRanges(60)).toEqual([
      { start: 1, end: 24 },
      { start: 25, end: 48 },
      { start: 49, end: 60 },
    ]);
  });

  it('NCE4 48 课 → 两组 1–24 / 25–48', () => {
    expect(buildNceGroupRanges(48)).toEqual([
      { start: 1, end: 24 },
      { start: 25, end: 48 },
    ]);
  });
});
