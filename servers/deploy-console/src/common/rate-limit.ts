/**
 * 滑动窗口限流（纯逻辑，无依赖，便于单测）。
 *
 * 为什么自研而不是引 `@nestjs/throttler`：内部接口只需要「按来源 IP × 动作」
 * 计数这一种策略，且必须能**按动作分别配阈值**并在被限流时给出可执行的提示
 * （发布脚本需要知道「稍后重试」而不是收到一个通用 429）。一个 Map 足够，
 * 不值得为此多一个依赖与一套全局配置。
 *
 * 惰性清理：只在命中同一 key 时剔除窗口外的旧记录，不挂定时器
 * （避免定时器阻止进程退出，也避免空转）。
 */

/** 默认窗口 60s */
export const DEFAULT_WINDOW_MS = 60_000;

export interface RateLimitVerdict {
  allowed: boolean;
  /** 当前窗口内已发生的次数（含本次） */
  count: number;
  /** 距离窗口内最早一次过期还有多少毫秒（被拒时用于提示重试时间） */
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    /** 注入时钟，便于单测推进时间 */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** limit <= 0 表示关闭限流 */
  get enabled(): boolean {
    return this.limit > 0;
  }

  hit(key: string): RateLimitVerdict {
    const now = this.now();
    const from = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > from);

    if (!this.enabled) {
      // 关闭时仍记录，便于随时开启后立刻生效（窗口内已有历史）
      this.hits.set(key, [...prev, now]);
      return { allowed: true, count: prev.length + 1, retryAfterMs: 0 };
    }

    if (prev.length >= this.limit) {
      // 满了：不写入本次（否则重试永远进不来 —— 拒绝也要保留最早一次的过期时间）
      const oldest = prev[0] ?? now;
      return {
        allowed: false,
        count: prev.length,
        retryAfterMs: Math.max(0, oldest + this.windowMs - now),
      };
    }

    const next = [...prev, now];
    this.hits.set(key, next);
    return { allowed: true, count: next.length, retryAfterMs: 0 };
  }

  /** 仅供测试/运维：清空计数 */
  reset(key?: string): void {
    if (key) this.hits.delete(key);
    else this.hits.clear();
  }

  /** 当前被跟踪的 key 数（便于观测内存占用） */
  get size(): number {
    return this.hits.size;
  }
}
