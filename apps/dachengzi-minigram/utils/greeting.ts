/**
 * 首页「动态问候」—— 纯函数层。
 *
 * 需求真源：specs/dachengzi-minigram/page-spec.md §2026-11-23 · ① 首页 hero 动态问候 + 昵称
 * （原型 114 已确认版本；本文件是该需求里唯一的文案 / 时段 / 截断真相源）。
 *
 * 🔴 边界（本段「零阻塞层」）：
 *  - 零 UI 接线：本文件不 import 任何 page / wxml / wx 全局，改动不触发 UI 门禁。
 *  - 零 IO：昵称读取链 readLocalNickname → fetchProfile → isNicknameUnset 位于
 *    services/account.ts（含登录态 + 网络 + storage），属 UI 接线阶段职责；
 *    本文件只提供 resolveNickname / formatGreeting 两个纯函数，由调用方把已解析好的
 *    昵称传进来。不臆造对 readLocalNickname / fetchProfile 的调用。
 *  - 零时区库：只认 Date#getHours()（设备本地时区），不写死 UTC+8、不引 dayjs。
 *  - 文案唯一真相源：GREETINGS 一处定义 5 段时段表，页面不得另抄一份。
 */

/** 时段表条目：[start, end) 左闭右开，覆盖本地时间 [0,24)。 */
export interface GreetingSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** 5 段时段表（本地时区）：文案只在此处定义。 */
export const GREETINGS: readonly GreetingSegment[] = [
  { start: 0, end: 6, text: '夜深了' },
  { start: 6, end: 12, text: '早上好' },
  { start: 12, end: 14, text: '中午好' },
  { start: 14, end: 18, text: '下午好' },
  { start: 18, end: 24, text: '晚上好' },
];

/** 昵称缺省兜底（isNicknameUnset 判空 / wx_ 占位 → 「同学」）。 */
export const DEFAULT_NICKNAME = '同学';

/** 昵称展示上限（PRD 默认 ①-2：长昵称截断，避免破版）。按 Unicode 码点计。 */
export const NICKNAME_MAX_CHARS = 16;

/**
 * 按小时取问候语（纯函数，只读入参 hour，不读系统时钟）。
 *
 * 边界：0/5/6/11/12/13/14/17/18/23 逐段命中；
 * 越界 / 非有限 / 带小数输入一律确定性归一（截断小数 → 钳制到 [0,23]，
 * 非有限 → 0），输出恒落在 5 段文案内，绝不抛异常。
 */
export function getGreeting(hour: number): string {
  const h = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.trunc(hour))) : 0;
  for (const seg of GREETINGS) {
    if (h >= seg.start && h < seg.end) return seg.text;
  }
  // 兜底不可达（[0,23] 已被 5 段完全覆盖），保留以保证返回值恒为文案表内字符串
  return GREETINGS[0].text;
}

/**
 * 取设备本地时区的「本地小时」（唯一读时钟的入口）。
 * 只调用 Date#getHours()，不看 getUTCHours、不做任何固定偏移换算。
 * @param date 可注入，便于单测用不同 mock Date 验证「随设备本地时区」。
 */
export function getLocalHour(date: Date = new Date()): number {
  return date.getHours();
}

/**
 * 用设备本地时区当前时刻取问候语（UI 接线阶段可直接调用的便捷入口）。
 * 无参时 new Date() 由调用方环境提供，便于真机跟随系统时区。
 */
export function getGreetingNow(date: Date = new Date()): string {
  return getGreeting(getLocalHour(date));
}

/**
 * 昵称三态归一（纯函数）：
 *  - 有值（trim 后非空且非 wx_ 占位）→ 原值（再截断到 16 码点）
 *  - undefined / null / 空串 / 纯空白 / wx_ 前缀占位 → DEFAULT_NICKNAME「同学」
 * 与 services/account.ts isNicknameUnset 同口径，但不 import 它（保持纯函数层）。
 */
export function resolveNickname(nickname: string | undefined | null): string {
  if (typeof nickname !== 'string') return DEFAULT_NICKNAME;
  const n = nickname.trim();
  if (!n || n.startsWith('wx_')) return DEFAULT_NICKNAME;
  const chars = Array.from(n);
  return chars.length > NICKNAME_MAX_CHARS
    ? chars.slice(0, NICKNAME_MAX_CHARS).join('')
    : n;
}

/**
 * 展示格式严格「<昵称>，<问候语>」（中文全角逗号，非半角）。
 * 纯函数：昵称与 hour 均由调用方传入，本函数不做任何 IO。
 */
export function formatGreeting(nickname: string | undefined | null, hour: number): string {
  return `${resolveNickname(nickname)}，${getGreeting(hour)}`;
}
