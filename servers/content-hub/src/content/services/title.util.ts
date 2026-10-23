/**
 * 日报标题模板渲染。
 *
 * 背景（2026-10-23 修复）：同一段「把 {{date}} 换成日期」的逻辑曾经在
 * `pipeline.service.ts`（定时发布）与 `content.service.ts`（重新发布 / 成文预览）
 * 各写一遍，结果定时发布那处漏了替换，落库 title 变成
 * 「AI 资讯日报 ｜ {{date}}」，列表与微信端都显示原始模板。
 *
 * 抽成单一函数后两条路径共用同一实现，避免再次出现「一处渲染一处漏」。
 */
export function renderTitle(
  template: string | null | undefined,
  fallback: string,
  date: Date = new Date(),
): string {
  return renderPlaceholders(template ?? fallback, date);
}

/**
 * 把文本里的 `{{date}}` **全部**替换成日期（YYYY-MM-DD）。
 *
 * 两处刻意为之：
 *   - 用 split/join 而非 `replaceAll` —— 老 Node / 转译链路不一定有它；
 *   - 全量而非只替首个（`String.replace` 配字符串参数只换第一处）—— 成文
 *     markdown 里 `{{date}}` 可能出现不止一处（标题行、摘要），只替首个会把
 *     半截模板留在正文里（#431 重建存量记录时实测）。
 */
export function renderPlaceholders(text: string, date: Date = new Date()): string {
  return text.split('{{date}}').join(date.toISOString().slice(0, 10));
}
