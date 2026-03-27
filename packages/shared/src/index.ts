import dayjs from 'dayjs';

/**
 * 格式化日期时间
 */
export function formatDateTime(date: Date | string | number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  return dayjs(date).format(format);
}

/**
 * 生成随机字符串
 */
export function randomString(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 环境变量获取
 */
export function getEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}

/**
 * 判断是否为开发环境
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * 判断是否为生产环境
 */
export function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}
