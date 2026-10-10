// 段落级 diff：把文档当成「段落序列」做 LCS，而不是字符级。
// 理由：文档改动天然是段落维度的，得到的区间可以直接解释成"第 N 段被改"，
// 也方便和人工改动区间求交集来判断"交叉"。

export type Range = [number, number]

export interface DiffSeg {
  type: 'eq' | 'del' | 'ins'
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

export function splitParagraphs(text: string): string[] {
  return (text || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function diffParagraphs(a: string[], b: string[]): DiffSeg[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const segs: DiffSeg[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      const as = i
      const bs = j
      while (i < n && j < m && a[i] === b[j]) {
        i++
        j++
      }
      segs.push({ type: 'eq', aStart: as, aEnd: i, bStart: bs, bEnd: j })
      continue
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      const as = i
      while (i < n && !(j < m && a[i] === b[j]) && dp[i + 1][j] >= dp[i][j + 1]) i++
      if (i === as) i++ // 保底前进，防死循环
      segs.push({ type: 'del', aStart: as, aEnd: i, bStart: j, bEnd: j })
    } else {
      const bs = j
      while (j < m && !(i < n && a[i] === b[j]) && dp[i + 1][j] < dp[i][j + 1]) j++
      if (j === bs) j++ // 保底前进，防死循环
      segs.push({ type: 'ins', aStart: i, aEnd: i, bStart: bs, bEnd: j })
    }
  }
  if (i < n) segs.push({ type: 'del', aStart: i, aEnd: n, bStart: j, bEnd: j })
  if (j < m) segs.push({ type: 'ins', aStart: i, aEnd: i, bStart: j, bEnd: m })
  return segs
}

export function changedRanges(segs: DiffSeg[]): Range[] {
  return segs.filter((s) => s.type !== 'eq').map((s) => [s.aStart, s.aEnd] as Range)
}

// 区间求交：长度为 0 的区间（纯插入）视作一个"点"
// 点落在区间【边界】上不算交叉：在 C 段之前插入新段落 ≠ 修改 C 段，两者可以共存。
export function rangesOverlap(x: Range, y: Range): boolean {
  const [xs, xe] = x
  const [ys, ye] = y
  if (xs === xe) return ys < xs && xs < ye
  if (ys === ye) return xs < ys && ys < xe
  return xs < ye && ys < xe
}

export function anyOverlap(xs: Range[], ys: Range[]): boolean {
  for (const x of xs) {
    for (const y of ys) {
      if (rangesOverlap(x, y)) return true
    }
  }
  return false
}
