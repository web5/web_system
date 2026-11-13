// diff.ts 边界矩阵（D2 / 阶段一 ③rangesOverlap 边界矩阵）
import { describe, it, expect } from 'vitest'
import {
  splitParagraphs,
  diffParagraphs,
  changedRanges,
  rangesOverlap,
  anyOverlap,
} from './diff'

describe('splitParagraphs', () => {
  it('按空行切分并 trim，空段被丢弃', () => {
    expect(splitParagraphs('甲\n\n乙\n   \n丙')).toEqual(['甲', '乙', '丙'])
  })
  it('空字符串 → 空数组', () => {
    expect(splitParagraphs('')).toEqual([])
  })
})

describe('diffParagraphs', () => {
  it('完全相同 → 单个 eq 段', () => {
    const segs = diffParagraphs(['A', 'B'], ['A', 'B'])
    expect(segs).toEqual([{ type: 'eq', aStart: 0, aEnd: 2, bStart: 0, bEnd: 2 }])
  })
  it('完全无关 → 不丢内容（del+ins 覆盖全集）', () => {
    const segs = diffParagraphs(['A'], ['X', 'Y'])
    const del = segs.filter((s) => s.type === 'del')
    const ins = segs.filter((s) => s.type === 'ins')
    expect(del.map((s) => [s.aStart, s.aEnd])).toEqual([[0, 1]])
    expect(ins.map((s) => [s.bStart, s.bEnd])).toEqual([[0, 2]])
  })
  it('中间插入一段', () => {
    const segs = diffParagraphs(['A', 'C'], ['A', 'B', 'C'])
    expect(segs.filter((s) => s.type !== 'eq')).toEqual([
      { type: 'ins', aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 },
    ])
  })
  it('空输入不抛错', () => {
    expect(diffParagraphs([], [])).toEqual([])
    expect(diffParagraphs(['A'], []).some((s) => s.type === 'del')).toBe(true)
    expect(diffParagraphs([], ['A']).some((s) => s.type === 'ins')).toBe(true)
  })
})

describe('changedRanges', () => {
  it('只保留非 eq 段的 a 侧区间（ins 映射为 a 侧空点）', () => {
    // 'B'→'X' 表现为 del[1,2] + ins（a 侧为点 [2,2]）；
    // 点在边界上不算交叉，与 rangesOverlap 语义契约一致
    const ranges = changedRanges(diffParagraphs(['A', 'B', 'C'], ['A', 'X', 'C']))
    expect(ranges).toEqual([[1, 2], [2, 2]])
  })
})

// 语义契约（来自 diff.ts 注释，冻结为可执行断言）：
//   点（纯插入）落在区间【边界】上不算交叉 —— 在 C 段之前插入新段落 ≠ 修改 C 段。
describe('rangesOverlap 边界矩阵', () => {
  it.each([
    // [x, y, expected, 说明]
    [[0, 2], [1, 3], true, '区间相交'],
    [[0, 1], [1, 2], false, '首尾相接不算交叉'],
    [[0, 2], [0, 2], true, '完全重合'],
    [[1, 1], [0, 2], true, '点落在区间内部'],
    [[0, 0], [0, 2], false, '点落在区间左边界（语义契约）'],
    [[2, 2], [0, 2], false, '点落在区间右边界（语义契约）'],
    [[0, 2], [1, 1], true, '区间为点的外侧'],
    [[0, 2], [0, 0], false, '区间为点的左边界外侧（对称）'],
    [[0, 2], [2, 2], false, '区间为点的右边界外侧（对称）'],
    [[1, 1], [1, 1], false, '点与点同位置不算交叉'],
    [[2, 3], [0, 1], false, '完全不相交'],
  ])('%j vs %j → %s（%s）', (x, y, expected) => {
    expect(rangesOverlap(x as [number, number], y as [number, number])).toBe(expected)
  })
})

describe('anyOverlap', () => {
  it('任一对交叉即 true；空数组 false', () => {
    expect(anyOverlap([[0, 1]], [[5, 6]])).toBe(false)
    expect(anyOverlap([[0, 3]], [[2, 6]])).toBe(true)
    expect(anyOverlap([], [[0, 1]])).toBe(false)
  })
})
