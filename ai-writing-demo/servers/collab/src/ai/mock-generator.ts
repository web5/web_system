// 内置 mock 流式生成器：离线也能演示「AI 直接写文档」
// 注意：现在 AI 的契约是返回【修改后的完整文档全文】（不是插入片段），
// 所以 mock 也必须返回全文，否则前端的段落级 diff / 合并逻辑拿不到正确输入。
export async function* mockStream(instruction: string, doc: string): AsyncGenerator<string> {
  for (const ch of buildMockReply(instruction, doc)) {
    yield ch
    await new Promise((r) => setTimeout(r, 8))
  }
}

function buildMockReply(instruction: string, doc: string): string {
  const paras = doc
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  // 空文档 → 按指令生成一篇完整文档（演示"生成文档"）
  if (!paras.length) {
    return [
      `【AI 生成】${instruction || '项目周报'}`,
      '本周进展：完成 AI 协作写作原型的前后端联调，跑通流式输出与文档落地闭环。',
      '下周计划：补充交叉冲突检测与一键撤销，完善保存与恢复能力。',
      '风险与求助：暂无。',
    ].join('\n')
  }

  // 非空 → 只改第一段（其余原样保留），演示"精准改写 + 人工改动共存"
  const first = paras[0]
  const rewritten = `${first}\n（已按指令「${instruction}」润色为更正式的表达，其余段落保持原样。）`
  return [rewritten, ...paras.slice(1)].join('\n')
}
