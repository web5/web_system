/**
 * 新概念英语书册常量与纯函数（NCE2 / NCE3 / NCE4）
 *
 * 唯一索引 (book, lesson_no)：三册 lesson_no 都从 1 起，详情跳转必须带 book，
 * 否则点 NCE3 第 1 课会打开 NCE2 Lesson 1。目录分组与上一/下一课边界按各册 total。
 */
export interface NceBookDef {
  book: string;
  label: string;
  total: number;
}

export const NCE_BOOKS: NceBookDef[] = [
  { book: 'NCE2', label: 'NCE2', total: 96 },
  { book: 'NCE3', label: 'NCE3', total: 60 },
  { book: 'NCE4', label: 'NCE4', total: 48 },
];

export const DEFAULT_NCE_BOOK = 'NCE2';

/** 按册查课数；未知册回退 NCE2（96），避免 goLesson 边界越界崩溃 */
export function nceBookTotal(book?: string): number {
  const def = NCE_BOOKS.find((b) => b.book === book);
  return def ? def.total : NCE_BOOKS[0].total;
}

export interface NceGroupRange {
  start: number;
  end: number;
}

/** 目录分组区间：每 size 课一组，末组按 total 截断（NCE3 末组 49–60、NCE4 末组 25–48） */
export function buildNceGroupRanges(total: number, size = 24): NceGroupRange[] {
  const ranges: NceGroupRange[] = [];
  for (let s = 1; s <= total; s += size) {
    ranges.push({ start: s, end: Math.min(s + size - 1, total) });
  }
  return ranges;
}
