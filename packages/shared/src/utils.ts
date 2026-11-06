/**
 * 前后端通用的纯工具函数（**浏览器可直接加载**）。
 *
 * 为什么从 `index.ts` 拆出来单独成文件：
 * `index.ts` 是**后端 barrel**（含 storage-dir / typeorm 实体 / nest 守卫等
 * node-only 模块）；而本文件的几个函数前端也在用。它们留在 barrel 里，
 * 前端就无法在不拖入 node-only 模块的前提下取到 —— 详见 `browser.ts` 顶部说明。
 *
 * 本文件硬约束：**只能 import 浏览器可用的包**（当前只有 dayjs），
 * 不得出现 `fs` / `os` / `path` / `process` —— 由
 * `scripts/check-shared-browser-safety.mjs` 机器校验。
 */
import dayjs from 'dayjs';

/**
 * 格式化日期时间
 */
export function formatDateTime(date: Date | string | number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  return dayjs(date).format(format);
}

/**
 * 生成随机字符串
 * 注意：使用 Math.random()，非密码学安全，仅适用于非安全场景（如临时 ID）
 * 安全场景（token、密钥等）请使用 crypto.randomBytes
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
export function debounce<This, A extends unknown[], R>(
  func: (this: This, ...args: A) => R,
  wait: number
): (this: This, ...args: A) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (this: This, ...args: A) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * 节流函数
 */
export function throttle<This, A extends unknown[], R>(
  func: (this: This, ...args: A) => R,
  limit: number
): (this: This, ...args: A) => void {
  let inThrottle: boolean = false;
  return function (this: This, ...args: A) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
