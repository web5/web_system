/** 相对时间：列表副标题用（「刚刚 / 10 分钟前 / 昨天 / 9月21日」） */
export function formatRelativeTime(input?: string | number | Date): string {
  if (!input) return '';
  const time = new Date(input).getTime();
  if (Number.isNaN(time)) return '';

  const diffSec = Math.floor((Date.now() - time) / 1000);
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 172800) return '昨天';

  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return sameYear ? md : `${date.getFullYear()}年${md}`;
}
