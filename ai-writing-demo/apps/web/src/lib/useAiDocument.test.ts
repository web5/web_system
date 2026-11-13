// planAiApply 语义不变量（D2）
// 落地策略契约（来自 useAiDocument.ts 头注释，冻结为可执行断言）：
//   ① 以【当前文档】为底落地 —— 未被 AI 触碰的人工改动必须原样保留
//   ② AI 改动按锚定段落精确替换
//   ③ 真正交叉的段落由 AI 版本覆盖，且 overlapped 必须为 true
import { describe, it, expect } from 'vitest'
import { planAiApply } from './useAiDocument'

const REQ = ['第一段', '第二段', '第三段'].join('\n')

describe('planAiApply 语义不变量', () => {
  it('无人工改动：AI 全文原样落地', () => {
    const ai = ['第一段', 'AI改写的第二段', '第三段'].join('\n')
    const plan = planAiApply(REQ, ai, REQ)
    expect(plan.text).toBe(ai)
    expect(plan.overlapped).toBe(false)
    expect(plan.humanRanges).toEqual([])
  })

  it('契约①：AI 改第二段时，人工对第三段的改动必须保留', () => {
    const ai = ['第一段', 'AI改写的第二段', '第三段'].join('\n')
    const cur = ['第一段', '第二段', '人工改写的第三段'].join('\n')
    const plan = planAiApply(REQ, ai, cur)
    expect(plan.paragraphs).toEqual(['第一段', 'AI改写的第二段', '人工改写的第三段'])
    expect(plan.overlapped).toBe(false)
  })

  it('契约③：人工与 AI 改同一段 → AI 覆盖且 overlapped=true', () => {
    const ai = ['第一段', 'AI版本第二段', '第三段'].join('\n')
    const cur = ['第一段', '人工版本第二段', '第三段'].join('\n')
    const plan = planAiApply(REQ, ai, cur)
    expect(plan.overlapped).toBe(true)
    expect(plan.paragraphs).toEqual(['第一段', 'AI版本第二段', '第三段'])
  })

  it('契约②：AI 在中间插入新段，锚定到插入点而非文末', () => {
    const ai = ['第一段', 'AI新增段', '第二段', '第三段'].join('\n')
    const plan = planAiApply(REQ, ai, REQ)
    expect(plan.paragraphs).toEqual(['第一段', 'AI新增段', '第二段', '第三段'])
  })

  it('AI 在开头插入 + 人工在尾部追加：两处都成立', () => {
    const ai = ['AI开头新增', '第一段', '第二段', '第三段'].join('\n')
    const cur = ['第一段', '第二段', '第三段', '人工尾部追加'].join('\n')
    const plan = planAiApply(REQ, ai, cur)
    expect(plan.paragraphs[0]).toBe('AI开头新增')
    expect(plan.paragraphs).toContain('人工尾部追加')
  })

  it('AI 删除一段：该段从结果中消失，其余保留', () => {
    const ai = ['第一段', '第三段'].join('\n')
    const plan = planAiApply(REQ, ai, REQ)
    expect(plan.paragraphs).toEqual(['第一段', '第三段'])
  })

  it('三方相同 → 零改动', () => {
    const plan = planAiApply(REQ, REQ, REQ)
    expect(plan.text).toBe(REQ)
    expect(plan.changedCount).toBe(0)
    expect(plan.overlapped).toBe(false)
  })

  it('空文档起步：AI 全文作为纯插入落地', () => {
    const plan = planAiApply('', '第一段\n第二段', '')
    expect(plan.paragraphs).toEqual(['第一段', '第二段'])
  })
})
