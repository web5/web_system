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

/**
 * 昵称展示上限（PRD 默认 ①-2：长昵称截断，避免破版）。
 *
 * 🔴 单位是【字素簇 grapheme cluster】，不是码点 —— 用户眼里「1 个字」= 1 簇。
 * 按码点截断的实测残字（盲测 P2-2）：'a'×15 + '🇨🇳'(2 码点) 会切出孤立的 U+1F1E8
 * （半个旗帜，渲染成字母 C 或豆腐块）；同理 👨‍👩‍👧‍👦(7 码点) 会被切掉大半。
 * 簇级截断保证「截断点永远落在簇边界上」，不产生残字。
 */
export const NICKNAME_MAX_CHARS = 16;

/** Intl.Segmenter 的最小结构声明（tsconfig lib 停在 ES2019，没有 Segmenter 类型）。 */
interface GraphemeSegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}
interface GraphemeSegmenterCtor {
  new (locales?: string, options?: { granularity?: string }): GraphemeSegmenterLike;
}

const ZWJ = 0x200d;

/** 区域指示符（🇨🇳 = 2 个 RI 拼成 1 面旗）。 */
function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}
/** 肤色修饰符（U+1F3FB–U+1F3FF，附着于前一个 emoji）。 */
function isEmojiModifier(cp: number): boolean {
  return cp >= 0x1f3fb && cp <= 0x1f3ff;
}
/** 变体选择符（VS1–VS16 U+FE00–FE0F；补充平面 VS17–VS256 U+E0100–E01EF）。 */
function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}
/**
 * 组合附加符（Mn/Me 的常用区块子集）：拉丁/希腊/西里尔组合符、组合用半符号、
 * 组合用附加符、组合用符号。**不覆盖** 复杂 Indic 连字与韩文 jamo 逐字组合（见下）。
 */
function isCombiningMark(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // Combining Diacritical Marks
    (cp >= 0x0483 && cp <= 0x0489) || // Cyrillic 组合符
    (cp >= 0x1ab0 && cp <= 0x1aff) || // Combining Diacritical Marks Extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // Combining Diacritical Marks Supplement
    (cp >= 0x20d0 && cp <= 0x20ff) || // Combining Diacritical Marks for Symbols
    (cp >= 0xfe20 && cp <= 0xfe2f) // Combining Half Marks
  );
}
/** 附着于前一个码点、不单独成簇的「扩展器」。 */
function isExtender(cp: number): boolean {
  return isEmojiModifier(cp) || isVariationSelector(cp) || isCombiningMark(cp);
}
/** UTF-16 码元长度：补充平面（> U+FFFF）占 2 个 code unit。 */
function unitLen(cp: number): number {
  return cp > 0xffff ? 2 : 1;
}

/**
 * 内置最小字素簇切分（Intl.Segmenter 不可用时的回退，纯函数 / O(n) 单次扫描 / 无正则）。
 *
 * 覆盖（每条都有对应单测）：
 *  a) 代理对（含 emoji 基本盘 U+1F300–U+1FAFF 等所有补充平面字符）不被劈开；
 *  b) 区域指示符两两成对（🇨🇳 = U+1F1E8 U+1F1F3 视为 1 簇；落单的 RI 自成 1 簇，不去切它）；
 *  c) ZWJ 序列（👨‍👩‍👧‍👦 = 4 emoji + 3×U+200D 视为 1 簇）；
 *  d) 肤色修饰（U+1F3FB–U+1F3FF 附着于前者）；
 *  e) 变体选择符（U+FE0E/U+FE0F 等附着于前者）；
 *  f) 组合附加符（U+0300–U+036F 等附着于前者）。
 *
 * 明确**不覆盖**（与 Intl.Segmenter 结果的已知差异，属可接受的降级）：
 *  - 韩文 jamo 逐字组合（U+1100–U+11FF 与现代 Hangul 音节的簇合并）；
 *  - 复杂 Indic 连字 / 辅音簇（梵文、泰米尔文等的 virama 组合）；
 *  - 前置间距标记（SpacingMark）与预置元音符号。
 *  上述语言在昵称场景占比极低，且回退路径只在小程序基础库/老设备无 Segmenter 时启用。
 *
 * 不做模块级缓存：本函数每个页面渲染只调一次，而缓存会让「运行期动态开关
 * Intl.Segmenter」的分支覆盖测试与热更新失真（见 tests/greeting.test.ts 回退分支用例）。
 */
function splitGraphemesFallback(input: string): string[] {
  const out: string[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    const start = i;
    const head = input.codePointAt(i) as number;
    i += unitLen(head);
    // b) 区域指示符两两成对
    if (isRegionalIndicator(head) && i < n) {
      const next = input.codePointAt(i) as number;
      if (isRegionalIndicator(next)) i += unitLen(next);
    }
    // c/d/e/f) 吸收所有附着于前者的后继码点；每轮 i 至少前进 1，保证 O(n) 且不死循环
    for (;;) {
      if (i >= n) break;
      const next = input.codePointAt(i) as number;
      if (isExtender(next)) {
        i += unitLen(next);
        continue;
      }
      if (next !== ZWJ) break;
      i += 1; // 吃掉 ZWJ 本身
      if (i >= n) break;
      const joined = input.codePointAt(i) as number;
      i += unitLen(joined);
      // ZWJ 连接的也可能是旗帜（少见），成对时一并吸收
      if (isRegionalIndicator(joined) && i < n) {
        const paired = input.codePointAt(i) as number;
        if (isRegionalIndicator(paired)) i += unitLen(paired);
      }
    }
    out.push(input.slice(start, i));
  }
  return out;
}

/**
 * 取运行时可用的 Intl.Segmenter 实例；不可用（小程序老基础库 / 未实现）返回 null。
 * 每次调用现取现建，不做模块级缓存（理由见 splitGraphemesFallback 注释）。
 */
function getGraphemeSegmenter(): GraphemeSegmenterLike | null {
  const intl = typeof Intl === 'undefined' ? undefined : (Intl as unknown as { Segmenter?: unknown });
  const Segmenter = intl ? intl.Segmenter : undefined;
  if (typeof Segmenter !== 'function') return null;
  try {
    // 语言标记只影响部分语言的词边界，字素簇切分与 locale 基本无关；固定 'zh' 求确定性
    return new (Segmenter as GraphemeSegmenterCtor)('zh', { granularity: 'grapheme' });
  } catch {
    // 运行时拒绝参数 / 构造失败 → 一律走回退，绝不抛异常
    return null;
  }
}

/** 按字素簇切分：优先 Intl.Segmenter（ICU 全量规则），回退到内置最小实现。 */
function splitGraphemes(input: string): string[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    const out: string[] = [];
    for (const part of segmenter.segment(input)) out.push(part.segment);
    return out;
  }
  return splitGraphemesFallback(input);
}

/**
 * 昵称三态归一（纯函数）：
 *  - 有值（trim 后非空且非 wx_ 占位）→ 原值（再截断到 16 字素簇）
 *  - undefined / null / 空串 / 纯空白 / wx_ 前缀占位 → DEFAULT_NICKNAME「同学」
 * 与 services/account.ts isNicknameUnset 同口径，但不 import 它（保持纯函数层）。
 */
export function resolveNickname(nickname: string | undefined | null): string {
  if (typeof nickname !== 'string') return DEFAULT_NICKNAME;
  const n = nickname.trim();
  if (!n || n.startsWith('wx_')) return DEFAULT_NICKNAME;
  const clusters = splitGraphemes(n);
  return clusters.length > NICKNAME_MAX_CHARS
    ? clusters.slice(0, NICKNAME_MAX_CHARS).join('')
    : n;
}

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
 * 展示格式严格「<昵称>，<问候语>」（中文全角逗号，非半角）。
 * 纯函数：昵称与 hour 均由调用方传入，本函数不做任何 IO。
 */
export function formatGreeting(nickname: string | undefined | null, hour: number): string {
  return `${resolveNickname(nickname)}，${getGreeting(hour)}`;
}
