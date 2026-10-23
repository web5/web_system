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
  const raw = template ?? fallback;
  return raw.replace('{{date}}', date.toISOString().slice(0, 10));
}
