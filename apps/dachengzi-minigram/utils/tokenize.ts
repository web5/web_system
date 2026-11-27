/**
 * 英文句子切词（课文详情页 / 首页今日一句共用）
 *
 * 2026-11-26 从 pages/nce/detail/detail.ts 抽出：首页「今日一句」要支持点词查释义 / 朗读 /
 * 收藏，与详情页必须用同一套切词与 hasDef 判定，否则两处点词口径会漂移。
 *
 * 产出「单词 / 非单词」片段：
 *  - w 非空 = 可识别的英文词（小写形式），供 data-w 传参；
 *  - hasDef = 该词是否被当前课文词汇表直收（仅原形；-s/-ed/-ing 等变形由
 *    utils/lexicon.ts 的 lookupWord R3 规则兜底查释义，但不显示点线）。
 */
export interface WordToken {
  /** 片段序号（wx:key，避免嵌套 wx:for 下默认 index 遮蔽） */
  idx: number;
  /** 展示片段（单词或标点/空白） */
  t: string;
  /** 可点单词（小写）；非单词为 '' */
  w: string;
  /** 词汇表直收词：显示点线并可点/长按；表外词恒 false */
  hasDef: boolean;
}

/**
 * 把英文句子切成「单词 / 非单词」片段。
 *
 * BB16（2026-11-26 盲测 D-5 修）：**撇号词与连字符词都整词一个 token**。
 *  - 撇号：`don't` / `It’s`（U+2019）—— 早已支持；
 *  - 连字符：`well-known` / `state-of-the-art` —— 本轮补上。
 *    此前正则只有 `['’]` 分支，`well-known` 被切成 `well` `-` `known` 三片：
 *    用户长按 `well-known` 只读「well」，且两个半词各弹一次四项抽屉。
 *    口径真源：`需求口径确认-B版.md` BB16「一个 token 里含连字符/撇号 → 整词作为一个 token」。
 *
 * 🔴 词内部连接符只认 `'` `’` `-` 三种；其余标点仍是独立「非单词」片段
 *    （`a,b` 里的 `,` 不并进词，BB14 的取词干口径靠这一条）。
 */
export function tokenize(en: string, known?: Record<string, boolean>): WordToken[] {
  const re = /[A-Za-z]+(?:['’-][A-Za-z]+)*|[^A-Za-z]+/g;
  const out: WordToken[] = [];
  let m: RegExpExecArray | null;
  let k = 0;
  const text = String(en || '');
  while ((m = re.exec(text)) !== null) {
    const t = m[0];
    const w = /^[A-Za-z]/.test(t) ? t.toLowerCase() : '';
    out.push({ idx: k++, t, w, hasDef: !!w && !!known && known[w] === true });
  }
  return out;
}

/** 词汇表 → 小写词集合（tokenize 的 hasDef 判定入参）。 */
export function buildKnown(words: ReadonlyArray<{ word?: string }> | null | undefined): Record<string, boolean> {
  const known: Record<string, boolean> = {};
  (words || []).forEach((x) => {
    const k = String((x && x.word) || '').toLowerCase();
    if (k) known[k] = true;
  });
  return known;
}
