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

/**
 * 标题日期按**运营所在时区**渲染，不用 UTC（2026-10-23 修）。
 *
 * 原实现是 `date.toISOString().slice(0, 10)` —— 那是 UTC 日期。服务器时区是
 * Asia/Shanghai，于是每天 00:00–08:00 之间跑出来的日报，标题上的日期是**前一天**
 * （10 月 24 日凌晨跑的日报写着 10 月 23 日）。同理 {{datetime}} 的时间也会差 8 小时。
 */
const TITLE_TZ = process.env.CONTENT_TITLE_TZ || 'Asia/Shanghai';

/** 本地时区的日期/时间片段（YYYY-MM-DD / HH:mm / YYYY-MM-DD HH:mm） */
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TITLE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // 部分 ICU 版本在 hour12:false 下把午夜给成 '24'，直接落到标题上会是 24:00
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

export function renderTitle(
  template: string | null | undefined,
  fallback: string,
  date: Date = new Date(),
): string {
  return renderPlaceholders(template ?? fallback, date);
}

/**
 * 把文本里的日期占位符**全部**替换：
 *   - `{{date}}`     → YYYY-MM-DD
 *   - `{{time}}`     → HH:mm
 *   - `{{datetime}}` → YYYY-MM-DD HH:mm
 *
 * 两处刻意为之：
 *   - 用 split/join 而非 `replaceAll` —— 老 Node / 转译链路不一定有它；
 *   - 全量而非只替首个（`String.replace` 配字符串参数只换第一处）—— 成文
 *     markdown 里占位符可能出现不止一处（标题行、摘要），只替首个会把
 *     半截模板留在正文里（#431 重建存量记录时实测）。
 *
 * `{{datetime}}` 用于区分同一天的多次运行：此前一天跑两次，草稿箱里两条标题
 * 完全同名（都是「AI 资讯日报 ｜ 2026-10-23」），分不清先后，也容易误发重复稿。
 */
export function renderPlaceholders(text: string, date: Date = new Date()): string {
  const { date: d, time: t } = localParts(date);
  return text
    .split('{{datetime}}')
    .join(`${d} ${t}`)
    .split('{{date}}')
    .join(d)
    .split('{{time}}')
    .join(t);
}
