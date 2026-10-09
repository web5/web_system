import { anyOverlap, diffParagraphs, splitParagraphs, type DiffSeg, type Range } from './diff'

// AI 落地策略（用户选定：直接写入 + 可撤销）
//   1. AI 返回的是【修改后的完整文档全文】
//   2. 用「发起请求时的文档 → AI 全文」做段落 diff，得到 AI 的改动区间
//   3. 用「发起请求时的文档 → 当前文档」做段落 diff，得到这段时间人工的改动区间
//   4. 两个区间求交集 → 判断是否交叉
//   5. 以【当前文档】为底落地（天然保留人工改动）：AI 改动按锚定段落精确替换，
//      未被 AI 触碰的人工改动原样保留；只有真正交叉的段落才由 AI 版本覆盖。

export interface AiApplyPlan {
  paragraphs: string[]
  text: string
  aiRanges: Range[]
  humanRanges: Range[]
  overlapped: boolean
  changedCount: number
}

interface Hunk {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

// 连续的非 eq 段合成一个 hunk：一次"改写段落"在 diff 里表现为 del+ins 成对，
// 必须当成一次整体替换处理，否则 del 和 ins 各自锚定会错位（内容跑到文末）。
function toHunks(segs: DiffSeg[]): Hunk[] {
  const hunks: Hunk[] = []
  let cur: Hunk | null = null
  for (const s of segs) {
    if (s.type === 'eq') {
      cur = null
      continue
    }
    if (!cur) {
      cur = { oldStart: s.aStart, oldEnd: s.aEnd, newStart: s.bStart, newEnd: s.bEnd }
      hunks.push(cur)
    } else {
      cur.oldStart = Math.min(cur.oldStart, s.aStart)
      cur.oldEnd = Math.max(cur.oldEnd, s.aEnd)
      cur.newStart = Math.min(cur.newStart, s.bStart)
      cur.newEnd = Math.max(cur.newEnd, s.bEnd)
    }
  }
  return hunks
}

const hunkRanges = (hunks: Hunk[]): Range[] => hunks.map((h) => [h.oldStart, h.oldEnd])

function findSequence(hay: string[], needle: string[]): number {
  if (!needle.length) return -1
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true
    for (let k = 0; k < needle.length; k++) {
      if (hay[i + k] !== needle[k]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

export function planAiApply(requestDoc: string, aiText: string, currentDoc: string): AiApplyPlan {
  const reqP = splitParagraphs(requestDoc)
  const aiP = splitParagraphs(aiText)
  const curP = splitParagraphs(currentDoc)

  const aiHunks = toHunks(diffParagraphs(reqP, aiP))
  const humanHunks = toHunks(diffParagraphs(reqP, curP))
  const aiRanges = hunkRanges(aiHunks)
  const humanRanges = hunkRanges(humanHunks)
  const overlapped = anyOverlap(aiRanges, humanRanges)

  // 以【当前文档】为底，再按 hunk 逆序落地（逆序保证前面的索引不受后续 splice 影响）
  const out = curP.slice()
  for (const h of aiHunks.slice().sort((x, y) => y.oldStart - x.oldStart)) {
    const oldSeq = reqP.slice(h.oldStart, h.oldEnd)
    const newSeq = aiP.slice(h.newStart, h.newEnd)

    // 纯插入：锚定到插入点前一段在当前文档中的位置
    if (oldSeq.length === 0) {
      let pos = out.length
      if (h.oldStart === 0) {
        pos = 0
      } else {
        const anchor = out.indexOf(reqP[h.oldStart - 1])
        pos = anchor >= 0 ? anchor + 1 : out.length
      }
      out.splice(pos, 0, ...newSeq)
      continue
    }

    // 该段在请求后没被人动过 → 精确替换，人工在别处的改动完全不受影响
    const idx = findSequence(out, oldSeq)
    if (idx >= 0) {
      out.splice(idx, oldSeq.length, ...newSeq)
      continue
    }

    // 找不到完整锚点 = 这段被人工改过（交叉）
    // → 用「前后未改动的上下文段落」夹逼出区间，按"直接写入"策略用 AI 版本覆盖
    const prevText = h.oldStart > 0 ? reqP[h.oldStart - 1] : null
    const nextText = h.oldEnd < reqP.length ? reqP[h.oldEnd] : null
    const prevIdx = prevText != null ? out.indexOf(prevText) : -1
    const nextIdx = nextText != null ? out.indexOf(nextText) : -1

    if (prevIdx >= 0 && nextIdx > prevIdx) {
      out.splice(prevIdx + 1, nextIdx - prevIdx - 1, ...newSeq)
    } else if (prevIdx >= 0) {
      out.splice(prevIdx + 1, Math.min(oldSeq.length, out.length - prevIdx - 1), ...newSeq)
    } else if (nextIdx >= 0) {
      out.splice(nextIdx, Math.min(oldSeq.length, nextIdx), ...newSeq)
    } else {
      out.splice(Math.min(h.oldStart, out.length), 0, ...newSeq)
    }
  }

  return {
    paragraphs: out,
    text: out.join('\n'),
    aiRanges,
    humanRanges,
    overlapped,
    changedCount: aiHunks.length,
  }
}
