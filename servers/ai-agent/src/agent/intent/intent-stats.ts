/**
 * 意图路由的兜底比例统计（进程内滑动窗口）。
 *
 * 为什么要有：`via=fallback` 的比例是「规范层」故障（注册表/配置/taxonomy 漂移）的唯一信号 ——
 * 这类故障**不报错、错误率为 0**，只会表现为兜底比例悄悄升高。
 * 2026-09-28「taxonomy 硬编码 → 100% 兜底」、2026-10-08「maxTokens=60 → 100% 兜底」两次
 * 都是这个形态，且都是靠别的模块偶然告警才发现。
 *
 * 口径（务必保持）：
 *  - 只统计「灰度开关已开、且经过分类器」的请求。开关关闭时所有输入都是 fallback，是设计如此，
 *    不是故障；显式 `@agent` / 显式传 agentId 不经分类，也不计入。
 *  - 比例 = fallback 条数 / 窗口内总条数。
 *  - 降级原因（degradeReason）单独分桶：locked 收尾（会话沿用锁定）虽然 via 不是 fallback，
 *    但同样是「分类失败」，不能被掩盖。
 *
 * 边界（诚实）：
 *  - 这是**进程内**窗口：重启清零，多实例各算各的，不是全局指标。
 *  - 它只负责「发现异常」并打 warn 日志；**不是**接入监控平台的告警。
 */
import type { IntentDegradeReason, IntentVia } from '@kedouai/agent-core';

export interface IntentStatsOptions {
  /** 滑动窗口大小（最近 N 次分类） */
  windowSize?: number;
  /** 兜底比例达到该值触发告警 */
  warnRatio?: number;
  /** 窗口内至少多少样本才允许告警（避免 2 条里有 1 条就报警） */
  minSamples?: number;
  /** 同类告警的最小间隔，防刷屏 */
  warnIntervalMs?: number;
}

export interface IntentStatsSnapshot {
  total: number;
  byVia: Partial<Record<IntentVia, number>>;
  byReason: Partial<Record<IntentDegradeReason, number>>;
  /** fallback / total；total=0 时为 0 */
  fallbackRatio: number;
}

interface Entry {
  via: IntentVia;
  reason?: IntentDegradeReason;
}

export class IntentStats {
  private readonly windowSize: number;
  private readonly warnRatio: number;
  private readonly minSamples: number;
  private readonly warnIntervalMs: number;
  private readonly buf: Entry[] = [];
  private lastWarnAt: number | null = null;

  constructor(opts: IntentStatsOptions = {}) {
    this.windowSize = opts.windowSize ?? 200;
    this.warnRatio = opts.warnRatio ?? 0.5;
    this.minSamples = opts.minSamples ?? 30;
    this.warnIntervalMs = opts.warnIntervalMs ?? 10 * 60 * 1000;
  }

  record(via: IntentVia, reason?: IntentDegradeReason): void {
    this.buf.push({ via, reason });
    if (this.buf.length > this.windowSize) this.buf.shift();
  }

  snapshot(): IntentStatsSnapshot {
    const byVia: IntentStatsSnapshot['byVia'] = {};
    const byReason: IntentStatsSnapshot['byReason'] = {};
    for (const e of this.buf) {
      byVia[e.via] = (byVia[e.via] ?? 0) + 1;
      if (e.reason) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
    }
    const total = this.buf.length;
    return { total, byVia, byReason, fallbackRatio: total ? (byVia.fallback ?? 0) / total : 0 };
  }

  /**
   * 是否应当现在告警。命中时会同时记录本次告警时间（调用即「消费」），
   * 所以同一窗口内重复调用只有第一次返回 true。
   */
  shouldWarn(now: number = Date.now()): boolean {
    const s = this.snapshot();
    if (s.total < this.minSamples) return false;
    if (s.fallbackRatio < this.warnRatio) return false;
    if (this.lastWarnAt !== null && now - this.lastWarnAt < this.warnIntervalMs) return false;
    this.lastWarnAt = now;
    return true;
  }
}
