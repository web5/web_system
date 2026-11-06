/**
 * cron 表达式工具 —— 注册端（SchedulerService）与校验端（DTO / 预览接口）共用同一份解析口径。
 *
 * 背景（2026-11-06 线上故障 #8557）：
 *   prod `content_pipelines.ai_news` 被写成 `0 8 0 * *` —— 把「每周四」的 4 写进了
 *   **日**字段（5 段式顺序是「分 时 日 月 周」）。保存时无人校验、启动时注册失败只
 *   `logger.error` 不阻断，管线于是静默停摆 2 天，直到有人翻启动日志才发现。
 *
 * 所以「能不能解析」必须变成**入库前的硬门**，而不是启动后的日志。
 * 校验与注册走同一个函数，避免出现「DTO 说合法、调度器却注册失败」的分裂。
 */
import { CronTime } from 'cron';

/** 调度时区：与 SchedulerService 注册定时任务时一致（业务按北京时间跑） */
export const CRON_TIMEZONE = 'Asia/Shanghai';

/**
 * 5 段式字段顺序提示。这条提示不是装饰——本次故障就是「以为第 3 段是周几」。
 * 每周四 8 点 = `0 8 * * 4`，不是 `0 8 4 * *`。
 */
export const CRON_FIELD_HINT =
  '5 段式顺序为「分 时 日 月 周」，每周四 8 点应写 `0 8 * * 4`（`0 8 4 * *` 是每月 4 号）';

export interface CronParseResult {
  /** 是否能被 cron 包解析 */
  ok: boolean;
  /** 归一化后的表达式（合并多余空白；失败时为原始输入） */
  normalized: string;
  /** 下一段：失败原因，直接面向使用者展示 */
  error?: string;
  /** 校验通过时的下一次执行时间（ISO 8601，带 +08:00 偏移） */
  nextRun?: string;
}

/**
 * 解析 + 校验 cron 表达式。
 *
 * @param input 调用方传入的任意值（DTO 里可能缺失 / 非字符串）
 * @param now   计算「下次执行时间」的基准时刻（测试注入用）
 */
export function parseCronExpression(input: unknown, now: Date = new Date()): CronParseResult {
  const raw = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!raw) {
    return { ok: false, normalized: '', error: 'cron 表达式不能为空' };
  }

  const fields = raw.split(' ');
  // cron 包同时接受 5 段（分 时 日 月 周）与 6 段（秒 分 时 日 月 周）。
  // 段数不对时直接给出人话提示，而不是把 `Too few fields` 原样丢给运营看。
  if (fields.length !== 5 && fields.length !== 6) {
    return {
      ok: false,
      normalized: raw,
      error: `需要 5 段（或 6 段含秒），实际 ${fields.length} 段 —— ${CRON_FIELD_HINT}`,
    };
  }

  try {
    const cronTime = new CronTime(raw, CRON_TIMEZONE);
    const next = cronTime.getNextDateFrom(now);
    return { ok: true, normalized: raw, nextRun: next.toISO() ?? undefined };
  } catch (e) {
    return { ok: false, normalized: raw, error: `${(e as Error).message} —— ${CRON_FIELD_HINT}` };
  }
}

/**
 * 未来 N 次执行时间（默认 3 次），用于「保存前预览」。
 * 非法表达式直接抛错——调用方应先用 {@link parseCronExpression} 判 ok。
 */
export function nextCronRuns(input: string, count = 3, now: Date = new Date()): string[] {
  const parsed = parseCronExpression(input, now);
  if (!parsed.ok) {
    throw new Error(parsed.error ?? 'cron 表达式不合法');
  }
  const cronTime = new CronTime(parsed.normalized, CRON_TIMEZONE);
  const out: string[] = [];
  // 从 now + 1s 起算：表达式可能秒级命中当前时刻，+1s 防止把「现在」算成「下次」
  let cursor = new Date(now.getTime() + 1000);
  for (let i = 0; i < count; i += 1) {
    const next = cronTime.getNextDateFrom(cursor);
    const iso = next.toISO();
    if (!iso) break;
    out.push(iso);
    cursor = new Date(next.toMillis() + 1000);
  }
  return out;
}
