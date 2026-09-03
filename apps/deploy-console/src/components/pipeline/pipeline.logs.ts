import type { PipelineItem } from '@/api'

/**
 * 阶段日志工具：把流水线全量日志按「阶段标记行」切段。
 *
 * 后端日志约定（pipeline.service.ts enterStage）：
 * 每个阶段开始 push 一行 `[ISO 时间] [stage] 进入说明`，
 * 其后到下一阶段标记行之前的行（ctx.log / `[stage] $ cmd` 执行输出）都属于该阶段。
 */
const STAGE_HEAD_RE = /^\[[^\]]+\]\s*\[([a-z-]+)\]\s+/

/** 从实例 logs 切出某阶段（自进入行起，到下一阶段标记行前）的日志段落 */
export function stageLogLines(p: PipelineItem, stage: string): string[] {
  const lines = p.logs ?? []
  const heads: { stage: string; idx: number }[] = []
  lines.forEach((l, i) => {
    const m = STAGE_HEAD_RE.exec(l)
    if (m) heads.push({ stage: m[1], idx: i })
  })
  const start = heads.find((h) => h.stage === stage)
  if (!start) {
    // 老数据无阶段标记：回退关键字过滤，至少保证命令执行行可定位
    return lines.filter((l) => l.toLowerCase().includes(stage.toLowerCase()))
  }
  const next = heads.find((h) => h.idx > start.idx)
  return lines.slice(start.idx, next ? next.idx : undefined)
}

/** 段落内是否出现失败/回滚特征（供「结果」Tab 展示警示） */
export function stageHasError(lines: string[]): boolean {
  return lines.some((l) => /error|fail|失败|回滚/i.test(l))
}
