/**
 * 会话相关的跨页面共用件。
 *
 * ⚠️ 必须放在 utils（非页面文件）：小程序页面文件（pages/**）只能由框架加载，
 * 被其他模块 import 时 `Page({...})` 会在错误时机被调用，导致该页面生命周期失效
 * （表现为页面能打开、但 onShow 不触发、请求不发）。
 */

/**
 * 会话恢复通道：对话页是 tabBar 页，`navigateTo` 到不了、`switchTab` 又不能带参数，
 * 因此用 storage 传递要恢复的 conversationId，由对话页 `onShow` 读取并载入。
 */
export const RESUME_CONV_KEY = 'resume_conversation_id';

/** 时间展示：今天给时刻，昨天 / 更早给日期 */
export function formatTime(v: string | Date | undefined): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
