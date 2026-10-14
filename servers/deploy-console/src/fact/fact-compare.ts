import type { FactStatus } from '../entities/deploy-fact-snapshot.entity';

/**
 * 事实状态判定（纯函数）。
 *
 * 判据只有一条原则：**没有期望态就不能说"一致"**。
 * 「采到了但没人说过它应该是什么」记 `unknown`，而不是塞进 ok ——
 * 否则事实层的数字会永远好看，而真正在漂的东西因为没登记期望态被算成正常。
 */
export interface FactVerdict {
  status: FactStatus;
  expected: string | null;
  actual: string | null;
}

export function classifyFact(input: {
  /** 期望态（平台认为应该是什么）；null/undefined = 没有期望 */
  expected?: string | null;
  /** 真实态（线上实际是什么）；null/undefined = 没采到 */
  actual?: string | null;
  /** 自定义相等判定（数值/集合类事实用） */
  equals?: (a: string, b: string) => boolean;
}): FactVerdict {
  const expected = input.expected == null || input.expected === '' ? null : String(input.expected);
  const actual = input.actual == null || input.actual === '' ? null : String(input.actual);

  if (actual === null) {
    // 没采到：有期望 = 线上缺了这个东西（真问题）；没期望 = 无从判断
    return { status: expected ? 'missing' : 'unknown', expected, actual };
  }
  if (expected === null) return { status: 'unknown', expected, actual };
  const same = input.equals ? input.equals(expected, actual) : expected === actual;
  return { status: same ? 'ok' : 'drift', expected, actual };
}
